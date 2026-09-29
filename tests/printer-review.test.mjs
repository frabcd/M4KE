import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createLanMonitor, packet } from '../printing/lan-monitor.mjs';
import { createPrinterService } from '../server/studio-printer.mjs';

const raw = Buffer.from('review synthetic certificate, not a real printer');
const serial = 'REVIEW123456';
const cert = { raw, subject: { CN: serial }, valid_from: 'Jan 1 2020 GMT', valid_to: 'Jan 1 2040 GMT' };
const config = { model: 'bambu-a1-mini', ip: '192.168.8.8', serial, fingerprint: createHash('sha256').update(raw).digest('hex'), accessCode: 'TESTONLY', trustConfirmed: true };
function transport(script = () => {}, { delayHandshake = false } = {}) {
  const state = { writes: [] };
  state.connect = (_options, ready) => {
    const socket = new EventEmitter(); state.socket = socket; state.ready = ready;
    socket.getPeerCertificate = () => cert;
    socket.write = b => { state.writes.push(b); queueMicrotask(() => script(b, socket)); };
    socket.end = b => { state.writes.push(b); };
    socket.destroy = () => { socket.destroyed = true; };
    if (!delayHandshake) queueMicrotask(ready);
    return socket;
  };
  return state;
}
const mqttString = text => { const b = Buffer.from(text); const n = Buffer.alloc(2); n.writeUInt16BE(b.length); return Buffer.concat([n, b]); };

test('printer review: timeout cannot permit a later TLS callback to send credentials', async () => {
  const f = transport(() => {}, { delayHandshake: true }); const run = createLanMonitor({ connect: f.connect, timeoutMs: 10 });
  await assert.rejects(run('check', config), /timed out/); assert.equal(f.socket.destroyed, true);
  f.ready(); // A cancelled/late handshake must remain a no-op.
  assert.equal(f.writes.length, 0, 'No CONNECT or access-code packet after operation completion');
});

test('printer review: fragmented CONNACK and QoS1 report emit ACK, never PUBLISH', async () => {
  const f = transport((b, socket) => {
    if (b[0] === 0x10) for (const byte of packet(0x20, Buffer.from([0, 0]))) socket.emit('data', Buffer.from([byte]));
    if (b[0] === 0x82) {
      socket.emit('data', packet(0x90, Buffer.from([0, 1, 0])));
      const value = { print: { gcode_state: 'IDLE', nozzle_temper: 24, accessCode: config.accessCode, gcode_file: 'private-project.3mf' }, user: 'private-user' };
      socket.emit('data', packet(0x32, Buffer.concat([mqttString(`device/${serial}/report`), Buffer.from([0, 7]), Buffer.from(JSON.stringify(value))])));
    }
  });
  const result = await createLanMonitor({ connect: f.connect })('check', config);
  assert.deepEqual(f.writes.map(b => b[0] >> 4), [1, 8, 4, 14]);
  assert.deepEqual(f.writes[2], packet(0x40, Buffer.from([0, 7])));
  assert.deepEqual(result.report, { state: 'IDLE', nozzle_temper: 24 });
  for (const secret of [config.accessCode, 'private-project', 'private-user']) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('printer review: remote error strings cannot disclose a code or raw device data', async () => {
  const f = transport((_b, socket) => socket.emit('error', new Error(`remote message ${config.accessCode}`)));
  await assert.rejects(createLanMonitor({ connect: f.connect })('check', config), error => !error.message.includes(config.accessCode) && /TLS connection failed/.test(error.message));
  assert.equal(f.socket.destroyed, true);
});

test('printer review: response failure still clears parsed HTTP access code', async () => {
  const input = { ...config };
  const service = createPrinterService({ body: async () => input, operate: async () => ({ status: 'fixture' }), json: () => { throw Error('client disconnected'); } });
  await assert.rejects(service({ method: 'POST', headers: { 'content-type': 'application/json' } }, {}, '/api/studio/printer/check'), /disconnected/);
  assert.equal(input.accessCode, '');
});
