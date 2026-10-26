import test from 'node:test';
import assert from 'node:assert/strict';
import {pixelsPerSecond, wheelPixels, wheelTimeDelta, wheelZoom, anchoredZoomTime, stepTime} from '../src/editor/navigation.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const chart = {bpm: 137, offset: .175, duration: 120};

test('wheel movement stays 48 CSS pixels at every zoom, including fine control', () => {
  for (const zoom of [55, 100, 150, 220]) {
    near(wheelTimeDelta({deltaY: 120}, zoom, 720) * pixelsPerSecond(zoom), 48);
    near(wheelTimeDelta({deltaY: -120, shiftKey: true}, zoom, 720) * pixelsPerSecond(zoom), -12);
  }
  assert.ok(wheelTimeDelta({deltaY: 120}, 220, 720) < .16);
});

test('trackpad fractions accumulate without jumping beats or treating horizontal scroll as vertical', () => {
  const small = wheelTimeDelta({deltaY: .5}, 220, 720);
  near(small * 240, wheelTimeDelta({deltaY: 120}, 220, 720));
  near(wheelTimeDelta({deltaY: 0, deltaX: 120}, 100, 720), 0);
  near(wheelTimeDelta({deltaY: NaN}, 100, 720), 0);
  near(wheelZoom({deltaY: 0}, 100, 720), 100);
});

test('line/page wheel modes normalize and large events cannot skip a screen', () => {
  near(wheelPixels({deltaY: 3, deltaMode: 1}, 720), 48);
  near(wheelPixels({deltaY: 1, deltaMode: 2}, 720), 720);
  for (const height of [300, 720]) for (const deltaY of [-10000, 10000]) {
    const distance = Math.abs(wheelTimeDelta({deltaY}, 220, height) * pixelsPerSecond(220));
    assert.ok(distance <= Math.min(96, height * .2));
  }
});

test('zoom preserves time beneath pointer and respects limits', () => {
  for (const pointer of [50, 200, 550, 650]) {
    const time = anchoredZoomTime(12, 100, 220, 550, pointer);
    near(time + (550 - pointer) / pixelsPerSecond(220), 12 + (550 - pointer) / pixelsPerSecond(100));
  }
  assert.equal(wheelZoom({deltaY: -10000}, 215, 720), 220);
  assert.equal(wheelZoom({deltaY: 10000}, 60, 720), 55);
});

test('grid stepping reaches exact thirds, fifths, sevenths and custom spans after free scrolling', () => {
  for (const division of [1, 3, 5, 7, 16, 64]) for (const span of [1, 2, 4]) {
    const step = 60 / chart.bpm * span / division;
    const onGrid = chart.offset + 11 * step;
    near(stepTime(onGrid, 1, chart, division, span), onGrid + step);
    near(stepTime(onGrid, -1, chart, division, span), onGrid - step);
    near(stepTime(onGrid + step * .3, 1, chart, division, span), onGrid + step);
    near(stepTime(onGrid + step * .3, -1, chart, division, span), onGrid);
  }
  assert.equal(stepTime(0, -1, chart), 0);
  assert.equal(stepTime(120, 1, chart), 120);
  near(stepTime(0, 1, {...chart, offset: -.1}), 60 / chart.bpm - .1);
});
