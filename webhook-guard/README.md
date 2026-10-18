# webhook-guard

A Code node that refuses a webhook call unless its `x-hook-secret` header matches
`HOOK_SECRET` in the n8n environment. It compares without an early exit, and it refuses
everything when the secret is not set.

A webhook path is easy to guess. If the workflow behind it sends email or calls a paid
API, anyone who finds the path can make it do that.

## Use it

1. Set `HOOK_SECRET` (a long random string) and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` in the
   n8n environment.
2. Put a Code node straight after the Webhook node and paste in [`guard.js`](guard.js).
3. Callers send the header:

```bash
curl -X POST https://your-n8n/webhook/your-path \
  -H "x-hook-secret: $HOOK_SECRET" -H "Content-Type: application/json" -d '{}'
```

`guard.js` only runs inside a Code node, so `node guard.js` fails. Or import
[`demo-workflow.json`](demo-workflow.json), activate it and call
`/webhook/guarded-demo` with and without the header.

## Why a refused call still gets 200

When the Webhook node's Respond setting is "Immediately", n8n answers 200 the moment the
request arrives. The guard runs after that. So a refused call gets the same 200 as an
accepted one, and the refusal only shows in the execution: it ends in an error on the
guard node. When you test the guard, look at the execution, not the status code.

If callers need a real 403, do what the demo does:

- set the Webhook's Respond to "Using 'Respond to Webhook' Node";
- set the guard's On Error to "Continue (using error output)";
- answer 403 from the error branch, then end the run with Stop and Error, so each refusal
  still shows as a failed execution.

## Or use the Webhook node's Header Auth

The Webhook node can check a header itself (Authentication: Header Auth). It answers 403
and never starts an execution. Use that when it fits. I use this Code node when the same
secret guards many workflows from one env var, so rotating it is one change, and when I
want every refused call in the executions list as a record that someone tried.

## Limits

- JavaScript makes no timing promises. The compare removes the early exit a plain `===`
  can take, but network jitter is far larger than either.
- The secret's length is not hidden.
- One shared secret is not per-caller access. Anyone who has it can call every workflow it
  guards.

## Tests

```bash
node --test webhook-guard/guard.test.mjs
```
