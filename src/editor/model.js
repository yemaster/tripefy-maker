const FORMAT = "tripefy.chart";
const VERSION = 1;
const SCENES = new Set(["dusk", "night", "clear", "overcast"]);
const CURVES = new Set(["linear", "easeIn", "easeOut", "easeInOut"]);
const EVENT_RANGES = { speed: [0.1, 8], x: [-1, 1], opacity: [0, 1] };
let nextId = 0;

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  nextId += 1;
  return `n-${Date.now().toString(36)}-${nextId.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象。`);
  }
  return value;
}

function number(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}必须是有效数字。`);
  }
  if (value < minimum || value > maximum) {
    if (minimum === 0 && maximum === Infinity) throw new Error(`${label}不能小于 0。`);
    throw new Error(`${label}必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return value;
}

function string(value, label, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new Error(`${label}必须是文字。`);
  return value;
}

function curve(value, label) {
  const result = value === undefined ? "linear" : value;
  if (!CURVES.has(result)) throw new Error(`${label}必须是 linear、easeIn、easeOut 或 easeInOut。`);
  return result;
}

function normalizePath(value, duration, x, label) {
  if (value !== undefined && !Array.isArray(value)) throw new Error(`${label}的位置节点必须是数组。`);
  if (duration === 0) {
    if (value?.length) throw new Error(`${label}是单点音符，不能包含长按位置节点。`);
    return [];
  }
  if (!value?.length) return [{ time: 0, x, curve: "linear" }, { time: duration, x, curve: "linear" }];
  if (value.length < 2) throw new Error(`${label}的位置节点必须包含长按的起点和终点。`);
  const path = value.map((item, index) => {
    const nodeLabel = `${label}的第 ${index + 1} 个位置节点`;
    const node = object(item, nodeLabel);
    return {
      time: number(node.time, `${nodeLabel}时间`, 0),
      x: number(node.x, `${nodeLabel}横向位置`, 0, 1),
      curve: curve(node.curve, `${nodeLabel}缓动`),
    };
  });
  if (Math.abs(path[0].time) > 1e-9 || Math.abs(path.at(-1).time - duration) > 1e-9) {
    throw new Error(`${label}的位置节点必须从 0 秒开始，并在长按结束时间终止。`);
  }
  if (Math.abs(path[0].x - x) > 1e-9) throw new Error(`${label}的位置起点必须与音符头部对齐。`);
  path[0].time = 0;
  path[0].x = x;
  path.at(-1).time = duration;
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].time <= path[i - 1].time || path[i].time > duration) {
      throw new Error(`${label}的位置节点时间必须依次递增，不能重复或超出长按长度。`);
    }
  }
  return path;
}

export function createBlankChart() {
  return {
    format: FORMAT,
    version: VERSION,
    metadata: { title: "未命名谱面", artist: "", charter: "", difficulty: "NORMAL", level: 3 },
    audio: "",
    bpm: 108,
    beatsPerBar: 4,
    offset: 0,
    duration: 120,
    scene: { preset: "dusk" },
    notes: [],
    events: [],
  };
}

export function createDemoChart() {
  const chart = createBlankChart();
  chart.metadata.title = "Afterglow";
  chart.metadata.artist = "余晖";
  chart.duration = 112;
  const beat = 60 / chart.bpm;
  const positions = [0.28, 0.64, 0.42, 0.72, 0.35, 0.58];
  const add = (b, x, length = 0) => {
    chart.notes.push({ id: createId(), time: b * beat, x, duration: length * beat });
  };
  for (let bar = 0; bar < 12; bar += 1) {
    const start = 2 + bar * 4;
    add(start, positions[bar % positions.length]);
    add(start + 1, 0.32);
    add(start + 1, 0.68);
    add(start + 2, bar % 2 ? 0.62 : 0.38, bar % 3 === 1 ? 1.5 : 0);
    if (bar % 3 !== 1) add(start + 3, positions[(bar + 2) % positions.length]);
  }
  return validateChart(chart);
}

/** Return an independent, normalized chart. Extra fields are accepted and omitted. */
export function validateChart(input) {
  const source = object(input, "谱面");
  if (source.format !== FORMAT) throw new Error("文件不是 Tripefy 谱面格式。");
  if (source.version !== VERSION) throw new Error("不支持此谱面版本，请使用版本 1。");
  const metadata = object(source.metadata, "曲目信息");
  const title = string(metadata.title, "曲名");
  if (!title.trim()) throw new Error("曲名不能为空。");
  const audio = string(source.audio, "音频文件名", "").replaceAll("\\", "/");
  if (audio) {
    if (audio.startsWith("/") || audio.includes(":") || audio.split("/").includes("..")) {
      throw new Error("音频必须使用谱面文件夹内的相对路径，不能包含绝对路径或上级目录。");
    }
    if (!/\.(mp3|ogg|wav)$/i.test(audio)) throw new Error("音频文件必须是 MP3、OGG 或 WAV 格式。");
  }
  const scene = object(source.scene, "场景");
  if (!SCENES.has(scene.preset)) throw new Error("场景必须是 dusk、night、clear 或 overcast。");

  const bpm = number(source.bpm, "BPM", 20, 400);
  const beatsPerBar = number(source.beatsPerBar === undefined ? 4 : source.beatsPerBar, "每小节拍数", 1, 16);
  if (!Number.isInteger(beatsPerBar)) throw new Error("每小节拍数必须是 1 到 16 之间的整数。");
  const offset = number(source.offset, "音频偏移");
  const duration = number(source.duration, "谱面长度", 0);
  if (duration === 0) throw new Error("谱面长度必须大于 0 秒。");
  const level = number(metadata.level, "难度等级", 1, 99);
  if (!Number.isInteger(level)) throw new Error("难度等级必须是 1 到 99 之间的整数。");
  if (!Array.isArray(source.notes)) throw new Error("音符列表必须是数组。");
  if (source.notes.length > 50000) throw new Error("单个谱面最多支持 50000 个音符。");

  const ids = new Set();
  const notes = source.notes.map((value, index) => {
    const label = `第 ${index + 1} 个音符`;
    const note = object(value, label);
    let id = note.id;
    if (id === undefined || id === null || id === "") {
      do { id = createId(); } while (ids.has(id));
    }
    if (typeof id !== "string") throw new Error(`${label}的 ID 必须是文字。`);
    if (id === "all") throw new Error(`${label}不能使用保留 ID「all」。`);
    if (ids.has(id)) throw new Error(`${label}的 ID 重复，请为每个音符使用不同 ID。`);
    ids.add(id);
    const time = number(note.time, `${label}的时间`, 0);
    const x = number(note.x, `${label}的横向位置`, 0, 1);
    const length = number(note.duration, `${label}的持续时间`, 0);
    if (time + offset < -1e-9) throw new Error(`${label}在偏移后早于音频起点。`);
    if (time + offset + length > duration + 1e-9) {
      throw new Error(`${label}超出谱面长度，请延长谱面或调整音符时间。`);
    }
    return {
      id, time, x, duration: length,
      opacity: number(note.opacity === undefined ? 1 : note.opacity, `${label}的透明度`, 0, 1),
      speed: number(note.speed === undefined ? 1 : note.speed, `${label}的速度`, 0.1, 8),
      path: normalizePath(note.path, length, x, label),
    };
  });
  notes.sort((a, b) => a.time - b.time || a.x - b.x);

  const sourceEvents = source.events === undefined ? [] : source.events;
  if (!Array.isArray(sourceEvents)) throw new Error("事件列表必须是数组。");
  if (sourceEvents.length > 50000) throw new Error("单个谱面最多支持 50000 个事件。");
  const eventIds = new Set();
  const channels = new Map();
  const events = sourceEvents.map((value, index) => {
    const label = `第 ${index + 1} 个事件`;
    const event = object(value, label);
    let id = event.id;
    if (id === undefined || id === null || id === "") {
      do { id = createId(); } while (eventIds.has(id));
    }
    if (typeof id !== "string") throw new Error(`${label}的 ID 必须是文字。`);
    if (eventIds.has(id)) throw new Error(`${label}的 ID 重复。`);
    eventIds.add(id);
    const target = string(event.target, `${label}的目标`);
    if (target !== "all" && !ids.has(target)) throw new Error(`${label}引用的音符不存在。`);
    const property = event.property;
    if (!Object.hasOwn(EVENT_RANGES, property)) throw new Error(`${label}的属性必须是 speed、x 或 opacity。`);
    const [minimum, maximum] = EVENT_RANGES[property];
    const time = number(event.time, `${label}的时间`, 0);
    const length = number(event.duration, `${label}的持续时间`, 0);
    if (time + offset < -1e-9 || time + offset + length > duration + 1e-9) {
      throw new Error(`${label}在偏移后超出谱面播放范围。`);
    }
    const normalized = {
      id, target, property, time, duration: length,
      from: number(event.from, `${label}的起始值`, minimum, maximum),
      to: number(event.to, `${label}的结束值`, minimum, maximum),
      curve: curve(event.curve, `${label}的缓动`),
    };
    const key = JSON.stringify([target, property]);
    if (!channels.has(key)) channels.set(key, []);
    channels.get(key).push(normalized);
    return normalized;
  });
  for (const channel of channels.values()) {
    channel.sort((a, b) => a.time - b.time);
    for (let i = 1; i < channel.length; i += 1) {
      const previous = channel[i - 1];
      const current = channel[i];
      if (current.time === previous.time || current.time < previous.time + previous.duration - 1e-9) {
        throw new Error("同一目标、同一属性的事件不能重叠或在同一时刻重复开始。");
      }
    }
  }
  events.sort((a, b) => a.time - b.time || a.target.localeCompare(b.target) || a.property.localeCompare(b.property));

  return {
    format: FORMAT,
    version: VERSION,
    metadata: {
      title,
      artist: string(metadata.artist, "曲师", ""),
      charter: string(metadata.charter, "谱师", ""),
      difficulty: string(metadata.difficulty, "难度名称", "NORMAL"),
      level,
    },
    audio,
    bpm,
    beatsPerBar,
    offset,
    duration,
    scene: { preset: scene.preset },
    notes,
    events,
  };
}

export function serializeChart(chart) {
  return `${JSON.stringify(validateChart(chart), null, 2)}\n`;
}

export function effectiveTime(note, chart) {
  return note.time + chart.offset;
}

/** Snap playback seconds to `division` equal steps across `span` beats, from chart.offset. */
export function snapTime(seconds, chart, division = 4, span = 1) {
  number(seconds, "播放时间");
  number(chart.bpm, "BPM", 20, 400);
  number(chart.offset, "音频偏移");
  if (!Number.isInteger(division) || division < 1 || division > 64) {
    throw new Error("节拍细分必须是 1 到 64 之间的整数。");
  }
  number(span, "细分跨度", 0);
  if (span === 0) throw new Error("细分跨度必须大于 0 拍。");
  const step = 60 / chart.bpm * span / division;
  if (!Number.isFinite(step) || step <= 0) throw new Error("细分跨度超出可计算范围。");
  // Do not invent notes before chart time zero, even with a positive audio offset.
  const firstStep = Math.max(0, Math.ceil(-chart.offset / step - 1e-9));
  const tick = Math.max(firstStep, Math.round((seconds - chart.offset) / step));
  const result = chart.offset + tick * step;
  return Math.abs(result) < 1e-9 ? 0 : result;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) seconds = 0;
  const negative = seconds < 0;
  const milliseconds = Math.round(Math.abs(seconds) * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const remainder = milliseconds % 60000;
  return `${negative ? "−" : ""}${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1000)).padStart(2, "0")}.${String(remainder % 1000).padStart(3, "0")}`;
}

export class History {
  constructor({ limit = 80 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("历史记录上限必须是正整数。");
    this.limit = limit;
    this._undo = [];
    this._redo = [];
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }

  /** Save the state before a change. New edits discard the redo branch. */
  push(chart) {
    this._undo.push(clone(chart));
    if (this._undo.length > this.limit) this._undo.shift();
    this._redo = [];
  }

  undo(current) {
    if (!this.canUndo) return clone(current);
    this._redo.push(clone(current));
    return clone(this._undo.pop());
  }

  redo(current) {
    if (!this.canRedo) return clone(current);
    this._undo.push(clone(current));
    if (this._undo.length > this.limit) this._undo.shift();
    return clone(this._redo.pop());
  }
}
