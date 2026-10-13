
const fail=(path,message)=>{throw Object.assign(new Error(`${path}: ${message}`),{code:'DESIGN_CONTRACT',validationPath:path});};
function obj(v,keys,p){if(!v||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(p,'expected plain object');for(const k of Reflect.ownKeys(v))if(typeof k!=='string'||!keys.includes(k)||!('value'in Object.getOwnPropertyDescriptor(v,k)))fail(p,'unsupported field or accessor');return v;}
function num(v,a,b,p){if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)fail(p,'finite bounded number required');return v===0?0:v;}
function list(v,a,b,p,f){if(!Array.isArray(v)||v.length<a||v.length>b)fail(p,`expected ${a}..${b} items`);return Array.from(v,(x,i)=>f(x,`${p}[${i}]`));}
const vec=(v,p,limit=500)=>list(v,3,3,p,(x,k)=>num(x,-limit,limit,k));
const id=(v,p)=>{if(typeof v!=='string'||! /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v))fail(p,'safe identifier required');return v;};
const text=(v,p)=>{if(typeof v!=='string'||!v.trim()||v.length>1000||/[\x00-\x1f]/.test(v))fail(p,'nonempty bounded text required');return v.trim();};
function unique(xs,p){if(new Set(xs).size!==xs.length)fail(p,'duplicate identifier');}
export function validateFrame(v,p){obj(v,['position','rotation'],p);return {position:vec(v.position,p+'.position'),rotation:vec(v.rotation,p+'.rotation',360)};}
export function validateDatums(v,p){const out=list(v,1,16,p,(d,k)=>{obj(d,['id','position','rotation'],k);return {id:id(d.id,k+'.id'),...validateFrame({position:d.position,rotation:d.rotation},k)};});unique(out.map(d=>d.id),p);return out;}

export function validateProfile(points,p){
 const xy=list(points,3,32,p,(q,k)=>list(q,2,2,k,(n,j)=>num(n,-250,250,j)));
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,c)=>Math.abs(cross(a,b,c))<=1e-9&&c.every((x,i)=>x>=Math.min(a[i],b[i])-1e-9&&x<=Math.max(a[i],b[i])+1e-9);
 for(let i=0;i<xy.length;i++){
  const a=xy[i],b=xy[(i+1)%xy.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6)fail(p,'degenerate profile edge');
  for(let j=i+1;j<xy.length;j++){if(j===(i+1)%xy.length||i===(j+1)%xy.length)continue;const c=xy[j],d=xy[(j+1)%xy.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))fail(p,'self-intersecting profile');}
 }
 if(Math.abs(area(xy))<1e-6)fail(p,'zero-area profile');return xy;
}
const area=p=>p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-a[1]*b[0];},0)/2;
export function validateParametricShape(s,p){
 if(s.type==='profileExtrusion'){obj(s,['type','points','height'],p);return {type:s.type,points:validateProfile(s.points,p+'.points'),height:num(s.height,.5,500,p+'.height')};}
 obj(s,['type','sections'],p);if(s.type!=='profileLoft')fail(p,'unsupported parametric shape');
 const sections=list(s.sections,2,8,p+'.sections',(s,k)=>{obj(s,['z','points'],k);return {z:num(s.z,-250,250,k+'.z'),points:validateProfile(s.points,k+'.points')};});
 for(let i=1;i<sections.length;i++)if(sections[i].z-sections[i-1].z<.5||sections[i].points.length!==sections[0].points.length||Math.sign(area(sections[i].points))!==Math.sign(area(sections[0].points)))fail(p,'loft needs increasing z (>=0.5 mm), equal vertex counts and matching winding');
 return {type:s.type,sections};
}

export function validatePlacement(value,parts,requirements,p='placement'){
 obj(value,['version','roots','attachments'],p);if(value.version!==1)fail(p,'unsupported version');
 const known=new Map(parts.map(x=>[x.id,x])),reqs=new Set(requirements.map(x=>x.id));
 const roots=list(value.roots,1,48,p+'.roots',(r,k)=>{obj(r,['partId','reason'],k);return {partId:id(r.partId,k),reason:text(r.reason,k)};});unique(roots.map(r=>r.partId),p+'.roots');
 const attachments=list(value.attachments,0,47,p+'.attachments',(a,k)=>{
  obj(a,['id','requirementId','parentId','parentDatum','childId','childDatum','offset','verification'],k);
  const out=Object.fromEntries(['id','requirementId','parentId','parentDatum','childId','childDatum'].map(n=>[n,id(a[n],k+'.'+n)]));
  out.offset=validateFrame(a.offset,k+'.offset');const v=a.verification;
  if(v?.type==='contact'){obj(v,['type','maxGapMm','maxIntersectionMm3'],k+'.verification');out.verification={type:'contact',maxGapMm:num(v.maxGapMm,0,.1,k),maxIntersectionMm3:num(v.maxIntersectionMm3,0,.01,k)};}
  else {obj(v,['type','reason'],k+'.verification');if(v.type!=='frameOnly')fail(k,'unsupported verification');out.verification={type:'frameOnly',reason:text(v.reason,k)};}
  if(!reqs.has(out.requirementId))fail(k,'unknown requirement');return out;
 });unique(attachments.map(a=>a.id),p+'.attachments');
 const rootsSet=new Set(roots.map(r=>r.partId)),parents=new Map();
 for(const r of roots)if(!known.has(r.partId))fail(p,'unknown root');
 for(const a of attachments){
  for(const [part,datum] of [[a.parentId,a.parentDatum],[a.childId,a.childDatum]]){const x=known.get(part);if(!x)fail(p,'unknown part');if(!(x.datums?.some(d=>d.id===datum)||x.datumIds?.includes(datum)))fail(p,`missing datum ${part}.${datum}`);}
  if(rootsSet.has(a.childId)||parents.has(a.childId))fail(p,'conflicting parent/root');parents.set(a.childId,a.parentId);
 }
 const done=new Set(rootsSet),active=new Set();function visit(k){if(done.has(k))return;if(active.has(k))fail(p,'cyclic attachments');if(!parents.has(k))fail(p,`unbound part ${k}`);active.add(k);visit(parents.get(k));active.delete(k);done.add(k);}for(const k of known.keys())visit(k);
 return {version:1,roots,attachments};
}
// Dependency-free rigid transforms keep the standalone server distributable.
// Row-major R = Rx * Ry * Rz matches the viewport's intrinsic XYZ convention.
const matrix=f=>{
 const [x,y,z]=f.rotation.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
 return [[cy*cz,-cy*sz,sy,f.position[0]],[cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,f.position[1]],[sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy,f.position[2]],[0,0,0,1]];
};
const multiply=(a,b)=>a.map((row,i)=>b[0].map((_,j)=>row.reduce((sum,v,k)=>sum+v*b[k][j],0)));
const inverse=m=>[...Array.from({length:3},(_,i)=>[m[0][i],m[1][i],m[2][i],-m.slice(0,3).reduce((sum,row)=>sum+row[i]*row[3],0)]),[0,0,0,1]];
function euler(m){
 const c=Math.hypot(m[0][0],m[0][1]),y=Math.atan2(m[0][2],c);
 // Composition amplifies roundoff near singularity. This threshold bounds the
 // orientation residual below the independent native matrix tolerance (1e-7).
 const x=c>1e-8?Math.atan2(-m[1][2],m[2][2]):Math.atan2(m[2][1],m[1][1]);
 const z=c>1e-8?Math.atan2(-m[0][1],m[0][0]):0;
 return [x,y,z].map(v=>v*180/Math.PI);
}
const rounded=n=>{const v=Math.round(n*1e10)/1e10;return v===0?0:v;};
/** Resolve only declared relationships. Never infer mates or datum locations from labels. */
export function resolvePlacement(parts,placement){
 const byId=new Map(parts.map(p=>[p.id,p])),links=new Map(placement.attachments.map(a=>[a.childId,a]));
 const solved=new Map(placement.roots.map(r=>[r.partId,matrix(byId.get(r.partId))]));
 function visit(k){if(solved.has(k))return solved.get(k);const a=links.get(k),parent=byId.get(a.parentId),child=byId.get(k);
  const m=multiply(multiply(multiply(visit(a.parentId),matrix(parent.datums.find(d=>d.id===a.parentDatum))),matrix(a.offset)),inverse(matrix(child.datums.find(d=>d.id===a.childDatum))));solved.set(k,m);return m;}
 return parts.map(p=>{if(!links.has(p.id))return p;const m=visit(p.id),position=m.slice(0,3).map(row=>rounded(row[3])),rotation=euler(m).map(rounded);
  if(position.some(n=>Math.abs(n)>500))fail('placement',`resolved ${p.id} outside workspace bounds`);return {...p,position,rotation};});
}

const n=(minimum,maximum)=>({type:'number',minimum,maximum}),arr=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const object=(properties)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const sid={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$',minLength:1,maxLength:64},txt={type:'string',minLength:1,maxLength:1000};
export const FRAME_SCHEMA=object({position:arr(n(-500,500),3,3),rotation:arr(n(-360,360),3,3)});
export const DATUM_SCHEMA=object({id:sid,...FRAME_SCHEMA.properties});
const points=arr(arr(n(-250,250),2,2),3,32);
export const PARAMETRIC_SHAPES=[object({type:{type:'string',enum:['profileExtrusion']},points,height:n(.5,500)}),object({type:{type:'string',enum:['profileLoft']},sections:arr(object({z:n(-250,250),points}),2,8)})];
export const PLACEMENT_SCHEMA=object({version:{const:1},roots:arr(object({partId:sid,reason:txt}),1,48),attachments:arr(object({id:sid,requirementId:sid,parentId:sid,parentDatum:sid,childId:sid,childDatum:sid,offset:FRAME_SCHEMA,verification:{anyOf:[object({type:{const:'contact'},maxGapMm:n(0,.1),maxIntersectionMm3:n(0,.01)}),object({type:{const:'frameOnly'},reason:txt})]}}),0,47)});
