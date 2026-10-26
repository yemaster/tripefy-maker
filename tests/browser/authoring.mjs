// Optional integration check: npm run test:browser after installing Playwright.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM may point to an existing test runtime.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBlankChart, validateChart} from '../../src/editor/model.js';
import {stepTime} from '../../src/editor/navigation.js';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, '.preview/authoring');
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
const fixture = validateChart({...createBlankChart(), bpm: 120, offset: .375, duration: 40,
  metadata: {title: 'Editor study', artist: 'Tripefy', charter: 'Test', difficulty: 'NORMAL', level: 3},
  notes: [
    {id: 'hold', type: 'hold', time: 5, x: .2, duration: 3, path: [
      {time: 0, x: .2, curve: 'smooth'}, {time: .85, x: .75, curve: 'smooth'},
      {time: 1.9, x: .3, curve: 'smooth'}, {time: 3, x: .65, curve: 'smooth'}]},
    {id: 'tap', type: 'tap', time: 12, x: .2, duration: 0}, {id: 'heart', type: 'heartap', time: 12, x: .8, duration: 0},
    {id: 'drag', type: 'drag', time: 13, x: .5, duration: 0},
  ], events: [
    {id: 'global', target: 'all', property: 'speed', time: 1, duration: 2, from: 1, to: 1.5, curve: 'easeInOut'},
    {id: 'local', target: 'hold', property: 'speed', time: 6, duration: 1, from: .7, to: 1.6, curve: 'easeOut'},
    {id: 'tap-event', target: 'tap', property: 'opacity', time: 12, duration: .25, from: 1, to: .8, curve: 'linear'},
  ]});

const seek = async time => { await page.locator('#current-time').fill(String(time)); await page.locator('#current-time').press('Enter'); };
const time = async () => {
  const [minutes, seconds] = (await page.locator('#current-time').inputValue()).split(':').map(Number);
  return minutes * 60 + seconds;
};
const near = (a, b, tolerance = .0011) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const zoom = async value => {
  await page.locator('#zoom').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', {bubbles: true})); }, value);
};
const wheel = async (deltaY, options = {}) => {
  await page.locator('#editor').evaluate((element, args) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true,
      clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, ...args}));
  }, {deltaY, ...options});
};
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
const activePanel = () => page.locator('[role=tab][data-state=active]').getAttribute('data-panel');

const panel = async name => page.locator(`[data-panel=${name}]`).click();
const edit = async (label,value) => {const input=page.getByRole('spinbutton',{name:label,exact:true});await input.fill(String(value));await input.press('Tab');};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#chart-file').setInputFiles({name:'study.chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Editor study');
  await seek(12.375);await clickNote(.2);await page.keyboard.down('Shift');await clickNote(.8);await page.keyboard.up('Shift');
  assert.equal(await page.locator('#selection-count').textContent(),'2');
  await panel('groups');await page.getByRole('button',{name:'选中音符成组',exact:true}).click();
  await page.getByRole('textbox',{name:'分组名称',exact:true}).fill('Melody');await page.getByRole('textbox',{name:'分组名称',exact:true}).press('Tab');
  await edit('分组偏移 (%)',5);await edit('分组透明度 (%)',60);await edit('分组速度 (×)',1.5);
  await edit('分组速度 (×)',99);assert.equal(await page.getByRole('spinbutton',{name:'分组速度 (×)',exact:true}).inputValue(),'1.5');
  let output=await exportChart('group-base');const group=output.groups[0].id;
  assert.equal(output.version,2);assert.equal(output.notes.filter(n=>n.group===group).length,2);near(output.groups[0].opacity,.6);
  await page.getByRole('combobox',{name:'显示分组'}).selectOption(group);
  await panel('groups');await page.getByRole('button',{name:'锁定分组 Melody',exact:true}).click();
  await page.locator('#editor').focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('#selection-count').textContent(),'0');
  await panel('groups');await page.getByRole('button',{name:'解锁分组 Melody',exact:true}).click();
  await page.getByRole('button',{name:'隐藏分组 Melody',exact:true}).click();await page.locator('#editor').focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('#selection-count').textContent(),'0');
  await panel('groups');await page.getByRole('button',{name:'显示分组 Melody',exact:true}).click();
  await page.getByRole('button',{name:'选择组内音符',exact:true}).click();assert.equal(await page.locator('#selection-count').textContent(),'2');
  await seek(8.375);await panel('presets');await page.getByRole('combobox',{name:'动画预设',exact:true}).selectOption('builtin:from-left');await page.getByRole('combobox',{name:'预设作用目标'}).selectOption('group');
  await page.getByRole('button',{name:'应用动画预设',exact:true}).click();assert.equal(await activePanel(),'events');
  output=await exportChart('group-preset');assert.equal(output.events.filter(e=>e.target===group).length,1);
  await panel('presets');await page.getByRole('button',{name:'应用动画预设',exact:true}).click();
  assert.match(await page.locator('#toast').textContent(),/重叠/);assert.equal((await exportChart('conflict')).events.length,output.events.length);
  await page.locator('#panel-presets summary').click();await page.getByRole('combobox',{name:'预设起始层'}).selectOption('1');await page.getByRole('button',{name:'应用动画预设',exact:true}).click();
  await page.getByRole('combobox',{name:'事件目标筛选'}).selectOption(group);await page.getByRole('combobox',{name:'事件层筛选'}).selectOption('-1');
  await page.locator('#event-list button').first().click();await page.locator('#event-list button').nth(1).click({modifiers:['Shift']});assert.equal(await page.locator('#event-list [data-state=selected]').count(),2);
  await page.getByRole('combobox',{name:'批量事件缓动'}).selectOption('easeInOut');
  await panel('presets');await page.getByRole('textbox',{name:'预设名称',exact:true}).fill('双层进入');await page.getByRole('button',{name:'将所选事件存为预设',exact:true}).click();
  output=await exportChart('custom-preset');assert.equal(output.animationPresets.length,1);assert.equal(output.animationPresets[0].events.length,2);
  const libraryDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出预设库',exact:true}).click();const library=await libraryDownload;const libraryPath=path.join(artifacts,'library.json');await library.saveAs(libraryPath);
  await page.locator('#preset-file').setInputFiles(libraryPath);output=await exportChart('library-import');assert.equal(output.animationPresets.length,2);assert.notEqual(output.animationPresets[0].id,output.animationPresets[1].id);
  await panel('events');await page.getByRole('button',{name:'复制',exact:true}).filter({hasNot:page.locator('svg')}).click();
  await seek(16.375);await page.locator('#paste-selection').click();output=await exportChart('event-paste');assert.equal(output.events.filter(e=>e.target===group).length,4);
  await panel('groups');await page.getByRole('button',{name:'锁定分组 Melody',exact:true}).click();await page.locator('#paste-selection').click();assert.match(await page.locator('#toast').textContent(),/解锁/);await page.getByRole('button',{name:'解锁分组 Melody',exact:true}).click();
  await page.locator('#undo').click();await page.locator('#undo').click();
  await page.locator('#undo').click();output=await exportChart('event-undo');assert.equal(output.events.filter(e=>e.target===group).length,2);
  await page.locator('#redo').click();output=await exportChart('event-redo');assert.equal(output.events.filter(e=>e.target===group).length,4);
  await panel('groups');await page.getByRole('button',{name:'复制分组',exact:true}).click();output=await exportChart('duplicate-group');assert.equal(output.groups.length,2);assert.equal(output.notes.length,6);assert.equal(output.events.filter(e=>e.target===output.groups[1].id).length,4);
  await panel('groups');await page.getByRole('button',{name:'解散分组',exact:true}).click();output=await exportChart('dissolve');assert.equal(output.notes.length,6);assert.equal(output.groups.length,1);
  await page.locator('#undo').click();assert.equal((await exportChart('dissolve-undo')).groups.length,2);
  console.log('PASS groups, lock/hide/filter, duplicate/dissolve, layered presets, custom library, multi-event clipboard, undo/redo');

  await seek(10.375);await panel('chart');await page.locator('#panel-chart summary').click();await page.getByRole('button',{name:'在当前时间添加',exact:true}).click();await edit('BPM 点 1 BPM',180);
  output=await exportChart('bpm');assert.deepEqual(output.bpmChanges,[{time:10,bpm:180}]);
  for(const division of [3,5,7]){await page.locator('#snap').selectOption(String(division));await seek(10.4);await page.locator('#step-forward').click();near(await time(),stepTime(10.4,1,output,division));}
  await page.getByRole('button',{name:'片段循环',exact:true}).click();await edit('终点 B (s)',11);await edit('起点 A (s)',10);await page.getByRole('checkbox',{name:'启用片段循环'}).check();await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.locator('#playback-rate').selectOption('2');await seek(10.9);await page.locator('#play').click();await page.waitForTimeout(400);let loopTime=await time();assert.ok(loopTime>=10&&loopTime<11,`loop failed: ${loopTime}`);await page.locator('#play').click();
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'播放');
  console.log('PASS BPM changes with thirds/fifths/sevenths and loop playback at 2x');
  await page.locator('[data-view=preview]').click();await page.screenshot({path:path.join(artifacts,'preview.png')});await page.locator('[data-view=edit]').click();
  for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
    await page.setViewportSize(viewport);
    for(const name of ['chart','groups','events','presets']){
      await panel(name);await page.waitForTimeout(200);await page.mouse.move(10,10);await page.screenshot({path:path.join(artifacts,`${name}-${viewport.width}.png`)});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const canvas=await page.locator('#editor').boundingBox();assert.ok(canvas.height>360,`canvas too short: ${canvas.height}`);
      const tabs=await page.locator('aside [role=tab]').all();for(const tab of tabs){const b=await tab.boundingBox();assert.ok(b.x+b.width<260);}
    }
  }
  await page.waitForTimeout(350);await page.reload();await page.waitForFunction(()=>document.querySelector('#document-title').textContent==='Editor study');
  const restored=await exportChart('restored');assert.equal(restored.groups.length,2);assert.equal(restored.animationPresets.length,2);assert.equal(restored.bpmChanges[0].bpm,180);
  await seek(12.375);await clickNote(.2);await panel('events');await page.getByRole('combobox',{name:'事件目标筛选'}).selectOption('selected');await page.getByRole('combobox',{name:'事件层筛选'}).selectOption('0');
  await page.locator('#event-list button').first().click();assert.ok(await page.locator('#event-list button').count()>0,'selected note event filter lost its target');
  console.log('PASS selected-note event filtering retains its target after selecting an event');
  assert.deepEqual(errors,[]);await writeFile(path.join(artifacts,'result.json'),JSON.stringify({passed:true,errors},null,2));
  console.log('PASS narrow/wide layouts, preview, autosave reload and v2 export, no page errors');
}catch(error){await page.screenshot({path:path.join(artifacts,'failure.png')});await writeFile(path.join(artifacts,'failure.html'),await page.content());throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
