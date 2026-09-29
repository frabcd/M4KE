import {gzip as gzipCallback} from 'node:zlib';
import {promisify} from 'node:util';

const gzip = promisify(gzipCallback);
const TYPES = new Set(['model/stl','application/json','application/javascript','text/javascript','application/x-javascript','text/css']);

function header(headers, name) {
  const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

function setHeader(headers, name, value) {
  for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  headers[name] = value;
}

function acceptsGzip(value) {
  const codings = new Map();
  for (const item of String(Array.isArray(value) ? value.join(',') : value ?? '').split(',')) {
    const [rawName, ...parameters] = item.trim().toLowerCase().split(';');
    const name = rawName.trim();
    if (name !== 'gzip' && name !== '*') continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/.exec(parameter);
      if (match) quality = Math.min(quality, /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]) ? Number(match[1]) : 0);
    }
    // Conflicting duplicates fail closed; an explicit gzip exclusion wins over '*'.
    codings.set(name, Math.min(codings.get(name) ?? 1, quality));
  }
  return (codings.get('gzip') ?? codings.get('*') ?? 0) > 0;
}

/** Send already-verified artifact bytes. Caller retains its existing 64 MiB read limit.
 * HTTP content coding changes only transport bytes: canonical files and hashes stay intact.
 */
export async function sendArtifact(req, res, bytes, headers = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Artifact bytes must be a Buffer or Uint8Array.');
  const outputHeaders = {...headers};
  const vary = String(header(outputHeaders, 'Vary') ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (!vary.includes('*') && !vary.some(item => item.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
  setHeader(outputHeaders, 'Vary', vary.join(', '));
  const type = String(header(outputHeaders, 'Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  let body = bytes;
  if (bytes.byteLength >= 65536 && TYPES.has(type) && !header(outputHeaders, 'Content-Encoding') &&
      !header(outputHeaders, 'Content-Range') && acceptsGzip(header(req.headers ?? {}, 'Accept-Encoding'))) {
    body = await gzip(bytes, {level: 4});
    setHeader(outputHeaders, 'Content-Encoding', 'gzip');
    setHeader(outputHeaders, 'Content-Length', body.byteLength);
    for (const key of Object.keys(outputHeaders)) if (key.toLowerCase() === 'transfer-encoding') delete outputHeaders[key];
  }
  res.writeHead(200, outputHeaders);
  res.end(req.method === 'HEAD' ? undefined : body);
}
