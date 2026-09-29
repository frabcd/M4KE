import test from 'node:test';
import assert from 'node:assert/strict';
import {tutorialHTML} from '../server/studio-service.mjs';

test('offline guide keeps long evidence visible with a bounded wrapping table',()=>{
 const marker='long-evidence-'.repeat(200);
 const spec={title:'Layout test',description:'No physical claims',assembly:[],requirements:[],assumptions:[],unknowns:[]};
 const verification={overall:'UNVERIFIED',claims:[{label:'Long scope',status:'UNKNOWN',method:marker,details:{unbroken:'x'.repeat(2000)}}],limitations:[]};
 const html=tutorialHTML(spec,verification,'a'.repeat(64));
 assert.match(html,/body\{[^}]*overflow-wrap:anywhere/);
 assert.match(html,/table\{[^}]*width:100%;table-layout:fixed/);
 assert.match(html,/td,th\{[^}]*vertical-align:top/);
 assert(html.includes(marker),'Long evidence must not be truncated to hide overflow');
 assert(html.includes('x'.repeat(2000)),'Keep complete evidence text');
 assert(!html.includes('overflow:hidden'),'Do not hide data instead of wrapping');
});
