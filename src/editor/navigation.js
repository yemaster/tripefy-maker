import {beatAtTime,timeAtBeat} from './timing.js';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MIN_ZOOM = 55;
export const MAX_ZOOM = 220;

export const pixelsPerSecond = zoom => 145 * zoom / 100;

/** Wheel deltas are CSS pixels, lines, or pages; never one beat per event. */
export function wheelPixels(event, height) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  return Number.isFinite(event.deltaY) ? event.deltaY * unit : 0;
}

export function wheelTimeDelta(event, zoom, height) {
  const limit = Math.min(96, height * .2);
  const pixels = clamp(wheelPixels(event, height) * .4, -limit, limit);
  return pixels * (event.shiftKey ? .25 : 1) / pixelsPerSecond(zoom);
}

export function wheelZoom(event, zoom, height) {
  const change = clamp(-wheelPixels(event, height) * .1, -15, 15);
  return clamp(Math.round((zoom + change) * 10) / 10, MIN_ZOOM, MAX_ZOOM);
}

/** Preserve the authored instant under the pointer in the linear editing view. */
export function anchoredZoomTime(time, oldZoom, newZoom, hitY, pointerY) {
  return time + (hitY - pointerY) * (1 / pixelsPerSecond(oldZoom) - 1 / pixelsPerSecond(newZoom));
}

/** After free scrolling, a step still lands on the actual chart grid. */
export function stepTime(time, direction, chart, division = 1, span = 1) {
  const step = span / division;
  const position = beatAtTime(chart,time) / step;
  const index = direction > 0 ? Math.floor(position + 1e-7) + 1 : Math.ceil(position - 1e-7) - 1;
  return clamp(timeAtBeat(chart,index * step), 0, chart.duration);
}
