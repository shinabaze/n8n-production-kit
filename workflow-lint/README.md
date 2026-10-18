# workflow-lint

Checks exported n8n workflows for three mistakes that fail without an error. Node 22 or
later, nothing to install.

```bash
node workflow-lint/lint.mjs my-workflow.json
node workflow-lint/lint.mjs exports/        # every .json file in a folder
n8n export:workflow --all --output=all.json && node workflow-lint/lint.mjs all.json
```

It exits 0 when every workflow is clean, 1 when a rule fails, and 2 on bad usage, so it can
sit in CI next to your exported workflows.

## The rules

**fan-in.** A node that gets input from two or more nodes, in a workflow with
`executionOrder: v1`, which n8n sets on every new workflow. Merge and Loop Over Items are
allowed, since they are built for it, and triggers do not count, since one fires per run.
v1 runs each branch to the end before it starts the next. So the node runs as soon as the
first branch reaches it, and again for each other branch. If it reads another branch with
`$('Name')`, that branch has not run yet and the node fails. If it does not, it runs twice.

```
Every Morning ─┬─ Fetch Orders ──┐
               └─ Fetch Refunds ─┴─ Build Report     fails: Fetch Refunds has not run yet
Every Morning ── Fetch Orders ── Fetch Refunds ── Build Report     fixed: one chain
```

**email-credential.** An email node (Send Email, Gmail, Outlook) with no credential. It
fails when it runs. With On Error set to continue, the run is green and nobody gets the
email.

**batched-autodetect.** An HTTP Request node with Batching on and Response Format left on
autodetect. Autodetect reads each response as a stream, and with batching the early
responses wait while later requests go out. On n8n 2.x I watched a stalled body leave a
run stuck on "running" for days, with no error. Setting Response Format to JSON fixed it.

## Try it

```bash
node workflow-lint/lint.mjs workflow-lint/fixtures
```

Three fixtures fail, one rule each, and `clean.json` passes. To watch fan-in fail inside
n8n itself, import [`demo-workflow.json`](demo-workflow.json) and run it.

## Limits

- Three rules, no config, and no way to silence one.
- It reads the export, not the live instance, so a credential that is attached but broken
  looks fine.
- A node that is meant to run once per branch still gets flagged.

## Tests

```bash
node --test workflow-lint/lint.test.mjs
```
