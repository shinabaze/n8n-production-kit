#!/usr/bin/env node
// Checks exported n8n workflows for three mistakes that fail without an error.
// node workflow-lint/lint.mjs <workflow.json | folder> ...   exit 1 when a rule fails
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const isTrigger = (type) => /trigger$/i.test(type) || type === 'n8n-nodes-base.webhook';
// Nodes that are built to take more than one input.
const MANY_INPUTS = new Set(['n8n-nodes-base.merge', 'n8n-nodes-base.splitInBatches']);
const EMAIL_NODES = new Set(['n8n-nodes-base.emailSend', 'n8n-nodes-base.gmail', 'n8n-nodes-base.microsoftOutlook']);

function fanIn(workflow, byName) {
  const sources = new Map();
  for (const [from, outputs] of Object.entries(workflow.connections || {})) {
    const fromNode = byName.get(from);
    if (!fromNode || isTrigger(fromNode.type)) continue; // only one trigger fires per run
    (outputs.main || []).forEach((links, output) => {
      for (const link of links || []) {
        const list = sources.get(link.node) || [];
        const label = output ? `"${from}" (output ${output})` : `"${from}"`;
        if (!list.includes(label)) list.push(label);
        sources.set(link.node, list);
      }
    });
  }
  const problems = [];
  for (const [to, from] of sources) {
    const node = byName.get(to);
    if (from.length < 2 || !node || MANY_INPUTS.has(node.type)) continue;
    problems.push({
      rule: 'fan-in', node: to,
      message: `gets input from ${from.join(', ')}. Under executionOrder v1 it runs as soon as the first of them `
        + 'finishes, and again for each other one, so anything it reads from the others has not run yet. '
        + 'Chain them, or put a Merge node in front.',
    });
  }
  return problems;
}

export function lint(workflow) {
  const nodes = workflow.nodes || [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const problems = (workflow.settings || {}).executionOrder === 'v1' ? fanIn(workflow, byName) : [];
  for (const node of nodes) {
    if (node.disabled) continue;
    if (EMAIL_NODES.has(node.type) && !Object.values(node.credentials || {}).some((c) => c && (c.id || c.name))) {
      problems.push({
        rule: 'email-credential', node: node.name,
        message: 'has no credential. It fails when it runs, and behind "On Error: Continue" that run looks green.',
      });
    }
    const options = node.parameters?.options || {};
    const format = options.response?.response?.responseFormat || 'autodetect';
    if (node.type === 'n8n-nodes-base.httpRequest' && options.batching && format === 'autodetect') {
      problems.push({
        rule: 'batched-autodetect', node: node.name,
        message: 'batches its requests with Response Format on autodetect. Autodetect reads each body as a stream, '
          + 'and a body that stalls can leave the run hanging with no error. Set Response Format to JSON or Text.',
      });
    }
  }
  return problems;
}

function files(paths) {
  return paths.flatMap((p) => (statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => join(p, f))
    : [p]));
}

export function main(args, log = console.log) {
  if (!args.length) {
    log('usage: node workflow-lint/lint.mjs <workflow.json | folder> ...');
    return 2;
  }
  let failing = 0;
  for (const file of files(args)) {
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { log(`${file}: cannot read it: ${e.message}`); failing++; continue; }
    // `n8n export:workflow --all` writes an array; a download from the editor is one object.
    for (const workflow of Array.isArray(data) ? data : [data]) {
      const where = Array.isArray(data) ? `${file} [${workflow.name}]` : file;
      const problems = lint(workflow);
      for (const p of problems) log(`${where}: ${p.rule}: "${p.node}" ${p.message}`);
      if (problems.length) failing++; else log(`${where}: ok`);
    }
  }
  return failing ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
