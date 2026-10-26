import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../src/editor/renderer.js';
import {createBlankChart,validateChart} from '../src/editor/model.js';
import {noteX,scrollDistance} from '../src/editor/animation.js';

const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);
function canvas(width=1400,height=900,left=24,top=40){
  const context={setTransform(){}};
  return {width:0,height:0,getContext:()=>context,getBoundingClientRect:()=>({width,height,left,top})};
}
function renderer(width=1400,height=900){return new Renderer(canvas(width,height),canvas(width,36));}
function fixture(extra={}){
  const chart=createBlankChart();chart.offset=.4;
  chart.notes=[{id:'snake',time:2,x:.2,duration:3,path:[{time:0,x:.2,curve:'linear'},{time:1.5,x:.8,curve:'easeInOut'},{time:3,x:.4,curve:'linear'}]}];
  return {chart:validateChart(chart),time:2.4,zoom:100,view:'edit',selected:new Set(),...extra};
}
function client(render,point){const rect=render.canvas.getBoundingClientRect();return [point.x+rect.left,point.y+rect.top];}

test('wide geometry uses available canvas space with room for edge notes and ruler',()=>{
  const render=renderer(1800,900),g=render.geometry();
  assert.equal(g.left,82);assert.equal(g.right,1744);assert.equal(g.right-g.left,1662);
  assert.ok(g.right-g.left>820);assert.ok(g.left-g.noteWidth/2>=0);assert.ok(g.right+g.noteWidth/2<=g.w);
  const small=renderer(400,600).geometry();assert.equal(small.right,344);assert.ok(small.right+small.noteWidth/2<=400);
  near(g.hitY,720);
});

test('edit geometry retains linear chart time even with speed events and note speed',()=>{
  const render=renderer(),state=fixture();state.chart.notes[0].speed=3;
  state.chart.events=[{id:'s',target:'all',property:'speed',time:0,duration:0,from:1,to:4,curve:'linear'}];
  const g=render.geometry(),shape=render._noteGeometry(state.chart.notes[0],state,g);
  near(shape.headY,g.hitY);near(shape.tailY,g.hitY-3*g.pxPerSecond);
  near(shape.x,g.left+.2*(g.right-g.left));near(shape.tailX,g.left+.4*(g.right-g.left));
});

test('marquee selection includes the whole curved ribbon, including edge width',()=>{
  const render=renderer(),state=fixture(),g=render.geometry(),note=state.chart.notes[0];
  const bend={x:g.left+.8*(g.right-g.left),y:g.hitY-1.5*g.pxPerSecond};
  assert.equal(render.intersects(note,{x1:bend.x+g.noteWidth/2-2,x2:bend.x+g.noteWidth/2+2,y1:bend.y-3,y2:bend.y+3},state),true);
  assert.equal(render.intersects(note,{x1:bend.x+g.noteWidth/2+20,x2:bend.x+g.noteWidth/2+25,y1:bend.y-2,y2:bend.y+2},state),false);
  assert.equal(render.intersects(note,{x1:bend.x+4,x2:bend.x-4,y1:bend.y+4,y2:bend.y-4},state),true);
  const points=render.pathPoints(note,state,g);
  assert.ok(points.some(p=>Math.abs(p.x-bend.x)<1e-8&&Math.abs(p.y-bend.y)<1e-8));
  for(const point of [points[0],points.at(-1)])assert.equal(render.intersects(note,{x1:point.x-2,x2:point.x+2,y1:point.y-2,y2:point.y+2},state),true);
});

test('hit testing follows curved head, body, tail, and selected node handles',()=>{
  const render=renderer(),state=fixture(),g=render.geometry(),note=state.chart.notes[0];
  const shape=render._noteGeometry(note,state,g);
  assert.equal(render.hitTest(...client(render,{x:shape.x,y:shape.headY}),state)?.part,'head');
  assert.equal(render.hitTest(...client(render,{x:shape.tailX,y:shape.tailY}),state)?.part,'tail');
  const bend=render._pathPoint(note,1.5,state,g);
  assert.equal(render.hitTest(...client(render,bend),state)?.part,'body');
  assert.equal(render.hitTest(...client(render,{x:bend.x+g.noteWidth,y:bend.y}),state),null);
  state.selected.add(note.id);
  assert.deepEqual(render.hitTest(...client(render,bend),state),{note,part:'node',index:1});
});

test('preview combines current path offsets and speed integration while pinning held head',()=>{
  const render=renderer(),state=fixture({view:'preview',time:2.9});
  state.chart.notes[0].speed=1.5;
  state.chart.events=[
    {id:'speed-global',target:'all',property:'speed',time:0,duration:8,from:1,to:2,curve:'easeIn'},
    {id:'speed-note',target:'snake',property:'speed',time:0,duration:8,from:1,to:.5,curve:'easeOut'},
    {id:'x-global',target:'all',property:'x',time:0,duration:0,from:0,to:.1,curve:'linear'},
    {id:'x-note',target:'snake',property:'x',time:0,duration:0,from:0,to:-.05,curve:'linear'},
  ];
  const g=render.geometry(),note=state.chart.notes[0],shape=render._noteGeometry(note,state,g);
  near(shape.headY,g.hitY);
  near(shape.x,g.left+noteX(state.chart,note,state.time)*(g.right-g.left));
  near(shape.tailX,g.left+.45*(g.right-g.left));
  near(shape.tailY,g.hitY-scrollDistance(state.chart,note,state.time,note.time+state.chart.offset+note.duration)*g.pxPerSecond);
  const points=render.pathPoints(note,state,g);near(points[0].x,shape.x);near(points[0].y,shape.headY);
  near(points.at(-1).x,shape.tailX);near(points.at(-1).y,shape.tailY);
  const bend=render._pathPoint(note,1.5,state,g);
  assert.equal(render.hitTest(...client(render,bend),state)?.part,'body');
});

test('preview path horizontal events use current playback time for the whole body',()=>{
  const render=renderer(),state=fixture({view:'preview',time:2.9});
  state.chart.events=[{id:'x',target:'all',property:'x',time:0,duration:10,from:0,to:.4,curve:'linear'}];
  const g=render.geometry(),note=state.chart.notes[0],shape=render._noteGeometry(note,state,g);
  // (2.9 - offset .4) / 10 * .4 = .1 applied to every body point.
  near(shape.tailX,g.left+.5*(g.right-g.left));
  const bend=render._pathPoint(note,1.5,state,g);near(bend.x,g.left+.9*(g.right-g.left));
});

function distanceToSegment(point, a, b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const u=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
  return Math.hypot(point.x-a.x-u*dx,point.y-a.y-u*dy);
}

test('short wide S bends are sampled between their midpoint and endpoints',()=>{
  const render=renderer(1800,900),state=fixture(),note=state.chart.notes[0],g=render.geometry();
  note.duration=.06;note.path=[{time:0,x:.1,curve:'linear'},{time:.06,x:.9,curve:'easeInOut'}];
  const points=render.pathPoints(note,state,g);
  assert.ok(points.length>8,'a short S bend must not collapse into a diagonal');
  for(let i=0;i<=2000;i++){
    const actual=render._pathPoint(note,note.duration*i/2000,state,g);
    const error=Math.min(...points.slice(1).map((b,j)=>distanceToSegment(actual,points[j],b)));
    assert.ok(error<.5,`ribbon deviated ${error}px from authored curve`);
  }
});

test('playing through a Hold clips the head without moving remaining sample times',()=>{
  const render=renderer(),state=fixture({view:'preview',time:2.713}),note=state.chart.notes[0],g=render.geometry();
  const times=()=>render.pathPoints(note,state,g).map(p=>(g.hitY-p.y)/g.pxPerSecond+state.time-note.time-state.chart.offset);
  const before=times();state.time+=.007;
  const after=times(),start=state.time-note.time-state.chart.offset;
  const retained=before.slice(1).filter(t=>t>start+1e-9);
  assert.equal(after.length,retained.length+1);
  after.slice(1).forEach((time,i)=>near(time,retained[i]));
  near(after[0],start);near(after.at(-1),note.duration);
  assert.equal(new Set(after.map(t=>t.toFixed(9))).size,after.length,'no duplicate tail');
});

test('smooth ribbons remain accurate with narrow speed events and horizontal clamping',()=>{
  const render=renderer(1800,1000),state=fixture({view:'preview',time:2.5}),g=render.geometry();
  const note=state.chart.notes[0];note.speed=2;
  note.path=[{time:0,x:.1,curve:'smooth'},{time:.4,x:.8,curve:'smooth'},{time:1.9,x:.9,curve:'smooth'},{time:3,x:.2,curve:'smooth'}];
  state.chart.events=[
    {id:'s',target:note.id,property:'speed',time:2.413,duration:.019,from:.1,to:8,curve:'easeInOut'},
    {id:'x',target:'all',property:'x',time:0,duration:0,from:0,to:.15,curve:'linear'},
  ];
  const points=render.pathPoints(note,state,g),start=state.time-note.time-state.chart.offset;
  let segment=1;
  for(let i=0;i<=4000;i++){
    const t=start+(note.duration-start)*i/4000,actual=render._pathPoint(note,t,state,g);
    while(segment<points.length-1&&points[segment].y>actual.y)segment++;
    const error=distanceToSegment(actual,points[segment-1],points[segment]);
    assert.ok(error<.5,`speed-integrated ribbon deviated ${error}px at ${t}s`);
  }
  near(points[0].y,g.hitY);
});
