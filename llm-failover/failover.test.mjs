import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCodeNode } from '../harness/code-node.mjs';

const SOURCE = readFileSync(new URL('./failover.js', import.meta.url), 'utf8');
const ENV = { LLM_KEY_1: 'value-1', LLM_KEY_2: 'value-2', LLM_KEY_3: 'value-3' };
const FLASH = 'gemini-flash-latest';
const LITE = 'gemini-flash-lite-latest';
const ANSWER = { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };

// A fake API. `replies` maps "model|key value" or "model" to a status, 'hang', 'slow'
// or a response body. Anything not listed answers 200.
function fakeApi(replies = {}) {
  const calls = [];
  async function httpRequest(opts) {
    const model = opts.url.match(/models\/([^:]+):/)[1];
    const key = opts.headers['x-goog-api-key'];
    calls.push(`${model}|${key}`);
    const reply = replies[`${model}|${key}`] ?? replies[model] ?? 200;
    if (reply === 'hang') throw new Error(`timeout of ${opts.timeout}ms exceeded`);
    if (reply === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { statusCode: 503, body: { error: { message: 'overloaded' } } };
    }
    if (typeof reply === 'object') return { statusCode: 200, body: reply };
    return { statusCode: reply, body: reply === 200 ? ANSWER : { error: { message: `status ${reply}` } } };
  }
  return { httpRequest, calls };
}

const items = (n) => Array.from({ length: n }, (_, i) => ({ json: { id: i, request: { contents: [] } } }));
const run = (api, n = 1, extra = {}) => runCodeNode(SOURCE, { items: items(n), env: ENV, httpRequest: api.httpRequest, ...extra });

test('a 429 moves to the next key on the same model', async () => {
  const api = fakeApi({ [`${FLASH}|value-1`]: 429 });
  const [out] = await run(api);
  assert.deepEqual(api.calls, [`${FLASH}|value-1`, `${FLASH}|value-2`]);
  assert.equal(out.json._failover.model, FLASH);
  assert.equal(out.json._failover.key, 'LLM_KEY_2');
});

test('a bad key reported as a 400 still counts as a key problem', async () => {
  const api = fakeApi();
  const original = api.httpRequest;
  api.httpRequest = async (opts) => (opts.headers['x-goog-api-key'] === 'value-1'
    ? { statusCode: 400, body: { error: { message: 'API key not valid' } } }
    : original(opts));
  const [out] = await run(api);
  assert.equal(out.json._failover.key, 'LLM_KEY_2');
  assert.equal(out.json._failover.model, FLASH);
});

test('a 400 moves to the next model without trying the other keys', async () => {
  const api = fakeApi({ [FLASH]: 400 });
  const [out] = await run(api);
  assert.deepEqual(api.calls, [`${FLASH}|value-1`, `${LITE}|value-1`]);
  assert.equal(out.json._failover.model, LITE);
});

test('a 200 with no text counts as the model failing, and says why', async () => {
  const api = fakeApi({ [FLASH]: { candidates: [{ finishReason: 'SAFETY' }] } });
  const [out] = await run(api);
  assert.equal(out.json._failover.model, LITE);
  assert.match(out.json._failover.failedBefore[0], /EMPTY SAFETY/);
});

test('two hangs on a model move to the next model, not to the third key', async () => {
  const api = fakeApi({ [FLASH]: 'hang' });
  await run(api);
  assert.deepEqual(api.calls, [`${FLASH}|value-1`, `${FLASH}|value-2`, `${LITE}|value-1`]);
});

test('what the first item learns, the other items skip', async () => {
  const api = fakeApi({ [`${FLASH}|value-1`]: 429, [`${FLASH}|value-2`]: 429, [`${FLASH}|value-3`]: 'hang' });
  const out = await run(api, 10);
  assert.equal(api.calls.length, 13); // 4 for the first item, then 1 each
  assert.ok(out.every((o) => o.json._failover.model === LITE));
});

test('a failure keeps its pairing and the error shape', async () => {
  const api = fakeApi({ [FLASH]: 500, [LITE]: 500 });
  const out = await run(api, 3);
  out.forEach((o, i) => {
    assert.equal(o.pairedItem.item, i);
    assert.equal(o.json.error.name, 'LLMFailoverError');
    assert.match(o.json.error.message, /every model and key failed/);
  });
  assert.equal(out[0].json.error.attempts.length, 4);
  assert.equal(api.calls.length, 4); // items 2 and 3 make no calls at all
});

test('no key value ever reaches the output', async () => {
  const api = fakeApi({ [`${FLASH}|value-1`]: 429 });
  const out = await run(api, 2);
  assert.doesNotMatch(JSON.stringify(out), /value-\d/);
});

test('with no key set, every item fails without a call', async () => {
  const api = fakeApi();
  const out = await runCodeNode(SOURCE, { items: items(2), env: {}, httpRequest: api.httpRequest });
  assert.equal(api.calls.length, 0);
  assert.ok(out.every((o) => /no key is set/.test(o.json.error.message)));
});

test('an item with no request body fails on its own', async () => {
  const api = fakeApi();
  const out = await runCodeNode(SOURCE, {
    items: [{ json: { request: { contents: [] } } }, { json: {} }], env: ENV, httpRequest: api.httpRequest,
  });
  assert.equal(out[0].json._failover.model, FLASH);
  assert.match(out[1].json.error.message, /no request body/);
});

test('the deadline stops the walk', async () => {
  const api = fakeApi({ [FLASH]: 'slow' });
  const [out] = await run(api, 1, { replace: { 'const DEADLINE_MS = 300000;': 'const DEADLINE_MS = 2000;' } });
  assert.match(out.json.error.message, /deadline of 2000 ms/);
  assert.equal(api.calls.length, 2);
});

test('THROW_ON_FAIL fails the node instead', async () => {
  const api = fakeApi({ [FLASH]: 500, [LITE]: 500 });
  await assert.rejects(
    run(api, 1, { replace: { 'const THROW_ON_FAIL = false;': 'const THROW_ON_FAIL = true;' } }),
    /every model and key failed/,
  );
});
