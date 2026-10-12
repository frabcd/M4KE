import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDesignMessages} from '../server/studio-skills.mjs';
test('generation receives machine-readable primitive axes and rotation examples next to the brief',()=>{
 const messages=buildDesignMessages({request:'Any display object',skills:{design:'Design',verify:'Verify',dyson:'Method'}});
 const c=JSON.parse(messages[1].content).geometryConventions;
 assert.equal(c.units,'mm');assert.equal(c.upAxis,'Z');assert.equal(c.cylinder.localAxis,'Z');
 assert.deepEqual(c.cylinder.axisExamples,[{rotationDegrees:[0,0,0],axis:[0,0,1]},{rotationDegrees:[0,90,0],axis:[1,0,0]},{rotationDegrees:[90,0,0],axis:[0,-1,0]}]);
 assert.match(c.union,/member.*rotation.*translation/);assert.match(c.scope,/not.*design/i);
});
