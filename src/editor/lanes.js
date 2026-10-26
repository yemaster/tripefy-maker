export const KEY_COUNTS = [4, 5, 6, 7, 8, 9];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function laneCount(mode) {
  const count = Number(String(mode).replace(/k$/, ''));
  return String(mode).endsWith('k') && KEY_COUNTS.includes(count) ? count : 0;
}

export function validHorizontalMode(mode) {
  return laneCount(mode) > 0 || ['0', '8', '16', '32'].includes(String(mode));
}

export function laneCenters(count) {
  return Array.from({length: count}, (_, index) => (index + .5) / count);
}

/** Key modes snap to lane centers; legacy subdivisions snap to grid lines. */
export function snapHorizontal(x, mode = '0', bypass = false) {
  x = clamp(x, 0, 1);
  if (bypass) return x;
  const keys = laneCount(mode);
  if (keys) return (clamp(Math.floor(x * keys), 0, keys - 1) + .5) / keys;
  const divisions = ['8', '16', '32'].includes(String(mode)) ? Number(mode) : 0;
  return divisions ? Math.round(x * divisions) / divisions : x;
}

/** At an edge, retain whole-lane translations instead of squeezing a group. */
export function constrainHorizontalShift(requested, minimum, maximum, step = 0) {
  if (!step) return clamp(requested, minimum, maximum);
  let shift = requested;
  if (shift < minimum) shift += Math.ceil((minimum - shift) / step - 1e-9) * step;
  if (shift > maximum) shift += Math.floor((maximum - shift) / step + 1e-9) * step;
  return shift >= minimum - 1e-9 && shift <= maximum + 1e-9 ? clamp(shift, minimum, maximum) : 0;
}
