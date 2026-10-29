import {noteEditable,groupMap,targetEditable} from './groups.js';
import {beatAtTime,secondsForBeats} from './timing.js';
import {authoringSnapshot,attachAuthoring,eventVisible} from './authoring.js';
import {pasteEvents} from './presets.js';
import {createDemoChart, createBlankChart, validateChart, serializeChart, effectiveTime, snapTime, formatTime, createId, History} from './model.js';
import {Renderer} from './renderer.js';
import {AudioEngine} from './audio.js';
import {copySelection, pasteSelection, deleteSelection, mirrorSelection, alignSelection, moveSelection, resizeHold, changeNoteType} from './operations.js';
import {pathX, eventValue, invalidateAnimationCache} from './animation.js';
import {collectImpacts, IMPACT_LIFETIME, MAX_ACTIVE_IMPACTS} from './impact.js';
import {wheelTimeDelta, wheelZoom, anchoredZoomTime, stepTime} from './navigation.js';
import {snapHorizontal, laneCount, validHorizontalMode} from './lanes.js';
import {extendsSelection} from './selection.js';
import {resolveEventValues,setEventValueMode} from './event-values.js';

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
const state = {chart, time: 0, view:'edit', selected:new Set(), selectedNodeIndex:0, selectedEventId:null, zoom:100, grid:true, division:4, span:1, snapEnabled:true, hover:null, draft:null, marquee:null, audioPeaks:null, audioDuration:0, playing:false, hits:[]};
Object.assign(state,{selectedEvents:new Set(),eventNoteTargets:new Set(),groupFilter:'all',activeGroupId:null,eventLayer:0,eventTarget:'*',loop:{enabled:false,start:0,end:Math.min(4,chart.duration)}});
state.xSnap='0';
try { const saved=localStorage.getItem('tripefy.editor.horizontal'); if(validHorizontalMode(saved))state.xSnap=saved; } catch { /* Preferences are optional. */ }
$('x-snap').value=state.xSnap;
let tool = 'select';
let drag = null;
let clipboard = {notes:[],events:[]};
let eventClipboard=[];
let saveTimer = 0;
let toastTimer = 0;
let frameTime = 0;
let lastPlayTime = 0;
let lastBeat = -1;
let timelineDragging = false;
let timeEditing = false;
let audioLoadVersion = 0;
let inspectedSelection = '';
let targetOptionsChart=null;
const audioCache = new Map();
const sceneNames = {dusk:'黄昏',night:'夜晚',clear:'晴朗',overcast:'阴天'};
const toolNames = {select:'选择',tap:'Tap',hold:'Hold',erase:'擦除'};
const toolHints = {select:'拖动框选 · Ctrl / ⌘ / Option 多选 · 拖尾端调整 Hold',tap:'单击放置 Tap · 滚轮移动时间 · Space 播放',hold:'按下确定头部，向上拖出尾部 · Alt 临时取消吸附',erase:'单击或拖动擦除 · Ctrl Z 撤销'};

function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3200); }
function emit(name,detail){window.dispatchEvent(new CustomEvent('editor:'+name,{detail}));}
function dirty() {
  $('save-state').textContent='保存中'; clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{try {localStorage.setItem(STORAGE,serializeChart(chart)); $('save-state').textContent='已保存';} catch { $('save-state').textContent='请导出保存'; }},250);
}
function replaceChart(next) {
  audioLoadVersion++; audio.cancelPendingLoad();
  chart=next; state.chart=chart;
  const notesById=new Map(chart.notes.map(note=>[note.id,note])),eventsById=new Map(chart.events.map(event=>[event.id,event]));
  if(audio.file && audio.file.name!==chart.audio){audio.clear();state.audioPeaks=null;state.audioDuration=0;}
  if(!['all','ungrouped'].includes(state.groupFilter)&&!chart.groups?.some(g=>g.id===state.groupFilter))state.groupFilter='all';
  if(!chart.groups?.some(g=>g.id===state.activeGroupId))state.activeGroupId=null;
  if(!['*','all','selected'].includes(state.eventTarget)&&!chart.groups?.some(g=>g.id===state.eventTarget))state.eventTarget='*';
  state.eventNoteTargets=new Set([...state.eventNoteTargets].filter(id=>notesById.has(id)));
  state.selected=new Set([...state.selected].filter(id=>notesById.has(id)&&noteEditable(notesById.get(id),state)));
  state.selectedEvents=new Set([...state.selectedEvents].filter(id=>eventsById.has(id)&&targetEditable(chart,eventsById.get(id).target)));
  if(state.loop.end>chart.duration)state.loop={enabled:false,start:0,end:Math.min(4,chart.duration)};
  if(!state.selectedEvents.has(state.selectedEventId))state.selectedEventId=[...state.selectedEvents][0]||null;
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
  syncClipboard();
  $('select-all').disabled=!chart.notes.length;
  $$('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===chart.scene.preset)));
  $('scene-label').textContent=sceneNames[chart.scene.preset];
  syncAudioUI();syncSelection();syncEvents();syncTime();
}
function syncSelection(){
  const notes=selectedNotes(), count=notes.length;
  if(count&&state.eventTarget==='selected')state.eventNoteTargets=new Set(state.selected);
  const selectionKey=notes.map(note=>note.id).join(',');
  if(count && selectionKey!==inspectedSelection) emit('panel',{panel:'notes'});
  inspectedSelection=selectionKey;
  $('selection-count').textContent=count;
  $('selection-empty').hidden=!!count; $('selection-fields').hidden=!count;
  $('status-selection').textContent=[count?`${count} 个音符`:'',state.selectedEvents.size?`${state.selectedEvents.size} 个事件`:''].filter(Boolean).join(' · ')||'未选择';
  for(const id of ['copy-selection','cut-selection'])$(id).disabled=!count&&!state.selectedEvents.size;
  for(const id of ['mirror-selection','delete-selection'])$(id).disabled=!count;
  $('align-selection').disabled=!count||!laneCount(state.xSnap);
  if(count){
    $('note-time').value=Number(effectiveTime(notes[0],chart).toFixed(6));
    $('note-x').value=Number((notes[0].x*100).toFixed(3));
    $('note-duration').value=Number(notes[0].duration.toFixed(6));
    ['note-time','note-x','note-duration'].forEach(id=>$(id).disabled=count!==1);
    $('note-type').value=notes.every(n=>n.type===notes[0].type)?notes[0].type:'';
    $('note-duration').disabled=count!==1||notes[0].type!=='hold';
    for(const [id,key,scale]of [['note-opacity','opacity',100],['note-speed','speed',1]]) {
      const same=notes.every(n=>n[key]===notes[0][key]);$(id).value=same?Number((notes[0][key]*scale).toFixed(3)):'';$(id).placeholder=same?'':'混合';
    }
  }
  syncPath();syncInspectorLists();
}
function singleHold(){const notes=selectedNotes();return notes.length===1&&notes[0].duration>0?notes[0]:null;}
function syncPath(){
  const note=singleHold();$('path-section').hidden=!note;if(!note)return;
  state.selectedNodeIndex=clamp(state.selectedNodeIndex,0,note.path.length-1);
  const index=state.selectedNodeIndex,node=note.path[index];
  $('path-time').value=Number(node.time.toFixed(6));$('path-x').value=Number((node.x*100).toFixed(3));$('path-curve').value=node.curve;
  $('path-time').disabled=index===0||index===note.path.length-1;$('path-curve').disabled=index===0;
  $('delete-path-node').disabled=index===0||index===note.path.length-1;
  $('smooth-path').disabled=note.path.every(node=>node.curve==='smooth');
}
function syncInspectorLists(){
  const noteIndices=new Map(chart.notes.map((note,index)=>[note.id,index+1]));
  emit('inspector',{...authoringSnapshot(state,eventClipboard),scene:chart.scene.preset,pathNodes:(singleHold()?.path||[]).map((p,index)=>({...p,index})),events:chart.events.map(e=>({...e,time:e.time+chart.offset,targetLabel:e.target==='all'?'全部':groupMap(chart).get(e.target)?.name||`音符 ${noteIndices.get(e.target)}`})),selectedEventId:state.selectedEventId,selectedNodeIndex:state.selectedNodeIndex,noteCount:state.selected.size});
}
function syncEvents(){
  const event=chart.events.find(e=>e.id===state.selectedEventId);$('event-fields').hidden=!event||state.selectedEvents.size!==1;
  const select=$('event-target');if(targetOptionsChart!==chart){targetOptionsChart=chart;select.replaceChildren(new Option('全部音符','all'));
  for(const g of chart.groups||[])if(!g.locked)select.add(new Option('组 · '+g.name,g.id));
  chart.notes.forEach((n,i)=>{if(targetEditable(chart,n.id))select.add(new Option(`${i+1} · ${formatTime(effectiveTime(n,chart))}`,n.id));});}
  if(event){
    $('event-layer').value=event.layer||0;
    for(const key of ['property','target','curve'])$('event-'+key).value=event[key];
    $('event-duration').value=Number(event.duration.toFixed(6));
    $('event-time').value=Number((event.time+chart.offset).toFixed(6));
    const scale=event.property==='speed'?1:100;
    const mode=event.valueMode||'end';$('event-value-mode').value=mode;
    const range=mode==='delta'?(event.property==='speed'?[-7.9,7.9]:event.property==='opacity'?[-100,100]:[-200,200]):event.property==='speed'?[.1,8]:event.property==='opacity'?[0,100]:[-100,100];
    const unit={speed:'速度 (×)',x:'偏移 (%)',opacity:'透明度 (%)'}[event.property];
    $('event-to').value=Number(((event.valueMode?event.value:event.to)*scale).toFixed(3));$('event-to').min=range[0];$('event-to').max=range[1];$('event-to').step=event.property==='speed'?.05:1;
    document.querySelector('label[for="event-to"]').textContent=(mode==='delta'?'变化量 · ':'终值 · ')+unit;
    $('event-start-value').textContent=`${event.valueMode?'自动起点':'原谱起点'} ${Number((event.from*scale).toFixed(3))} → ${Number((event.to*scale).toFixed(3))}`;
  }
  syncInspectorLists();
}
function selectEvents(ids,preserveNotes=false){const eventsById=new Map(chart.events.map(event=>[event.id,event]));state.selectedEvents=new Set(ids.filter(id=>eventsById.has(id)&&targetEditable(chart,eventsById.get(id).target)));state.selectedEventId=[...state.selectedEvents][0]||null;if(!preserveNotes)state.selected.clear();syncSelection();syncEvents();}
function selectEvent(id,append=false){const event=chart.events.find(e=>e.id===id);if(!event||!targetEditable(chart,event.target))return;const ids=append?new Set(state.selectedEvents):new Set();if(append&&ids.has(id))ids.delete(id);else ids.add(id);selectEvents([...ids],append);if(state.eventLayer!==-1)state.eventLayer=event.layer||0;syncEvents();emit('panel',{panel:'events'});}
function addPathNode(time=null,x=null){
  const note=singleHold();if(!note)return;const index=state.selectedNodeIndex;
  const left=note.path[Math.min(index,note.path.length-2)],right=note.path[Math.min(index+1,note.path.length-1)];
  const relative=time===null?(left.time+right.time)/2:time;
  if(relative<=0||relative>=note.duration||note.path.some(p=>Math.abs(p.time-relative)<1e-6))return;
  if(commit(c=>{const n=c.notes.find(n=>n.id===note.id);n.path.push({time:relative,x:x===null?pathX(n,relative):x,curve:'smooth'});n.path.sort((a,b)=>a.time-b.time);})){state.selectedNodeIndex=singleHold().path.findIndex(p=>Math.abs(p.time-relative)<1e-6);syncSelection();}
}
function smoothPath(){const note=singleHold();if(note)commit(c=>{for(const node of c.notes.find(n=>n.id===note.id).path)node.curve='smooth';});}
function deletePathNode(){const note=singleHold(),index=state.selectedNodeIndex;if(!note||index===0||index===note.path.length-1)return;commit(c=>c.notes.find(n=>n.id===note.id).path.splice(index,1));}
function removeEvent(){if(state.selectedEvents.size)commit(c=>c.events=c.events.filter(e=>!state.selectedEvents.has(e.id)));}
function syncAudioUI(){
  const loaded=!!audio.file && audio.file.name===chart.audio;
  $('audio-name').textContent=chart.audio || '载入音频';
  $('audio-name').title=chart.audio || '载入音频';
  $('audio-detail').textContent=loaded?`${formatTime(audio.duration)} · 已载入`:chart.audio?'请重新载入同名音频':'MP3 / OGG / WAV';
  $('audio-download').disabled=!loaded;
  $('waveform-empty').hidden=!!state.audioPeaks;
}
function syncTime(){
  if(!timeEditing&&document.activeElement!==$('current-time')) $('current-time').value=formatTime(state.time);
  const beats=Math.max(0,beatAtTime(chart,state.time));
  $('status-position').textContent=`第 ${Math.floor(beats/(chart.beatsPerBar||4))+1} 小节 · 第 ${Math.floor(beats%(chart.beatsPerBar||4))+1} 拍`;
  $('back-to-start').hidden=state.time<chart.duration-0.001;
}
function setTool(next){tool=next;setView('edit');$$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});$('placement-type-wrap').hidden=tool!=='tap';$('status-tool').textContent=tool==='tap'?$('placement-type').selectedOptions[0].textContent:toolNames[tool];$('canvas-hint').textContent=toolHints[tool];$('editor').style.cursor=tool==='select'?'default':'crosshair';state.hover=null;emit('tool',{tool});}
function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelector('.workspace').classList.toggle('preview',view==='preview');$('canvas-mode').textContent=view==='edit'?'2D / EDIT':'2D / PREVIEW';$('canvas-hint').textContent=view==='edit'?toolHints[tool]:'Space 播放 / 暂停 · 滚轮定位';state.hover=null;emit('view',{view});}
function snapStep(){return secondsForBeats(chart,state.time,state.span/state.division);}
function snap(seconds, alt=false){const first=Math.max(0,chart.offset);return clamp(state.snapEnabled&&!alt?snapTime(seconds,chart,state.division,state.span):seconds,first,chart.duration);}
function snapX(x, alt=false){return snapHorizontal(x,state.xSnap,alt);}
function updateSnap(){
  const value=$('snap').value;
  state.snapEnabled=value!=='off';
  $('custom-snap').hidden=value!=='custom';
  if(value==='custom') {state.division=clamp(Math.round(Number($('snap-division').value)||1),1,64);state.span=Number($('snap-span').value);$('snap-division').value=state.division;}
  else if(value!=='off'){state.division=Number(value);state.span=1;}
  $('status-snap').textContent=state.snapEnabled?`${state.span} 拍 / ${state.division} 等分`:'自由放置';
}
function seek(seconds){
  state.time=clamp(seconds,0,chart.duration);audio.seek(state.time);lastPlayTime=state.time;lastBeat=Math.floor(beatAtTime(chart,state.time));state.hits=[];syncTime();
}
function step(direction, wholeBeat=false){pause();seek(stepTime(state.time,direction,chart,wholeBeat?1:state.division,wholeBeat?1:state.span));}
function setZoom(value){
  state.zoom=clamp(Number(value)||100,55,220);renderer.zoom=state.zoom;
  $('zoom').value=state.zoom;$('zoom-label').textContent=state.zoom+'%';state.hover=null;
}
function pause(){if(state.playing) state.time=clamp(audio.pause(),0,chart.duration);state.playing=false;$('play').innerHTML='<svg><use href="#i-play"/></svg>';$('play').setAttribute('aria-label','播放');syncTime();}
async function togglePlayback(){
  if(state.playing){pause();return;}
  finishDrag();
  if(state.loop.enabled&&(state.time<state.loop.start||state.time>=state.loop.end))seek(state.loop.start);
  else if(state.time>=chart.duration-.001) seek(0);
  try {await audio.resumeContext();audio.play(state.time,Number($('playback-rate').value));state.playing=true;lastPlayTime=state.time-.0001;lastBeat=Math.floor(beatAtTime(chart,state.time))-1;$('play').innerHTML='<svg><use href="#i-pause"/></svg>';$('play').setAttribute('aria-label','暂停');} catch(error){toast('无法开始播放：'+error.message);}
}
function undo(){finishDrag();pause();if(!history.canUndo)return;replaceChart(history.undo(chart));restoreCachedAudio();state.selected.clear();syncSelection();}
function redo(){finishDrag();pause();if(!history.canRedo)return;replaceChart(history.redo(chart));restoreCachedAudio();state.selected.clear();syncSelection();}
function removeSelected(){if(!state.selected.size&&!state.selectedEvents.size)return;commit(c=>{deleteSelection(c,state.selected);c.events=c.events.filter(e=>!state.selectedEvents.has(e.id));});state.selected.clear();state.selectedEvents.clear();state.selectedEventId=null;syncSelection();syncEvents();}
function syncClipboard(){$('paste-selection').disabled=!clipboard.notes.length&&!eventClipboard.length;$('mirror-paste').disabled=!clipboard.notes.length;}
function copyEvents(){eventClipboard=clone(chart.events.filter(e=>state.selectedEvents.has(e.id)));clipboard={notes:[],events:[]};syncClipboard();syncInspectorLists();if(eventClipboard.length)toast(`已复制 ${eventClipboard.length} 个事件`);}
function pasteEventClipboard(){if(!eventClipboard.length)return;if(eventClipboard.some(e=>!targetEditable(chart,state.eventTarget!=='*'&&state.eventTarget!=='selected'?state.eventTarget:e.target))){toast('请先解锁目标组');return;}let ids=[];if(commit(c=>ids=pasteEvents(c,eventClipboard,snap(state.time),state.eventTarget!=='*'&&state.eventTarget!=='selected'?state.eventTarget:null))){state.eventLayer=state.chart.events.find(e=>e.id===ids[0])?.layer||0;selectEvents(ids);}}
function copy(){finishDrag();if(state.selectedEvents.size&&!state.selected.size){copyEvents();return;}clipboard=copySelection(chart,state.selected,state.selectedEvents);eventClipboard=[];syncClipboard();syncInspectorLists();if(clipboard.notes.length)toast(`已复制 ${clipboard.notes.length} 个音符${state.selectedEvents.size?` · ${state.selectedEvents.size} 个事件`:''}`);}
function cut(){if(!state.selected.size&&!state.selectedEvents.size)return;copy();removeSelected();}
function selectAll(){finishDrag();setTool('select');state.selectedEventId=null;state.selectedEvents.clear();state.selected=new Set(chart.notes.filter(n=>noteEditable(n,state)).map(n=>n.id));syncSelection();syncEvents();}
function mirror(){if(state.selected.size){state.groupFilter='all';commit(c=>mirrorSelection(c,state.selected));}}
function paste(mirrored=false){
  if(!clipboard.notes.length){if(!mirrored)pasteEventClipboard();return;}
  let ids=[];state.groupFilter='all';const priorEvents=new Set(chart.events.map(e=>e.id));
  if(clipboard.events.some(e=>clipboard.selectedEventIds?.includes(e.id)&&!clipboard.notes.some(n=>n.id===e.target)&&!clipboard.groups?.some(g=>g.id===e.target)&&!targetEditable(chart,e.target))){toast('请先解锁目标组');return;}
  if(commit(c=>ids=pasteSelection(c,clipboard,snap(state.time),{mirror:mirrored}))){state.selected=new Set(ids);state.selectedEvents=new Set(clipboard.selectedEventIds?.length?chart.events.filter(e=>!priorEvents.has(e.id)).map(e=>e.id):[]);state.selectedEventId=[...state.selectedEvents][0]||null;syncSelection();syncEvents();}
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
$$('[data-scene]').forEach(b=>b.addEventListener('click',()=>commit(c=>c.scene.preset=b.dataset.scene)));
['snap','snap-division','snap-span'].forEach(id=>$(id).addEventListener('change',updateSnap));
$('x-snap').addEventListener('change',e=>{finishDrag();state.xSnap=e.target.value;state.hover=null;syncSelection();try{localStorage.setItem('tripefy.editor.horizontal',state.xSnap);}catch{/* Optional preference. */}});
$('zoom').addEventListener('input',e=>setZoom(e.target.value));
$('reset-zoom').addEventListener('click',()=>setZoom(100));
$('step-back').addEventListener('click',()=>step(-1));
$('step-forward').addEventListener('click',()=>step(1));
$('grid-toggle').addEventListener('click',()=>{state.grid=!state.grid;$('grid-toggle').setAttribute('aria-pressed',String(state.grid));});
$('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
$('copy-selection').addEventListener('click',copy);$('paste-selection').addEventListener('click',()=>paste());
$('mirror-paste').addEventListener('click',()=>paste(true));
$('cut-selection').addEventListener('click',cut);$('select-all').addEventListener('click',selectAll);
$('mirror-selection').addEventListener('click',mirror);
$('align-selection').addEventListener('click',()=>{if(laneCount(state.xSnap))commit(c=>alignSelection(c,state.selected,state.xSnap));});
$('delete-selection').addEventListener('click',removeSelected);
$('placement-type').addEventListener('change',()=>setTool('tap'));
$('note-type').addEventListener('change',e=>{
  if(!e.target.value)return;
  commit(c=>{for(const n of c.notes)if(state.selected.has(n.id))changeNoteType(n,e.target.value,Math.min(60/c.bpm,c.duration-effectiveTime(n,c)));});
});
for(const [id,key]of [['note-time','time'],['note-x','x'],['note-duration','duration']]) $(id).addEventListener('change',e=>{
  const note=selectedNotes()[0];if(!note)return;
  const value=Number(e.target.value);
  commit(c=>{
    if(key==='duration')resizeHold(c.notes.find(n=>n.id===note.id),value);
    else moveSelection(c,chart,new Set([note.id]),key==='time'?value-effectiveTime(note,chart):0,key==='x'?value/100-note.x:0);
  });
});
for(const [id,key,scale]of [['note-opacity','opacity',100],['note-speed','speed',1]]) $(id).addEventListener('change',e=>{if(e.target.value!=='')commit(c=>c.notes.forEach(n=>{if(state.selected.has(n.id))n[key]=Number(e.target.value)/scale;}));});
$('add-path-node').addEventListener('click',()=>addPathNode());
$('smooth-path').addEventListener('click',smoothPath);
$('delete-path-node').addEventListener('click',deletePathNode);
for(const key of ['time','x','curve']) $('path-'+key).addEventListener('change',e=>{
  const note=singleHold(),index=state.selectedNodeIndex;if(!note)return;
  commit(c=>{const n=c.notes.find(n=>n.id===note.id);n.path[index][key]=key==='curve'?e.target.value:Number(e.target.value)/(key==='x'?100:1);if(index===0)n.x=n.path[0].x;});
});
$('add-event').addEventListener('click',()=>{
  pause();const target=!['*','selected'].includes(state.eventTarget)?state.eventTarget:state.selected.size===1?[...state.selected][0]:chart.events.find(e=>e.id===state.selectedEventId)?.target||state.activeGroupId||'all';const time=snap(state.time)-chart.offset;const layer=Math.max(0,state.eventLayer);if(!targetEditable(chart,target)){toast('请先解锁分组');return;}
  const occupied=property=>chart.events.find(e=>e.target===target&&(e.layer||0)===layer&&e.property===property&&(Math.abs(e.time-time)<1e-7||(e.time<time&&time<e.time+e.duration)));
  const property=['speed','x','opacity'].find(p=>!occupied(p));
  if(!property){selectEvent(occupied('speed').id);toast('此时刻已有三个属性事件');return;}
  const existing=chart.events.filter(e=>e.target===target&&(e.layer||0)===layer&&e.property===property).sort((a,b)=>a.time-b.time);
  const next=existing.find(e=>e.time>time);
  const duration=Math.max(0,Math.min(secondsForBeats(chart,time+chart.offset,1),chart.duration-chart.offset-time,next?next.time-time:Infinity));
  const value=eventValue(chart,property,time+chart.offset,target,layer),id=createId();
  if(commit(c=>c.events.push({id,target,property,time,duration,from:value,to:value,valueMode:'end',value,curve:'linear',...(layer?{layer}:{})})))selectEvent(id);
});
$('delete-event').addEventListener('click',removeEvent);
for(const key of ['property','target','time','duration','to','curve','layer','value-mode']) $('event-'+key).addEventListener('change',e=>{
  const id=state.selectedEventId;if(!id)return;
  commit(c=>{
    const event=c.events.find(e=>e.id===id);
    if(key==='value-mode'){setEventValueMode(event,e.target.value);return;}
    if(!event.valueMode)setEventValueMode(event,'end');
    if(key==='to')event.value=Number(e.target.value)/(event.property==='speed'?1:100);
    else event[key]=['property','target','curve'].includes(key)?e.target.value:Number(e.target.value)-(key==='time'?c.offset:0);
    if(key==='property'){event.valueMode='end';event.value=eventValue({...c,events:c.events.filter(other=>other.id!==id)},event.property,event.time+c.offset,event.target,event.layer||0);}
  });
  const changed=chart.events.find(e=>e.id===id);if(changed){state.eventLayer=changed.layer||0;if(!['*','selected',changed.target].includes(state.eventTarget))state.eventTarget=groupMap(chart).has(changed.target)?changed.target:'*';syncEvents();}
});
window.addEventListener('editor:action',e=>{
  const {type,index,id,append}=e.detail;
  if(type==='select-path-node'){state.selectedNodeIndex=index;syncSelection();}
  if(type==='delete-path-node'){state.selectedNodeIndex=index;deletePathNode();}
  if(type==='select-event')selectEvent(id,append);
});
// Commit a typed value once on blur or Enter, including browser paste/autofill input.
for(const input of $$('input').filter(el=>/^(meta-|note-|path-|event-)/.test(el.id)||['bpm','beats-per-bar','offset','duration'].includes(el.id))){
  let edited=false;
  input.addEventListener('input',()=>edited=true);
  input.addEventListener('change',()=>edited=false);
  input.addEventListener('blur',()=>{if(edited){edited=false;input.dispatchEvent(new Event('change',{bubbles:true}));}});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
}
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

function eraseAt(e){const hit=renderer.hitTest(e.clientX,e.clientY,state);if(hit){deleteSelection(chart,new Set([hit.note.id]));state.selected.delete(hit.note.id);invalidateAnimationCache(chart);}}
$('editor').addEventListener('contextmenu',e=>e.preventDefault());
$('editor').addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  $('editor').focus();pause();
  if(state.view==='preview')return;
  const point=renderer.pointToNote(e.clientX,e.clientY,state);
  const hit=renderer.hitTest(e.clientX,e.clientY,state);
  const event=renderer.hitEvent(e.clientX,e.clientY,state);
  $('editor').setPointerCapture(e.pointerId);
  const append=extendsSelection(e);
  if(event&&e.button===0){if(append||!state.selectedEvents.has(event.id))selectEvent(event.id,append);if(state.selectedEvents.has(event.id))drag={kind:'event',before:clone(chart),point,eventId:event.id};return;}
  if(!append&&(!hit||!state.selected.has(hit.note.id))){state.selectedEventId=null;state.selectedEvents.clear();}
  if(tool==='erase'||e.button===2){drag={kind:'erase',before:clone(chart)};eraseAt(e);return;}
  if(hit){
    if(append&&state.selected.has(hit.note.id)){state.selected.delete(hit.note.id);syncSelection();syncEvents();return;}
    if(!state.selected.has(hit.note.id)){if(!append)state.selected.clear();state.selected.add(hit.note.id);state.selectedNodeIndex=0;}
    const single=state.selected.size===1&&!state.selectedEvents.size;
    const kind=hit.part==='node'&&single?'node':hit.part==='tail'&&single?'resize':'move';
    if(kind==='node')state.selectedNodeIndex=hit.index;
    drag={kind,before:clone(chart),point,notes:clone(selectedNotes()),noteId:hit.note.id,index:hit.index};
    syncSelection();syncEvents();return;
  }
  if(tool==='select'||append&&!e.altKey){
    const initial=append?new Set(state.selected):new Set(),initialEvents=append?new Set(state.selectedEvents):new Set();
    if(!append)state.selected.clear();
    drag={kind:'marquee',point,initial,initialEvents};state.marquee={x1:point.canvasX,y1:point.canvasY,x2:point.canvasX,y2:point.canvasY};syncSelection();syncEvents();return;
  }
  if(!point.inside)return;
  const active=groupMap(chart).get(state.groupFilter);if(active?.locked||active?.hidden){toast('当前分组已锁定或隐藏');return;}
  const time=snap(point.time,e.altKey), x=snapX(point.x,e.altKey);
  if(time<Math.max(0,chart.offset)||time>chart.duration)return;
  const n={id:createId(),type:tool==='hold'?'hold':$('placement-type').value,time:time-chart.offset,x,duration:0,opacity:1,speed:1,path:[],...(active?{group:active.id}:{})};
  if(tool==='tap'){
    if(chart.notes.some(other=>Math.abs(other.time-n.time)<1e-7&&Math.abs(other.x-n.x)<.015)){toast('此位置已有音符');return;}
    if(commit(c=>c.notes.push(n))){state.selected=new Set([n.id]);syncSelection();}
  }else{drag={kind:'hold',before:clone(chart),start:time,x};state.draft=n;}
});
$('editor').addEventListener('dblclick',e=>{
  if(state.view!=='edit')return;
  finishDrag();const hit=renderer.hitTest(e.clientX,e.clientY,state);
  if(hit?.note.duration>0&&hit.part==='body'){
    state.selected=new Set([hit.note.id]);const p=renderer.pointToNote(e.clientX,e.clientY,state);
    addPathNode(snap(p.time,e.altKey)-effectiveTime(hit.note,chart),snapX(p.x,e.altKey));
  }
});
$('editor').addEventListener('pointermove',e=>{
  const point=renderer.pointToNote(e.clientX,e.clientY,state);
  state.hover=state.view==='edit'&&point.inside&&!drag&&tool!=='select'&&tool!=='erase'?{x:snapX(point.x,e.altKey),time:snap(point.time,e.altKey),type:tool==='hold'?'hold':$('placement-type').value}:null;
  $('cursor-readout').textContent=point.inside?`${formatTime(snap(point.time,e.altKey))}   ·   X ${(snapX(point.x,e.altKey)*100).toFixed(1)}%`:'';
  if(!drag)return;
  if(drag.kind==='erase'){eraseAt(e);return;}
  if(drag.kind==='hold'){
    const end=snap(point.time,e.altKey);state.draft.time=Math.min(drag.start,end)-chart.offset;state.draft.duration=Math.abs(end-drag.start);return;
  }
  if(drag.kind==='marquee'){
    state.marquee.x2=point.canvasX;state.marquee.y2=point.canvasY;
    state.selected=new Set(drag.initial);
    chart.notes.forEach(n=>{if(renderer.intersects(n,state.marquee,state))state.selected.add(n.id);});
    state.selectedEvents=new Set(drag.initialEvents);chart.events.forEach(event=>{if(renderer.intersectsEvent(event,state.marquee,state))state.selectedEvents.add(event.id);});state.selectedEventId=[...state.selectedEvents][0]||null;syncSelection();syncEvents();return;
  }
  if(drag.kind==='event'){
    const originals=drag.before.events.filter(e=>state.selectedEvents.has(e.id)),anchor=originals.find(e=>e.id===drag.eventId);
    if(!anchor)return;
    let delta=snap(anchor.time+chart.offset+point.time-drag.point.time,e.altKey)-chart.offset-anchor.time;
    delta=clamp(delta,Math.max(...originals.map(e=>Math.max(0,-chart.offset)-e.time)),Math.min(...originals.map(e=>chart.duration-chart.offset-e.time-e.duration)));
    moveSelection(chart,drag.before,state.selected,delta,0,0,state.selectedEvents);
    resolveEventValues(chart.events);invalidateAnimationCache(chart);syncEvents();return;
  }
  if(drag.kind==='node'){
    const n=chart.notes.find(n=>n.id===drag.noteId),original=drag.notes.find(n=>n.id===drag.noteId),index=drag.index;
    const node=n.path[index],source=original.path[index];
    node.x=snapX(source.x+point.x-drag.point.x,e.altKey);
    if(index===0)n.x=node.x;
    else if(index===n.path.length-1){n.duration=clamp(snap(effectiveTime(n,chart)+source.time+point.time-drag.point.time,e.altKey)-effectiveTime(n,chart),n.path[index-1].time+.001,chart.duration-effectiveTime(n,chart));node.time=n.duration;}
    else node.time=clamp(snap(effectiveTime(n,chart)+source.time+point.time-drag.point.time,e.altKey)-effectiveTime(n,chart),n.path[index-1].time+.001,n.path[index+1].time-.001);
    syncSelection();return;
  }
  if(drag.kind==='resize'){
    const n=chart.notes.find(n=>n.id===drag.noteId),original=drag.notes.find(n=>n.id===drag.noteId);
    const tail=snap(effectiveTime(original,chart)+original.duration+point.time-drag.point.time,e.altKey);
    n.path=clone(original.path);n.duration=original.duration;
    resizeHold(n,clamp(tail-effectiveTime(n,chart),.001,chart.duration-effectiveTime(n,chart)));syncSelection();return;
  }
  if(drag.kind==='move'){
    const anchor=drag.notes.find(n=>n.id===drag.noteId);
    const dt=snap(effectiveTime(anchor,chart)+point.time-drag.point.time,e.altKey)-effectiveTime(anchor,chart);
    const dx=snapX(anchor.x+point.x-drag.point.x,e.altKey)-anchor.x;
    const keys=laneCount(state.xSnap);
    moveSelection(chart,drag.before,state.selected,dt,dx,keys&&!e.altKey?1/keys:0,state.selectedEvents);resolveEventValues(chart.events);invalidateAnimationCache(chart);syncSelection();syncEvents();
  }
});
$('editor').addEventListener('pointerup',e=>{finishDrag();if($('editor').hasPointerCapture(e.pointerId))$('editor').releasePointerCapture(e.pointerId);});
$('editor').addEventListener('pointercancel',()=>{if(drag?.before){chart=drag.before;state.chart=chart;}drag=null;state.draft=null;state.marquee=null;syncUI();});
$('editor').addEventListener('pointerleave',()=>{state.hover=null;$('cursor-readout').textContent='';});
$('editor').addEventListener('wheel',e=>{
  e.preventDefault();if(drag)return;
  const nextZoom=wheelZoom(e,state.zoom,renderer.h);
  if(e.ctrlKey||e.metaKey){
    if(nextZoom===state.zoom)return;
    if(state.view==='edit'&&!state.playing){
      const rect=$('editor').getBoundingClientRect();
      seek(anchoredZoomTime(state.time,state.zoom,nextZoom,renderer.geometry().hitY,e.clientY-rect.top));
    }
    setZoom(nextZoom);
  }else{
    const delta=wheelTimeDelta(e,state.zoom,renderer.h);
    if(delta){pause();seek(state.time+delta);state.hover=null;}
  }
},{passive:false});
function seekTimeline(e){const rect=$('timeline').getBoundingClientRect();pause();seek(clamp((e.clientX-rect.left-16)/(rect.width-32),0,1)*chart.duration);}
$('timeline').addEventListener('pointerdown',e=>{timelineDragging=true;$('timeline').setPointerCapture(e.pointerId);seekTimeline(e);});
$('timeline').addEventListener('pointermove',e=>{if(timelineDragging)seekTimeline(e);});
$('timeline').addEventListener('pointerup',()=>timelineDragging=false);$('timeline').addEventListener('pointercancel',()=>timelineDragging=false);
$('timeline').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pause();step(e.key==='ArrowRight'?1:-1,true);}});
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]'))return;
  const command=e.ctrlKey||e.metaKey;
  if(command&&['s','o'].includes(e.key.toLowerCase())){e.preventDefault();e.key.toLowerCase()==='s'?exportChart():$('chart-file').click();return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(command){
    const key=e.key.toLowerCase();
    if(['z','y','a','c','v','x','m','g'].includes(key))e.preventDefault();
    if(key==='z')e.shiftKey?redo():undo();else if(key==='y')redo();else if(key==='a'){
      if(document.querySelector('[data-panel=events][data-state=active]'))selectEvents(chart.events.filter(event=>eventVisible(event,state)&&targetEditable(chart,event.target)).map(e=>e.id));else selectAll();
    }else if(key==='c')copy();else if(key==='v')paste(e.shiftKey);else if(key==='x')cut();else if(key==='m')mirror();else if(key==='g')window.dispatchEvent(new CustomEvent('editor:authoring',{detail:{type:e.shiftKey?'assign-group':'create-group',id:''}}));return;
  }
  if(e.code==='Space'){e.preventDefault();if(!e.repeat)togglePlayback();}
  else if(['1','2','3','4'].includes(e.key))setTool(['select','tap','hold','erase'][Number(e.key)-1]);
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}
  else if(e.key==='Escape'){if(drag?.before){chart=drag.before;state.chart=chart;}drag=null;state.draft=null;state.marquee=null;state.selected.clear();state.selectedEventId=null;state.selectedEvents.clear();syncUI();}
  else if(e.key==='Home'){e.preventDefault();seek(0);}
  else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();step(e.key==='ArrowUp'?1:-1,e.shiftKey);}
});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',async e=>{e.preventDefault();const files=[...e.dataTransfer.files];const json=files.find(f=>/\.json$/i.test(f.name));if(json&&!await importChart(json))return;const sound=files.find(f=>/\.(mp3|ogg|wav)$/i.test(f.name));if(sound)await loadAudio(sound);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('beforeunload',()=>{try{localStorage.setItem(STORAGE,serializeChart(chart));}catch{}});
new ResizeObserver(()=>renderer.resize()).observe($('canvas-wrap'));

function frame(now){
  state.effectTime=now/1000;
  state.playbackRate=Number($('playback-rate').value);
  if(state.playing){
    let current=audio.time;
    if(state.loop.enabled&&current>=state.loop.end){current=state.loop.start+(current-state.loop.end)%(state.loop.end-state.loop.start);seek(current);}
    state.time=Math.min(chart.duration,current);
    if(!audio.playing&&current<chart.duration-.0001)audio.play(current,Number($('playback-rate').value));
    if(current>=chart.duration-.0001){pause();audio.seek(chart.duration);}
    const beat=Math.floor(beatAtTime(chart,state.time));
    if($('metronome').checked&&beat>lastBeat&&beat>=0)audio.tick(beat%(chart.beatsPerBar||4)===0);
    lastBeat=beat;
    const impacts=collectImpacts(chart,lastPlayTime,state.time,state.effectTime,state.playbackRate);
    state.hits=state.hits.concat(impacts).slice(-MAX_ACTIVE_IMPACTS);
    if($('hitsound').checked)for(const hit of impacts)if(hit.kind==='head'||hit.kind==='checkpoint')audio.hit();
    lastPlayTime=state.time;
  }
  state.hits=state.hits.filter(h=>state.effectTime-h.startedAt<(h.kind==='tail'?.18:IMPACT_LIFETIME));
  renderer.draw(state);
  if(now-frameTime>40){renderer.drawTimeline(state);syncTime();frameTime=now;}
  requestAnimationFrame(frame);
}
attachAuthoring({state,commit,sync:syncUI,toast,emit,snap,pause,download,selectEvents,copyEvents,pasteEventClipboard});
syncUI();setTool('select');updateSnap();audio.setVolume(.65);renderer.resize();requestAnimationFrame(frame);restoreAudio();
