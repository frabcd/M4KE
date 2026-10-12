// Synthetic inert fixture: no claim about a real design or model performance.
export const readiness=()=>({status:'ready',requirements:[{id:'R1',text:'Inspect fixture'}],assumptions:[],unknowns:[],questions:[]});
export const plan=(count=1)=>({title:'Fixture',description:'Inert test fixture',units:'mm',...readinessFields(),parts:Array.from({length:count},(_,i)=>({id:'p'+i,kind:'printed',position:[i*10,0,0],rotation:[0,0,0],source:null,identity:{type:'box'},interfaceIntent:'Fixture only'})),assembly:[{id:'inspect',partIds:Array.from({length:count},(_,i)=>'p'+i),requires:[]}],electrical:null,buildItems:null,verificationRequests:null,physicsInputs:false});
function readinessFields(){const {status,questions,...fields}=readiness();return fields;}
export function proposal(p,r=readiness()){
 const {requirements,assumptions,unknowns,...choices}=p;
 return {...choices,newAssumptions:assumptions.slice(r.assumptions.length),newUnknowns:unknowns.slice(r.unknowns.length)};
}
export const part=(p)=>({id:p.id,name:p.id,kind:p.kind,material:'PLA',color:'#ABCDEF',position:p.position,rotation:p.rotation,shape:{type:'box',size:[10,10,10]}});
export function payload(plan,unit){
  if(unit.kind==='part')return {items:unit.ids.map(id=>part(plan.parts.find(p=>p.id===id)))};
  if(unit.kind==='assembly')return {items:unit.ids.map(id=>({...plan.assembly.find(s=>s.id===id),title:'Inspect',instructions:['Inspect'],checks:['Measure']}))};
  if(unit.kind==='metadata')return {};
  throw new Error('Fixture does not implement '+unit.kind);
}
