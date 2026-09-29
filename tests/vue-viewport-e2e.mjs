// Real browser/WebGL regression fixtures. These are interaction tests, not engineering evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import * as THREE from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.env.M4KE_VIEWPORT_TEST_OUTPUT || `test-results/vue-viewport-${Date.now()}`);
await mkdir(output, {recursive: true});
const vite = await createServer({root, server: {host: '127.0.0.1', port: 0}});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executable = process.env.M4KE_BROWSER_EXECUTABLE || (process.platform === 'win32' && await access(localChrome).then(() => true, () => false) ? localChrome : undefined);
  browser = await chromium.launch({...(executable ? {executablePath: executable} : {}),
    headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1100, height: 750}});
  const errors = [], results = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const geometry = new THREE.BoxGeometry(40, 25, 16), material = new THREE.MeshBasicMaterial();
  const stl = new STLExporter().parse(new THREE.Mesh(geometry, material));
  geometry.dispose(); material.dispose();
  const hash = createHash('sha256').update(stl).digest('hex');
  const part = (id, x) => ({id, name: id, kind: id === 'shell' ? 'printed' : 'purchased', material: 'fixture', color: '#9bb5d2', shape: {type: 'box', size: [40, 25, 16]}, position: [x, 0, 10], rotation: [0, 0, 0]});
  const parts = [part('shell', -35), part('motor', 35)];
  const connections = [{id: 'wire', from: {partId: 'shell', terminal: 'A'}, to: {partId: 'motor', terminal: 'B'}, kind: 'fixture', color: '#ff3322', routingStatus: 'MODEL_ASSUMED', fromAnchorMm: [-15, 0, 10], toAnchorMm: [15, 0, 10], polylineMm: [[-15, 0, 10], [0, -15, 10], [15, 0, 10]]}];
  const model = {parts, cadParts: parts.map(p => ({id: p.id, stlUrl: `/fixture-${p.id}.stl`, sha256: {stl: hash}, bounds: {min: [-20, -12.5, -8], max: [20, 12.5, 8]}})), connections};
  const html = `<!doctype html><html><head><style>body{margin:0;background:#191b20;color:white;font:14px sans-serif}#viewport{width:1000px;height:600px}input{display:block;margin:20px;width:300px}</style></head><body><div id="viewport"></div><input aria-label="External editor" id="editor"><script type="module">
    import {StudioViewportController} from '/src/viewport/controller.ts';
    window.model = ${JSON.stringify(model)};
    window.display = {selectedIds:[],activeId:null,hiddenIds:[],selectedConnection:null};
    window.controller = new StudioViewportController(document.getElementById('viewport'),{
      select(selection){window.display={...window.display,selectedIds:selection.ids,activeId:selection.activeId};window.controller.setDisplay(window.display);},
      visibility(ids){window.display={...window.display,hiddenIds:ids};window.controller.setDisplay(window.display);},
      selectConnection(id){window.display.selectedConnection=id;window.controller.setDisplay(window.display);},
      status(state){window.statusSnapshot=state;}
    });
    window.controller.setModel(window.model);
    window.controller.setLabel('Viewport fixture');
    window.initialCanvas=document.querySelector('canvas');
    window.meshSnapshot=()=>[...window.controller.meshes.values()].map(mesh=>({id:mesh.name,uuid:mesh.uuid,visible:mesh.visible}));
    window.clickPosition=id=>{const c=window.controller,m=c.meshes.get(id),p=m.position.clone().project(c.camera),r=c.renderer.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};};
  </script></body></html>`;
  await page.route('**/viewport-fixture', route => route.fulfill({contentType: 'text/html', body: html}));
  await page.route('**/fixture-*.stl', route => {requests.push(route.request().url());return route.fulfill({contentType: 'model/stl', body: stl});});
  const check = async (name, action) => {await action(); results.push({name, status: 'PASS'});};
  await page.goto(`${base}/viewport-fixture`);
  await page.waitForFunction(() => window.statusSnapshot?.loaded === 2);
  const canvas = page.locator('canvas');
  await check('native STL exact-cache sharing and complete wire readiness', async () => {
    assert.equal(requests.length, 1, 'equal SHA parts share one verified request');
    assert.equal(await page.evaluate(() => window.statusSnapshot.error), '');
    assert.equal(await page.evaluate(() => window.statusSnapshot.wiresVisible), true);
  });
  const before = await page.evaluate(() => window.meshSnapshot());
  await check('idle native scene stops rendering and display changes request a fresh frame', async () => {
    await page.waitForFunction(() => window.controller.frame === 0);
    const frames = await page.evaluate(() => window.controller.renderer.info.render.frame);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.controller.renderer.info.render.frame), frames);
    await page.evaluate(() => window.controller.setDisplay({...window.display,selectedIds:['shell'],activeId:'shell'}));
    await page.waitForFunction(previous => window.controller.renderer.info.render.frame > previous, frames);
    await page.evaluate(() => window.controller.setDisplay(window.display));
  });
  await check('real ray selection, Shift multiselect and active part are controlled', async () => {
    await page.evaluate(() => window.controller.setView('front'));
    for (const [id, shift] of [['shell', false], ['motor', true]]) {
      const point = await page.evaluate(id => window.clickPosition(id), id);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.click(point.x, point.y);
      if (shift) await page.keyboard.up('Shift');
    }
    assert.deepEqual(await page.evaluate(() => window.display.selectedIds), ['shell', 'motor']);
    assert.equal(await page.evaluate(() => window.display.activeId), 'motor');
  });
  await check('H hides meshes and endpoint wires, hidden parts are excluded from raycast, Alt H restores', async () => {
    await canvas.focus(); await page.keyboard.press('h');
    assert.deepEqual(await page.evaluate(() => window.display.hiddenIds), ['shell', 'motor']);
    assert.equal(await page.evaluate(() => window.statusSnapshot.wiresVisible), false);
    assert((await page.evaluate(() => window.meshSnapshot())).every(p => !p.visible));
    const point = await page.evaluate(() => window.clickPosition('shell'));
    await page.mouse.click(point.x, point.y);
    assert.deepEqual(await page.evaluate(() => window.display.selectedIds), []);
    await page.keyboard.press('Alt+h');
    assert.deepEqual(await page.evaluate(() => window.display.hiddenIds), []);
    assert.equal(await page.evaluate(() => window.statusSnapshot.wiresVisible), true);
  });
  await check('standard numpad views and projection preserve the same native mesh and canvas instances', async () => {
    await canvas.focus();
    await page.keyboard.press('Numpad3');
    assert.equal(await page.evaluate(() => window.statusSnapshot.direction), 'right');
    assert.equal(await page.evaluate(() => window.statusSnapshot.projection), 'orthographic');
    await page.keyboard.press('Control+Numpad7');
    assert.equal(await page.evaluate(() => window.statusSnapshot.direction), 'bottom');
    await page.keyboard.press('Numpad5');
    assert.equal(await page.evaluate(() => window.statusSnapshot.projection), 'perspective');
    await page.keyboard.press('Home');
    await page.evaluate(() => window.controller.setModel(structuredClone(window.model)));
    assert.deepEqual(await page.evaluate(() => window.meshSnapshot()), before);
    assert.equal(await page.evaluate(() => window.initialCanvas === document.querySelector('canvas')), true);
    assert.equal(requests.length, 1);
  });
  await check('external input is not affected by viewport keyboard shortcuts', async () => {
    await page.getByRole('textbox', {name: 'External editor'}).fill('');
    await page.keyboard.type('hgrs');
    assert.equal(await page.getByRole('textbox', {name: 'External editor'}).inputValue(), 'hgrs');
    assert.deepEqual(await page.evaluate(() => window.display.hiddenIds), []);
  });
  await check('middle mouse orbits, Shift middle mouse pans and wheel zooms', async () => {
    await page.evaluate(() => {window.controller.setView('front');window.controller.toggleProjection();});
    const pose = () => page.evaluate(() => ({position: window.controller.camera.position.toArray(), target: window.controller.controls.target.toArray()}));
    const a = await pose();
    await page.mouse.move(500, 300); await page.mouse.down({button: 'middle'}); await page.mouse.move(540, 330, {steps: 5}); await page.mouse.up({button: 'middle'});
    const b = await pose(); assert.notDeepEqual(b.position, a.position);
    await page.keyboard.down('Shift'); await page.mouse.down({button: 'middle'}); await page.mouse.move(590, 350, {steps: 5}); await page.mouse.up({button: 'middle'}); await page.keyboard.up('Shift');
    const c = await pose(); assert.notDeepEqual(c.target, b.target);
    await page.mouse.wheel(0, 250); await page.waitForTimeout(150);
    assert.notDeepEqual((await pose()).position, c.position);
    assert.equal(requests.length, 1);
  });
  await page.screenshot({path: path.join(output, 'native-interaction-fixture.png')});
  await check('library concept envelope preserves off-centre source origin and missing bounds never invent a substitute', async () => {
    const value = await page.evaluate(() => {
      const sourceSha256 = 'b'.repeat(64);
      const part = {...window.model.parts[0], id: 'source', shape: {type: 'library', sourceSha256}, position: [10, 20, 30], rotation: [0, 0, 0]};
      const data = {parts: [part], librarySources: [{sourceSha256, name: 'Off-centre fixture', nativeImportCandidate: true, sourceBoundsMm: [4, 5, 6, 14, 25, 36]}]};
      window.controller.setDisplay({selectedIds: [], activeId: null, hiddenIds: []});
      window.controller.setModel(data);
      const bounds = window.controller.bounds();
      const observed = {min: bounds.min.toArray(), max: bounds.max.toArray(), envelope: window.controller.meshes.get('source').userData.catalogEnvelope};
      window.controller.setModel({parts: [part]});
      return {...observed, missingCount: window.controller.meshes.size, error: window.statusSnapshot.error};
    });
    assert.deepEqual(value.min, [14, 25, 36]);
    assert.deepEqual(value.max, [24, 45, 66]);
    assert.equal(value.envelope, true);
    assert.equal(value.missingCount, 0);
    assert.match(value.error, /Source-local bounds unavailable/);
    await page.evaluate(() => window.controller.setModel(window.model));
    await page.waitForFunction(() => window.statusSnapshot.loaded === 2);
    assert.equal(requests.length, 1);
  });
  await check('assembly motion reuses exact native meshes, hides future parts and restores every pose', async () => {
    const before=await page.evaluate(()=>({model:JSON.stringify(window.model),canvas:document.querySelector('canvas')===window.initialCanvas,poses:[...window.controller.meshes.values()].map(m=>({id:m.name,position:m.position.toArray(),uuid:m.uuid}))}));
    const count=requests.length;
    await page.evaluate(()=>window.controller.setAssemblyFrame({stepId:'motor',settledIds:['shell'],activeIds:['motor'],movingIds:['motor'],progress:0}));
    assert(await page.evaluate(()=>window.controller.meshes.get('motor').position.z>10));
    assert.equal(await page.evaluate(()=>window.statusSnapshot.wiresVisible),false);
    await page.evaluate(()=>window.controller.setAssemblyFrame({stepId:'motor',settledIds:['shell'],activeIds:['motor'],movingIds:['motor'],progress:1}));
    assert.equal(await page.evaluate(()=>window.controller.meshes.get('motor').position.z),10);
    assert.equal(await page.evaluate(()=>window.statusSnapshot.wiresVisible),true);
    await page.evaluate(()=>window.controller.setAssemblyFrame({stepId:'motor',settledIds:['shell'],activeIds:['motor'],movingIds:['motor'],progress:0}));
    await page.waitForFunction(()=>window.controller.frame===0);
    assert(await page.evaluate(()=>{
      const c=window.controller,m=c.meshes.get('motor');m.geometry.computeBoundingBox();
      const b=m.geometry.boundingBox;
      return [b.min.x,b.max.x].every(x=>[b.min.y,b.max.y].every(y=>[b.min.z,b.max.z].every(z=>{
        const p=m.position.clone().set(x,y,z).applyMatrix4(m.matrixWorld).project(c.camera);
        return Math.abs(p.x)<1&&Math.abs(p.y)<1;
      })));
    }),'Replayed moving mesh must remain in the step camera frame');
    await page.evaluate(()=>window.controller.setAssemblyFrame({stepId:'base',settledIds:[],activeIds:['shell'],movingIds:['shell'],progress:1}));
    assert.equal(await page.evaluate(()=>window.controller.meshes.get('motor').visible),false);
    await page.evaluate(()=>window.controller.setAssemblyFrame(null));
    const after=await page.evaluate(()=>({model:JSON.stringify(window.model),canvas:document.querySelector('canvas')===window.initialCanvas,poses:[...window.controller.meshes.values()].map(m=>({id:m.name,position:m.position.toArray(),uuid:m.uuid}))}));
    assert.deepEqual(after,before);assert.equal(requests.length,count);
  });
  await check('new corrupt native revision fails closed without concept substitution', async () => {
    await page.evaluate(() => {
      const invalid = structuredClone(window.model); invalid.cadParts[0].sha256.stl = 'f'.repeat(64);
      window.controller.setModel(invalid);
    });
    await page.waitForFunction(() => window.statusSnapshot.error.includes('hash mismatch'));
    const ids = await page.evaluate(() => window.meshSnapshot().map(p => p.id));
    assert(!ids.includes('shell'), 'no preview box may replace rejected native shell');
    assert.equal(await page.evaluate(() => window.statusSnapshot.wiresVisible), false);
  });
  await check('dispose removes canvas and stops the controller', async () => {
    await page.evaluate(() => window.controller.dispose());
    assert.equal(await canvas.count(), 0);
    assert.equal(await page.evaluate(() => window.controller.disposed), true);
  });
  await check('disposing during an in-flight revision aborts native loading without a late mesh or error', async () => {
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    let reached;
    const routeReached = new Promise(resolve => {reached = resolve;});
    await page.route('**/fixture-slow.stl', async route => {
      reached();
      await gate;
      await route.fulfill({contentType: 'model/stl', body: stl});
    });
    const slowRequest = page.waitForRequest('**/fixture-slow.stl');
    await page.evaluate(async () => {
      const {StudioViewportController} = await import('/src/viewport/controller.ts');
      window.pendingController = new StudioViewportController(document.getElementById('viewport'), {
        select() {}, visibility() {}, selectConnection() {}, status(state) {window.pendingStatus = state;},
      });
      const slow = structuredClone(window.model);
      slow.parts = slow.parts.slice(0, 1);
      slow.cadParts = [{id: slow.parts[0].id, stlUrl: '/fixture-slow.stl', sha256: {stl: 'e'.repeat(64)}}];
      slow.connections = [];
      window.pendingController.setModel(slow);
    });
    await slowRequest;
    await routeReached;
    await page.evaluate(() => window.pendingController.dispose());
    release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.pendingController.meshes.size), 0);
    assert.equal(await page.evaluate(() => window.pendingStatus.error), '');
  });

  const componentResponse = await fetch(`${base}/src/components/StudioViewport.vue`);
  assert.equal(componentResponse.status, 200);
  const componentSource = await componentResponse.text();
  const vueUrl = componentSource.match(/from\s+["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
  assert(vueUrl, 'resolve the same Vue runtime URL used by the compiled component');
  await page.evaluate(async ({vueUrl, model}) => {
    const {createApp, h, reactive} = await import(vueUrl);
    const {default: Viewport} = await import('/src/components/StudioViewport.vue');
    const host = document.getElementById('viewport');
    window.vueState = reactive({...model, selectedIds: [], activeId: null, hiddenIds: [], selectedConnection: null, locale: 'zh', viewMode: 'model', projection: 'orthographic'});
    window.vueApp = createApp({render() {return h(Viewport, {...window.vueState,
      onSelect({ids, activeId}) {window.vueState.selectedIds = ids; window.vueState.activeId = activeId;},
      onVisibility(ids) {window.vueState.hiddenIds = ids;},
      onSelectConnection(id) {window.vueState.selectedConnection = id;},
      onProjection(projection) {window.vueState.projection = projection;},
    });}});
    window.vueApp.mount(host);
  }, {vueUrl, model});
  const component = page.locator('.studio-viewport');
  await page.waitForFunction(() => document.querySelector('.studio-viewport')?.getAttribute('data-native-loaded') === '2');
  await check('Vue component binds controlled selection, visibility, wire state and real toolbar camera actions', async () => {
    assert.equal(await component.getAttribute('data-projection'), 'orthographic');
    await page.evaluate(() => {window.vueState.selectedIds = ['shell'];window.vueState.activeId = 'shell';});
    await page.waitForFunction(() => document.querySelector('.studio-viewport').getAttribute('data-selected-ids') === 'shell');
    await page.getByRole('button', {name: '隐藏选中', exact: true}).click();
    assert.equal(await component.getAttribute('data-hidden-ids'), 'shell');
    assert.equal(await component.getAttribute('data-wires-visible'), 'false');
    await page.getByRole('button', {name: '显示全部零件', exact: true}).click();
    assert.equal(await component.getAttribute('data-hidden-ids'), '');
    assert.equal(await component.getAttribute('data-wires-visible'), 'true');
    for (const [label, view] of [['前视图', 'front'], ['后视图', 'back'], ['左视图', 'left'], ['右视图', 'right'], ['顶视图', 'top'], ['底视图', 'bottom']]) {
      await page.getByRole('button', {name: label, exact: true}).click();
      assert.equal(await component.getAttribute('data-view'), view);
      assert.equal(await component.getAttribute('data-projection'), 'orthographic');
    }
    await page.getByRole('button', {name: '切换透视与正交', exact: true}).click();
    assert.equal(await component.getAttribute('data-projection'), 'perspective');
    assert.equal(await page.evaluate(() => window.vueState.projection), 'perspective');
    await page.evaluate(() => {window.vueState.projection = 'orthographic';});
    await page.waitForFunction(() => document.querySelector('.studio-viewport').getAttribute('data-projection') === 'orthographic');
  });
  await check('Vue locale change and display props preserve native canvas and cached bytes', async () => {
    const count = requests.length;
    await page.evaluate(() => {window.vueCanvas = document.querySelector('canvas');window.vueState.locale = 'en';});
    await page.getByRole('button', {name: 'Fit visible parts', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.vueCanvas === document.querySelector('canvas')), true);
    assert.equal(requests.length, count);
    await page.getByRole('button', {name: 'Hide unselected', exact: true}).click();
    assert.equal(await component.getAttribute('data-hidden-ids'), 'motor');
    await page.locator('canvas').focus();await page.keyboard.press('Alt+h');
    assert.equal(await component.getAttribute('data-hidden-ids'), '');
    await page.screenshot({path: path.join(output, 'vue-viewport-toolbar.png')});
    await page.evaluate(() => window.vueApp.unmount());
    assert.equal(await page.locator('canvas').count(), 0);
  });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({fixtureOnly: true, results, errors, requests: requests.length}, null, 2));
  console.log(JSON.stringify({status: 'PASS', tests: results.length, output}));
} finally {
  await browser?.close();
  await vite.close();
}
