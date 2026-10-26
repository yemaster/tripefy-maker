import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY_COUNTS, laneCount, laneCenters, snapHorizontal, validHorizontalMode, constrainHorizontalShift} from '../src/editor/lanes.js';
import {alignSelection, copySelection, pasteSelection, mirrorSelection, moveSelection} from '../src/editor/operations.js';
import {createBlankChart, validateChart, History} from '../src/editor/model.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const fixture = () => validateChart({...createBlankChart(), duration: 40, notes: [
  {id: 'hold', time: 2, x: .13, duration: 2, path: [{time: 0, x: .13}, {time: 1, x: .69}, {time: 2, x: .32}]},
  {id: 'tap', time: 3, x: .6, duration: 0},
], events: [
  {id: 'x', target: 'hold', property: 'x', time: 2, duration: 1, from: .1, to: -.2, curve: 'linear'},
  {id: 'global', target: 'all', property: 'speed', time: 0, duration: 0, from: 1, to: 2, curve: 'linear'},
]});

test('4K–9K use lane centers, with symmetric outer lanes and bounded edges', () => {
  assert.deepEqual(laneCenters(4), [.125, .375, .625, .875]);
  for (const keys of KEY_COUNTS) {
    const mode = `${keys}k`, centers = laneCenters(keys);
    assert.equal(laneCount(mode), keys);
    assert.ok(validHorizontalMode(mode));
    near(snapHorizontal(-.3, mode), centers[0]);
    near(snapHorizontal(1.3, mode), centers.at(-1));
    for (const [index, x] of centers.entries()) {
      near(snapHorizontal(x, mode), x);
      near(snapHorizontal(index / keys + .01 / keys, mode), x);
      near(snapHorizontal(1 - x, mode), centers[keys - 1 - index]);
    }
  }
});

test('free mode, legacy grids, and Alt retain their original placement behavior', () => {
  near(snapHorizontal(.29, '0'), .29);
  near(snapHorizontal(.29, '4k', true), .29);
  near(snapHorizontal(.29, '8'), .25);
  near(snapHorizontal(.29, '16'), .3125);
  for (const value of [null, '', '10k', '7', 'invalid']) assert.equal(validHorizontalMode(value), false);
  assert.equal(laneCount('8'), 0);
});

test('lane alignment updates only selected heads and path positions and remains undoable', () => {
  let chart = fixture(); const original = structuredClone(chart), history = new History();
  history.push(chart); alignSelection(chart, new Set(['hold']), '5k');
  assert.deepEqual(chart.notes[0].path.map(p => p.x), [.1, .7, .3]);
  near(chart.notes[0].x, .1);
  assert.deepEqual(chart.notes[1], original.notes[1]);
  assert.deepEqual(chart.events, original.events);
  validateChart(chart);
  chart = history.undo(chart); assert.deepEqual(chart, original);
  chart = history.redo(chart); near(chart.notes[0].path[1].x, .7);
});

test('mirror paste clones paths and local position events without mutating the clipboard', () => {
  const chart = fixture(), original = structuredClone(chart), ids = new Set(['hold', 'tap']);
  const clipboard = copySelection(chart, ids), saved = structuredClone(clipboard);
  const pastedIds = pasteSelection(chart, clipboard, 10, {mirror: true});
  const pasted = chart.notes.find(note => note.id === pastedIds[0]);
  near(pasted.x, .87); assert.deepEqual(pasted.path.map(node => node.time), [0, 1, 2]);
  for (let i = 0; i < pasted.path.length; i++) near(pasted.path[i].x, 1 - original.notes[0].path[i].x);
  const event = chart.events.find(item => item.target === pasted.id);
  near(event.from, -.1); near(event.to, .2); near(event.time, 10);
  assert.equal(chart.events.filter(item => item.target === 'all').length, 1);
  assert.deepEqual(clipboard, saved);
  assert.deepEqual(chart.notes.slice(0, 2), original.notes);
  const regular = pasteSelection(chart, clipboard, 20);
  near(chart.notes.find(note => note.id === regular[0]).x, .13);
  validateChart(chart);
});

test('K-mode group dragging stops on whole lanes at both edges without deforming holds', () => {
  for (const keys of KEY_COUNTS) {
    const before = fixture(); alignSelection(before, new Set(['hold', 'tap']), `${keys}k`);
    for (const request of [-3, -.5, 1 / keys, .5, 3]) {
      const after = structuredClone(before);
      moveSelection(after, before, new Set(['hold', 'tap']), 1, request, 1 / keys);
      // App requests a snapped anchor shift, so use that same lattice here.
      const anchored = Math.round(request * keys) / keys;
      const aligned = structuredClone(before);
      moveSelection(aligned, before, new Set(['hold', 'tap']), 1, anchored, 1 / keys);
      const dx = aligned.notes[0].x - before.notes[0].x;
      near(dx * keys, Math.round(dx * keys));
      for (const [index, note] of aligned.notes.entries()) {
        near(note.x - before.notes[index].x, dx);
        for (const [i, node] of note.path.entries()) near(node.x - before.notes[index].path[i].x, dx);
      }
      validateChart(after); validateChart(aligned);
    }
    const mirrored = structuredClone(before);
    mirrorSelection(mirrored, new Set(['hold', 'tap']));
    for (const note of mirrored.notes) near(snapHorizontal(note.x, `${keys}k`), note.x);
  }
  near(constrainHorizontalShift(.25, -.125, .125, .25), 0);
  near(constrainHorizontalShift(.125, 0, 0, .25), 0);
});
