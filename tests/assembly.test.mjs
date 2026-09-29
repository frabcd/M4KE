import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProject,calculate,applyChanges,restoreLocal,evidenceCurrent,STEPS,completeStep,reopenStep,completionBlockReason,METHOD_VERSION} from '../src/domain.ts';
import {instructionsHTML} from '../src/instructions.ts';

test('final review requires current evidence without concealing physical unknowns',()=>{
 let p=newProject();for(const s of STEPS.slice(0,-1))p=completeStep(p,s.id,s.checklist);
 const final=STEPS.at(-1);assert.match(completionBlockReason(p,final),/Run checks/);
 assert.throws(()=>completeStep(p,final.id,final.checklist),/Run checks/);
 p.evidence=calculate(p.parameters,p.version);p=completeStep(p,final.id,final.checklist);
 assert.equal(p.completed.length,10);assert.ok(p.evidence.checks.some(c=>c.status==='UNKNOWN'));
});
test('completion cannot bypass dependencies or incomplete checklist',()=>{
 const p=newProject();assert.throws(()=>completeStep(p,'prepare',[]),/checklist/);
 assert.throws(()=>completeStep(p,'base',STEPS[1].checklist),/previous step/);
 assert.throws(()=>completeStep(p,'fake',[]),/Unknown/);
});
test('reopening a step clears only it and dependent confirmations',()=>{
 let p=newProject();p.evidence=calculate(p.parameters,p.version);for(const s of STEPS)p=completeStep(p,s.id,s.checklist);
 const reopened=reopenStep(p,'mount-step');assert.deepEqual(reopened.completed,['prepare','base','frame-step']);
 assert.equal(p.completed.length,10);assert.equal(reopened.version,p.version);assert.equal(reopened.evidence,p.evidence);
 assert.equal(reopenStep(p,'prepare').completed.length,0);assert.throws(()=>reopenStep(p,'missing'),/Unknown/);
});
test('reload preserves stale evidence and original time without trusting stored check text',()=>{
 const p=newProject();p.evidence=calculate(p.parameters,p.version);p.evidence.createdAt='2026-09-25T00:00:00.000Z';
 const changed=applyChanges(p,{clearance:1},'Fail clearance');changed.evidence.checks[0].status='FORGED';
 const restored=restoreLocal(JSON.stringify(changed));assert.equal(restored.evidence.version,1);assert.equal(restored.version,2);assert.equal(evidenceCurrent(restored),false);
 assert.equal(restored.evidence.createdAt,'2026-09-25T00:00:00.000Z');assert.notEqual(restored.evidence.checks[0].status,'FORGED');assert.equal(restored.evidence.methodVersion,METHOD_VERSION);
});
test('saved final confirmation is removed when current evidence is missing',()=>{
 const p=newProject();p.completed=STEPS.map(s=>s.id);const restored=restoreLocal(JSON.stringify(p));assert.equal(restored.completed.length,9);assert.ok(!restored.completed.includes('review-step'));
});
test('instruction HTML contains ten linked steps, embedded local images and scoped evidence',()=>{
 const p=newProject();p.name='<script>alert(1)</script>';p.evidence=calculate(p.parameters,p.version);
 const image='data:image/png;base64,aGVsbG8=';const html=instructionsHTML(p,{prepare:image,base:'https://tracker.invalid/image.png'});
 assert.equal((html.match(/class="step" id=/g)||[]).length,11);
 assert.ok(html.includes(image));assert.ok(!html.includes('https://tracker.invalid'));assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('CURRENT ANALYTICAL RESULTS'));assert.ok(html.includes('Do not energize'));
 assert.ok(html.includes('UNKNOWN'));assert.ok(html.includes('No motor data'));assert.ok(html.includes('href="#review-step"'));
});
test('instruction HTML labels historical values stale instead of current passes',()=>{
 let p=newProject();p.evidence=calculate(p.parameters,p.version);p=applyChanges(p,{width:290},'Change');const html=instructionsHTML(p);
 assert.ok(html.includes('STALE RESULTS'));assert.ok(!html.includes('class="PASS"'));assert.ok(html.includes('revision 1'));
});
