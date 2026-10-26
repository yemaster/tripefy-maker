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
const artifacts = path.join(root, '.preview/editor-update');
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

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#chart-file').setInputFiles({name: 'study.chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(() => document.querySelector('#document-title').textContent === 'Editor study');

  // Real mouse wheel at maximum zoom and normalized line/page/trackpad events.
  for (const scale of [55, 100, 220]) {
    await zoom(scale); await seek(10);
    const r = await page.locator('#editor').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('#current-time').value !== '00:10.000');
    near((await time() - 10) * 145 * scale / 100, 48, .18);
  }
  await seek(10); await wheel(120, {shiftKey: true}); near(await time(), 10 + 12 / 319);
  await seek(10); await wheel(0); near(await time(), 10);
  for (let i = 0; i < 10; i++) await wheel(.5);
  near(await time(), 10 + 2 / 319);
  await seek(10); await wheel(3, {deltaMode: 1}); near(await time(), 10 + 19.2 / 319);
  await seek(10); await wheel(1, {deltaMode: 2}); near(await time(), 10 + 96 / 319);
  await zoom(100); await seek(10);
  const r = await page.locator('#editor').boundingBox();
  await wheel(-120, {ctrlKey: true});
  assert.equal(await page.locator('#zoom').inputValue(), '112');
  near(await time() + r.height * .3 / (145 * 1.12), 10 + r.height * .3 / 145);
  await page.locator('#reset-zoom').click(); assert.equal(await page.locator('#zoom').inputValue(), '100');

  for (const division of [3, 5, 7]) {
    await page.locator('#snap').selectOption(String(division)); await seek(4.13);
    await page.locator('#step-forward').click(); near(await time(), stepTime(4.13, 1, fixture, division));
    await seek(4.13); await page.locator('#step-back').click(); near(await time(), stepTime(4.13, -1, fixture, division));
  }
  console.log('PASS zoom-aware mouse/trackpad scrolling, anchored zoom, tuplets and grid stepping');

  // Inspector selection must preserve mounted inputs and their event listeners.
  await page.locator('#snap').selectOption('4'); await seek(5.375); await clickNote(.2);
  await page.locator('#path-section').waitFor({state: 'visible'});
  assert.equal(await activePanel(), 'notes');
  assert.equal(await page.locator('#path-node-list tr').count(), 4);
  await change('note-opacity', 65); await change('note-speed', 1.25);
  await page.locator('#add-path-node').click();
  assert.equal(await page.locator('#path-node-list tr').count(), 5);
  await change('path-x', 42);
  await page.locator('#undo').click(); await clickNote(.2);
  assert.notEqual(await page.locator('#path-x').inputValue(), '42');
  await page.locator('#redo').click(); await clickNote(.2);
  const holdExport = await exportChart('hold');
  const hold = holdExport.notes.find(note => note.id === 'hold');
  assert.equal(hold.path.length, 5); assert.equal(hold.opacity, .65); assert.equal(hold.speed, 1.25);
  assert.ok(hold.path.some(node => node.x === .42));
  await page.locator('[data-panel=chart]').click();
  assert.equal(await page.locator('#meta-title').inputValue(), 'Editor study');
  await page.locator('[data-scene=clear]').click();
  await page.locator('[data-panel=notes]').click(); assert.equal(await page.locator('#note-speed').inputValue(), '1.25');
  await page.screenshot({path: path.join(artifacts, 'hold-1440.png')});

  await seek(12.375);
  const area = await page.locator('#editor').boundingBox();
  await page.mouse.move(area.x + 82 + (area.width - 138) * .02, area.y + area.height * .8 + 20);
  await page.mouse.down();
  await page.mouse.move(area.x + 82 + (area.width - 138) * .98, area.y + area.height * .8 - 20, {steps: 12});
  await page.mouse.up();
  assert.equal(await page.locator('#selection-count').textContent(), '2');
  await change('note-opacity', 80);
  await page.locator('#copy-selection').click(); await seek(16.375); await page.locator('#paste-selection').click();
  let exported = await exportChart('copied');
  assert.equal(exported.notes.length, 6);
  assert.deepEqual(exported.notes.filter(note => note.time === 16).map(note => note.type).sort(), ['heartap', 'tap']);
  assert.ok(exported.notes.filter(note => note.time === 16).every(note => note.opacity === .8));
  assert.equal(exported.events.length, 4);
  await page.locator('#undo').click(); assert.equal((await exportChart('undo')).notes.length, 4);
  await page.locator('#redo').click(); assert.equal((await exportChart('redo')).notes.length, 6);
  console.log('PASS Hold nodes, bulk properties, marquee, copy/paste with events, undo/redo, downloads');

  await page.locator('[data-panel=events]').click(); await page.locator('#add-event').click();
  await page.locator('#event-property').selectOption('x');
  await change('event-to', 7); await change('event-duration', .5);
  await page.locator('#event-curve').selectOption('easeInOut');
  assert.equal(await activePanel(), 'events');
  exported = await exportChart('events');
  assert.ok(exported.events.some(event => event.property === 'x' && event.to === .07 && event.target === 'all'));

  await page.locator('#chart-file').setInputFiles(path.join(artifacts, 'events.chart.json'));
  await page.locator('[data-panel=chart]').click();
  assert.equal(await page.locator('[data-scene=clear]').getAttribute('aria-pressed'), 'true');
  await page.locator('#audio-file').setInputFiles(path.join(root, 'tests/fixtures/timing-test.wav'));
  await page.waitForFunction(() => document.querySelector('#audio-name').textContent === 'timing-test.wav');
  await page.locator('[data-view=preview]').click();
  for (const rate of [.5, 2]) {
    await seek(.5); await page.locator('#playback-rate').selectOption(String(rate));
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-label') === '暂停');
    const begin = await time(); const clock = Date.now();
    await page.waitForTimeout(500); await page.locator('#play').click();
    const elapsed = (Date.now() - clock) / 1000;
    near(await time() - begin, elapsed * rate, .16);
  }
  await seek(6.5); await page.screenshot({path: path.join(artifacts, 'preview-1440.png')});
  await page.locator('#play').click(); await wheel(1);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), '播放');
  console.log('PASS event editing, scene ownership, export/import, audio, playback rates and preview');

  // Placement tools and node handles still work after switching inspector tabs.
  await page.locator('[data-view=edit]').click(); await seek(24.375);
  await page.locator('[data-tool=tap]').click();
  for (const [type, x] of [['tap', .15], ['drag', .5], ['heartap', .85]]) {
    await page.locator('#placement-type').selectOption(type); await clickNote(x);
    assert.equal(await page.locator('#note-type').inputValue(), type);
  }
  await seek(28.375); await page.locator('[data-tool=hold]').click();
  const drawArea = await page.locator('#editor').boundingBox();
  const drawX = drawArea.x + 82 + (drawArea.width - 138) * .4;
  const drawY = drawArea.y + drawArea.height * .8;
  await page.mouse.move(drawX, drawY); await page.mouse.down();
  await page.mouse.move(drawX, drawY - 145, {steps: 10}); await page.mouse.up();
  assert.equal(await page.locator('#note-type').inputValue(), 'hold');
  near(Number(await page.locator('#note-duration').inputValue()), 1);
  await page.mouse.dblclick(drawX, drawY - 72.5);
  await page.waitForFunction(() => document.querySelectorAll('#path-node-list tr').length === 3);
  await page.mouse.move(drawX, drawY - 72.5); await page.mouse.down();
  await page.mouse.move(drawX + (drawArea.width - 138) * .1, drawY - 72.5, {steps: 8}); await page.mouse.up();
  near(Number(await page.locator('#path-x').inputValue()), 50, .1);
  exported = await exportChart('placed');
  assert.deepEqual(exported.notes.filter(note => note.time === 24).map(note => note.type).sort(), ['drag', 'heartap', 'tap']);
  assert.equal(exported.notes.find(note => note.time === 28).path.length, 3);
  await page.locator('[data-tool=select]').click();
  console.log('PASS Tap/Drag/HearTap placement, Hold drawing, double-click node creation and node dragging');

  await page.locator('[data-view=edit]').click(); await seek(5.375); await clickNote(.2);
  for (const viewport of [{width: 1440, height: 900}, {width: 1280, height: 720}, {width: 1024, height: 768}]) {
    await page.setViewportSize(viewport);
    await page.locator('#snap').selectOption('custom');
    await change('snap-division', 7); await page.locator('#snap-span').selectOption('2');
    await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const canvas = await page.locator('#editor').boundingBox(); assert.ok(canvas.height > 380);
    for (const id of ['zoom', 'undo', 'redo', 'current-time', 'playback-rate', 'volume', 'step-forward']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${id} clipped at ${viewport.width}`);
    }
    await page.screenshot({path: path.join(artifacts, `layout-${viewport.width}.png`)});
  }
  // Switch away from a scrolled property panel without carrying its scroll offset.
  await page.locator('[data-panel=chart]').click();
  await page.locator('[data-scene=night]').click();
  await page.locator('[data-panel=notes]').click();
  assert.equal(await page.locator('aside [data-slot=scroll-area-viewport]').first().evaluate(el => el.scrollTop), 0);
  await page.locator('#note-speed').click();
  assert.equal(await page.locator('#note-speed').inputValue(), '1.25');

  // K presets are editor guides: selecting one must not rewrite the chart.
  await page.setViewportSize({width: 1440, height: 900});
  await page.locator('#chart-file').setInputFiles({name: 'lanes.chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture))});
  await page.locator('#snap').selectOption('4');
  await page.locator('#x-snap').selectOption('4k');
  const beforeLanes = await exportChart('lane-switch');
  assert.deepEqual(beforeLanes.notes, fixture.notes);
  await page.locator('[data-tool=tap]').click(); await page.locator('#placement-type').selectOption('tap');
  for (const [index, keys] of [4,5,6,7,8,9].entries()) {
    await page.locator('#x-snap').selectOption(`${keys}k`); await seek(20.375 + index); await clickNote(.04);
    near(Number(await page.locator('#note-x').inputValue()), 50 / keys);
  }
  await page.locator('#x-snap').selectOption('4k'); await seek(27.375);
  await page.keyboard.down('Alt'); await clickNote(.29); await page.keyboard.up('Alt');
  near(Number(await page.locator('#note-x').inputValue()), 29, .1);

  // Curved Hold nodes can be dragged between K centers, then mirrored as a unit.
  await page.locator('#x-snap').selectOption('6k'); await seek(28.375);
  await page.locator('[data-tool=hold]').click();
  let lanesArea = await page.locator('#editor').boundingBox();
  const laneX = x => lanesArea.x + 82 + (lanesArea.width - 138) * x;
  const laneY = lanesArea.y + lanesArea.height * .8;
  await page.mouse.move(laneX(.04), laneY); await page.mouse.down();
  await page.mouse.move(laneX(.04), laneY - 145, {steps: 8}); await page.mouse.up();
  await page.locator('#add-path-node').click();
  await page.waitForFunction(() => document.querySelectorAll('#path-node-list tr').length === 3);
  await page.mouse.move(laneX(1/12), laneY - 72.5); await page.mouse.down();
  await page.mouse.move(laneX(.91), laneY - 72.5, {steps: 10}); await page.mouse.up();
  near(Number(await page.locator('#path-x').inputValue()), 100 * 11 / 12);
  await page.locator('#copy-selection').click(); await seek(32.375); await page.locator('#mirror-paste').click();
  const mirroredHoldChart = await exportChart('mirrored-hold');
  const originalHold = mirroredHoldChart.notes.find(note => note.time === 28);
  const mirroredHold = mirroredHoldChart.notes.find(note => note.time === 32);
  near(mirroredHold.x, 1 - originalHold.x, 1e-9);
  originalHold.path.forEach((node, index) => {
    near(mirroredHold.path[index].x, 1 - node.x, 1e-9);
    near(mirroredHold.path[index].time, node.time, 1e-9);
  });

  const selectPair = async () => {
    await page.locator('[data-tool=select]').click(); await seek(12.375);
    const box = await page.locator('#editor').boundingBox();
    await page.mouse.move(box.x + 82 + (box.width - 138) * .02, box.y + box.height * .8 + 18);
    await page.mouse.down(); await page.mouse.move(box.x + 82 + (box.width - 138) * .98, box.y + box.height * .8 - 18, {steps: 8}); await page.mouse.up();
    assert.equal(await page.locator('#selection-count').textContent(), '2');
  };
  await page.locator('#x-snap').selectOption('4k'); await selectPair();
  await page.locator('#align-selection').click();
  let laneExport = await exportChart('aligned');
  near(laneExport.notes.find(note => note.id === 'tap').x, .125);
  near(laneExport.notes.find(note => note.id === 'heart').x, .875);
  // A full-width group cannot move half a lane when dragged into the edge.
  lanesArea = await page.locator('#editor').boundingBox();
  await page.mouse.move(laneX(.125), lanesArea.y + lanesArea.height * .8); await page.mouse.down();
  await page.mouse.move(laneX(.375), lanesArea.y + lanesArea.height * .8, {steps: 8}); await page.mouse.up();
  laneExport = await exportChart('edge-drag');
  near(laneExport.notes.find(note => note.id === 'tap').x, .125);
  near(laneExport.notes.find(note => note.id === 'heart').x, .875);

  await page.locator('#mirror-selection').click();
  laneExport = await exportChart('mirror'); near(laneExport.notes.find(note => note.id === 'tap').x, .875);
  await page.keyboard.press('Control+z');
  laneExport = await exportChart('mirror-undo'); near(laneExport.notes.find(note => note.id === 'tap').x, .125);
  await page.keyboard.press('Control+Shift+z');
  laneExport = await exportChart('mirror-redo'); near(laneExport.notes.find(note => note.id === 'tap').x, .875);
  await selectPair(); await page.keyboard.press('Control+c'); await seek(16.375); await page.locator('#editor').focus();
  await page.keyboard.press('Control+Shift+v');
  laneExport = await exportChart('mirror-paste');
  near(laneExport.notes.find(note => note.time === 16 && note.type === 'tap').x, .125);
  assert.ok(laneExport.events.some(event => event.time === 16 && event.target !== 'tap' && event.property === 'opacity'));
  await seek(18.375); await page.locator('#paste-selection').click();
  laneExport = await exportChart('regular-paste'); near(laneExport.notes.find(note => note.time === 18 && note.type === 'tap').x, .875);
  await page.locator('#editor').focus(); await page.keyboard.press('Control+m');
  laneExport = await exportChart('mirror-shortcut'); near(laneExport.notes.find(note => note.time === 18 && note.type === 'tap').x, .125);

  await page.locator('#select-all').click();
  assert.equal(Number(await page.locator('#selection-count').textContent()), laneExport.notes.length);
  await page.locator('#cut-selection').click(); assert.equal((await exportChart('cut')).notes.length, 0);
  assert.equal(await page.locator('#mirror-paste').isEnabled(), true);
  await page.locator('#undo').click(); assert.equal((await exportChart('cut-undo')).notes.length, laneExport.notes.length);
  await page.locator('#x-snap').selectOption('5k');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#x-snap')?.value === '5k');
  await page.locator('#x-snap').selectOption('4k'); await selectPair();
  for (const viewport of [{width:1440,height:900},{width:1024,height:768}]) {
    await page.setViewportSize(viewport); await page.locator('[data-tool=tap]').click();
    for (const id of ['copy-selection','paste-selection','mirror-selection','x-snap','placement-type']) {
      const box = await page.locator('#'+id).boundingBox();
      assert.ok(box && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height, `K toolbar clipped: ${id}`);
    }
    await page.mouse.move(10,10);
    await page.screenshot({path:path.join(artifacts,`lanes-${viewport.width}.png`)});
  }
  console.log('PASS 4K–9K, Alt placement, K Hold nodes, alignment, group edge limits, mirror/cut/paste shortcuts, undo/redo and saved preferences');
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({passed: true, viewports: [1440, 1280, 1024], errors}, null, 2));
  console.log('PASS 1440/1280/1024 layouts, no page errors');
} catch (error) {
  await page.screenshot({path: path.join(artifacts, 'failure.png')});
  await writeFile(path.join(artifacts, 'failure.html'), await page.content());
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
