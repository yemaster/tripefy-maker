const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;
const PALETTES = {
  dusk: { sky: '#9e91b6', horizon: '#f8d9ba', water: '#c9b3bc', bottom: '#827d9f', far: '#b5a6b9', near: '#8d8ea7', cloud: '#ffeadb', light: '#fff2cf' },
  night: { sky: '#1b254b', horizon: '#7a8fa1', water: '#556d87', bottom: '#222e52', far: '#516883', near: '#394f70', cloud: '#a0b4cd', light: '#f1f1d7' },
  clear: { sky: '#7aafc6', horizon: '#efe7cd', water: '#b2ced0', bottom: '#62949d', far: '#9bb9b9', near: '#749c9f', cloud: '#fff9e8', light: '#fff6d4' },
  overcast: { sky: '#8c99a7', horizon: '#e0ddd2', water: '#b5bdbb', bottom: '#71838d', far: '#a2afb1', near: '#81969a', cloud: '#e8e8dd', light: '#eee8cf' },
};

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundedRect(ctx, x, y, width, height, radius = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function secondsLabel(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Canvas coordinates are CSS pixels. Chart note times exclude chart.offset. */
export class Renderer {
  constructor(editorCanvas, timelineCanvas) {
    this.canvas = editorCanvas;
    this.timelineCanvas = timelineCanvas;
    this.ctx = editorCanvas.getContext('2d');
    this.timelineCtx = timelineCanvas.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.tw = 1;
    this.th = 1;
    this.zoom = 100;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    for (const [canvas, context, timeline] of [
      [this.canvas, this.ctx, false], [this.timelineCanvas, this.timelineCtx, true],
    ]) {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const pixelWidth = Math.round(width * this.dpr);
      const pixelHeight = Math.round(height * this.dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (timeline) { this.tw = width; this.th = height; }
      else { this.w = width; this.h = height; }
    }
  }

  geometry() {
    const fieldWidth = Math.min(820, Math.max(80, this.w - 156));
    return {
      w: this.w, h: this.h,
      left: (this.w - fieldWidth) / 2,
      right: (this.w + fieldWidth) / 2,
      top: 44,
      hitY: this.h * 0.80,
      noteWidth: clamp(fieldWidth * 0.12, 32, 100),
      pxPerSecond: 145 * this.zoom / 100,
    };
  }

  pointToNote(clientX, clientY, state) {
    this.zoom = Number(state.zoom) || 100;
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    const g = this.geometry();
    const time = state.time + (g.hitY - canvasY) / g.pxPerSecond;
    return {
      x: clamp((canvasX - g.left) / (g.right - g.left), 0, 1),
      time, canvasX, canvasY,
      inside: canvasX >= g.left && canvasX <= g.right && canvasY >= g.top && canvasY <= g.h,
    };
  }

  hitTest(clientX, clientY, state) {
    const point = this.pointToNote(clientX, clientY, state);
    const g = this.geometry();
    if (point.canvasY < g.top || point.canvasY > g.h) return null;
    for (const selectedPass of [true, false]) for (const note of state.chart.notes) {
      if (Boolean(state.selected?.has(note.id)) !== selectedPass) continue;
      const shape = this._noteGeometry(note, state, g);
      if (Math.abs(point.canvasX - shape.x) > g.noteWidth / 2 + 5) continue;
      const headDistance = Math.abs(point.canvasY - shape.headY);
      const tailDistance = Math.abs(point.canvasY - shape.tailY);
      if (note.duration > 0 && tailDistance <= 10 && tailDistance < headDistance) return { note, part: 'tail' };
      if (headDistance <= 11) return { note, part: 'head' };
      if (note.duration > 0 && point.canvasY > shape.tailY && point.canvasY < shape.headY) {
        return { note, part: 'body' };
      }
    }
    return null;
  }

  _noteGeometry(note, state, g) {
    const start = note.time + state.chart.offset;
    const end = start + note.duration;
    let headY = g.hitY - (start - state.time) * g.pxPerSecond;
    const tailY = g.hitY - (end - state.time) * g.pxPerSecond;
    if (state.view === 'preview' && note.duration > 0 && state.time >= start && state.time <= end) headY = g.hitY;
    return { x: g.left + note.x * (g.right - g.left), headY, tailY, start, end };
  }

  draw(state) {
    this.zoom = Number(state.zoom) || 100;
    const g = this.geometry();
    const ctx = this.ctx;
    const preview = state.view === 'preview';
    const preset = state.chart.scene?.preset || 'dusk';
    const light = preview && (preset === 'clear' || preset === 'overcast');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, g.w, g.h);
    if (preview) this._drawScenery(preset, g);
    else { ctx.fillStyle = '#18181b'; ctx.fillRect(0, 0, g.w, g.h); }
    ctx.fillStyle = preview ? (light ? 'rgba(223,227,223,.80)' : 'rgba(48,61,72,.80)') : '#202023';
    ctx.fillRect(g.left - 10, g.top, g.right - g.left + 20, g.h - g.top);
    if (!preview) {
      line(ctx, g.left - 10.5, g.top, g.left - 10.5, g.h, '#2d2d32');
      line(ctx, g.right + 10.5, g.top, g.right + 10.5, g.h, '#2d2d32');
      this._drawRuler(state, g);
      if (state.grid) this._drawGrid(state, g);
      this._drawVerticalWave(state, g);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, g.top, g.w, g.h - g.top);
    ctx.clip();
    line(ctx, g.left - 10, g.hitY + 0.5, g.right + 10, g.hitY + 0.5,
      preview ? (light ? 'rgba(67,86,83,.7)' : 'rgba(240,239,216,.8)') : '#a1a1aa', 1.5);
    this._drawChords(state, g, light);
    const notes = state.chart.notes;
    for (const note of notes) {
      if (!state.selected?.has(note.id)) this._drawNote(note, state, g, light, false);
    }
    for (const note of notes) {
      if (state.selected?.has(note.id)) this._drawNote(note, state, g, light, true);
    }
    if (!preview && state.hover && !state.draft) {
      this._drawNote({ x: state.hover.x, time: state.hover.time - state.chart.offset, duration: 0 }, state, g, false, false, true);
      const y = g.hitY - (state.hover.time - state.time) * g.pxPerSecond;
      line(ctx, g.left, y, g.right, y, 'rgba(200,184,137,.22)');
    }
    if (state.draft) this._drawNote(state.draft, state, g, light, true, true);
    if (!preview && state.marquee) {
      const m = state.marquee;
      const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2);
      const width = Math.abs(m.x2 - m.x1), height = Math.abs(m.y2 - m.y1);
      ctx.fillStyle = 'rgba(175,199,173,.08)';
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = 'rgba(175,199,173,.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, width, height);
    }
    if (preview) this._drawHits(state, g, light);
    ctx.restore();
    if (!preview) {
      ctx.fillStyle = '#81818b';
      ctx.font = '10px "Manrope", sans-serif';
      ctx.textAlign = 'center';
      for (const position of [0, .25, .5, .75, 1]) {
        ctx.fillText(`${position * 100}`, g.left + position * (g.right - g.left), 26);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#92929c';
      ctx.font = '10px "Manrope", sans-serif';
    }
  }

  _drawRuler(state, g) {
    const ctx = this.ctx;
    const start = Math.max(0, state.time - (g.h - g.hitY) / g.pxPerSecond);
    const end = Math.min(state.chart.duration, state.time + (g.hitY - g.top) / g.pxPerSecond);
    const interval = g.pxPerSecond < 75 ? 2 : 1;
    ctx.font = '10px "Manrope", sans-serif';
    ctx.textAlign = 'right';
    for (let t = Math.ceil(start / interval) * interval; t <= end; t += interval) {
      const y = g.hitY - (t - state.time) * g.pxPerSecond;
      ctx.fillStyle = '#7f8c85';
      ctx.fillText(secondsLabel(t), g.left - 39, y + 3);
      line(ctx, g.left - 32, y + .5, g.left - 25, y + .5, '#4b5750');
    }
  }

  _drawGrid(state, g) {
    const ctx = this.ctx;
    const beat = 60 / state.chart.bpm;
    const beatsPerBar = state.chart.beatsPerBar || 4;
    const division = Math.max(1, state.division || 4);
    const span = Math.max(0.01, state.span || 1);
    const step = beat * span / division;
    const start = Math.max(0, state.time - (g.h - g.hitY) / g.pxPerSecond);
    const end = Math.min(state.chart.duration, state.time + (g.hitY - g.top) / g.pxPerSecond);
    const begin = Math.max(0, Math.ceil((start - state.chart.offset) / step));
    const finish = Math.ceil((end - state.chart.offset) / step);
    ctx.font = '10px "Manrope", sans-serif';
    ctx.textAlign = 'right';
    for (let tick = begin; tick <= finish && tick - begin < 2000; tick++) {
      const b = tick * span / division;
      const major = Math.abs(b / beatsPerBar - Math.round(b / beatsPerBar)) < 1e-6;
      const whole = Math.abs(b - Math.round(b)) < 1e-6;
      if (!whole && step * g.pxPerSecond < 5) continue;
      const y = Math.round(g.hitY - (state.chart.offset + tick * step - state.time) * g.pxPerSecond) + .5;
      line(ctx, g.left - 10, y, g.right + 10, y,
        major ? 'rgba(180,180,185,.24)' : whole ? 'rgba(180,180,185,.12)' : 'rgba(180,180,185,.045)');
      if (whole) {
        ctx.fillStyle = major ? '#a8b6a9' : '#66766d';
        ctx.fillText(major ? `${Math.round(b / beatsPerBar) + 1}` : '·', g.left - 16, y + 3);
      }
    }
  }

  _drawVerticalWave(state, g) {
    if (!state.audioPeaks?.length || !(state.audioDuration > 0)) return;
    const ctx = this.ctx;
    const peaks = state.audioPeaks;
    const center = g.right + 42;
    ctx.fillStyle = 'rgba(146,165,148,.22)';
    for (let y = g.top; y < g.h; y += 2) {
      const t = state.time + (g.hitY - y) / g.pxPerSecond;
      if (t < 0 || t >= state.audioDuration) continue;
      const index = Math.floor(t / state.audioDuration * peaks.length);
      const amplitude = clamp(Math.abs(peaks[index] || 0), 0, 1) * 15;
      ctx.fillRect(center - amplitude, y, amplitude * 2, 1.5);
    }
  }

  _drawChords(state, g, light) {
    const groups = new Map();
    for (const note of state.chart.notes) {
      const effective = note.time + state.chart.offset;
      if (state.view === 'preview' && effective < state.time - .03) continue;
      const y = g.hitY - (effective - state.time) * g.pxPerSecond;
      if (y < g.top || y > g.h) continue;
      const key = Math.round(note.time * 1000000);
      if (!groups.has(key)) groups.set(key, { y, xs: [] });
      groups.get(key).xs.push(g.left + note.x * (g.right - g.left));
    }
    const color = light ? 'rgba(62,85,80,.48)' : 'rgba(224,231,214,.40)';
    for (const group of groups.values()) {
      if (group.xs.length < 2) continue;
      group.xs.sort((a, b) => a - b);
      for (let i = 1; i < group.xs.length; i++) {
        const from = group.xs[i - 1] + g.noteWidth / 2;
        const to = group.xs[i] - g.noteWidth / 2;
        if (to > from) line(this.ctx, from, group.y, to, group.y, color);
      }
    }
  }

  _drawNote(note, state, g, light, selected, ghost = false) {
    const ctx = this.ctx;
    const shape = this._noteGeometry(note, state, g);
    const isHold = note.duration > 0;
    if (shape.headY < g.top - 12 || shape.tailY > g.h + 12) return;
    const preview = state.view === 'preview';
    const passed = state.time - shape.end;
    if (preview && passed > .22) return;
    const fade = ghost ? .42 : preview ? clamp(1 - Math.max(0, passed) / .22, 0, 1) : shape.end < state.time ? .46 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    const width = g.noteWidth;
    const height = clamp(width * .12, 8, 12);
    const x = shape.x - width / 2;
    const head = shape.headY;
    const tail = shape.tailY;
    if (isHold) {
      ctx.fillStyle = light ? 'rgba(61,89,80,.21)' : 'rgba(224,234,213,.17)';
      ctx.fillRect(x, tail, width, Math.max(0, head - tail));
      line(ctx, x + .5, tail, x + .5, head, light ? 'rgba(61,89,80,.25)' : 'rgba(223,233,214,.26)');
      line(ctx, x + width - .5, tail, x + width - .5, head, light ? 'rgba(61,89,80,.25)' : 'rgba(223,233,214,.26)');
      ctx.globalAlpha = fade * .72;
      this._drawJade(x, tail - height / 2, width, height, light);
      ctx.globalAlpha = fade;
    }
    this._drawJade(x, head - height / 2, width, height, light);
    if (selected && !preview) {
      ctx.strokeStyle = '#d2bd87';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, x - 3, head - height / 2 - 3, width + 6, height + 6, 2);
      ctx.stroke();
      if (isHold) {
        ctx.strokeStyle = 'rgba(167,192,165,.75)';
        ctx.strokeRect(x - 3, tail - height / 2 - 3, width + 6, Math.max(height + 6, head - tail + height + 6));
        ctx.fillStyle = '#c5d4bd';
        ctx.fillRect(shape.x - 3, tail - 3, 6, 6);
      }
    }
    ctx.restore();
  }

  _drawJade(x, y, width, height, dark) {
    const ctx = this.ctx;
    const fill = ctx.createLinearGradient(0, y, 0, y + height);
    fill.addColorStop(0, dark ? '#5b7568' : '#f4f6e9');
    fill.addColorStop(.42, dark ? '#3b584e' : '#e1e9d7');
    fill.addColorStop(1, dark ? '#29443e' : '#b7c9b8');
    ctx.fillStyle = fill;
    roundedRect(ctx, x, y, width, height, 1.6);
    ctx.fill();
    line(ctx, x + 1.5, y + 1.5, x + width - 1.5, y + 1.5, dark ? 'rgba(169,190,166,.40)' : 'rgba(255,255,249,.8)');
  }

  _drawHits(state, g, light) {
    const ctx = this.ctx;
    for (const hit of state.hits || []) {
      const age = state.time - hit.time;
      if (age < 0 || age > .34) continue;
      const progress = age / .34;
      const x = g.left + hit.x * (g.right - g.left);
      const opacity = Math.pow(1 - progress, 2);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = light ? '#729b8d' : '#f4efcd';
      ctx.lineWidth = 1.5 - progress;
      ctx.beginPath();
      ctx.ellipse(x, g.hitY, 8 + progress * 38, 4 + progress * 13, 0, 0, TAU);
      ctx.stroke();
      line(ctx, x - 18 - progress * 30, g.hitY, x + 18 + progress * 30, g.hitY, light ? '#46685b' : '#fffae3', 2 * (1 - progress));
      ctx.restore();
    }
  }

  _drawScenery(preset, g) {
    const ctx = this.ctx;
    const p = PALETTES[preset] || PALETTES.dusk;
    const horizon = g.h * .29;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, p.sky); sky.addColorStop(1, p.horizon);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, g.w, horizon);
    ctx.fillStyle = p.light;
    ctx.globalAlpha = preset === 'overcast' ? .35 : .82;
    ctx.beginPath(); ctx.arc(g.w * .22, g.h * .105, Math.min(g.w, g.h) * .028, 0, TAU); ctx.fill();
    if (preset === 'night') {
      ctx.fillStyle = p.sky;
      ctx.beginPath(); ctx.arc(g.w * .22 + 7, g.h * .105 - 4, Math.min(g.w, g.h) * .026, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = .22;
    ctx.fillStyle = p.cloud;
    for (const [x, y, width] of [[.04, .11, .25], [.62, .08, .32], [.4, .18, .35]]) {
      ctx.beginPath();
      ctx.ellipse(g.w * x, g.h * y, g.w * width, Math.max(4, g.h * .009), 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const [color, level, lift] of [[p.far, .245, .052], [p.near, .28, .031]]) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(0, horizon);
      ctx.lineTo(0, g.h * level);
      ctx.bezierCurveTo(g.w * .12, g.h * (level - lift), g.w * .2, g.h * (level - lift * .75), g.w * .34, g.h * level);
      ctx.bezierCurveTo(g.w * .49, g.h * (level + lift * .2), g.w * .57, g.h * (level - lift * 1.5), g.w * .7, g.h * (level - lift * .7));
      ctx.bezierCurveTo(g.w * .84, g.h * (level + lift * .3), g.w * .9, g.h * (level - lift), g.w, g.h * level);
      ctx.lineTo(g.w, horizon); ctx.closePath(); ctx.fill();
    }
    const water = ctx.createLinearGradient(0, horizon, 0, g.h);
    water.addColorStop(0, p.water); water.addColorStop(1, p.bottom);
    ctx.fillStyle = water; ctx.fillRect(0, horizon, g.w, g.h - horizon);
    ctx.globalAlpha = .11;
    for (let i = 0; i < 12; i++) {
      const y = horizon + 15 + i * i * g.h * .004;
      const x = ((i * .381966 + .17) % 1) * g.w;
      line(ctx, x, y, x + g.w * (.06 + (i % 3) * .035), y, p.light);
    }
    ctx.globalAlpha = 1;
  }

  drawTimeline(state) {
    const ctx = this.timelineCtx;
    const w = this.tw, h = this.th;
    const left = 16, right = Math.max(left + 1, w - 16);
    const progress = clamp(state.time / Math.max(.01, state.chart.duration), 0, 1);
    const cursor = left + (right - left) * progress;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    line(ctx, left, h / 2, right, h / 2, '#3f3f46', 3);
    if (progress > 0) line(ctx, left, h / 2, cursor, h / 2, '#a1a1aa', 3);
    ctx.fillStyle = '#e4e4e7';
    ctx.beginPath(); ctx.arc(cursor, h / 2, 4.5, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt';
  }
}
