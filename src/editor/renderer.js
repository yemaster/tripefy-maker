import {noteEditable,noteVisible,groupMap,targetEditable} from './groups.js';
import {beatAtTime,timeAtBeat} from './timing.js';
import {eventVisible} from './authoring.js';
import {pathX, eventValue, noteX, noteOpacity, scrollDistance} from './animation.js';
import {impactFrame, createImpactSprites, drawImpact, drawHoldContact} from './impact.js';
import {pixelsPerSecond} from './navigation.js';
import {laneCount, laneCenters} from './lanes.js';
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
    this.lanes = 0;
    this.dpr = 1;
    this.impactSprites = new Map();
    this.resize();
  }

  resize() {
    this.font = typeof getComputedStyle === 'function' ? getComputedStyle(this.canvas).fontFamily : 'sans-serif';
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
    const fieldWidth = Math.max(80, this.w - 138);
    return {
      w: this.w, h: this.h,
      left: 82,
      right: 82 + fieldWidth,
      top: 44,
      hitY: this.h * 0.80,
      noteWidth: Math.min(clamp(fieldWidth * 0.13, 32, 100), this.lanes ? fieldWidth / this.lanes * .8 : Infinity),
      lanes: this.lanes,
      pxPerSecond: pixelsPerSecond(this.zoom),
    };
  }

  pointToNote(clientX, clientY, state) {
    this.zoom = Number(state.zoom) || 100;
    this.lanes = state.view === 'preview' ? 0 : laneCount(state.xSnap);
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
      if (!noteEditable(note,state)) continue;
      if (Boolean(state.selected?.has(note.id)) !== selectedPass) continue;
      const shape = this._noteGeometry(note, state, g);
      if (selectedPass && state.selected.size === 1 && note.duration > 0) {
        for (let index = 0; index < (note.path || []).length; index++) {
          const p = this._pathPoint(note, note.path[index].time, state, g);
          if (Math.hypot(point.canvasX - p.x, point.canvasY - p.y) <= 10) return {note, part:'node', index};
        }
      }
      const headDistance = Math.abs(point.canvasY - shape.headY);
      const tailDistance = Math.abs(point.canvasY - shape.tailY);
      if (note.duration > 0 && tailDistance <= 10 && tailDistance < headDistance && Math.abs(point.canvasX - shape.tailX) <= g.noteWidth / 2 + 5) return { note, part: 'tail' };
      if (headDistance <= 11 && Math.abs(point.canvasX - shape.x) <= g.noteWidth / 2 + 5) return { note, part: 'head' };
      if (note.duration > 0 && point.canvasY > shape.tailY && point.canvasY < shape.headY) {
        const points=this.pathPoints(note,state,g);
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i];
          if(point.canvasY<Math.min(a.y,b.y)||point.canvasY>Math.max(a.y,b.y))continue;
          const ratio=b.y===a.y?0:(point.canvasY-a.y)/(b.y-a.y);
          if(Math.abs(point.canvasX-a.x-(b.x-a.x)*ratio)<=g.noteWidth/2+5)return {note,part:'body'};
        }
      }
    }
    return null;
  }

  _noteGeometry(note, state, g) {
    const start = note.time + state.chart.offset;
    const end = start + note.duration;
    const relative = state.view === 'preview' && note.duration > 0 ? clamp(state.time - start, 0, note.duration) : 0;
    const head = this._pathPoint(note, relative, state, g);
    const tail = this._pathPoint(note, note.duration || 0, state, g);
    return {x:head.x, headY:head.y, tailX:tail.x, tailY:tail.y, start, end};
  }

  _pathPoint(note, relative, state, g) {
    const endpoint = note.time + state.chart.offset + relative;
    const preview = state.view === 'preview';
    const x = preview ? noteX(state.chart,note,state.time,relative) : pathX(note,relative);
    const distance = preview ? scrollDistance(state.chart,note,state.time,endpoint) : endpoint - state.time;
    return {x:g.left+x*(g.right-g.left),y:g.hitY-distance*g.pxPerSecond};
  }

  pathPoints(note, state, g = this.geometry()) {
    const start = state.view === 'preview' ? clamp(state.time - note.time - state.chart.offset,0,note.duration) : 0;
    const points = [this._pathPoint(note, start, state, g)];
    const boundaries = new Set([0, note.duration, ...(note.path || []).map(p => p.time)]);
    if (state.view === 'preview') {
      // Speed knots can lie between path nodes. Keep them in the tessellation
      // so even short events are represented by the displayed ribbon.
      for (const event of state.chart.events || []) {
        if (event.property !== 'speed' || (event.target !== 'all' && event.target !== note.id && event.target !== note.group)) continue;
        for (const time of [event.time, event.time + event.duration / 2, event.time + event.duration]) {
          const relative = time - note.time;
          if (relative > 0 && relative < note.duration) boundaries.add(relative);
        }
      }
    }
    const stops = [...boundaries].sort((a, b) => a - b);
    const cache = new Map();
    const pointAt = time => {
      if (!cache.has(time)) cache.set(time, this._pathPoint(note, time, state, g));
      return cache.get(time);
    };
    const subdivide = (a, b, depth = 0) => {
      if (b <= start) return;
      const left = pointAt(a), right = pointAt(b);
      let error = 0;
      // The midpoint of an S bend can lie exactly on its chord.
      for (const u of [.25, .5, .75]) {
        const p = pointAt(a + (b - a) * u);
        error = Math.max(error, Math.hypot(p.x - left.x - (right.x - left.x) * u,
          p.y - left.y - (right.y - left.y) * u));
      }
      if (error > .25 && depth < 12) {
        const middle = (a + b) / 2;
        subdivide(a, middle, depth + 1);
        subdivide(middle, b, depth + 1);
      } else {
        points.push(right);
      }
    };
    // Anchor subdivisions to authored intervals. Advancing the held head only
    // clips existing samples instead of redistributing the remaining vertices.
    for (let i = 1; i < stops.length; i++) subdivide(stops[i - 1], stops[i]);
    return points;
  }

  intersects(note, marquee, state) {
    if(!noteEditable(note,state))return false;
    const g=this.geometry(), half=g.noteWidth/2+5;
    const left=Math.min(marquee.x1,marquee.x2),right=Math.max(marquee.x1,marquee.x2);
    const top=Math.min(marquee.y1,marquee.y2),bottom=Math.max(marquee.y1,marquee.y2);
    const points=note.duration>0?this.pathPoints(note,state,g):[this._pathPoint(note,0,state,g)];
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[Math.min(i+1,points.length-1)];
      if(Math.max(a.y,b.y)+7<top||Math.min(a.y,b.y)-7>bottom)continue;
      const dy=b.y-a.y;
      const u=dy?clamp((top-7-a.y)/dy,0,1):0,v=dy?clamp((bottom+7-a.y)/dy,0,1):1;
      const x1=a.x+(b.x-a.x)*u,x2=a.x+(b.x-a.x)*v;
      if(Math.max(x1,x2)+half>=left&&Math.min(x1,x2)-half<=right)return true;
    }
    return false;
  }

  hitEvent(clientX,clientY,state) {
    const p=this.pointToNote(clientX,clientY,state),g=this.geometry();
    if(p.canvasX<g.left-24||p.canvasX>g.left-8)return null;
    return (state.chart.events||[]).find(e=>eventVisible(e,state)&&targetEditable(state.chart,e.target)&&Math.abs(p.canvasY-(g.hitY-(e.time+state.chart.offset-state.time)*g.pxPerSecond))<=8)||null;
  }

  _drawEvents(state,g) {
    const ctx=this.ctx;
    for(const e of state.chart.events||[]) {
      if(!eventVisible(e,state))continue;
      const y=g.hitY-(e.time+state.chart.offset-state.time)*g.pxPerSecond;
      const end=y-e.duration*g.pxPerSecond;
      if(y<g.top||end>g.h)continue;
      const selected=state.selectedEvents?.has(e.id)||e.id===state.selectedEventId;
      const color=selected?'#f5f5f5':'#a1a1aa';
      line(ctx,g.left-17,Math.max(g.top,end),g.left-17,y,color,selected?3:1.5);
      ctx.fillStyle=color;ctx.fillRect(g.left-21,y-4,8,8);
      if(selected){line(ctx,g.left,y,g.right,y,'#737373');ctx.font=`11px ${this.font}`;ctx.textAlign='left';ctx.fillText({speed:'速度',x:'横移',opacity:'透明度'}[e.property],g.left+8,y-7);}
    }
  }

  draw(state) {
    this.zoom = Number(state.zoom) || 100;
    this.lanes = state.view === 'preview' ? 0 : laneCount(state.xSnap);
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
      if (state.grid) { this._drawGrid(state, g); this._drawLanes(g); }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, g.top, g.w, g.h - g.top);
    ctx.clip();
    if(!preview) this._drawEvents(state,g);
    line(ctx, g.left - 10, g.hitY + 0.5, g.right + 10, g.hitY + 0.5,
      preview ? (light ? 'rgba(67,86,83,.7)' : 'rgba(240,239,216,.8)') : '#a1a1aa', 1.5);
    this._drawChords(state, g, light);
    const notes = state.chart.notes.filter(note=>noteVisible(note,state));
    for (const note of notes) {
      if (!state.selected?.has(note.id)) this._drawNote(note, state, g, light, false);
    }
    for (const note of notes) {
      if (state.selected?.has(note.id)) this._drawNote(note, state, g, light, true);
    }
    if (!preview && state.hover && !state.draft) {
      this._drawNote({ x: state.hover.x, type: state.hover.type, time: state.hover.time - state.chart.offset, duration: 0 }, state, g, false, false, true);
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
      ctx.font = `10px ${this.font}`;
      ctx.textAlign = 'center';
      const positions = g.lanes ? laneCenters(g.lanes) : [0, .25, .5, .75, 1];
      for (const [index, position] of positions.entries()) {
        ctx.fillText(g.lanes ? String(index + 1) : `${position * 100}`, g.left + position * (g.right - g.left), 26);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#92929c';
      ctx.font = `10px ${this.font}`;
    }
  }

  _drawLanes(g) {
    for (let index = 1; index < g.lanes; index++) {
      const x = g.left + (g.right - g.left) * index / g.lanes;
      line(this.ctx, x, g.top, x, g.h, 'rgba(161,161,170,.16)');
    }
  }

  _drawRuler(state, g) {
    const ctx = this.ctx;
    const start = Math.max(0, state.time - (g.h - g.hitY) / g.pxPerSecond);
    const end = Math.min(state.chart.duration, state.time + (g.hitY - g.top) / g.pxPerSecond);
    const interval = g.pxPerSecond < 75 ? 2 : 1;
    ctx.font = `10px ${this.font}`;
    ctx.textAlign = 'right';
    for (let t = Math.ceil(start / interval) * interval; t <= end; t += interval) {
      const y = g.hitY - (t - state.time) * g.pxPerSecond;
      ctx.fillStyle = '#7f8c85';
      ctx.fillText(secondsLabel(t), g.left - 35, y + 3);
      line(ctx, g.left - 32, y + .5, g.left - 25, y + .5, '#4b5750');
    }
  }

  _drawGrid(state, g) {
    const ctx = this.ctx;

    const beatsPerBar = state.chart.beatsPerBar || 4;
    const division = Math.max(1, state.division || 4);
    const span = Math.max(0.01, state.span || 1);
    const step = span / division;
    const start = Math.max(0, state.time - (g.h - g.hitY) / g.pxPerSecond);
    const end = Math.min(state.chart.duration, state.time + (g.hitY - g.top) / g.pxPerSecond);
    const begin = Math.max(0, Math.ceil(beatAtTime(state.chart,start) / step));
    const finish = Math.ceil(beatAtTime(state.chart,end) / step);
    ctx.font = `10px ${this.font}`;
    ctx.textAlign = 'right';
    for (let tick = begin; tick <= finish && tick - begin < 2000; tick++) {
      const b = tick * span / division;
      const major = Math.abs(b / beatsPerBar - Math.round(b / beatsPerBar)) < 1e-6;
      const whole = Math.abs(b - Math.round(b)) < 1e-6;
      if (!whole && (timeAtBeat(state.chart,b+step)-timeAtBeat(state.chart,b)) * g.pxPerSecond < 5) continue;
      const y = Math.round(g.hitY - (timeAtBeat(state.chart,b) - state.time) * g.pxPerSecond) + .5;
      line(ctx, g.left - 10, y, g.right + 10, y,
        major ? 'rgba(180,180,185,.24)' : whole ? 'rgba(180,180,185,.12)' : 'rgba(180,180,185,.045)');
      if (whole) {
        ctx.fillStyle = major ? '#a8b6a9' : '#66766d';
        ctx.fillText(major ? `${Math.round(b / beatsPerBar) + 1}` : '·', g.left - 16, y + 3);
      }
    }
  }

  _drawChords(state, g, light) {
    const groups = new Map();
    for (const note of state.chart.notes) {
      if(!noteVisible(note,state))continue;
      const effective = note.time + state.chart.offset;
      if (state.view === 'preview' && effective < state.time - .03) continue;
      const shape = this._noteGeometry(note,state,g);
      const y = shape.headY;
      if (y < g.top || y > g.h) continue;
      const key = `${Math.round(note.time * 1000000)}:${Math.round(y)}`;
      if (!groups.has(key)) groups.set(key, { y, xs: [] });
      groups.get(key).xs.push(shape.x);
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
    const opacity = preview ? noteOpacity(state.chart,note,state.time) : Math.max(.22,note.opacity ?? 1);
    ctx.save();
    ctx.globalAlpha = fade * opacity * (!preview && groupMap(state.chart).get(note.group)?.locked ? .45 : 1);
    const width = g.noteWidth;
    const height = clamp(width * .12, 8, 12);
    const x = shape.x - width / 2;
    const head = shape.headY;
    const tail = shape.tailY;
    if (isHold) {
      const points=this.pathPoints(note,state,g);
      ctx.beginPath();
      points.forEach((p,i)=>i?ctx.lineTo(p.x-width/2,p.y):ctx.moveTo(p.x-width/2,p.y));
      [...points].reverse().forEach(p=>ctx.lineTo(p.x+width/2,p.y));
      ctx.closePath();
      ctx.fillStyle=light?'rgba(61,89,80,.25)':'rgba(224,234,213,.20)';
      ctx.fill();
      ctx.strokeStyle=selected&&!preview?'#a3a3a3':light?'rgba(61,89,80,.4)':'rgba(223,233,214,.30)';
      ctx.lineWidth=1;ctx.lineJoin='round';ctx.stroke();
      this._drawJade(shape.tailX-width/2,tail-height/2,width,height,light);
      for (const node of (note.path || []).slice(1, -1)) {
        if (preview && shape.start + node.time < state.time) continue;
        const p = this._pathPoint(note, node.time, state, g);
        this._drawJade(p.x-width/2,p.y-height*.36,width,height*.72,light);
        line(ctx,p.x-width/2+2,p.y-height*.36-1,p.x+width/2-2,p.y-height*.36-1,light?'rgba(52,92,80,.65)':'rgba(251,255,239,.9)',1.2);
      }
    }
    this._drawJade(x,head-height/2,width,height,light,note.type);
    if(selected&&!preview) {
      ctx.globalAlpha=1;
      ctx.strokeStyle='#fafafa';ctx.lineWidth=1.5;
      roundedRect(ctx,x-3,head-height/2-3,width+6,height+6,2);ctx.stroke();
      if(isHold&&state.selected.size===1) {
        (note.path||[]).forEach((node,index)=>{
          const p=this._pathPoint(note,node.time,state,g);
          const active=index===state.selectedNodeIndex;
          ctx.fillStyle=active?'#fafafa':'#262626';ctx.strokeStyle='#fafafa';
          ctx.beginPath();ctx.arc(p.x,p.y,active?5:4,0,TAU);ctx.fill();ctx.stroke();
        });
      }
    }
    ctx.restore();
  }

  _drawJade(x, y, width, height, dark, type = 'tap') {
    const ctx = this.ctx;
    if (type === 'drag') { y += height * .19; height *= .62; }
    const fill = ctx.createLinearGradient(0, y, 0, y + height);
    const colors = type === 'heartap'
      ? (dark ? ['#897498', '#695577', '#4e3e63'] : ['#f5efff', '#ded1f2', '#b6a0d2'])
      : type === 'drag'
        ? (dark ? ['#6b9197', '#456a72', '#30535e'] : ['#e4f7f7', '#bcdfe1', '#87b7bd'])
        : (dark ? ['#5b7568', '#3b584e', '#29443e'] : ['#f4f6e9', '#e1e9d7', '#b7c9b8']);
    fill.addColorStop(0, colors[0]);
    fill.addColorStop(.42, colors[1]);
    fill.addColorStop(1, colors[2]);
    ctx.fillStyle = fill;
    roundedRect(ctx, x, y, width, height, 1.6);
    ctx.fill();
    line(ctx, x + 1.5, y + 1.5, x + width - 1.5, y + 1.5, dark ? 'rgba(169,190,166,.40)' : 'rgba(255,255,249,.8)');
  }

  _drawHits(state, g, light) {
    const ctx = this.ctx;
    if (!this.impactSprites.has(light)) this.impactSprites.set(light, createImpactSprites(light));
    const sprites = this.impactSprites.get(light);
    const clock = state.effectTime ?? performance.now() / 1000;
    const unit = g.noteWidth / 176;
    if (state.playing) for (const note of state.chart.notes) {
      const start = note.time + state.chart.offset;
      if (!note.duration || state.time < start || state.time >= start + note.duration) continue;
      const x = g.left + noteX(state.chart, note, state.time) * (g.right - g.left);
      const remaining = (start + note.duration - state.time) / (state.playbackRate || 1);
      const strength = Math.min(1, remaining / .06) * noteOpacity(state.chart, note, state.time);
      if (strength > 0) drawHoldContact(ctx, sprites, x, g.hitY, unit, clock, strength, light);
    }
    for (const hit of state.hits || []) {
      const age = clock - hit.startedAt;
      const x = g.left + hit.x * (g.right - g.left);
      drawImpact(ctx, sprites, impactFrame(age, hit.kind), x, g.hitY, unit, light);
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
    if(state.loop?.enabled){
      const a=left+(right-left)*state.loop.start/state.chart.duration,b=left+(right-left)*state.loop.end/state.chart.duration;
      line(ctx,a,h/2,b,h/2,'#d4d4d8',5);
      for(const x of [a,b])line(ctx,x,3,x,h-3,'#a1a1aa',1);
    }
    if (progress > 0) line(ctx, left, h / 2, cursor, h / 2, '#a1a1aa', 3);
    ctx.fillStyle = '#e4e4e7';
    ctx.beginPath(); ctx.arc(cursor, h / 2, 4.5, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt';
  }
}
