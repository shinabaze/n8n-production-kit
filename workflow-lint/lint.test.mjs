import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, main } from './lint.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const rules = (workflow) => lint(workflow).map((p) => `${p.rule}:${p.node}`);

test('each fixture fails its own rule and nothing else', () => {
  assert.deepEqual(rules(fixture('fan-in')), ['fan-in:Build Report']);
  assert.deepEqual(rules(fixture('email-no-credential')), ['email-credential:Send Report']);
  assert.deepEqual(rules(fixture('batched-autodetect')), ['batched-autodetect:Scrape Pages']);
  assert.deepEqual(rules(fixture('clean')), []);
});

test('fan-in is only a problem under executionOrder v1', () => {
  const workflow = fixture('fan-in');
  workflow.settings.executionOrder = 'v0';
  assert.deepEqual(rules(workflow), []);
});

test('a Merge node is allowed to take two inputs', () => {
  const workflow = fixture('fan-in');
  workflow.nodes.find((n) => n.name === 'Build Report').type = 'n8n-nodes-base.merge';
  assert.deepEqual(rules(workflow), []);
});

test('two triggers into one node are fine, since only one fires per run', () => {
  const workflow = fixture('clean');
  workflow.nodes.push({ id: '9', name: 'Run Now', type: 'n8n-nodes-base.webhook', parameters: {} });
  workflow.connections['Run Now'] = { main: [[{ node: 'Fetch Orders', type: 'main', index: 0 }]] };
  assert.deepEqual(rules(workflow), []);
});

test('both outputs of an IF into one node count as fan-in', () => {
  const workflow = fixture('clean');
  workflow.nodes.push({ id: '9', name: 'Has Orders', type: 'n8n-nodes-base.if', parameters: {} });
  workflow.connections['Fetch Orders'] = { main: [[{ node: 'Has Orders', type: 'main', index: 0 }]] };
  workflow.connections['Has Orders'] = { main: [
    [{ node: 'Fetch Refunds', type: 'main', index: 0 }],
    [{ node: 'Fetch Refunds', type: 'main', index: 0 }],
  ] };
  assert.deepEqual(rules(workflow), ['fan-in:Fetch Refunds']);
});

test('a disabled email node is not checked', () => {
  const workflow = fixture('email-no-credential');
  workflow.nodes[1].disabled = true;
  assert.deepEqual(rules(workflow), []);
});

test('a batched node that reads text is fine, an unbatched autodetect node is fine', () => {
  const workflow = fixture('batched-autodetect');
  const node = workflow.nodes[1];
  node.parameters.options.response = { response: { responseFormat: 'text' } };
  assert.deepEqual(rules(workflow), []);
  delete node.parameters.options.response;
  delete node.parameters.options.batching;
  assert.deepEqual(rules(workflow), []);
});

test('the CLI exits 1 on a failing workflow, 0 on a clean one, and reads an --all export', () => {
  const lines = [];
  const log = (line) => lines.push(line);
  const path = (name) => fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  assert.equal(main([path('clean')], log), 0);
  assert.equal(main([path('fan-in')], log), 1);
  assert.equal(main([], log), 2);
  const all = join(mkdtempSync(join(tmpdir(), 'lint-')), 'all.json');
  writeFileSync(all, JSON.stringify([fixture('clean'), fixture('fan-in')]));
  assert.equal(main([all], log), 1);
  assert.match(lines.join('\n'), /\[fixture: fan-in\]: fan-in: "Build Report"/);
});
