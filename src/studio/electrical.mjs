export {hasWireRoute} from '../viewport/interaction.mjs';

/** Exact artifact paths only; a model/source URL must never become a download URL. */
const artifactNames=Object.freeze({netlist:'electrical/netlist.json',diagram:'electrical/wiring.svg',table:'electrical/connections.csv',guide:'electrical/README.md',firmwareConfig:'firmware/config.py'});

/** @param {string|undefined} jobId @param {import('./types').Electrical|undefined} summary @param {string} key */
export function electricalArtifactUrl(jobId,summary,key){
  if(!Object.hasOwn(artifactNames,key)||!jobId||!/^[a-zA-Z0-9-]{1,80}$/.test(jobId)||summary?.artifactPaths?.[key]!==artifactNames[key])return undefined;
  return `/api/studio/jobs/${encodeURIComponent(jobId)}/files/${artifactNames[key]}`;
}

/** Do not render detached or stale wiring as current evidence. Legacy fields remain optional.
 * @param {import('./types').Electrical|undefined} value @param {string} hash @param {import('../viewport/types').ToyPart[]} parts
 * @returns {import('./types').Electrical|undefined}
 */
export function currentElectrical(value,hash,parts){
  if(!value||value.schemaVersion!==1||!hash||value.designHash!==hash||!['NOT_APPLICABLE','UNVERIFIED','FAIL'].includes(value.status)||!Array.isArray(value.connections)||value.connections.length>128||!Array.isArray(value.components)||!Array.isArray(value.claims)||!value.firmware)return undefined;
  const ids=new Set(parts.map(p=>p.id)),connections=new Set();
  for(const c of value.connections){
    if(!c||typeof c.id!=='string'||connections.has(c.id)||!ids.has(c.from?.partId)||!ids.has(c.to?.partId)||typeof c.from?.terminal!=='string'||typeof c.to?.terminal!=='string'||typeof c.kind!=='string'||typeof c.color!=='string')return undefined;
    connections.add(c.id);
  }
  return value;
}
