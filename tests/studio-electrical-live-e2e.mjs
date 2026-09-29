/** Read-only acceptance of an actual persisted DGX job. Never generates, edits, purchases or prints. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {unzipSync} from 'fflate';

const base=process.env.STUDIO_REAL_URL||'http://127.0.0.1:4174';
const jobId=process.env.STUDIO_REAL_JOB;
assert.ok(jobId,'STUDIO_REAL_JOB must identify the actual retained job; no default fixture is selected.');
assert.match(jobId,/^[0-9a-f-]{36}$/i);
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use the local endpoint or existing user tunnel.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=path.resolve(process.env.STUDIO_REAL_OUT||`test-results/electrical-live-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);await mkdir(out,{recursive:true});
const results=[],errors=[],mutations=[],stls=[],pending=[],requests=[];
const record={at:new Date().toISOString(),scope:'Actual persisted-job browser/artifact verification; not fresh-inference or physical proof by itself.',jobId,status:'RUNNING',physicalValidation:'UNKNOWN',results,errors,mutations};
let browser;
const check=async(name,run)=>{await run();results.push({name,status:'PASS'});};
try{
  const r=await fetch(`${base}/api/studio/jobs/${jobId}`);assert.equal(r.status,200);
  const job=await r.json();assert.equal(job.id,jobId);assert.equal(job.status,'complete');
  assert.ok(job.spec?.electrical,'The actual job has no generated electrical netlist.');
  assert.equal(job.electrical?.designHash,job.designHash);assert.equal(job.verification?.revisionHash,job.designHash);
  Object.assign(record,{designHash:job.designHash,overall:job.verification.overall,electricalStatus:job.electrical.status,firmwareStatus:job.electrical.firmware.status,partCount:job.spec.parts.length,connectionCount:job.electrical.connections.length,kitId:job.kitId||null});
  await check('same-job SVG has image MIME, inline disposition and strict script boundary',async()=>{
    const response=await fetch(`${base}/api/studio/jobs/${jobId}/files/electrical/wiring.svg`);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/^image\/svg\+xml/);assert.match(response.headers.get('content-disposition')||'',/^inline/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy')||'',/default-src 'none'/);
    const bytes=Buffer.from(await response.arrayBuffer());assert.match(bytes.toString('utf8'),/<svg[\s>]/);record.diagram={sha256:sha(bytes),bytes:bytes.length,contentType:response.headers.get('content-type')};
  });
  await check('downloaded package agrees on design identity, netlist and every artifact hash',async()=>{
    const response=await fetch(`${base}/api/studio/jobs/${jobId}/package`);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer()),entries=unzipSync(bytes);const hashes=JSON.parse(Buffer.from(entries['ARTIFACT-HASHES.json']).toString('utf8'));
    for(const [name,digest] of Object.entries(hashes)){assert.ok(entries[name],name);assert.equal(sha(entries[name]),digest,name);}
    assert.deepEqual(JSON.parse(Buffer.from(entries['design.json']).toString('utf8')),job.spec);
    const netlist=JSON.parse(Buffer.from(entries['electrical/netlist.json']).toString('utf8'));assert.equal(netlist.designHash,job.designHash);assert.deepEqual(netlist.electrical,job.spec.electrical);
    assert.equal(sha(entries['electrical/wiring.svg']),record.diagram.sha256);
    if(job.electrical.firmware.status==='GENERATED_OUTPUT_DISABLED'){assert.match(Buffer.from(entries['firmware/config.py']).toString('utf8'),/MOTOR_OUTPUT_ENABLED\s*=\s*False/);for(const name of ['firmware/main.py','firmware/controller.py'])assert.ok(entries[name],name);}
    record.package={sha256:sha(bytes),bytes:bytes.length,artifactHashesVerified:Object.keys(hashes).length};
  });
  browser=await chromium.launch({...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1512,height:1080}});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{requests.push(r.url());if(!['GET','HEAD'].includes(r.method()))mutations.push({method:r.method(),url:r.url()});});
  page.on('response',r=>{if(r.url().includes(`/api/studio/jobs/${jobId}/files/`)&&r.url().endsWith('.stl'))pending.push((async()=>{const bytes=await r.body();stls.push({url:r.url(),status:r.status(),sha256:sha(bytes)});})());});
  const phase=async name=>page.getByRole('navigation',{name:'Design workflow'}).getByRole('button',{name:new RegExp(name,'i')}).click();
  await page.goto(`${base}/?job=${jobId}`);
  await check('current native meshes and actual electrical SVG load in the browser',async()=>{
    await page.getByRole('heading',{name:'Shape the first experiment.'}).waitFor({timeout:30000});await page.getByText('Exported CAD mesh',{exact:false}).waitFor();await page.waitForFunction(()=>!document.querySelector('.m4-view-loading'),{},{timeout:90000});await Promise.all(pending);
    assert.equal(await page.locator('.m4-view-error').count(),0);const img=page.getByRole('img',{name:'Generated pin-to-pin wiring diagram for this exact design revision'});await img.waitFor();assert(await img.evaluate(el=>el.complete&&el.naturalWidth>0));
    assert.equal(await page.locator('.m4-electrical').getAttribute('data-electrical-hash'),job.designHash);assert.equal(await page.locator('.m4-wire-table tbody tr').count(),job.electrical.connections.length);
    for(const part of job.cad.parts){const got=stls.find(x=>x.url===base+part.stlUrl);assert.ok(got,part.id);assert.equal(got.status,200);assert.equal(got.sha256,part.sha256.stl,part.id);}
    record.loadedNativeParts=stls.length;
  });
  await check('actual routed connection selection and exploded-view boundary agree with netlist',async()=>{
    const connection=job.electrical.connections.find(c=>c.routingStatus==='MODEL_ASSUMED'&&c.polylineMm?.length>=2);assert.ok(connection,'No actual connection has resolved terminal anchors.');
    await page.getByRole('button',{name:`Select connection ${connection.id}`,exact:true}).click();assert.equal(await page.locator('.m4-viewer').getAttribute('data-selected-wire'),connection.id);assert.equal(await page.locator('.m4-viewer').getAttribute('data-wires-visible'),'true');
    await page.getByRole('button',{name:'Explode',exact:true}).click();assert.equal(await page.locator('.m4-viewer').getAttribute('data-wires-visible'),'false');await page.getByRole('button',{name:'Reset view',exact:true}).click();assert.equal(await page.locator('.m4-viewer').getAttribute('data-wires-visible'),'true');
    await page.locator('.m4-viewer').screenshot({path:path.join(out,'actual-wiring-3d.png')});await page.locator('.m4-electrical-title').screenshot({path:path.join(out,'actual-electrical-status.png')});await page.getByRole('img',{name:'Generated pin-to-pin wiring diagram for this exact design revision'}).screenshot({path:path.join(out,'actual-wiring-diagram.png')});
  });
  await check('current verification and exports retain unknowns and unselected printer',async()=>{
    await phase('Verify');await page.getByRole('heading',{name:job.verification.overall.replaceAll('_',' '),exact:true}).waitFor();await page.getByText('Physical validation remains UNKNOWN.',{exact:true}).waitFor();
    await phase('Export');if(job.verification.overall==='FAILED'){await page.getByRole('alert').getByText('Diagnostic artifacts only — do not manufacture or energize.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Download diagnostic package',exact:true}).getAttribute('href'),`/api/studio/jobs/${jobId}/package`);assert.equal(await page.getByRole('link',{name:'Download package',exact:true}).count(),0);}assert.equal(await page.getByLabel('Printer',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('link',{name:'Pin-to-pin table CSV',exact:true}).getAttribute('href'),`/api/studio/jobs/${jobId}/files/electrical/connections.csv`);await page.screenshot({path:path.join(out,'actual-export-desktop.png'),fullPage:true});
  });
  await check('mobile wiring stays readable without document overflow or remote data writes',async()=>{
    await page.setViewportSize({width:390,height:844});await phase('Design');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'actual-wiring-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    record.frontendBundles=[...new Set(requests.filter(url=>/\/assets\/.*\.js$/.test(url)).map(url=>new URL(url).pathname))];
  });
  record.status='PASS';
}catch(error){record.status='FAIL';record.error=String(error.stack||error);process.exitCode=1;}
finally{await Promise.allSettled(pending);if(browser)await browser.close();record.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(record,null,2));}
console.log(JSON.stringify(record,null,2));
