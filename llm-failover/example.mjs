// A simulated run of the failover node, no network and no keys: 10 items, three keys, and the
// first model rate-limited on two keys and hanging on the third.
//   node llm-failover/example.mjs
import { readFileSync } from 'node:fs';
import { runCodeNode } from '../harness/code-node.mjs';

const source = readFileSync(new URL('./failover.js', import.meta.url), 'utf8');
const replies = {
  'gemini-flash-latest|key-one': 429,
  'gemini-flash-latest|key-two': 429,
  'gemini-flash-latest|key-three': 'hang',
};
let calls = 0;

async function httpRequest(opts) {
  calls++;
  const model = opts.url.match(/models\/([^:]+):/)[1];
  const reply = replies[`${model}|${opts.headers['x-goog-api-key']}`] ?? 200;
  if (reply === 'hang') throw new Error(`timeout of ${opts.timeout}ms exceeded`);
  if (reply !== 200) return { statusCode: reply, body: { error: { message: 'Resource has been exhausted' } } };
  return { statusCode: 200, body: { candidates: [{ content: { parts: [{ text: `answer ${calls}` }] } }] } };
}

const items = Array.from({ length: 10 }, (_, i) => ({ json: { request: { contents: [{ parts: [{ text: `question ${i + 1}` }] }] } } }));
const env = { LLM_KEY_1: 'key-one', LLM_KEY_2: 'key-two', LLM_KEY_3: 'key-three' };
const out = await runCodeNode(source, { items, env, httpRequest });

out.forEach((o, i) => {
  const f = o.json._failover;
  console.log(`item ${String(i + 1).padStart(2)}: ${f.model} on ${f.key}`);
  for (const attempt of f.failedBefore) console.log(`           after ${attempt}`);
});
console.log(`\n${calls} calls for 10 items. Without sharing what item 1 learned, each item makes 4: 40 calls.`);
