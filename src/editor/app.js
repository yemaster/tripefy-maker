import {createDemoChart, createBlankChart, validateChart, serializeChart, effectiveTime, snapTime, formatTime, createId, History} from './model.js';
import {Renderer} from './renderer.js';
import {AudioEngine} from './audio.js';

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const clone = data => structuredClone(data);
const STORAGE = 'tripefy.chart-editor.v1';
const history = new History();
const audio = new AudioEngine();
const renderer = new Renderer($('editor'), $('timeline'));
let chart = createDemoChart();
try { const saved = localStorage.getItem(STORAGE); if (saved) chart = validateChart(JSON.parse(saved)); } catch { /* A damaged autosave must not prevent opening the editor. */ }
const state = {chart, time: 0, view:'edit', selected:new Set(), zoom:100, grid:true, division:4, span:1, snapEnabled:true, hover:null, draft:null, marquee:null, audioPeaks:null, audioDuration:0, playing:false, hits:[]};
let tool = 'tap';
let drag = null;
let clipboard = [];
let saveTimer = 0;
let toastTimer = 0;
let frameTime = 0;
let lastPlayTime = 0;
let lastBeat = -1;
let timelineDragging = false;
let timeEditing = false;
let audioLoadVersion = 0;
const audioCache = new Map();
const sceneNames = {dusk:'黄昏',night:'夜晚',clear:'晴朗',overcast:'阴天'};
const toolNames = {select:'选择',tap:'Tap',hold:'Hold',erase:'擦除'};
const toolHints = {select:'拖动框选 · Shift 多选 · 拖尾端调整 Hold',tap:'单击放置 Tap · 滚轮移动时间 · Space 播放',hold:'按下确定头部，向上拖出尾部 · Alt 临时取消吸附',erase:'单击或拖动擦除 · Ctrl Z 撤销'};

function toast(message) { $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200); }
function dirty() {
  $('save-state').textContent='保存中'; clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{try {localStorage.setItem(STORAGE,serializeChart(chart)); $('save-state').textContent='已保存';} catch { $('save-state').textContent='请导出保存'; }},250);
}
function replaceChart(next) {
  audioLoadVersion++; audio.cancelPendingLoad();
  chart=next; state.chart=chart;
  if(audio.file && audio.file.name!==chart.audio){audio.clear();state.audioPeaks=null;state.audioDuration=0;}
  state.selected=new Set([...state.selected].filter(id=>chart.notes.some(n=>n.id===id)));
  if(state.time>chart.duration) seek(chart.duration);
  syncUI(); dirty();
}
function commit(change, message='') {
  if(drag) finishDrag();
  const before=clone(chart), next=clone(chart);
  try {
    change(next);
    const normalized=validateChart(next);
    if(JSON.stringify(before)===JSON.stringify(normalized)) return false;
    history.push(before); replaceChart(normalized);
    if(message) toast(message);
    return true;
  } catch(error) {toast(error.message); syncUI(); return false;}
}
function finishDrag() {
  if(!drag) return;
  const before=drag.before;
  if(drag.kind==='hold' && state.draft) {
    const n=clone(state.draft);
    if(n.duration<0.001) n.duration=Math.min(snapStep(),chart.duration-effectiveTime(n,chart));
    if(n.duration>0) {chart.notes.push(n); state.selected=new Set([n.id]);}
  }
  if(before && JSON.stringify(before)!==JSON.stringify(chart)) {
    try {const normalized=validateChart(chart);history.push(before);replaceChart(normalized);} catch(error) {chart=before;state.chart=chart;toast(error.message);syncUI();}
  }
  drag=null;state.draft=null;state.marquee=null;syncUI();
}
function selectedNotes(){return chart.notes.filter(n=>state.selected.has(n.id));}
function syncUI(){
  $('document-title').textContent=chart.metadata.title||'未命名谱面';
  for(const key of ['title','artist','charter','difficulty','level']) {
    const el=$('meta-'+key);
    if(key==='difficulty'&&!Array.from(el.options).some(o=>o.value===chart.metadata.difficulty)) el.add(new Option(chart.metadata.difficulty,chart.metadata.difficulty));
    el.value=chart.metadata[key];
  }
  $('bpm').value=chart.bpm; $('beats-per-bar').value=chart.beatsPerBar||4; $('offset').value=Number((chart.offset*1000).toFixed(3)); $('duration').value=Number(chart.duration.toFixed(3));
  $('total-time').textContent='/ '+formatTime(chart.duration);
  $('note-total').textContent=chart.notes.length+' NOTES';
  $('undo').disabled=!history.canUndo; $('redo').disabled=!history.canRedo;
  $('paste-selection').disabled=!clipboard.length;
  $$('[data-scene]').forEach(b=>b.classList.toggle('active',b.dataset.scene===chart.scene.preset));
  $('scene-label').textContent=sceneNames[chart.scene.preset];
  syncAudioUI();syncSelection();syncTime();
}
function syncSelection(){
  const notes=selectedNotes(), count=notes.length;
  $('selection-section').hidden=!count;
  $('selection-count').textContent=count;
  $('selection-empty').hidden=!!count; $('selection-fields').hidden=!count;
  $('status-selection').textContent=count?`${count} 个音符`:'未选择';
  $('copy-selection').disabled=!count;
  if(count){
    $('note-time').value=Number(effectiveTime(notes[0],chart).toFixed(6));
    $('note-x').value=Number((notes[0].x*100).toFixed(3));
    $('note-duration').value=Number(notes[0].duration.toFixed(6));
    ['note-time','note-x','note-duration'].forEach(id=>$(id).disabled=count!==1);
  }
}
function syncAudioUI(){
  const loaded=!!audio.file && audio.file.name===chart.audio;
  $('audio-name').textContent=chart.audio || '载入音频';
  $('audio-detail').textContent=loaded?`${formatTime(audio.duration)} · 已载入`:chart.audio?'请重新载入同名音频':'MP3 / OGG / WAV';
  $('audio-download').disabled=!loaded;
  $('waveform-empty').hidden=!!state.audioPeaks;
}
function syncTime(){
  if(!timeEditing&&document.activeElement!==$('current-time')) $('current-time').value=formatTime(state.time);
  const beats=Math.max(0,(state.time-chart.offset)*chart.bpm/60);
  $('status-position').textContent=`第 ${Math.floor(beats/(chart.beatsPerBar||4))+1} 小节 · 第 ${Math.floor(beats%(chart.beatsPerBar||4))+1} 拍`;
  $('back-to-start').hidden=state.time<chart.duration-0.001;
}
function setTool(next){tool=next;setView('edit');$$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});$('status-tool').textContent=toolNames[tool];$('canvas-hint').textContent=toolHints[tool];$('editor').style.cursor=tool==='select'?'default':'crosshair';state.hover=null;}
function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelector('.workspace').classList.toggle('preview',view==='preview');$('canvas-mode').textContent=view==='edit'?'2D / EDIT':'2D / PREVIEW';$('canvas-hint').textContent=view==='edit'?toolHints[tool]:'Space 播放 / 暂停 · 滚轮定位';state.hover=null;}
function snapStep(){return 60/chart.bpm*state.span/state.division;}
function snap(seconds, alt=false){const first=Math.max(0,chart.offset);return clamp(state.snapEnabled&&!alt?snapTime(seconds,chart,state.division,state.span):seconds,first,chart.duration);}
function snapX(x, alt=false){const count=Number($('x-snap').value);return clamp(count&&!alt?Math.round(x*count)/count:x,0,1);}
function updateSnap(){
  const value=$('snap').value;
  state.snapEnabled=value!=='off';
  $('custom-snap').hidden=value!=='custom';
  if(value==='custom') {state.division=clamp(Math.round(Number($('snap-division').value)||1),1,64);state.span=Number($('snap-span').value);$('snap-division').value=state.division;}
  else if(value!=='off'){state.division=Number(value);state.span=1;}
  $('status-snap').textContent=state.snapEnabled?`${state.span} 拍 / ${state.division} 等分`:'自由放置';
}
function seek(seconds){
  state.time=clamp(seconds,0,chart.duration);audio.seek(state.time);lastPlayTime=state.time;lastBeat=Math.floor((state.time-chart.offset)*chart.bpm/60);state.hits=[];syncTime();
}
function pause(){if(state.playing) state.time=clamp(audio.pause(),0,chart.duration);state.playing=false;$('play').innerHTML='<svg><use href="#i-play"/></svg>';$('play').setAttribute('aria-label','播放');syncTime();}
async function togglePlayback(){
  if(state.playing){pause();return;}
  finishDrag();
  if(state.time>=chart.duration-.001) seek(0);
  try {await audio.resumeContext();audio.play(state.time,Number($('playback-rate').value));state.playing=true;lastPlayTime=state.time-.0001;lastBeat=Math.floor((state.time-chart.offset)*chart.bpm/60)-1;$('play').innerHTML='<svg><use href="#i-pause"/></svg>';$('play').setAttribute('aria-label','暂停');} catch(error){toast('无法开始播放：'+error.message);}
}
function undo(){finishDrag();pause();if(!history.canUndo)return;replaceChart(history.undo(chart));restoreCachedAudio();state.selected.clear();syncSelection();}
function redo(){finishDrag();pause();if(!history.canRedo)return;replaceChart(history.redo(chart));restoreCachedAudio();state.selected.clear();syncSelection();}
function removeSelected(){if(!state.selected.size)return;commit(c=>{c.notes=c.notes.filter(n=>!state.selected.has(n.id));});state.selected.clear();syncSelection();}
function copy(){clipboard=clone(selectedNotes());$('paste-selection').disabled=!clipboard.length;if(clipboard.length)toast(`已复制 ${clipboard.length} 个音符`);}
function paste(){
  if(!clipboard.length)return;
  const origin=Math.min(...clipboard.map(n=>n.time));const target=snap(state.time)-chart.offset;
  const pasted=clipboard.map(n=>({...clone(n),id:createId(),time:n.time-origin+target}));
  if(commit(c=>{c.notes.push(...pasted);c.duration=Math.max(c.duration,...pasted.map(n=>n.time+c.offset+n.duration));})) {state.selected=new Set(pasted.map(n=>n.id));syncSelection();}
}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function exportChart(){
  finishDrag();
  try{const text=serializeChart(chart);const filename=(chart.metadata.title||'chart').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');download(new Blob([text],{type:'application/json'}),filename+'.chart.json');toast('谱面已导出'+(chart.audio?' · 音频请与谱面放在同一目录':''));}catch(error){toast(error.message);}
}
async function importChart(file){
  if(!file)return false;
  try{
    if(file.size>20*1024*1024)throw new Error('谱面文件不能超过 20 MB。');
    const next=validateChart(JSON.parse(await file.text()));finishDrag();pause();audioLoadVersion++;history.push(chart);
    if(audio.file?.name!==next.audio){audio.clear();state.audioPeaks=null;state.audioDuration=0;}
    state.selected.clear();replaceChart(next);seek(0);restoreCachedAudio();toast('已导入 '+(next.metadata.title||file.name));return true;
  }catch(error){toast('导入失败：'+error.message);return false;}
}

async function audioDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('tripefy-editor-audio',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function storeAudio(file){try{const db=await audioDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}catch{toast('音频仅保留在本次会话，谱面已保存。');}}
function restoreCachedAudio(){if(chart.audio&&!audio.file&&audioCache.has(chart.audio))void loadAudio(audioCache.get(chart.audio),true);}
async function restoreAudio(){
  if(!chart.audio)return;
  const expected=chart.audio, version=audioLoadVersion;
  try{const db=await audioDatabase();const file=await new Promise((resolve,reject)=>{const req=db.transaction('files').objectStore('files').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();if(file?.name===expected&&chart.audio===expected&&version===audioLoadVersion){await loadAudio(file,true);}}catch{/* Audio remains explicitly marked as needing reload. */}
}
async function loadAudio(file,restoring=false){
  if(!file)return;
  if(!/\.(mp3|ogg|wav)$/i.test(file.name)){toast('请选择 MP3、OGG 或 WAV 音频。');return;}
  const version=++audioLoadVersion;finishDrag();pause();$('audio-detail').textContent='正在读取波形…';
  try {
    const result=await audio.load(file);
    if(version!==audioLoadVersion)return;
    audioCache.set(file.name,file);
    state.audioPeaks=result.peaks;state.audioDuration=result.duration;
    const lastEnd=chart.notes.reduce((max,n)=>Math.max(max,effectiveTime(n,chart)+n.duration),0);
    if(!restoring)commit(c=>{c.audio=file.name;c.duration=Math.max(c.duration,result.duration,lastEnd);});
    seek(Math.min(state.time,chart.duration));syncAudioUI();
    if(!restoring){await storeAudio(file);toast('音频已载入');}
  }catch(error){if(error.name==='AbortError')return;syncAudioUI();toast('音频读取失败：'+error.message);}
}

for(const key of ['title','artist','charter','difficulty','level']) $('meta-'+key).addEventListener('change',e=>commit(c=>c.metadata[key]=key==='level'?Number(e.target.value):e.target.value));
for(const [id,key,multiplier]of [['bpm','bpm',1],['beats-per-bar','beatsPerBar',1],['offset','offset',.001],['duration','duration',1]]) $(id).addEventListener('change',e=>{pause();commit(c=>c[key]=Number(e.target.value)*multiplier);});
$$('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$$('[data-panel]').forEach(b=>b.addEventListener('click',()=>{const panel=b.dataset.panel;$$('[data-panel]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b));});$('panel-chart').hidden=panel!=='chart';$('panel-scene').hidden=panel!=='scene';}));
$$('[data-scene]').forEach(b=>b.addEventListener('click',()=>commit(c=>c.scene.preset=b.dataset.scene)));
['snap','snap-division','snap-span'].forEach(id=>$(id).addEventListener('change',updateSnap));
$('zoom').addEventListener('input',e=>{state.zoom=Number(e.target.value);$('zoom-label').textContent=state.zoom+'%';});
$('grid-toggle').addEventListener('click',()=>{state.grid=!state.grid;$('grid-toggle').classList.toggle('active',state.grid);});
$('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
$('copy-selection').addEventListener('click',copy);$('paste-selection').addEventListener('click',paste);
$('mirror-selection').addEventListener('click',()=>commit(c=>c.notes.forEach(n=>{if(state.selected.has(n.id))n.x=1-n.x;})));
$('delete-selection').addEventListener('click',removeSelected);
for(const [id,key]of [['note-time','time'],['note-x','x'],['note-duration','duration']]) $(id).addEventListener('change',e=>{
  const note=selectedNotes()[0];if(!note)return;
  commit(c=>{const n=c.notes.find(n=>n.id===note.id);n[key]=Number(e.target.value)/(key==='x'?100:1)-(key==='time'?c.offset:0);});
});
$('play').addEventListener('click',togglePlayback);
$('rewind').addEventListener('click',()=>seek(0));$('back-to-start').addEventListener('click',()=>seek(0));
$('playback-rate').addEventListener('change',e=>{audio.setRate(Number(e.target.value));lastPlayTime=state.time;});
$('volume').addEventListener('input',e=>audio.setVolume(Number(e.target.value)/100));
function applyTimeInput(){const parts=$('current-time').value.split(':').map(Number);const seconds=parts.length===2?parts[0]*60+parts[1]:parts[0];timeEditing=false;if(Number.isFinite(seconds))seek(seconds);else{toast('时间格式为 mm:ss.mmm 或秒数。');syncTime();}}
$('current-time').addEventListener('focus',()=>timeEditing=true);
$('current-time').addEventListener('input',()=>timeEditing=true);
$('current-time').addEventListener('change',applyTimeInput);
$('current-time').addEventListener('blur',()=>{if(timeEditing)applyTimeInput();});
$('current-time').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyTimeInput();$('current-time').blur();}});
$('export-chart').addEventListener('click',exportChart);$('import-chart').addEventListener('click',()=>$('chart-file').click());
$('chart-file').addEventListener('change',async e=>{await importChart(e.target.files[0]);e.target.value='';});
$('load-audio').addEventListener('click',()=>$('audio-file').click());$('audio-file').addEventListener('change',async e=>{await loadAudio(e.target.files[0]);e.target.value='';});
$('audio-download').addEventListener('click',()=>{if(audio.file)download(audio.file,audio.file.name);});
$('new-chart').addEventListener('click',()=>$('new-dialog').showModal());
$('export-before-new').addEventListener('click',exportChart);
$('confirm-new').addEventListener('click',()=>{finishDrag();pause();audioLoadVersion++;history.push(chart);audio.clear();state.audioPeaks=null;state.audioDuration=0;state.selected.clear();replaceChart(createBlankChart());seek(0);$('new-dialog').close();});
$('show-shortcuts').addEventListener('click',()=>$('shortcuts-dialog').showModal());
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));

function eraseAt(e){const hit=renderer.hitTest(e.clientX,e.clientY,state);if(hit){chart.notes=chart.notes.filter(n=>n.id!==hit.note.id);state.selected.delete(hit.note.id);}}
$('editor').addEventListener('contextmenu',e=>e.preventDefault());
$('editor').addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  $('editor').focus();pause();
  if(state.view==='preview')return;
  const point=renderer.pointToNote(e.clientX,e.clientY,state);if(!point.inside)return;
  const hit=renderer.hitTest(e.clientX,e.clientY,state);
  $('editor').setPointerCapture(e.pointerId);
  if(tool==='erase'||e.button===2){drag={kind:'erase',before:clone(chart)};eraseAt(e);return;}
  if(hit){
    if(e.shiftKey&&state.selected.has(hit.note.id)){state.selected.delete(hit.note.id);syncSelection();return;}
    if(!state.selected.has(hit.note.id)){if(!e.shiftKey)state.selected.clear();state.selected.add(hit.note.id);}
    drag={kind:hit.part==='tail'&&hit.note.duration>0?'resize':'move',before:clone(chart),point,notes:clone(selectedNotes()),noteId:hit.note.id};
    syncSelection();return;
  }
  if(tool==='select'){
    const initial=e.shiftKey?new Set(state.selected):new Set();
    if(!e.shiftKey)state.selected.clear();
    drag={kind:'marquee',point,initial};state.marquee={x1:point.canvasX,y1:point.canvasY,x2:point.canvasX,y2:point.canvasY};syncSelection();return;
  }
  const time=snap(point.time,e.altKey), x=snapX(point.x,e.altKey);
  if(time<Math.max(0,chart.offset)||time>chart.duration)return;
  const n={id:createId(),time:time-chart.offset,x,duration:0};
  if(tool==='tap'){
    if(chart.notes.some(other=>Math.abs(other.time-n.time)<1e-7&&Math.abs(other.x-n.x)<.015)){toast('此位置已有音符');return;}
    if(commit(c=>c.notes.push(n))){state.selected=new Set([n.id]);syncSelection();}
  }else{drag={kind:'hold',before:clone(chart),start:time,x};state.draft=n;}
});
$('editor').addEventListener('pointermove',e=>{
  const point=renderer.pointToNote(e.clientX,e.clientY,state);
  state.hover=state.view==='edit'&&point.inside&&!drag&&tool!=='select'&&tool!=='erase'?{x:snapX(point.x,e.altKey),time:snap(point.time,e.altKey)}:null;
  $('cursor-readout').textContent=point.inside?`${formatTime(snap(point.time,e.altKey))}   ·   X ${(snapX(point.x,e.altKey)*100).toFixed(1)}%`:'';
  if(!drag)return;
  if(drag.kind==='erase'){eraseAt(e);return;}
  if(drag.kind==='hold'){
    const end=snap(point.time,e.altKey);state.draft.time=Math.min(drag.start,end)-chart.offset;state.draft.duration=Math.abs(end-drag.start);return;
  }
  if(drag.kind==='marquee'){
    state.marquee.x2=point.canvasX;state.marquee.y2=point.canvasY;
    const m=state.marquee,g=renderer.geometry();const x1=Math.min(m.x1,m.x2),x2=Math.max(m.x1,m.x2),y1=Math.min(m.y1,m.y2),y2=Math.max(m.y1,m.y2);
    state.selected=new Set(drag.initial);
    chart.notes.forEach(n=>{const x=g.left+n.x*(g.right-g.left),y=g.hitY-(effectiveTime(n,chart)-state.time)*g.pxPerSecond;const tail=y-n.duration*g.pxPerSecond;if(x>=x1&&x<=x2&&y>=y1&&tail<=y2)state.selected.add(n.id);});syncSelection();return;
  }
  if(drag.kind==='resize'){
    const n=chart.notes.find(n=>n.id===drag.noteId),original=drag.notes.find(n=>n.id===drag.noteId);
    const tail=snap(effectiveTime(original,chart)+original.duration+point.time-drag.point.time,e.altKey);
    n.duration=clamp(tail-effectiveTime(n,chart),.001,chart.duration-effectiveTime(n,chart));syncSelection();return;
  }
  if(drag.kind==='move'){
    const anchor=drag.notes.find(n=>n.id===drag.noteId);
    let dt=snap(effectiveTime(anchor,chart)+point.time-drag.point.time,e.altKey)-effectiveTime(anchor,chart);
    let dx=snapX(anchor.x+point.x-drag.point.x,e.altKey)-anchor.x;
    const minT=Math.min(...drag.notes.map(n=>n.time)),maxT=Math.max(...drag.notes.map(n=>n.time+n.duration));
    dt=clamp(dt,Math.max(0,-chart.offset)-minT,chart.duration-chart.offset-maxT);
    dx=clamp(dx,-Math.min(...drag.notes.map(n=>n.x)),1-Math.max(...drag.notes.map(n=>n.x)));
    for(const original of drag.notes){const n=chart.notes.find(n=>n.id===original.id);n.time=original.time+dt;n.x=original.x+dx;}syncSelection();
  }
});
$('editor').addEventListener('pointerup',e=>{finishDrag();if($('editor').hasPointerCapture(e.pointerId))$('editor').releasePointerCapture(e.pointerId);});
$('editor').addEventListener('pointercancel',()=>{if(drag?.before){chart=drag.before;state.chart=chart;}drag=null;state.draft=null;state.marquee=null;syncUI();});
$('editor').addEventListener('pointerleave',()=>{state.hover=null;$('cursor-readout').textContent='';});
$('editor').addEventListener('wheel',e=>{
  e.preventDefault();if(drag)return;
  if(e.ctrlKey||e.metaKey){state.zoom=clamp(state.zoom+(e.deltaY<0?10:-10),55,220);$('zoom').value=state.zoom;$('zoom-label').textContent=state.zoom+'%';}
  else {pause();seek(state.time+(e.deltaY>0?1:-1)*(e.shiftKey?snapStep():60/chart.bpm));}
},{passive:false});
function seekTimeline(e){const rect=$('timeline').getBoundingClientRect();pause();seek(clamp((e.clientX-rect.left-16)/(rect.width-32),0,1)*chart.duration);}
$('timeline').addEventListener('pointerdown',e=>{timelineDragging=true;$('timeline').setPointerCapture(e.pointerId);seekTimeline(e);});
$('timeline').addEventListener('pointermove',e=>{if(timelineDragging)seekTimeline(e);});
$('timeline').addEventListener('pointerup',()=>timelineDragging=false);$('timeline').addEventListener('pointercancel',()=>timelineDragging=false);
$('timeline').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pause();seek(state.time+(e.key==='ArrowRight'?1:-1)*60/chart.bpm);}});
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]'))return;
  const command=e.ctrlKey||e.metaKey;
  if(command&&['s','o'].includes(e.key.toLowerCase())){e.preventDefault();e.key.toLowerCase()==='s'?exportChart():$('chart-file').click();return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(command){
    const key=e.key.toLowerCase();
    if(['z','y','a','c','v','x'].includes(key))e.preventDefault();
    if(key==='z')e.shiftKey?redo():undo();else if(key==='y')redo();else if(key==='a'){state.selected=new Set(chart.notes.map(n=>n.id));syncSelection();}else if(key==='c')copy();else if(key==='v')paste();else if(key==='x'){copy();removeSelected();}return;
  }
  if(e.code==='Space'){e.preventDefault();if(!e.repeat)togglePlayback();}
  else if(['1','2','3','4'].includes(e.key))setTool(['select','tap','hold','erase'][Number(e.key)-1]);
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}
  else if(e.key==='Escape'){if(drag?.before){chart=drag.before;state.chart=chart;}drag=null;state.draft=null;state.marquee=null;state.selected.clear();syncUI();}
  else if(e.key==='Home'){e.preventDefault();seek(0);}
  else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();pause();seek(state.time+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?60/chart.bpm:snapStep()));}
});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',async e=>{e.preventDefault();const files=[...e.dataTransfer.files];const json=files.find(f=>/\.json$/i.test(f.name));if(json&&!await importChart(json))return;const sound=files.find(f=>/\.(mp3|ogg|wav)$/i.test(f.name));if(sound)await loadAudio(sound);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('beforeunload',()=>{try{localStorage.setItem(STORAGE,serializeChart(chart));}catch{}});
new ResizeObserver(()=>renderer.resize()).observe($('canvas-wrap'));

function frame(now){
  if(state.playing){
    const current=audio.time;
    state.time=Math.min(chart.duration,current);
    if(!audio.playing&&current<chart.duration-.0001)audio.play(current,Number($('playback-rate').value));
    if(current>=chart.duration-.0001){pause();seek(chart.duration);}
    const beat=Math.floor((state.time-chart.offset)*chart.bpm/60);
    if($('metronome').checked&&beat>lastBeat&&beat>=0)audio.tick(beat%(chart.beatsPerBar||4)===0);
    lastBeat=beat;
    for(const n of chart.notes){const t=effectiveTime(n,chart);if(t>lastPlayTime&&t<=state.time){state.hits.push({x:n.x,time:t});if($('hitsound').checked)audio.hit();}}
    lastPlayTime=state.time;
  }
  state.hits=state.hits.filter(h=>state.time-h.time<.38&&state.time>=h.time);
  renderer.draw(state);
  if(now-frameTime>40){renderer.drawTimeline(state);syncTime();frameTime=now;}
  requestAnimationFrame(frame);
}
// Keep the selection inspector visible while the property list scrolls.
document.querySelector('.sidebar').insertBefore($('selection-section'),document.querySelector('.sidebar-footer'));
syncUI();updateSnap();audio.setVolume(.65);renderer.resize();requestAnimationFrame(frame);restoreAudio();
