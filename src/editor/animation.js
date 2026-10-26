const DEFAULTS = { speed: 1, opacity: 1, x: 0 };
const EMPTY = [];
const indexes = new WeakMap();
const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

/** Standard quadratic easing; the curve belongs to the segment's destination node. */
export function ease(t, curve = "linear") {
  t = clamp(t);
  if (curve === "easeIn") return t * t;
  if (curve === "easeOut") return 1 - (1 - t) * (1 - t);
  if (curve === "easeInOut") return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  return t;
}

/** Call after any in-place event edits; replaced charts index automatically. */
export function invalidateAnimationCache(chart) {
  indexes.delete(chart);
}

function indexFor(chart) {
  const events = chart.events || EMPTY;
  let index = indexes.get(chart);
  if (index?.events === events && index.length === events.length) return index;
  const targets = new Map();
  for (const event of events) {
    let properties = targets.get(event.target);
    if (!properties) targets.set(event.target, properties = new Map());
    let channel = properties.get(event.property);
    if (!channel) properties.set(event.property, channel = []);
    channel.push(event);
  }
  for (const properties of targets.values()) {
    for (const channel of properties.values()) channel.sort((a, b) => a.time - b.time);
  }
  index = { events, length: events.length, targets };
  indexes.set(chart, index);
  return index;
}

function channelFor(chart, property, target) {
  return indexFor(chart).targets.get(target)?.get(property) || EMPTY;
}

/** First item whose start is strictly later than time. */
function upperBound(items, time) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function channelValue(channel, property, relativeTime) {
  const index = upperBound(channel, relativeTime) - 1;
  if (index < 0) return DEFAULTS[property];
  const event = channel[index];
  if (event.duration <= 0 || relativeTime >= event.time + event.duration) return event.to;
  const progress = ease((relativeTime - event.time) / event.duration, event.curve);
  return event.from + (event.to - event.from) * progress;
}

function endpointTangent(h0, h1, d0, d1) {
  const tangent = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(tangent) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(tangent) > 3 * Math.abs(d0)) return 3 * d0;
  return tangent;
}

/** Shape-preserving PCHIP tangents: a bend cannot overshoot its neighboring nodes. */
function pathTangent(path, index) {
  const last = path.length - 1;
  const slope = i => (path[i + 1].x - path[i].x) / (path[i + 1].time - path[i].time);
  if (last === 1) return slope(0);
  if (index === 0) {
    return endpointTangent(path[1].time - path[0].time, path[2].time - path[1].time, slope(0), slope(1));
  }
  if (index === last) {
    return endpointTangent(path[last].time - path[last - 1].time,
      path[last - 1].time - path[last - 2].time, slope(last - 1), slope(last - 2));
  }
  const before = slope(index - 1);
  const after = slope(index);
  if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
  const hBefore = path[index].time - path[index - 1].time;
  const hAfter = path[index + 1].time - path[index].time;
  const w1 = 2 * hAfter + hBefore;
  const w2 = hAfter + 2 * hBefore;
  return (w1 + w2) / (w1 / before + w2 / after);
}

export function pathX(note, relativeTime) {
  const path = note.path;
  if (!note.duration || !path?.length) return note.x;
  if (relativeTime <= path[0].time) return path[0].x;
  if (relativeTime >= path.at(-1).time) return path.at(-1).x;
  const after = upperBound(path, relativeTime);
  const left = path[after - 1];
  const right = path[after];
  const length = right.time - left.time;
  const t = (relativeTime - left.time) / length;
  if (right.curve === "smooth") {
    const t2 = t * t;
    const t3 = t2 * t;
    const x = (2 * t3 - 3 * t2 + 1) * left.x + (t3 - 2 * t2 + t) * length * pathTangent(path, after - 1)
      + (-2 * t3 + 3 * t2) * right.x + (t3 - t2) * length * pathTangent(path, after);
    return clamp(x, Math.min(left.x, right.x), Math.max(left.x, right.x));
  }
  const progress = ease(t, right.curve);
  return left.x + (right.x - left.x) * progress;
}

/** absoluteTime is playback seconds, including chart.offset. */
export function eventValue(chart, property, absoluteTime, target = "all") {
  if (!Object.hasOwn(DEFAULTS, property)) throw new Error("未知事件属性。");
  return channelValue(channelFor(chart, property, target), property, absoluteTime - (chart.offset || 0));
}

function noteChannel(chart, note, property) {
  // "all" is the reserved global target, so never apply that channel twice.
  return note.id && note.id !== "all" ? channelFor(chart, property, note.id) : EMPTY;
}

export function noteX(chart, note, absoluteTime) {
  const relativeTime = absoluteTime - (chart.offset || 0);
  const base = pathX(note, relativeTime - note.time);
  return clamp(base + channelValue(channelFor(chart, "x", "all"), "x", relativeTime)
    + channelValue(noteChannel(chart, note, "x"), "x", relativeTime));
}

export function noteOpacity(chart, note, absoluteTime) {
  const relativeTime = absoluteTime - (chart.offset || 0);
  return clamp((note.opacity ?? 1) * channelValue(channelFor(chart, "opacity", "all"), "opacity", relativeTime)
    * channelValue(noteChannel(chart, note, "opacity"), "opacity", relativeTime));
}

function addBoundaries(channel, from, to, boundaries) {
  let index = Math.max(0, upperBound(channel, from) - 1);
  for (; index < channel.length && channel[index].time < to; index += 1) {
    const event = channel[index];
    if (event.time > from) boundaries.push(event.time);
    const end = event.time + event.duration;
    if (end > from && end < to) boundaries.push(end);
    if (event.curve === "easeInOut") {
      const midpoint = event.time + event.duration / 2;
      if (midpoint > from && midpoint < to) boundaries.push(midpoint);
    }
  }
}

function integrate(valueAt, from, to) {
  const half = (to - from) / 2;
  if (half <= 0) return 0;
  const center = from + half;
  const node = Math.sqrt(3 / 5);
  return half * (5 / 9 * valueAt(center - half * node)
    + 8 / 9 * valueAt(center) + 5 / 9 * valueAt(center + half * node));
}

function globalPrimitive(chart, channel) {
  const index = indexFor(chart);
  if (index.globalSpeedPrimitive) return index.globalSpeedPrimitive;
  const boundaries = [];
  for (const event of channel) {
    boundaries.push(event.time, event.time + event.duration);
    if (event.curve === "easeInOut") boundaries.push(event.time + event.duration / 2);
  }
  boundaries.sort((a, b) => a - b);
  const times = boundaries.filter((time, i) => i === 0 || time !== boundaries[i - 1]);
  const values = [0];
  const valueAt = time => channelValue(channel, "speed", time);
  let correction = 0;
  for (let i = 1; i < times.length; i += 1) {
    const adjusted = integrate(valueAt, times[i - 1], times[i]) - correction;
    const next = values[i - 1] + adjusted;
    correction = (next - values[i - 1]) - adjusted;
    values.push(next);
  }
  const primitive = time => {
    if (time <= times[0]) return time - times[0];
    const last = times.length - 1;
    if (time >= times[last]) return values[last] + (time - times[last]) * valueAt(times[last]);
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (times[middle] <= time) low = middle;
      else high = middle - 1;
    }
    return values[low] + integrate(valueAt, times[low], time);
  };
  index.globalSpeedPrimitive = primitive;
  return primitive;
}

/** Signed integral of global speed × per-note event speed × the note's base speed, in seconds. */
export function scrollDistance(chart, note, fromAbsolute, toAbsolute) {
  if (fromAbsolute === toAbsolute) return 0;
  const direction = toAbsolute > fromAbsolute ? 1 : -1;
  const offset = chart.offset || 0;
  const from = Math.min(fromAbsolute, toAbsolute) - offset;
  const to = Math.max(fromAbsolute, toAbsolute) - offset;
  const global = channelFor(chart, "speed", "all");
  const local = noteChannel(chart, note, "speed");
  const baseSpeed = note.speed ?? 1;
  if (!global.length && !local.length) return (toAbsolute - fromAbsolute) * baseSpeed;
  if (!local.length) {
    const primitive = globalPrimitive(chart, global);
    return direction * baseSpeed * (primitive(to) - primitive(from));
  }
  const boundaries = [from, to];
  addBoundaries(global, from, to, boundaries);
  addBoundaries(local, from, to, boundaries);
  boundaries.sort((a, b) => a - b);

  // Each curve is quadratic on these intervals. The product has degree ≤4,
  // so three-point Gauss-Legendre integrates it exactly, without frame-step drift.
  const valueAt = time => channelValue(global, "speed", time) * channelValue(local, "speed", time);
  let total = 0;
  let correction = 0;
  for (let i = 1; i < boundaries.length; i += 1) {
    const integral = integrate(valueAt, boundaries[i - 1], boundaries[i]);
    const adjusted = integral - correction;
    const next = total + adjusted;
    correction = (next - total) - adjusted;
    total = next;
  }
  return direction * baseSpeed * total;
}
