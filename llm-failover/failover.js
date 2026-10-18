// LLM call with key and model failover, for an n8n Code node (Run Once for All Items).
// Each input item carries its request body in BODY_FIELD. Paste this whole file into the node.

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']; // in order of preference
const KEY_NAMES = ['LLM_KEY_1', 'LLM_KEY_2', 'LLM_KEY_3']; // env var names, never values
const BODY_FIELD = 'request';
const CALL_TIMEOUT_MS = 60000;
const DEADLINE_MS = 300000; // for the whole node: one slow run must not hold the task runner
const UNWELL_AFTER = 2; // 5xx or timeouts on one model before it is skipped
const CONCURRENCY = 3;
const THROW_ON_FAIL = false; // true fails the node, so the error workflow fires

// The two provider-specific parts. Change these two functions for another API.
function requestFor(model, key, body) {
  return {
    method: 'POST',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body,
  };
}

// null when the response has text, otherwise the reason it has none.
function emptyReason(resp) {
  const candidate = resp?.candidates?.[0];
  if ((candidate?.content?.parts || []).some((p) => p && p.text)) return null;
  return candidate?.finishReason || resp?.promptFeedback?.blockReason || 'no text';
}

const keys = [];
for (const name of KEY_NAMES) {
  let value;
  try { value = $env[name]; } catch (e) { value = undefined; } // n8n can block $env
  if (value && !keys.some((k) => k.value === value)) keys.push({ name, value });
}

const helpers = this.helpers;
const started = Date.now();
const timeLeft = () => DEADLINE_MS - (Date.now() - started);
const spent = new Set(); // "model|key" pairs that already failed in this run
const deadModels = new Set();
const unwell = {};

// What a failed call says about the next attempt.
function classify(status, message) {
  if ([401, 402, 403, 429].includes(status) || /quota|exhausted|api key/i.test(message)) return 'key';
  if (status === 400 || status === 404 || status === 'EMPTY') return 'model';
  return 'unwell'; // 5xx, timeout, network
}

async function callOnce(model, key, body) {
  const timeout = Math.max(1000, Math.min(CALL_TIMEOUT_MS, timeLeft()));
  try {
    const r = await helpers.httpRequest({
      ...requestFor(model, key.value, body),
      json: true, timeout, returnFullResponse: true, ignoreHttpStatusErrors: true,
    });
    if (r.statusCode === 200) {
      const why = emptyReason(r.body);
      return why ? { ok: false, status: 'EMPTY', message: why } : { ok: true, body: r.body };
    }
    return { ok: false, status: r.statusCode, message: String(r.body?.error?.message || r.statusMessage || '') };
  } catch (e) {
    return { ok: false, status: 'NET', message: String(e.message || e) };
  }
}

function failed(i, reason, attempts) {
  const message = `LLM failover: ${reason}`;
  if (THROW_ON_FAIL) throw new Error(`${message} | ${attempts.join(' ; ')}`);
  // The shape n8n's own nodes use, so "Continue (using error output)" routes it.
  return { json: { error: { message, name: 'LLMFailoverError', attempts } }, pairedItem: { item: i } };
}

async function runItem(item, i) {
  const body = item.json?.[BODY_FIELD];
  if (!body || typeof body !== 'object') return failed(i, `no request body in "${BODY_FIELD}"`, []);
  if (!keys.length) return failed(i, `no key is set (${KEY_NAMES.join(', ')})`, []);
  const attempts = [];
  for (const model of MODELS) {
    if (deadModels.has(model)) continue;
    for (const key of keys) {
      if ((unwell[model] || 0) >= UNWELL_AFTER) break;
      if (spent.has(`${model}|${key.name}`)) continue;
      if (timeLeft() < 1000) return failed(i, `deadline of ${DEADLINE_MS} ms reached`, attempts);
      const r = await callOnce(model, key, body);
      if (r.ok) {
        return { json: { ...r.body, _failover: { model, key: key.name, failedBefore: attempts } }, pairedItem: { item: i } };
      }
      attempts.push(`${model}/${key.name}: ${r.status} ${r.message}`.slice(0, 200));
      const kind = classify(r.status, r.message);
      if (kind === 'model') { deadModels.add(model); break; }
      spent.add(`${model}|${key.name}`);
      // A 503 or a hang rarely clears within one run, so it counts against the model too.
      if (kind === 'unwell') unwell[model] = (unwell[model] || 0) + 1;
    }
  }
  return failed(i, 'every model and key failed', attempts);
}

const items = $input.all();
const out = new Array(items.length);
// The first item runs alone and learns which pairs are spent, so the rest do not
// all hit the same dead key at once.
if (items.length) out[0] = await runItem(items[0], 0);
let next = 1;
async function worker() {
  while (next < items.length) {
    const i = next++;
    out[i] = await runItem(items[i], i);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
return out;
