const EMPTY = [];
const caches = new WeakMap();
function timing(chart) {
  const changes = chart.bpmChanges || EMPTY;
  let cached = caches.get(chart);
  if (cached?.changes === changes && cached.bpm === chart.bpm) return cached.points;
  let beat = 0;
  const points = [{time: 0, bpm: chart.bpm, beat: 0}];
  for (const change of changes) {
    const previous = points.at(-1);
    beat += (change.time - previous.time) * previous.bpm / 60;
    points.push({...change, beat});
  }
  caches.set(chart, {changes, bpm: chart.bpm, points});
  return points;
}
function before(points, key, value) {
  let low = 0, high = points.length;
  while (low < high) { const mid = (low + high) >>> 1; if (points[mid][key] <= value) low = mid + 1; else high = mid; }
  return points[Math.max(0, low - 1)];
}
export function beatAtTime(chart, seconds) {
  const time = seconds - chart.offset, point = before(timing(chart), 'time', time);
  return point.beat + (time - point.time) * point.bpm / 60;
}
export function timeAtBeat(chart, beat) {
  const point = before(timing(chart), 'beat', beat);
  return chart.offset + point.time + (beat - point.beat) * 60 / point.bpm;
}
export function bpmAtTime(chart, seconds) { return before(timing(chart), 'time', seconds - chart.offset).bpm; }
export function secondsForBeats(chart, start, beats) { return timeAtBeat(chart, beatAtTime(chart, start) + beats) - start; }

export function normalizeBpmChanges(value, offset, duration) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2000) throw new Error('BPM 列表最多包含 2000 项。');
  const changes = value.map(item => {
    if (!item || !Number.isFinite(item.time) || item.time <= 0 || item.time + offset >= duration
      || !Number.isFinite(item.bpm) || item.bpm < 20 || item.bpm > 400) throw new Error('变速点需要有效的时间和 20–400 BPM。');
    return {time: item.time, bpm: item.bpm};
  }).sort((a,b) => a.time - b.time);
  if (changes.some((item,index) => index && item.time - changes[index-1].time < 1e-9)) throw new Error('BPM 变速点不能重叠。');
  return changes;
}
