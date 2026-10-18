import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCodeNode } from '../harness/code-node.mjs';

const SOURCE = readFileSync(new URL('./guard.js', import.meta.url), 'utf8');
const SECRET = 'correct-horse-battery-staple';
const call = (headers, env = { HOOK_SECRET: SECRET }) =>
  runCodeNode(SOURCE, { items: [{ json: { headers, body: { order: 42 } } }], env });

test('the right secret passes the item through unchanged', async () => {
  const out = await call({ 'x-hook-secret': SECRET });
  assert.deepEqual(out, [{ json: { headers: { 'x-hook-secret': SECRET }, body: { order: 42 } } }]);
});

test('a wrong secret is refused', async () => {
  await assert.rejects(call({ 'x-hook-secret': 'correct-horse-battery-stapl3' }), /Unauthorized/);
});

test('a prefix or a longer value is refused', async () => {
  await assert.rejects(call({ 'x-hook-secret': SECRET.slice(0, 10) }), /Unauthorized/);
  await assert.rejects(call({ 'x-hook-secret': `${SECRET}x` }), /Unauthorized/);
});

test('a missing header is refused', async () => {
  await assert.rejects(call({}), /Unauthorized/);
  await assert.rejects(runCodeNode(SOURCE, { items: [{ json: {} }], env: { HOOK_SECRET: SECRET } }), /Unauthorized/);
});

test('with no secret set, even an empty header is refused', async () => {
  await assert.rejects(call({ 'x-hook-secret': '' }, {}), /HOOK_SECRET is not set/);
});

test('when n8n blocks $env, the guard refuses rather than opening up', async () => {
  const blocked = new Proxy({}, { get() { throw new Error('access to env vars denied'); } });
  await assert.rejects(call({ 'x-hook-secret': SECRET }, blocked), /HOOK_SECRET is not set/);
});
