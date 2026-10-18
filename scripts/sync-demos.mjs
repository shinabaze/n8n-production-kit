// Copies each Code node's source file into its demo workflow, so the two never drift.
// node scripts/sync-demos.mjs    (scripts/demos.test.mjs fails when you forget)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PAIRS = [
  { demo: 'llm-failover/demo-workflow.json', node: 'LLM Failover', source: 'llm-failover/failover.js' },
  { demo: 'webhook-guard/demo-workflow.json', node: 'Verify Hook Secret', source: 'webhook-guard/guard.js' },
];
const root = new URL('../', import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const { demo, node, source } of PAIRS) {
    const workflow = JSON.parse(read(demo));
    workflow.nodes.find((n) => n.name === node).parameters.jsCode = read(source);
    writeFileSync(new URL(demo, root), `${JSON.stringify(workflow, null, 2)}\n`);
    console.log(`${demo}: "${node}" now carries ${source}`);
  }
}
