import {EVENT_DEFAULTS as DEFAULTS, resolveEventValues} from './event-values.js';
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
  const groups = chart.groups || EMPTY;
  let index = indexes.get(chart);
  if (index?.events === events && index.length === events.length && index.groupsSource === groups) return index;
  const targets = new Map();
  for (const event of resolveEventValues(events.map(event=>event.valueMode?{...event}:event))) {
    let properties = targets.get(event.target);
    if (!properties) targets.set(event.target, properties = new Map());
    let layers = properties.get(event.property);
    if (!layers) properties.set(event.property, layers = new Map());
    let channel = layers.get(event.layer || 0);
    if (!channel) layers.set(event.layer || 0, channel = []);
    channel.push(event);
  }
  for (const properties of targets.values()) {
    for (const layers of properties.values()) for (const channel of layers.values()) channel.sort((a, b) => a.time - b.time);
  }
  index = { events, length: events.length, targets, groupsSource: groups, groups: new Map(groups.map(group=>[group.id,group])), routes:new WeakMap(),speedTables: new Map(), fromTime: NaN, fromValues: new Map() };
  indexes.set(chart, index);
  return index;
}

function channelsFor(chart, property, target) {
  const layers = indexFor(chart).targets.get(target)?.get(property);
  return layers ? [...layers.values()] : EMPTY;
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
export function eventValue(chart, property, absoluteTime, target = "all", layer = null) {
  if (!Object.hasOwn(DEFAULTS, property)) throw new Error("未知事件属性。");
  const channels = layer === null ? channelsFor(chart,property,target) : [indexFor(chart).targets.get(target)?.get(property)?.get(layer) || EMPTY];
  return channels.reduce((value,channel)=>property==='x' ? value+channelValue(channel,property,absoluteTime-(chart.offset||0))
    : value*channelValue(channel,property,absoluteTime-(chart.offset||0)),DEFAULTS[property]);
}

function routeFor(chart,note) {
  const index=indexFor(chart);let route=index.routes.get(note);
  if(!route){
    const targets=[...new Set(['all',note.group,note.id].filter(Boolean))];
    const channels=Object.fromEntries(['x','opacity','speed'].map(property=>[property,targets.flatMap(target=>channelsFor(chart,property,target))]));
    route={group:index.groups.get(note.group),channels,speedKey:JSON.stringify(targets.filter(target=>index.targets.get(target)?.has('speed')))};
    index.routes.set(note,route);
  }
  return route;
}
function noteValue(chart,note,property,time) {
  return routeFor(chart,note).channels[property].reduce((value,channel)=>property==='x' ? value+channelValue(channel,property,time-(chart.offset||0))
    : value*channelValue(channel,property,time-(chart.offset||0)),DEFAULTS[property]);
}

export function noteX(chart, note, absoluteTime, relativeTime = absoluteTime - (chart.offset || 0) - note.time) {
  const group = routeFor(chart,note).group;
  return clamp(pathX(note,relativeTime) + (group?.x||0) + noteValue(chart,note,'x',absoluteTime));
}

export function noteOpacity(chart, note, absoluteTime) {
  const group = routeFor(chart,note).group;
  return clamp((note.opacity ?? 1) * (group?.opacity??1) * noteValue(chart,note,'opacity',absoluteTime));
}

// Match the game's exact polynomial integral. Compile at most once per speed
// channel after an edit, rather than integrating every vertex on every frame.
function speedPolynomial(channel, start, end) {
  const midpoint = (start + end) / 2;
  const event = channel[upperBound(channel, midpoint) - 1];
  if (!event) return [1, 0, 0];
  if (event.duration <= 0 || midpoint >= event.time + event.duration) return [event.to, 0, 0];
  const begin = (start - event.time) / event.duration;
  const step = (end - start) / event.duration;
  let constant = begin, linear = step, quadratic = 0;
  if (event.curve === 'easeIn') {
    constant = begin * begin; linear = 2 * begin * step; quadratic = step * step;
  } else if (event.curve === 'easeOut') {
    constant = begin * (2 - begin); linear = 2 * step * (1 - begin); quadratic = -step * step;
  } else if (event.curve === 'easeInOut') {
    if (midpoint < event.time + event.duration / 2) {
      constant = 2 * begin * begin; linear = 4 * begin * step; quadratic = 2 * step * step;
    } else {
      constant = -1 + 4 * begin - 2 * begin * begin;
      linear = 4 * step * (1 - begin); quadratic = -2 * step * step;
    }
  }
  const delta = event.to - event.from;
  return [event.from + delta * constant, delta * linear, delta * quadratic];
}

function speedPrimitive(channels) {
  const boundaries = new Set();
  for (const channel of channels) for (const event of channel) {
    boundaries.add(event.time); boundaries.add(event.time + event.duration);
    if (event.curve === 'easeInOut') boundaries.add(event.time + event.duration / 2);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const values = [0], polynomials = [];
  let correction = 0;
  for (let i = 1; i < times.length; i++) {
    const span = times[i] - times[i - 1];
    let product = [1];
    for (const channel of channels) {
      const coefficients = speedPolynomial(channel,times[i-1],times[i]);
      const next = Array(product.length+2).fill(0);
      for(let a=0;a<product.length;a++) for(let b=0;b<3;b++)next[a+b]+=product[a]*coefficients[b];
      product=next;
    }
    const p = product.map((coefficient,power)=>coefficient*span/(power+1));
    polynomials.push(p);
    const adjusted = p.reduce((sum, coefficient) => sum + coefficient, 0) - correction;
    const total = values[i - 1] + adjusted;
    correction = (total - values[i - 1]) - adjusted;
    values.push(total);
  }
  const last = times.length - 1;
  const finalSpeed = channels.reduce((value,channel)=>value*channelValue(channel,'speed',times[last]),1);
  return time => {
    if (time <= times[0]) return time - times[0];
    if (time >= times[last]) return values[last] + (time - times[last]) * finalSpeed;
    let low = 0, high = last;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (times[middle] <= time) low = middle;
      else high = middle - 1;
    }
    const t = (time - times[low]) / (times[low + 1] - times[low]);
    const p = polynomials[low];
    let value=0;for(let i=p.length-1;i>=0;i--)value=t*(p[i]+value);
    return values[low]+value;
  };
}

/** Signed integral of global speed × per-note event speed × the note's base speed, in seconds. */
export function scrollDistance(chart, note, fromAbsolute, toAbsolute) {
  if (fromAbsolute === toAbsolute) return 0;
  const offset = chart.offset || 0;
  const from = fromAbsolute - offset;
  const to = toAbsolute - offset;
  const index = indexFor(chart);
  const route=routeFor(chart,note),group=route.group;
  const baseSpeed = (note.speed ?? 1) * (group?.speed??1);
  if(!route.channels.speed.length)return (toAbsolute-fromAbsolute)*baseSpeed;
  const key=route.speedKey;
  if (!index.speedTables.has(key)) index.speedTables.set(key, speedPrimitive(route.channels.speed));
  const primitive = index.speedTables.get(key);
  if (index.fromTime !== from) { index.fromTime = from; index.fromValues.clear(); }
  if (!index.fromValues.has(key)) index.fromValues.set(key, primitive(from));
  return baseSpeed * (primitive(to) - index.fromValues.get(key));
}
