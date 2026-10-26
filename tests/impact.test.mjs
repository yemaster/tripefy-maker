import test from 'node:test';
import assert from 'node:assert/strict';
import {collectImpacts, impactFrame, IMPACT_LIFETIME, MAX_ACTIVE_IMPACTS} from '../src/editor/impact.js';
import {Renderer} from '../src/editor/renderer.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const chart={offset:.25,events:[],notes:[
  {id:'tap',time:1,x:.2,duration:0},
  {id:'hold',time:2,x:.3,duration:1,path:[{time:0,x:.3,curve:'linear'},{time:1,x:.8,curve:'linear'}]},
]};

test('playback generates each head and hold tail once at their animated position',()=>{
  const first=collectImpacts(chart,1.2,1.3,10,1);
  assert.equal(first.length,1);assert.equal(first[0].kind,'head');near(first[0].x,.2);near(first[0].startedAt,9.95);
  assert.deepEqual(collectImpacts(chart,1.3,1.4,10.1,1),[]);
  const head=collectImpacts(chart,2.2,2.26,11,1);assert.equal(head[0].kind,'head');near(head[0].x,.3);
  const tail=collectImpacts(chart,3.2,3.3,12,1);assert.equal(tail.length,1);assert.equal(tail[0].kind,'tail');near(tail[0].x,.8);
});

test('a curved hold scores each completed segment, with no extra head or tail unit',()=>{
  const hold={id:'segmented',type:'hold',time:1,x:.2,duration:3,path:[
    {time:0,x:.2,curve:'smooth'},{time:1,x:.8,curve:'smooth'},
    {time:2,x:.4,curve:'smooth'},{time:3,x:.6,curve:'smooth'},
  ]};
  const c={offset:.25,events:[],notes:[hold]};
  const hits=[1.25,2.25,3.25,4.25].flatMap(t=>collectImpacts(c,t-.01,t+.01,t));
  assert.deepEqual(hits.map(h=>h.kind),['head','checkpoint','checkpoint','tail']);
  assert.deepEqual(hits.map(h=>h.judgement),[false,true,true,true]);
  assert.deepEqual(hits.filter(h=>h.judgement).map(h=>h.segmentIndex),[0,1,2]);
  [ .2,.8,.4,.6 ].forEach((x,i)=>near(hits[i].x,x));
  assert.ok(hits.every(hit=>hit.noteId==='segmented'));
  for(const type of ['tap','drag','heartap']){
    const single={...hold,type,duration:0,path:[]};
    const hit=collectImpacts({...c,notes:[single]},1.24,1.26,1.26);
    assert.equal(hit.length,1);assert.equal(hit[0].judgement,true);
  }
});

test('real-time aging stays short at quarter speed and includes frame latency',()=>{
  const slow=collectImpacts(chart,1.24,1.26,20,.25)[0];
  const normal=collectImpacts(chart,1.24,1.29,20,1)[0];
  near(slow.startedAt,normal.startedAt);
  assert.deepEqual(impactFrame(20-slow.startedAt),impactFrame(20-normal.startedAt));
  assert.equal(impactFrame(IMPACT_LIFETIME),null);
  assert.equal(impactFrame(.18,'tail'),null);
});

test('seeking backwards or jumping across expired notes produces no delayed burst',()=>{
  assert.deepEqual(collectImpacts(chart,3,1,20),[]);
  assert.deepEqual(collectImpacts(chart,0,8,20),[]);
});

test('contact keeps its peak through the first display frame, then clears quickly',()=>{
  assert.equal(impactFrame(0).core,1);
  assert.equal(impactFrame(1/60).core,1);
  assert.ok(impactFrame(1/30).core>.8);
  assert.ok(impactFrame(.075).core<impactFrame(1/30).core);
  assert.equal(impactFrame(.11).core,0);
  assert.equal(impactFrame(.13).flare,0);
  assert.ok(impactFrame(.13).flame>0);
  assert.equal(impactFrame(.18).flame,0);
  assert.equal(impactFrame(-.01),null);
});

test('outward motion stays visible after contact without lingering into the next beat',()=>{
  const early=impactFrame(.05),late=impactFrame(.12);
  assert.ok(early.arcs.length>0&&early.petals.length>0);
  assert.ok(early.arcs.every(a=>a.end-a.start<Math.PI&&a.alpha<early.core));
  assert.ok(late.arcs[0].radius>early.arcs[0].radius);
  early.petals.forEach((petal,i)=>{
    assert.ok(late.petals[i].distance>petal.distance);
    assert.ok(late.petals[i].alpha<petal.alpha);
  });
  assert.equal(impactFrame(.25).arcs.length,0);
  assert.equal(impactFrame(.29).petals.length,0);
  assert.equal(impactFrame(.18,'tail'),null);
});

test('extreme simultaneous hits stay within the active impact budget',()=>{
  const dense={offset:0,events:[],notes:Array.from({length:5000},(_,i)=>({id:`n${i}`,time:1,x:i/5000,duration:0}))};
  const hits=collectImpacts(dense,.99,1.01,10);
  assert.equal(hits.length,MAX_ACTIVE_IMPACTS);
  assert.ok(hits.every(hit=>hit.startedAt>9.9));
});

test('hold contact follows combined opacity, including zero from an event',()=>{
  const run=(opacity,events=[])=>{
    const alphas=[];
    const ctx={globalAlpha:1,save(){},restore(){},translate(){},scale(){},fillRect(){alphas.push(this.globalAlpha);},drawImage(){alphas.push(this.globalAlpha);}};
    const renderer=Object.create(Renderer.prototype);
    renderer.ctx=ctx;renderer.impactSprites=new Map([[false,{glow:{},flame:{},petal:{}}]]);
    renderer._drawHits({playing:true,time:1.5,effectTime:10,playbackRate:1,hits:[],chart:{offset:0,events,notes:[{id:'hold',time:1,x:.5,duration:1,opacity}]}},{left:0,right:100,hitY:100,noteWidth:100},false);
    return alphas;
  };
  const full=run(1),half=run(.5);
  assert.ok(full.length>0);assert.equal(half.length,full.length);
  full.forEach((alpha,i)=>near(half[i],alpha*.5));
  assert.deepEqual(run(0),[]);
  assert.deepEqual(run(1,[{id:'hide',target:'hold',property:'opacity',time:0,duration:0,from:1,to:0,curve:'linear'}]),[]);
});
