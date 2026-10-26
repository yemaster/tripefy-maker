import test from "node:test";
import assert from "node:assert/strict";
import {
  createBlankChart, createDemoChart, createId, validateChart, serializeChart,
  effectiveTime, snapTime, formatTime, History,
} from "../src/editor/model.js";

const tap = (extra = {}) => ({ id: createId(), time: 2, x: 0.5, duration: 0, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("blank and demo round-trip without mutating the input", () => {
  for (const chart of [createBlankChart(), createDemoChart()]) {
    const before = structuredClone(chart);
    const parsed = JSON.parse(serializeChart(chart));
    assert.deepEqual(parsed, chart);
    assert.deepEqual(chart, before);
    assert.deepEqual(validateChart(parsed), chart);
  }
  const demo = createDemoChart();
  assert.equal(demo.duration, 112);
  assert.ok(demo.notes.some(note => note.duration > 0));
  assert.ok(demo.notes.some((note, i) => i > 0 && note.time === demo.notes[i - 1].time));
  assert.ok(demo.notes.every(note => note.time + note.duration < 30));
});

test('note types round-trip and legacy notes infer tap or hold', () => {
  const chart = createBlankChart();
  chart.notes = ['tap', 'hold', 'drag', 'heartap'].map((type, i) => tap({id:type, type, time: i + 1, duration:type === 'hold' ? .5 : 0}));
  const normalized = validateChart(chart);
  assert.deepEqual(normalized.notes.map(n => n.type), ['tap', 'hold', 'drag', 'heartap']);
  assert.deepEqual(validateChart(JSON.parse(serializeChart(chart))), normalized);
  chart.notes = [tap(), tap({duration:1})];
  assert.deepEqual(validateChart(chart).notes.map(n => n.type), ['tap', 'hold']);
});

test('note type rejects inconsistent duration and point-note paths', () => {
  for (const value of [
    {type:'hold'}, {type:'tap', duration:1}, {type:'drag', duration:1},
    {type:'heartap', duration:1}, {type:'HearTap'}, {type:null},
    ...['tap','drag','heartap'].map(type => ({type,path:[{time:0,x:.5,curve:'linear'}]})),
  ]) {
    const chart=createBlankChart();chart.notes=[tap(value)];
    assert.throws(()=>validateChart(chart),/[\u4e00-\u9fff]/);
  }
});

test("normalization generates IDs, sorts notes, accepts extra fields, and detaches data", () => {
  const chart = createBlankChart();
  chart.ignored = { extension: true };
  chart.metadata.ignored = true;
  chart.notes = [tap({ time: 4 }), { time: 2, x: 0.8, duration: 0 }, { time: 2, x: 0.2, duration: 0 }];
  const normalized = validateChart(chart);
  assert.deepEqual(normalized.notes.map(n => n.x), [0.2, 0.8, 0.5]);
  assert.equal(new Set(normalized.notes.map(n => n.id)).size, 3);
  assert.ok(normalized.notes.every(n => typeof n.id === "string" && n.id));
  assert.equal(normalized.ignored, undefined);
  normalized.metadata.title = "changed";
  normalized.notes[2].time = 30;
  assert.equal(chart.metadata.title, "未命名谱面");
  assert.equal(chart.notes[0].time, 4);
});

test("invalid chart values produce readable errors", () => {
  const invalidMutations = [
    chart => { chart.format = "other"; },
    chart => { chart.version = 2; },
    chart => { chart.bpm = NaN; },
    chart => { chart.bpm = Infinity; },
    chart => { chart.bpm = "108"; },
    chart => { chart.bpm = 19; },
    chart => { chart.bpm = 401; },
    chart => { chart.beatsPerBar = 0; },
    chart => { chart.beatsPerBar = 17; },
    chart => { chart.beatsPerBar = 3.5; },
    chart => { chart.beatsPerBar = "3"; },
    chart => { chart.offset = Infinity; },
    chart => { chart.duration = 0; },
    chart => { chart.metadata.level = 100; },
    chart => { chart.metadata.level = 1.5; },
    chart => { chart.scene.preset = "rain"; },
    chart => { chart.notes = [tap({ x: -0.01 })]; },
    chart => { chart.notes = [tap({ x: 1.01 })]; },
    chart => { chart.notes = [tap({ time: -1 })]; },
    chart => { chart.notes = [tap({ duration: -1 })]; },
    chart => { chart.notes = [tap({ duration: Infinity })]; },
    chart => { chart.notes = [tap({ id: "duplicate" }), tap({ id: "duplicate" })]; },
    chart => { chart.notes = [tap({ id: 12 })]; },
    chart => { chart.notes = {}; },
    chart => { chart.notes = [null]; },
    chart => { chart.notes = Array(50001).fill(tap()); },
  ];
  for (const mutate of invalidMutations) {
    const chart = createBlankChart();
    mutate(chart);
    assert.throws(() => validateChart(chart), /[\u4e00-\u9fff]/);
  }
  assert.throws(() => validateChart(null), /谱面/);
});

test("duration covers effective hold tails and negative offsets remain valid", () => {
  const chart = createBlankChart();
  chart.offset = -1;
  chart.duration = 5;
  chart.notes = [tap({ time: 1 }), tap({ time: 4, duration: 2 })];
  const normalized = validateChart(chart);
  assert.equal(effectiveTime(normalized.notes[0], normalized), 0);
  chart.notes[0].time = 0.9;
  assert.throws(() => validateChart(chart), /早于音频起点/);
  chart.notes[0].time = 1;
  chart.notes[1].duration = 2.01;
  assert.throws(() => validateChart(chart), /超出谱面长度/);
});

test("title must contain text, and audio paths match the native player contract", () => {
  const chart = createBlankChart();
  for (const title of ["", "  ", "\n\t", "\u3000"]) {
    chart.metadata.title = title;
    assert.throws(() => validateChart(chart), /曲名不能为空/);
  }
  chart.metadata.title = "  Afterglow  ";
  assert.equal(validateChart(chart).metadata.title, chart.metadata.title);
  for (const audio of ["", "afterglow.mp3", "audio/song.ogg", "./audio/song.WAV", "余晖.wav"]) {
    chart.audio = audio;
    assert.equal(validateChart(chart).audio, audio);
  }
  chart.audio = "audio\\song.mp3";
  assert.equal(validateChart(chart).audio, "audio/song.mp3");
  for (const audio of ["/song.mp3", "\\song.mp3", "C:\\song.mp3", "https://example.com/song.mp3", "../song.mp3", "audio/../song.mp3", "audio\\..\\song.wav", "song.flac", "song", "song.mp3/", "song.wav "]) {
    chart.audio = audio;
    assert.throws(() => validateChart(chart), /音频/);
  }
});

test("older charts gain note defaults, straight hold paths, and an empty event list", () => {
  const input = createBlankChart();
  delete input.events;
  input.notes = [tap(), tap({ time: 5, x: 0.3, duration: 2 })];
  const chart = validateChart(input);
  assert.deepEqual(chart.events, []);
  assert.equal(chart.notes[0].opacity, 1);
  assert.equal(chart.notes[0].speed, 1);
  assert.deepEqual(chart.notes[0].path, []);
  assert.deepEqual(chart.notes[1].path, [
    { time: 0, x: 0.3, curve: "smooth" }, { time: 2, x: 0.3, curve: "smooth" },
  ]);
  assert.equal(input.notes[0].opacity, undefined);
});

test("snake paths, note properties, and timeline events survive serialization", () => {
  const input = createBlankChart();
  input.notes = [tap({ id: "hold", x: 0.2, duration: 4, opacity: 0.7, speed: 1.8, path: [
    { time: 0, x: 0.2, curve: "linear" },
    { time: 1, x: 0.8, curve: "easeIn" },
    { time: 4, x: 0.4, curve: "easeOut" },
  ] })];
  input.events = [
    { id: "speed", target: "all", property: "speed", time: 2, duration: 3, from: 1, to: 2, curve: "easeInOut" },
    { id: "shift", target: "hold", property: "x", time: 2, duration: 3, from: 0, to: -0.2, curve: "linear" },
    { id: "fade", target: "hold", property: "opacity", time: 2, duration: 3, from: 1, to: 0.5, curve: "easeOut" },
  ];
  const chart = validateChart(input);
  assert.deepEqual(JSON.parse(serializeChart(chart)), chart);
  chart.notes[0].path[1].x = 0.1;
  chart.events[0].to = 0.4;
  assert.equal(input.notes[0].path[1].x, 0.8);
  assert.equal(input.events.find(item => item.id === chart.events[0].id).to, 2);
});

test("smooth paths round-trip while omitted curves on explicit legacy paths stay linear", () => {
  const input = createBlankChart();
  input.notes = [tap({ x: .2, duration: 4, path: [
    { time: 0, x: .2, curve: "smooth" },
    { time: 1, x: .8, curve: "smooth" },
    { time: 4, x: .4, curve: "smooth" },
  ] })];
  const chart = validateChart(input);
  assert.deepEqual(JSON.parse(serializeChart(chart)), chart);
  assert.deepEqual(validateChart(JSON.parse(serializeChart(chart))).notes[0].path, input.notes[0].path);
  for (const node of input.notes[0].path) delete node.curve;
  assert.ok(validateChart(input).notes[0].path.every(node => node.curve === "linear"));
});

test("invalid snake paths and note animation properties are rejected", () => {
  const invalid = [
    { id: "all" }, { opacity: -0.1 }, { opacity: 1.1 }, { speed: 0.09 }, { speed: 8.1 },
    { opacity: NaN }, { speed: Infinity }, { path: {} },
    { path: [{ time: 0, x: 0.5 }, { time: 1, x: 0.5 }] },
    { duration: 2, path: [{ time: 0, x: 0.5 }] },
    { duration: 2, path: [{ time: 0.1, x: 0.5 }, { time: 2, x: 0.5 }] },
    { duration: 2, path: [{ time: 0, x: 0.4 }, { time: 2, x: 0.5 }] },
    { duration: 2, path: [{ time: 0, x: 0.5 }, { time: 1.9, x: 0.5 }] },
    { duration: 2, path: [{ time: 0, x: 0.5 }, { time: 2, x: 1.1 }] },
    { duration: 2, path: [{ time: 0, x: 0.5 }, { time: 1, x: 0.5 }, { time: 1, x: 0.3 }, { time: 2, x: 0.5 }] },
    { duration: 2, path: [{ time: 0, x: 0.5 }, { time: 2, x: 0.5, curve: "other" }] },
  ];
  for (const extra of invalid) {
    const chart = createBlankChart();
    chart.notes = [tap(extra)];
    assert.throws(() => validateChart(chart), /[\u4e00-\u9fff]/);
  }
});

test("events validate ranges, references, offsets, and nonoverlapping channels", () => {
  const base = { id: "event", target: "all", property: "speed", time: 1, duration: 2, from: 1, to: 2, curve: "linear" };
  const chart = createBlankChart();
  chart.notes = [tap({ id: "note" })];
  for (const extra of [
    { target: "missing" }, { property: "rotation" }, { time: -1 }, { time: 120 }, { duration: -1 },
    { from: 0 }, { to: 9 }, { from: NaN }, { to: Infinity }, { curve: "unknown" }, { curve: "smooth" },
    { property: "x", from: -1.1, to: 0 }, { property: "x", from: 0, to: 1.1 },
    { property: "opacity", from: 1.1, to: 0 },
  ]) {
    chart.events = [{ ...base, ...extra }];
    assert.throws(() => validateChart(chart), /[\u4e00-\u9fff]/);
  }
  for (const extra of [{ time: 1, duration: 0 }, { time: 2, duration: 0 }, { time: 2, duration: 2 }]) {
    chart.events = [base, { ...base, id: "second", ...extra }];
    assert.throws(() => validateChart(chart), /重叠|同一时刻/);
  }
  chart.events = [base, { ...base, id: "second", time: 3, duration: 0 }, { ...base, id: "third", target: "note" }];
  assert.equal(validateChart(chart).events.length, 3);
  chart.events = [{ ...base, id: undefined, target: "note" }];
  assert.ok(validateChart(chart).events[0].id);
  chart.offset = -2;
  assert.throws(() => validateChart(chart), /播放范围/);
});

test("snap respects offset, arbitrary divisions, and triplets", () => {
  const chart = createBlankChart();
  chart.bpm = 120;
  chart.offset = 0.2;
  near(snapTime(0.83, chart, 4), 0.825);
  near(snapTime(1.04, chart, 3), 0.2 + 5 / 6);
  near(snapTime(0, chart, 4), 0.2);
  chart.offset = -0.2;
  near(snapTime(0, chart, 4), 0.05);
  near(snapTime(1.31, chart, 1), 1.3);
  for (let division = 1; division <= 64; division += 1) assert.ok(Number.isFinite(snapTime(3, chart, division)));
  for (const division of [0, 65, 1.5, NaN, Infinity, "5"]) {
    assert.throws(() => snapTime(3, chart, division), /细分/);
  }
  assert.throws(() => snapTime(NaN, chart, 4), /播放时间/);
});

test("quintuplets, septuplets, and tuplets across multiple beats retain their grid", () => {
  const chart = { ...createBlankChart(), bpm: 120, offset: 0.2 };
  near(snapTime(0.39, chart, 5), 0.4);
  near(snapTime(0.41, chart, 7), 0.2 + 3 / 14);
  near(snapTime(0.79, chart, 5, 2), 0.8);
  near(snapTime(1.06, chart, 7, 4), 0.2 + 6 / 7);
  near(snapTime(0.47, chart, 3, 2), 0.2 + 1 / 3);
  near(snapTime(0.32, chart, 2, 0.5), 0.325);
  for (const span of [0, -1, NaN, Infinity, "2"]) {
    assert.throws(() => snapTime(3, chart, 5, span), /跨度/);
  }
});

test("long timelines snap directly to the grid without cumulative drift", () => {
  const chart = { ...createBlankChart(), bpm: 137.3, offset: -0.173 };
  for (const division of [3, 5, 7, 64]) {
    for (const span of [1, 2, 4]) {
      const step = 60 / chart.bpm * span / division;
      for (const tick of [10001, 1000001, 10000001]) {
        const expected = chart.offset + tick * step;
        const snapped = snapTime(expected + step * 0.2, chart, division, span);
        near(snapped, expected);
        near(snapTime(snapped, chart, division, span), snapped);
      }
    }
  }
});

test("beats per bar defaults for older files and survives export", () => {
  const chart = createBlankChart();
  assert.equal(chart.beatsPerBar, 4);
  delete chart.beatsPerBar;
  assert.equal(validateChart(chart).beatsPerBar, 4);
  assert.equal(chart.beatsPerBar, undefined);
  for (const beatsPerBar of [1, 3, 5, 7, 16]) {
    chart.beatsPerBar = beatsPerBar;
    assert.equal(JSON.parse(serializeChart(chart)).beatsPerBar, beatsPerBar);
  }
});

test("time formatting rounds milliseconds with correct carry", () => {
  assert.equal(formatTime(0), "00:00.000");
  assert.equal(formatTime(65.123), "01:05.123");
  assert.equal(formatTime(59.9996), "01:00.000");
  assert.equal(formatTime(-0.125), "−00:00.125");
  assert.equal(formatTime(Infinity), "00:00.000");
});

test("undo/redo snapshots stay independent and new changes invalidate redo", () => {
  const history = new History();
  const original = createBlankChart();
  const edited = structuredClone(original);
  edited.notes.push(tap());
  history.push(original);
  original.metadata.title = "external mutation";
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  const restored = history.undo(edited);
  assert.equal(restored.metadata.title, "未命名谱面");
  assert.equal(restored.notes.length, 0);
  edited.notes[0].x = 0.9;
  const redone = history.redo(restored);
  assert.equal(redone.notes[0].x, 0.5);
  assert.equal(history.canRedo, false);
  history.undo(redone);
  assert.equal(history.canRedo, true);
  history.push(restored);
  assert.equal(history.canRedo, false);
});

test("history limit and empty undo/redo preserve independent current state", () => {
  const history = new History({ limit: 2 });
  const chart = createBlankChart();
  const empty = history.undo(chart);
  empty.metadata.title = "independent";
  assert.equal(chart.metadata.title, "未命名谱面");
  for (let n = 0; n < 3; n += 1) history.push({ n });
  assert.deepEqual(history.undo({ n: 3 }), { n: 2 });
  assert.deepEqual(history.undo({ n: 2 }), { n: 1 });
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo({ n: 1 }), { n: 2 });
  assert.deepEqual(history.redo({ n: 2 }), { n: 3 });
  assert.equal(history.canRedo, false);
});
