// Optional integration check: npm run test:browser after installing Playwright.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM may point to an existing test runtime.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBlankChart, validateChart} from '../../src/editor/model.js';
import {eventValue,noteX,noteOpacity,scrollDistance} from '../../src/editor/animation.js';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, '.preview/event-transitions');
await mkdir(artifacts, {recursive: true});
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, 'dist', pathname === '/' ? 'index.html' : pathname);
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': {'.js':'application/javascript', '.css':'text/css', '.html':'text/html'}[path.extname(file)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  downloadsPath: artifacts});
const context = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const seek = async time => { await page.locator('#current-time').fill(String(time)); await page.locator('#current-time').press('Enter'); };
const near = (a, b, tolerance = .0011) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const clickNote = async x => {
  const r = await page.locator('#editor').boundingBox();
  await page.mouse.click(r.x + 82 + (r.width - 138) * x, r.y + r.height * .8);
};
const change = async (id, value) => {await page.locator('#' + id).fill(String(value)); await page.locator('#' + id).press('Tab');};
const exportChart = async name => {
  const pending = page.waitForEvent('download');
  await page.locator('#export-chart').click();
  const download = await pending;
  const output = path.join(artifacts, name + '.chart.json');
  await download.saveAs(output);
  return JSON.parse(await readFile(output, 'utf8'));
};

const panel = name => page.locator(`[data-panel=${name}]`).click();
const input = async data => {
  await page.locator('#chart-file').setInputFiles({name:'transitions.chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForTimeout(150);
};
const transitions=validateChart({...createBlankChart(),bpm:120,offset:.25,duration:30,
  notes:[{id:'a',time:8,x:.2,duration:0},{id:'b',time:8,x:.8,duration:0},{id:'c',time:9,x:.5,duration:0}],
  events:[
    {id:'first',target:'all',property:'x',time:2,duration:1,valueMode:'end',value:.2,curve:'easeInOut'},
    {id:'second',target:'all',property:'x',time:4,duration:1,valueMode:'delta',value:.1,curve:'easeInOut'},
    {id:'alpha',target:'all',property:'opacity',time:6,duration:1,valueMode:'end',value:.6,curve:'easeOut'},
    {id:'speed',target:'all',property:'speed',time:7,duration:.5,valueMode:'end',value:1.6,curve:'easeInOut'},
  ]});
const pickEvent=async time=>{await panel('events');await page.locator('#event-list button').filter({hasText:`${time} s`}).click();};
const withKey=async(key,run)=>{await page.keyboard.down(key);try{await run();}finally{await page.keyboard.up(key);}};
const expectEvents=async count=>{await page.waitForFunction(count=>document.querySelectorAll('#event-list [data-state=selected]').length===count,count);assert.equal(await page.locator('#event-list [data-state=selected]').count(),count);};
const noteCount=()=>page.locator('#selection-count').textContent();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await input(transitions);await seek(8.25);
  for(const key of ['Control','Meta','Alt','Shift']){
    await page.locator('#editor').focus();await page.keyboard.press('Escape');await clickNote(.2);
    await withKey(key,()=>clickNote(.8));assert.equal(await noteCount(),'2',`${key} must append`);
    await withKey(key,()=>clickNote(.2));assert.equal(await noteCount(),'1',`${key} must toggle off`);
  }
  await clickNote(.2);
  await withKey('Control',async()=>{
    const r=await page.locator('#editor').boundingBox();
    await page.mouse.move(r.x+82+(r.width-138)*.4,r.y+r.height*.8-145-25);
    await page.mouse.down();await page.mouse.move(r.x+82+(r.width-138)*.6,r.y+r.height*.8-145+25,{steps:8});await page.mouse.up();
  });assert.equal(await noteCount(),'2','Ctrl marquee appends to existing notes');
  console.log('PASS Ctrl / Command / Option / Shift toggling and additive marquee');

  await pickEvent(2.25);await page.locator('#event-list button').filter({hasText:'4.25 s'}).click({modifiers:['Alt']});
  await expectEvents(2);
  await page.locator('#event-list button').filter({hasText:'2.25 s'}).click({modifiers:['Control']});
  await expectEvents(1);
  await page.locator('#editor').focus();await page.keyboard.press('Control+a');await expectEvents(4);
  await page.keyboard.press('Escape');await seek(8.25);await clickNote(.2);await panel('events');
  await page.locator('#event-list button').filter({hasText:'7.25 s'}).click({modifiers:['Control']});
  assert.equal(await noteCount(),'1');assert.match(await page.locator('#status-selection').textContent(),/1 个音符 · 1 个事件/);
  await page.locator('#copy-selection').click();await seek(12.25);await page.locator('#paste-selection').click();
  let output=await exportChart('mixed-paste');assert.equal(output.notes.length,4);assert.equal(output.events.length,5);
  near(output.notes.at(-1).time,13);near(output.events.at(-1).time,12);
  await page.locator('#undo').click();output=await exportChart('mixed-undo');assert.equal(output.notes.length,3);assert.equal(output.events.length,4);
  await page.locator('#redo').click();output=await exportChart('mixed-redo');assert.equal(output.notes.length,4);assert.equal(output.events.length,5);

  // Real canvas markers and mixed drag, including one event before the note.
  await input(transitions);await seek(6.25);const r=await page.locator('#editor').boundingBox();
  await page.mouse.click(r.x+65,r.y+r.height*.8);
  await withKey('Alt',()=>page.mouse.click(r.x+65,r.y+r.height*.8-145));
  await expectEvents(2);
  await page.keyboard.press('Escape');await seek(8.25);await clickNote(.2);await panel('events');
  await page.locator('#event-list button').filter({hasText:'7.25 s'}).click({modifiers:['Meta']});
  await page.mouse.move(r.x+82+(r.width-138)*.2,r.y+r.height*.8);await page.mouse.down();
  await page.mouse.move(r.x+82+(r.width-138)*.2,r.y+r.height*.8-145,{steps:12});await page.mouse.up();
  output=await exportChart('mixed-move');near(output.notes.find(n=>n.id==='a').time,9);near(output.events.find(e=>e.id==='speed').time,8);
  await page.locator('#editor').focus();await page.keyboard.press('Delete');output=await exportChart('mixed-delete');assert.equal(output.notes.length,2);assert.equal(output.events.length,3);
  await page.locator('#undo').click();output=await exportChart('mixed-delete-undo');assert.equal(output.notes.length,3);assert.equal(output.events.length,4);
  console.log('PASS event list/canvas multi-select, contextual select-all, mixed clipboard, drag, delete and history');

  await input(transitions);await pickEvent(4.25);
  assert.equal(await page.locator('#event-from').count(),0);assert.equal(await page.locator('#event-value-mode').inputValue(),'delta');
  assert.match(await page.locator('#event-start-value').textContent(),/20 → 30/);
  await change('event-to',-5);output=await exportChart('delta');near(output.events.find(e=>e.id==='second').to,.15);
  await pickEvent(2.25);await change('event-to',40);await pickEvent(4.25);
  assert.match(await page.locator('#event-start-value').textContent(),/40 → 35/);
  await page.locator('#event-value-mode').selectOption('end');assert.equal(await page.locator('#event-to').inputValue(),'35');
  await page.locator('#event-value-mode').selectOption('delta');assert.equal(await page.locator('#event-to').inputValue(),'-5');
  await page.locator('#event-target').selectOption('a');assert.match(await page.locator('#event-start-value').textContent(),/0 → -5/);
  await page.locator('#event-layer').selectOption('1');await change('event-time',5.25);await change('event-duration',.75);
  output=await exportChart('retarget');const changed=output.events.find(e=>e.id==='second');near(changed.from,0);near(changed.to,-.05);near(changed.time,5);assert.equal(changed.layer,1);
  await change('event-to',500);assert.equal(await page.locator('#event-to').inputValue(),'-5');
  console.log('PASS auto start, end/delta mode switching, earlier edits, target/layer/time edits, rejected out-of-range input');

  await input(transitions);await seek(10.25);await panel('presets');
  await page.getByRole('combobox',{name:'预设作用目标'}).selectOption('all');
  await page.getByRole('combobox',{name:'动画预设',exact:true}).selectOption('builtin:slow-down');
  await page.getByRole('button',{name:'应用动画预设',exact:true}).click();
  output=await exportChart('slow-down');let generated=output.events.at(-1);near(generated.from,1.6);near(generated.to,.8);
  await panel('presets');await page.getByRole('combobox',{name:'动画预设',exact:true}).selectOption('builtin:pulse');
  await page.locator('#panel-presets summary').click();await page.getByRole('spinbutton',{name:'预设重复次数',exact:true}).fill('2');
  await page.getByRole('button',{name:'应用动画预设',exact:true}).click();
  output=await exportChart('continuous-presets');const pulse=output.events.filter(e=>e.property==='opacity'&&e.time>=10);assert.equal(pulse.length,4);near(pulse[0].from,.6);near(pulse.at(-1).to,.6);
  for(const e of pulse)near(eventValue(output,'opacity',e.time+.25-1e-8),eventValue(output,'opacity',e.time+.25),1e-6);
  await page.locator('[data-view=preview]').click();await seek(10.25);await page.locator('#play').click();await page.waitForTimeout(250);await page.locator('#play').click();await page.locator('[data-view=edit]').click();
  const expected=[];for(const note of output.notes)for(const t of [0,2.25,3.25,4.25,5.25,6.25,7.25,7.5,8.25,10.25,10.75,11.25,11.75,12.25])expected.push({id:note.id,time:t,x:noteX(output,note,t),opacity:noteOpacity(output,note,t),distance:scrollDistance(output,note,t,note.time+output.offset)});
  await writeFile(path.join(artifacts,'native-reference.json'),JSON.stringify({chart:output,values:expected}));
  // Pick one by list index when different properties share a time.
  await page.locator('#event-list button').last().click();
  for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
    await page.setViewportSize(viewport);await page.mouse.move(10,10);
    const overflow=await page.locator('#panel-events').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
    await page.screenshot({path:path.join(artifacts,`events-${viewport.width}.png`)});
  }
  await page.waitForTimeout(300);await page.reload();await page.waitForTimeout(200);
  const restored=await exportChart('reload');assert.deepEqual(restored.events,output.events);assert.deepEqual(errors,[]);
  console.log('PASS preset continuity in preview/export, auto-save, 1440/1024 layouts and zero browser errors');
} finally {await browser.close();await server.close();}
