import {noteX} from './animation.js';

export const IMPACT_LIFETIME = .32;
export const MAX_ACTIVE_IMPACTS = 32;
const clamp = n => Math.max(0, Math.min(1, n));
const out = n => 1 - Math.pow(1 - clamp(n), 3);
const pulse = (age, peak, duration, falloff = 1.5) => Math.pow(1 - clamp((age - peak) / (duration - peak)), falloff);
const PETALS = [
  [-2.78, 54, 20, 4.2, .006],
  [-2.20, 69, 27, 5.2, .012],
  [-1.27, 78, 31, 5.7, .000],
  [-.48, 64, 23, 4.6, .018],
  [.45, 42, 16, 3.3, .009],
  [2.36, 49, 19, 3.8, .022],
];

/** All ages are real seconds, independent of chart time and playback rate. */
export function impactFrame(age, kind = 'head') {
  const tail = kind === 'tail';
  const duration = tail ? .18 : IMPACT_LIFETIME;
  if (age < 0 || age >= duration) return null;
  if (tail) {
    const progress = clamp(age / duration);
    return {
      core: Math.pow(1 - clamp(age / .09), 2),
      flare: 0,
      flame: .45 * Math.pow(1 - progress, 2),
      flameHeight: 26 * (1 - progress) + 12,
      width: 1 - .42 * out(progress),
      arcs: [], petals: [],
      closing: {offset: 44 * Math.pow(1 - progress, 2), alpha: Math.sin(Math.PI * Math.min(1, progress * 1.15)) * .68},
    };
  }
  const arcProgress = clamp((age - .02) / .22);
  const arcAlpha = age < .02 ? 0 : .24 * Math.min(1, (age - .02) / .018) * Math.pow(1 - arcProgress, 1.3);
  return {
    core: pulse(age, .025, .105),
    flare: pulse(age, .012, .12, 1.65),
    flareWidth: 106 + 18 * out(age / .08),
    flareHeight: 82 + 14 * out(age / .08),
    flame: .92 * pulse(age, .012, .17, 1.25),
    flameHeight: 60 + 45 * out(age / .13),
    width: 1 + .06 * out(age / .10),
    arcs: arcAlpha > 0 ? [
      {radius: 10 + 40 * out(arcProgress), start: -2.99, end: -2.18, alpha: arcAlpha},
      {radius: 10 + 40 * out(arcProgress), start: -1.35, end: -.30, alpha: arcAlpha * .88},
      {radius: 10 + 40 * out(arcProgress), start: .62, end: 1.25, alpha: arcAlpha * .66},
    ] : [],
    petals: PETALS.flatMap(([angle, travel, length, width, delay]) => {
      const progress = clamp((age - delay) / (.28 - delay));
      if (age <= delay || progress >= 1) return [];
      const visibility = Math.min(1, (age - delay) / .016) * Math.pow(1 - progress, 1.5);
      return [{angle, distance: 7 + travel * out(progress), length: length * (1 - .55 * progress), width: width * (1 - .7 * progress), alpha: visibility * .88}];
    }),
    closing: null,
  };
}

/** A seek does not call this: only a running playback interval produces impacts. */
export function collectImpacts(chart, from, to, clock, playbackRate = 1) {
  if (to < from) return [];
  const rate = Math.max(.01, playbackRate);
  const hits = [];
  for (const note of chart.notes) {
    const start = note.time + (chart.offset || 0);
    const append = (time, kind, judgement = true, segmentIndex = null) => {
      if (time <= from || time > to) return;
      const startedAt = clock - (to - time) / rate;
      const life = kind === 'tail' ? .18 : IMPACT_LIFETIME;
      if (clock - startedAt >= life) return;
      if (hits.length === MAX_ACTIVE_IMPACTS) hits.shift();
      hits.push({x: noteX(chart, note, time), time, kind, startedAt, noteId: note.id, judgement, segmentIndex});
    };
    const hold = note.duration > 0;
    append(start, 'head', !hold);
    if (hold) {
      const ends = note.path?.length > 1 ? note.path.slice(1).map(node => node.time) : [note.duration];
      ends.forEach((relative, index) => append(start + relative, index === ends.length - 1 ? 'tail' : 'checkpoint', true, index));
    }
  }
  return hits;
}

/** Small, reusable soft textures: one cache per renderer/theme, not per particle. */
export function createImpactSprites(light) {
  const make = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2); draw(ctx, width, height);
    return canvas;
  };
  const soft = (width, height, sample) => make(width, height, (ctx, w, h) => {
    const image = ctx.createImageData(w * 2, h * 2);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const [alpha, white] = sample((x + .5) / image.width, (y + .5) / image.height);
      const i = (y * image.width + x) * 4;
      const base = light ? [82, 145, 162] : [187, 200, 255];
      image.data[i] = base[0] + (255 - base[0]) * white;
      image.data[i + 1] = base[1] + (255 - base[1]) * white;
      image.data[i + 2] = base[2] + (250 - base[2]) * white;
      image.data[i + 3] = clamp(alpha) * 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  const glow = make(208, 52, (ctx, width, height) => {
    ctx.translate(width / 2, height / 2); ctx.scale(1, .16);
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
    fill.addColorStop(0, light ? 'rgba(215,244,244,.82)' : 'rgba(255,248,222,.70)');
    fill.addColorStop(.42, light ? 'rgba(95,153,155,.33)' : 'rgba(204,211,254,.28)');
    fill.addColorStop(1, 'rgba(182,194,247,0)');
    ctx.fillStyle = fill; ctx.fillRect(-104, -164, 208, 328);
  });
  const flame = soft(114, 128, (u, v) => {
    const x = u * 2 - 1;
    const spread = .34 + .44 * Math.pow(v, .65);
    const feather = Math.exp(-3.6 * x * x / (spread * spread));
    const alpha = feather * Math.pow(v, 1.7) * .95;
    return [alpha, Math.pow(v, 3.5) * Math.exp(-x * x * 9)];
  });
  const flare = soft(160, 160, (u, v) => {
    const x = u * 2 - 1, y = v * 2 - 1;
    const horizontal = Math.exp(-y * y / .0012) * Math.pow(1 - Math.abs(x), 1.7);
    const vertical = Math.exp(-x * x / .0016) * Math.pow(1 - Math.abs(y), 2);
    const halo = .42 * Math.exp(-(x * x + y * y) * 43);
    const core = Math.exp(-(x * x + y * y) * 220);
    const sharp = horizontal + vertical + core;
    return [sharp + halo, clamp(sharp * 1.8)];
  });
  const petal = make(48, 20, ctx => {
    const fill = ctx.createLinearGradient(0, 0, 48, 0);
    fill.addColorStop(0, 'rgba(194,199,255,0)');
    fill.addColorStop(.32, light ? 'rgba(91,139,157,.52)' : 'rgba(195,204,255,.42)');
    fill.addColorStop(.76, 'rgba(255,254,240,.95)');
    fill.addColorStop(1, 'rgba(255,255,250,.2)');
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(0, 10);
    ctx.bezierCurveTo(19, 9, 27, 2, 38, 6);
    ctx.bezierCurveTo(44, 7, 47, 9, 48, 10);
    ctx.bezierCurveTo(40, 14, 31, 18, 23, 13);
    ctx.bezierCurveTo(15, 11, 6, 11, 0, 10);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = light ? 'rgba(53,107,130,.42)' : 'rgba(204,207,255,.35)';
    ctx.lineWidth = .65; ctx.stroke();
  });
  return {glow, flame, flare, petal};
}

export function drawImpact(ctx, sprites, frame, x, y, unit, light) {
  if (!frame) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(unit, unit);
  if (frame.flame > 0) {
    ctx.globalAlpha = frame.flame;
    const width = frame.closing ? 74 : 114;
    ctx.drawImage(sprites.flame, -width / 2, -frame.flameHeight, width, frame.flameHeight);
  }
  if (frame.core > 0) {
    ctx.globalAlpha = frame.core;
    ctx.drawImage(sprites.glow, -104 * frame.width, -26, 208 * frame.width, 52);
    ctx.fillStyle = light ? '#497c88' : '#cbcffa';
    ctx.fillRect(-88 * frame.width, -5.2, 176 * frame.width, 10.4);
    ctx.fillStyle = '#fffff3';
    ctx.fillRect(-87 * frame.width, -3.9, 174 * frame.width, 7.8);
  }
  if (frame.flare > 0) {
    ctx.globalAlpha = frame.flare;
    ctx.drawImage(sprites.flare, -frame.flareWidth / 2, -frame.flareHeight / 2, frame.flareWidth, frame.flareHeight);
  }
  ctx.lineCap = 'round';
  for (const arc of frame.arcs) {
    ctx.globalAlpha = arc.alpha;
    ctx.lineWidth = 1.65;
    ctx.strokeStyle = light ? '#527e8d' : '#c4c8f1';
    ctx.beginPath(); ctx.arc(0, 0, arc.radius, arc.start, arc.end); ctx.stroke();
    ctx.lineWidth = .65;
    ctx.strokeStyle = '#ffffef'; ctx.stroke();
  }
  for (const petal of frame.petals) {
    ctx.save(); ctx.rotate(petal.angle);
    ctx.globalAlpha = petal.alpha;
    ctx.drawImage(sprites.petal, petal.distance - petal.length / 2, -petal.width / 2, petal.length, petal.width);
    ctx.restore();
  }
  if (frame.closing) {
    ctx.globalAlpha = frame.closing.alpha;
    for (const direction of [-1, 1]) {
      ctx.save(); ctx.scale(direction, 1);
      ctx.translate(frame.closing.offset, 0); ctx.scale(-1, 1);
      ctx.drawImage(sprites.petal, -12, -2.5, 24, 5);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawHoldContact(ctx, sprites, x, y, unit, phase, strength, light) {
  const pulse = .86 + Math.sin(phase * 12) * .06;
  ctx.save(); ctx.translate(x, y); ctx.scale(unit, unit);
  ctx.globalAlpha = strength * pulse * .74;
  ctx.drawImage(sprites.glow, -101, -20, 202, 40);
  ctx.globalAlpha = strength * .92;
  ctx.fillStyle = light ? '#548792' : '#b6c9e9';
  ctx.fillRect(-86, -2.8, 172, 5.6);
  ctx.fillStyle = '#fffef0';
  ctx.fillRect(-83, -1.6, 166, 3.2);
  ctx.globalAlpha = strength * pulse * .50;
  ctx.drawImage(sprites.flame, -39, -42, 78, 44);
  ctx.globalAlpha = strength * pulse * .56;
  ctx.drawImage(sprites.flare, -39, -24, 78, 48);
  for (let i = 0; i < 2; i++) {
    const travel = (phase * 2.2 + i * .5) % 1;
    const alpha = Math.sin(travel * Math.PI) * .63 * strength;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprites.flare, (i ? 18 : -28) - 4, -7 - travel * 31, 8, 12 + 8 * travel);
  }
  ctx.restore();
}
