import {isIP} from 'node:net';

export function validateEndpoint(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 200) throw new Error('Endpoint must be a local HTTP URL.');
  let url; try { url = new URL(value); } catch { throw new Error('Invalid endpoint URL.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopbackV4 = isIP(host) === 4 && host.split('.')[0] === '127';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || !(host === 'localhost' || loopbackV4 || host === '::1')) throw new Error('Inference must run on this DGX: use a loopback URL without credentials, path or query. LAN and cloud endpoints are disabled.');
  return url.origin;
}
export function validateModel(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^[a-zA-Z0-9_.:/-]*$/.test(value) || /cloud/i.test(value)) throw new Error('Enter a local model tag; cloud model tags are disabled.');
  return value;
}
export function validateProvider(value = 'ollama') {
  if (!['ollama', 'vllm', 'codex-bridge'].includes(value)) throw new Error('Choose Ollama, vLLM or the explicit online Codex demo bridge.');
  return value;
}

/** Resolve a caller's speed/reasoning preference against this installed model,
 * not a model-name guess. A level is a transport control, never design evidence. */
export function resolveThinkingControl(requested, metadata) {
  if (requested !== null && requested !== undefined && typeof requested !== 'boolean' &&
      !(typeof requested === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(requested))) throw new Error('Invalid local thinking preference.');
  if (metadata === undefined) return {requested: requested ?? null, selected: requested ?? null, basis: 'legacy-no-metadata'};
  const values = metadata?.values;
  if (!Array.isArray(values) || !values.length || values.length > 16 ||
      values.some(value => typeof value !== 'boolean' && !(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(value))) ||
      new Set(values).size !== values.length || !values.includes(metadata.default)) throw new Error('Invalid local model thinking metadata.');
  let selected;
  if (requested === null || requested === undefined) selected = metadata.default;
  else if (values.includes(requested)) selected = requested;
  else if (requested === false) selected = values.includes('low') ? 'low' : metadata.default;
  else if (requested === true) selected = metadata.default;
  else throw new Error('The installed local model does not support the requested thinking level.');
  return {requested: requested ?? null, selected, supported: [...values], basis: 'installed-model-metadata'};
}
