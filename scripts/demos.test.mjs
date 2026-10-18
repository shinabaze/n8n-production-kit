import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS, read } from './sync-demos.mjs';
import { lint } from '../workflow-lint/lint.mjs';

const demo = (path) => JSON.parse(read(path));

test('each demo workflow carries the exact code of its tool', () => {
  for (const { demo: path, node, source } of PAIRS) {
    const code = demo(path).nodes.find((n) => n.name === node).parameters.jsCode;
    assert.equal(code, read(source), `${path} is stale: run node scripts/sync-demos.mjs`);
  }
});

test('the demo workflows pass the lint', () => {
  for (const path of ['llm-failover', 'webhook-guard', 'safe-dry-run']) {
    assert.deepEqual(lint(demo(`${path}/demo-workflow.json`)), [], path);
  }
});

test("the lint's own demo fails on fan-in, as it should", () => {
  assert.deepEqual(lint(demo('workflow-lint/demo-workflow.json')).map((p) => p.rule), ['fan-in']);
});
