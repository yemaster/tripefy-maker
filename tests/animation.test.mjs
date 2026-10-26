import test from "node:test";
import assert from "node:assert/strict";
import { createBlankChart, validateChart } from "../src/editor/model.js";
import { ease, pathX, eventValue, noteX, noteOpacity, scrollDistance, invalidateAnimationCache } from "../src/editor/animation.js";

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const note = (extra = {}) => ({ id: "n", time: 2, x: 0.3, duration: 0, ...extra });
const event = (extra = {}) => ({ id: "e", target: "all", property: "speed", time: 0, duration: 2, from: 1, to: 3, curve: "linear", ...extra });
function chartWith(notes = [note()], events = [], extra = {}) {
  return validateChart({ ...createBlankChart(), ...extra, notes, events });
}

test("quadratic easing clamps endpoints and uses matching in/out halves", () => {
  for (const curve of ["linear", "easeIn", "easeOut", "easeInOut"]) {
    assert.equal(ease(-1, curve), 0);
    assert.equal(ease(2, curve), 1);
  }
  near(ease(0.25, "linear"), 0.25);
  near(ease(0.25, "easeIn"), 0.0625);
  near(ease(0.25, "easeOut"), 0.4375);
  near(ease(0.25, "easeInOut"), 0.125);
  near(ease(0.75, "easeInOut"), 0.875);
});

test("path interpolation uses destination curves and holds first/last positions", () => {
  const hold = note({ duration: 4, path: [
    { time: 0, x: 0.3, curve: "linear" },
    { time: 2, x: 0.7, curve: "easeIn" },
    { time: 4, x: 0.1, curve: "easeOut" },
  ] });
  near(pathX(hold, -10), 0.3);
  near(pathX(hold, 1), 0.4);
  near(pathX(hold, 2), 0.7);
  near(pathX(hold, 3), 0.25);
  near(pathX(hold, 20), 0.1);
  near(pathX(note(), 10), 0.3);
});

const smoothHold = nodes => note({
  duration: nodes.at(-1)[0], x: nodes[0][1],
  path: nodes.map(([time, x]) => ({ time, x, curve: "smooth" })),
});

test("smooth holds pass through nodes and never overshoot or reverse inside a segment", () => {
  const cases = [
    [[0, .1], [.1, .4], [3, .45], [4, .9]],
    [[0, .9], [.4, .6], [.5, .1], [4, 0]],
    [[0, .2], [1, .8], [2, .3], [2.1, .5]],
    [[0, .2], [.01, .21], [1, .8]],
    [[0, .2], [1, .2], [2, .8], [3, .8]],
    [[0, .7], [1, .7], [4, .7]],
  ];
  for (const nodes of cases) {
    const hold = smoothHold(nodes);
    for (const [time, x] of nodes) near(pathX(hold, time), x);
    for (let i = 1; i < nodes.length; i += 1) {
      const [ta, xa] = nodes[i - 1], [tb, xb] = nodes[i];
      let previous = xa;
      for (let step = 1; step <= 200; step += 1) {
        const value = pathX(hold, ta + (tb - ta) * step / 200);
        assert.ok(value >= Math.min(xa, xb) - 1e-12 && value <= Math.max(xa, xb) + 1e-12);
        assert.ok((value - previous) * Math.sign(xb - xa) >= -1e-12);
        if (xa === xb) near(value, xa);
        previous = value;
      }
    }
  }
});

test("smooth joins share a tangent at uneven intervals, reversals, and flat sections", () => {
  for (const nodes of [
    [[0, .1], [.3, .4], [2, .8], [5, .9]],
    [[0, .2], [1, .8], [2.5, .3]],
    [[0, .2], [1, .2], [3, .8], [4, .8]],
  ]) {
    const hold = smoothHold(nodes);
    for (let i = 1; i < nodes.length - 1; i += 1) {
      const [time, x] = nodes[i];
      const epsilon = Math.min(time - nodes[i - 1][0], nodes[i + 1][0] - time) * 1e-6;
      const before = (x - pathX(hold, time - epsilon)) / epsilon;
      const after = (pathX(hold, time + epsilon) - x) / epsilon;
      near(before, after, 1e-5);
      if ((x - nodes[i - 1][1]) * (nodes[i + 1][1] - x) <= 0) near(before, 0, 1e-5);
      else assert.ok(before > 0);
    }
  }
});

test("two-node smooth holds stay straight and preserve endpoint positions", () => {
  const hold = smoothHold([[0, .2], [3, .8]]);
  for (let i = 0; i <= 20; i += 1) near(pathX(hold, i * 3 / 20), .2 + .6 * i / 20);
  near(pathX(hold, -1), .2);
  near(pathX(hold, 5), .8);
});

test("events respect offset, defaults, gaps, instant changes, and final persistence", () => {
  const chart = chartWith([note()], [
    event({ time: 2 }),
    event({ id: "e2", time: 6, duration: 0, from: 3, to: 0.5 }),
    event({ id: "e3", time: 8, duration: 2, from: 0.5, to: 1.5 }),
  ], { offset: 0.4 });
  near(eventValue(chart, "speed", 2.3), 1);
  near(eventValue(chart, "speed", 2.4), 1);
  near(eventValue(chart, "speed", 3.4), 2);
  near(eventValue(chart, "speed", 5.4), 3);
  near(eventValue(chart, "speed", 6.4), 0.5);
  near(eventValue(chart, "speed", 9.4), 1);
  near(eventValue(chart, "speed", 100), 1.5);
  near(eventValue(chart, "x", 100), 0);
  near(eventValue(chart, "opacity", 100), 1);
  near(eventValue(chart, "speed", 3.4, "unknown"), 1);
});

test("global and note events combine with base opacity and snake path position", () => {
  const chart = chartWith([note({ duration: 2, opacity: 0.8, path: [
    { time: 0, x: 0.3 }, { time: 2, x: 0.7 },
  ] })], [
    event({ id: "x1", property: "x", duration: 0, from: 0, to: 0.2 }),
    event({ id: "x2", target: "n", property: "x", duration: 0, from: 0, to: -0.1 }),
    event({ id: "a1", property: "opacity", duration: 0, from: 1, to: 0.5 }),
    event({ id: "a2", target: "n", property: "opacity", duration: 0, from: 1, to: 0.25 }),
  ], { offset: 1 });
  near(noteX(chart, chart.notes[0], 4), 0.6);
  near(noteOpacity(chart, chart.notes[0], 4), 0.1);
  chart.events.find(item => item.id === "x1").to = 1;
  near(noteX(chart, chart.notes[0], 4), 1);
});

test("distance is signed, includes base speed, and integrates both event channels", () => {
  const plain = chartWith([note({ speed: 2 })]);
  near(scrollDistance(plain, plain.notes[0], 3, 7), 8);
  near(scrollDistance(plain, plain.notes[0], 7, 3), -8);
  near(scrollDistance(plain, plain.notes[0], 7, 7), 0);
  const chart = chartWith([note({ speed: 2 })], [
    event({ duration: 1, from: 1, to: 2 }),
    event({ id: "local", target: "n", duration: 1, from: 1, to: 2 }),
  ], { offset: 0.5 });
  // Integral of 2(1+t)^2 over [0,1] = 14/3.
  near(scrollDistance(chart, chart.notes[0], 0.5, 1.5), 14 / 3);
  near(scrollDistance(chart, chart.notes[0], 1.5, 0.5), -14 / 3);
  near(scrollDistance(chart, chart.notes[0], 1.5, 2.5), 8);
});

test("compiled speed integrals remain exact across eased midpoints", () => {
  const chart = chartWith([note()], [
    event({ duration: 1, from: 1, to: 2, curve: "easeIn" }),
    event({ id: "local", target: "n", duration: 1, from: 1, to: 2, curve: "easeIn" }),
  ]);
  // Integral of (1+t²)^2 = 1 + 2/3 + 1/5.
  near(scrollDistance(chart, chart.notes[0], 0, 1), 28 / 15);
  chart.events[0].curve = "easeInOut";
  chart.events[1].curve = "easeInOut";
  invalidateAnimationCache(chart);
  // E[ease] = 1/2, E[ease²] = 23/60.
  near(scrollDistance(chart, chart.notes[0], 0, 1), 143 / 60);
  const total = scrollDistance(chart, chart.notes[0], -0.3, 2);
  const parts = scrollDistance(chart, chart.notes[0], -0.3, 0.31)
    + scrollDistance(chart, chart.notes[0], 0.31, 0.81)
    + scrollDistance(chart, chart.notes[0], 0.81, 2);
  near(total, parts);
});

test("instant changes split integration and offset does not change total distance", () => {
  const chart = chartWith([note()], [
    event({ time: 1, duration: 0, from: 1, to: 2 }),
    event({ id: "later", time: 2, duration: 0, from: 2, to: 3 }),
  ]);
  near(scrollDistance(chart, chart.notes[0], 0, 3), 6);
  chart.offset = 10;
  near(scrollDistance(chart, chart.notes[0], 10, 13), 6);
});

test("indexes refresh when replaced and can be invalidated after in-place ordering edits", () => {
  const chart = chartWith([note()], [event({ duration: 0, to: 2 })]);
  near(eventValue(chart, "speed", 5), 2);
  chart.events = [event({ duration: 0, to: 3 })];
  near(eventValue(chart, "speed", 5), 3);
  chart.events[0].target = "n";
  invalidateAnimationCache(chart);
  near(eventValue(chart, "speed", 5), 1);
  near(eventValue(chart, "speed", 5, "n"), 3);
});

test("distant speed ranges use direct elapsed seconds without accumulated drift", () => {
  const chart = chartWith([note()], [event({ time: 1000000, duration: 10, from: 1, to: 3, curve: "easeInOut" })], { duration: 2000000 });
  near(scrollDistance(chart, chart.notes[0], 1000000, 1000010), 20, 1e-8);
  near(scrollDistance(chart, chart.notes[0], 1000010, 1000011), 3);
});

test("global integral caching invalidates correctly after event edits", () => {
  const chart = chartWith([note()], [event({ duration: 1, from: 1, to: 2 })]);
  near(scrollDistance(chart, chart.notes[0], 0, 1), 1.5);
  chart.events[0].to = 3;
  invalidateAnimationCache(chart);
  near(scrollDistance(chart, chart.notes[0], 0, 1), 2);
  chart.events = [event({ duration: 1, from: 1, to: 4 })];
  near(scrollDistance(chart, chart.notes[0], 0, 1), 2.5);
});
