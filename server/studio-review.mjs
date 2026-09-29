import {createHash} from 'node:crypto';
import {buildReviewMessages} from './studio-skills.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clip = (value, limit) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length <= limit ? text : text.slice(0, limit) + ' [detail omitted; not evidence of completeness]';
};
const keys = (value, allowed, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${name}: unknown field or invalid object`);
};
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}: nonempty text <= ${max} characters required`);
  return value.trim();
};

export function reviewSchema(spec, maxConcerns = 6) {
  const ids = spec.requirements.map(r => r.id);
  return {type: 'object', additionalProperties: false, required: ['summary', 'concerns'], properties: {
    summary: {type: 'string'},
    concerns: {type: 'array', minItems: 0, maxItems: maxConcerns, items: {type: 'object', additionalProperties: false,
      required: ['requirementId', 'severity', 'problem', 'suggestedTest', 'missingEvidence'], properties: {
        requirementId: {type: 'string', enum: ids}, severity: {type: 'string', enum: ['critical', 'major', 'minor']},
        problem: {type: 'string'}, suggestedTest: {type: 'string'},
        missingEvidence: {type: 'array', minItems: 1, maxItems: 3, items: {type: 'string'}},
      }},
    },
  }};
}

export function validateAdvisory(value, spec, maxConcerns = 6) {
  keys(value, ['summary', 'concerns'], 'review');
  const summary = text(value.summary, 900, 'summary');
  if (!Array.isArray(value.concerns) || value.concerns.length > maxConcerns) throw new Error(`concerns: expected at most ${maxConcerns}`);
  const ids = new Set(spec.requirements.map(r => r.id));
  const concerns = value.concerns.map((c, index) => {
    keys(c, ['requirementId', 'severity', 'problem', 'suggestedTest', 'missingEvidence'], `concern ${index}`);
    if (!ids.has(c.requirementId)) throw new Error('Concern references an unknown requirement ID');
    if (!['critical', 'major', 'minor'].includes(c.severity)) throw new Error('Invalid concern severity');
    if (!Array.isArray(c.missingEvidence) || c.missingEvidence.length < 1 || c.missingEvidence.length > 3) throw new Error('missingEvidence must contain 1..3 items');
    return {requirementId: c.requirementId, severity: c.severity,
      problem: text(c.problem, 420, 'problem'), suggestedTest: text(c.suggestedTest, 420, 'suggestedTest'),
      missingEvidence: c.missingEvidence.map(item => text(item, 180, 'missingEvidence item'))};
  });
  return {summary, concerns};
}

export function compactReviewContext(spec, report) {
  const checks = Array.isArray(report?.claims) ? report.claims : [];
  return {
    spec: {title: spec.title, description: spec.description, units: spec.units,
      requirements: spec.requirements, assumptions: spec.assumptions, unknowns: spec.unknowns,
      parts: spec.parts.map(p => ({id: p.id, name: p.name, kind: p.kind, material: p.material,
        shape: p.shape, position: p.position, rotation: p.rotation,
        ...(p.holes?.length ? {holes: p.holes} : {}), ...(p.pockets?.length ? {pockets: p.pockets} : {}),
        source: clip(p.source || 'No source provided', 300)})),
      assembly: spec.assembly.map(s => ({id: s.id, partIds: s.partIds, requires: s.requires, instructions: s.instructions, checks: s.checks})),
      physicsInputs: spec.physicsInputs,
      electrical: spec.electrical||null,
      verificationRequests: spec.verificationRequests || [],
    },
    report: {revisionHash: report.revisionHash, overall: report.overall, physical: report.physical,
      fullReportSha256: hash(report),
      scope: 'Every requirement and host check ID/status is retained. Repeated PASS geometry details are omitted; this compact review is advisory, not complete acceptance coverage.',
      checkIndex: checks.map(c => ({id: c.id, status: c.status, critical: Boolean(c.critical)})),
      unresolvedChecks: checks.filter(c => c.status !== 'PASS').map(c => ({id: c.id, label: c.label, status: c.status, critical: Boolean(c.critical), method: clip(c.method, 220), observed: clip(c.observed, 450), required: clip(c.required, 250), details: clip(c.details, 400)})),
      conditionalCalculations: checks.filter(c => c.status === 'PASS' && /motion|traction|current|rolling|electrical|beam|runtime|sound/.test(c.id)).map(c => ({id: c.id, status: c.status, method: clip(c.method, 350), observed: c.observed, details: clip(c.details, 400)})),
      limitations: report.limitations,
    },
  };
}

function metrics(response) {
  return Object.fromEntries(['model', 'created_at', 'done', 'done_reason', 'total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration'].filter(key => Object.hasOwn(response || {}, key)).map(key => [key, response[key]]));
}

export async function runAdvisoryReview({spec, report, skills, model, endpoint, infer}) {
  const attempts = [];
  const base = {model: model || null, skillHash: skills?.hashes?.verify || null,
    doesNotChangeEvidence: true, physical: 'UNKNOWN', attempts};
  const unavailable = reason => ({...base, status: 'unavailable', summary: 'Local advisory review unavailable: ' + reason, concerns: [], structuredConcerns: [], suggestedTests: []});
  if (!model || !endpoint || typeof infer !== 'function') return unavailable('local model is not configured. Deterministic evidence is unchanged.');
  let messages;
  try {
    const context = compactReviewContext(spec, report);
    messages = buildReviewMessages({...context, skills});
    messages[0].content += '\n\nBounded advisory response: inspect every supplied requirement, then return at most 6 highest-impact concerns. Do not repeat per-part PASS geometry. Preserve UNKNOWN as missing evidence, not proven failure. Use a <=50-word advisory summary; each problem and suggestedTest should be <=35 words; missingEvidence should be 1–3 short phrases. Aim below 900 output tokens. No Markdown, status fields, rewritten design or evidence overrides. Omitted concerns do not mean those requirements passed. Distinguish nominal-voltage motion calculations from output-disabled bench firmware/PWM commissioning; do not invent firmware settings not supplied.';
    base.contextSha256 = hash(messages);
    base.contextCharacters = messages.reduce((n, m) => n + m.content.length, 0);
  } catch (error) { return unavailable(error.message); }
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxConcerns = attempt ? 3 : 6;
    const requestMessages = attempt ? [...messages,
      {role: 'user', content: JSON.stringify({retry: true, validationError: attempts.at(-1).error,
        instruction: 'The previous response was invalid or truncated. Return a shorter complete JSON object: at most 3 highest-impact concerns, at most 2 missing-evidence phrases per concern, short summary. Do not reproduce the previous output; do not change any host status.'})}] : messages;
    const request = {model, stream: false, think: false, format: reviewSchema(spec, maxConcerns), messages: requestMessages,
      options: {temperature: 0, num_ctx: 16384, num_predict: attempt ? 2400 : 1800}};
    const record = {number: attempt + 1, requestSha256: hash(request), schemaSha256: hash(request.format),
      maxConcerns, numPredict: request.options.num_predict, raw: null, metrics: null, error: null};
    attempts.push(record);
    const started = Date.now();
    try {
      const response = await infer(endpoint, '/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)}, 120000);
      record.metrics = metrics(response);
      record.raw = typeof response?.message?.content === 'string' ? response.message.content : null;
      if (record.raw === null) throw new Error('Missing response.message.content');
      if (record.raw.length > 20000) throw new Error('Review output exceeds bounded 20KB text limit');
      if (response.done_reason === 'length') throw new Error('Model output was truncated at its token limit');
      const validated = validateAdvisory(JSON.parse(record.raw), spec, maxConcerns);
      if (!validated.concerns.length && report.claims?.some(c => c.critical && c.status !== 'PASS')) throw new Error('Empty concerns omit unresolved critical host evidence');
      record.elapsedMs = Date.now() - started;
      return {...base, status: 'advisory', summary: validated.summary, structuredConcerns: validated.concerns,
        concerns: validated.concerns.map(c => `${c.severity} · ${c.requirementId}: ${c.problem}`),
        suggestedTests: validated.concerns.map(c => c.suggestedTest)};
    } catch (error) { record.error = String(error.message).slice(0, 2000); record.elapsedMs = Date.now() - started; }
  }
  return unavailable('two bounded attempts failed validation; see retained attempt output and errors. Deterministic evidence is unchanged.');
}
