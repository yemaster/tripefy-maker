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
