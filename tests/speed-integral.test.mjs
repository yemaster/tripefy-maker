import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankChart, validateChart} from '../src/editor/model.js';
import {scrollDistance, eventValue, invalidateAnimationCache} from '../src/editor/animation.js';

// Independent three-point Gaussian integration of the authored events.
function referenceDistance(chart, note, from, to) {
  if (from > to) return -referenceDistance(chart, note, to, from);
  const cuts = [from, to];
  for (const event of chart.events) if (event.property === 'speed' && ['all', note.id].includes(event.target)) {
    for (const relative of [event.time, event.time + event.duration / 2, event.time + event.duration]) {
      const time = relative + chart.offset;
      if (time > from && time < to) cuts.push(time);
    }
  }
  cuts.sort((a, b) => a - b);
  const speed = time => note.speed * eventValue(chart, 'speed', time)
    * eventValue(chart, 'speed', time, note.id);
  let total = 0;
  for (let i = 1; i < cuts.length; i++) {
    const half = (cuts[i] - cuts[i - 1]) / 2, mid = cuts[i - 1] + half;
    const node = half * Math.sqrt(3 / 5);
    total += half * (5 / 9 * speed(mid - node) + 8 / 9 * speed(mid) + 5 / 9 * speed(mid + node));
  }
  return total;
}

test('compiled global/local speed products agree with independent integration through seeks and jumps', () => {
  const curves = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
  for (const globalCurve of curves) for (const localCurve of curves) {
    const chart = validateChart({...createBlankChart(), offset: .375, duration: 20,
      notes: [{id: 'hold', time: 5, x: .3, duration: 3, speed: 1.7}, {id: 'tap', time: 7, x: .7, duration: 0}],
      events: [
        {id: 'g', target: 'all', property: 'speed', time: .5, duration: 2.7, from: .1, to: 3.1, curve: globalCurve},
        {id: 'l', target: 'hold', property: 'speed', time: 1.2, duration: 3.9, from: 2.6, to: .6, curve: localCurve},
        {id: 'jump', target: 'hold', property: 'speed', time: 5.1, duration: 0, from: .6, to: 4, curve: 'linear'},
        {id: 'short', target: 'all', property: 'speed', time: 5, duration: .001, from: .7, to: 1.9, curve: globalCurve},
      ]});
    for (const note of chart.notes) for (const from of [-2, .875, 1.9, 3.575, 5.375, 7, 2, 12]) {
      for (const to of [-1, .875, 2.3, 3.575, 5.375, 5.3755, 5.376, 5.475, 8, 10]) {
        const expected = referenceDistance(chart, note, from, to);
        assert.ok(Math.abs(scrollDistance(chart, note, from, to) - expected) < 1e-9, `${globalCurve}/${localCurve} ${from}→${to}`);
      }
    }
  }
});

test('editing, deleting, undoing, and retargeting speed events cannot leave a stale preview integral', () => {
  const chart = validateChart({...createBlankChart(), notes: [{id: 'n', time: 5, x: .5, duration: 0}],
    events: [{id: 'e', target: 'n', property: 'speed', time: 1, duration: 2, from: 1, to: 2, curve: 'linear'}]});
  const note = chart.notes[0];
  const check = () => assert.ok(Math.abs(scrollDistance(chart, note, .5, 8) - referenceDistance(chart, note, .5, 8)) < 1e-10);
  check();
  chart.events[0].to = 4; invalidateAnimationCache(chart); check();
  chart.events[0].target = 'all'; invalidateAnimationCache(chart); check();
  const saved = structuredClone(chart.events);
  chart.events = []; check();
  chart.events = saved; check();
});
