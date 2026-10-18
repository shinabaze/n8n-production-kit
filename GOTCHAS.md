# n8n gotchas

n8n behaviours that each cost me hours, because each one looks like success. For each one:
what you see, why it happens, and what to do. I hit these on self-hosted n8n. Behaviour
changes between versions, so treat each as something to test on yours.

## A green node is not a working node

With On Error set to "Continue (regular output)", a node that fails still shows green and
passes an item on, with the failure tucked inside `json.error`. An expired OAuth
credential, a bad request, a dead API key: all green. Test the side effect (the email
arrived, the row exists), not the tick. Where a failure matters, use "Continue (using error
output)" and wire the error branch to something that tells you.

## A batched HTTP node on autodetect can hang for ever

An HTTP Request node with Batching on and Response Format on autodetect reads each body
as a stream, and only after every batched request has been sent. A body that stalls
half-read can leave the run "running" for days with no error. Set Response Format to JSON
or Text on any node that batches. [workflow-lint](workflow-lint/) checks for it.

## A node with two inputs runs before the second one arrives

Under `executionOrder: v1`, the default for new workflows, each branch runs to the end
before the next starts. A node fed by two branches runs when the first reaches it, and
`$('Other Branch')` throws because that node has not run yet. Chain the branches or put a
Merge node in front. [workflow-lint](workflow-lint/) checks for this too.

## A run that times out is "canceled", not failed

The workflow setting Timeout Workflow ends a long run as `canceled`, with no error. The
error workflow does not fire, so a hang you capped is now a hang nobody hears about.
Watch for canceled runs as well as failed ones.

## Retry On Fail reruns the whole node

When the first output item is an error, Retry On Fail runs the whole node again, for every
item. On a node that walks many items or many keys, that repeats all of them. Retry inside
the code, per item, or not at all.

## An IF node can get a true boolean wrong

A Code node returns `passed: true`, the IF node checks "is true", and the item still goes
down the false branch, because of how the IF node converts and compares types. Have the
Code node emit a string, `passed: 'yes'` or `'no'`, and compare strings.

## `URL` may not exist in a Code node

In the Code node sandbox I hit, `new URL(...)` was not defined, so a `try { new URL(u) }`
always fell into the `catch`. A check like "is this link allowed?" then failed on every
link. Parse with a regex instead, or check that `URL` exists before you rely on it.

## Never sleep in a Code node

Code nodes share one task runner. A node that waits with `setTimeout` to pace its calls
holds the runner, other workflows' Code nodes wait behind it, and the runner can start
refusing tasks. Put rate limits in the HTTP node's Batching option, and give any loop in a
Code node a wall-clock deadline.

## After an email node, `$json` is the SMTP result

The item that comes out of Send Email is the mail server's reply, not the data you sent
in. A node after it that reads `$json.email` gets nothing. Read the earlier node by name:
`$('Build Email').item.json`.

## `$('Node').first()` inside a loop is the first pass

Inside a loop, `$('Some Node').first()` returns that node's first run every time, so pass
3 reads pass 1's data. Use `$runIndex` for the pass number, and read the current item from
`$json`.

## Thinking tokens count against the output limit

On LLMs that think before they answer, the thinking counts toward `maxOutputTokens`. A JSON
answer then stops halfway with `finishReason: MAX_TOKENS`. For structured output, turn
thinking off where the model allows it. Some models reject the thinking setting with a 400,
so it belongs with the model, not in every request.

## Set a real timeout on LLM calls

I had LLM calls on a 30 second timeout. The first call after a quiet spell sometimes took
longer and failed, and the error read like a rate limit. Use 60 seconds or more for LLM
calls.

## n8n can hide the provider's error

When an API returns a 4xx, the HTTP node's error can be n8n's own text (for a 429, a hint to
space your requests out) instead of the provider's message, which names the exact limit
you hit. Send the same request with curl or a short script to see the real body.

## "Respond Immediately" answers 200 even when the workflow refuses

A Webhook node on "Respond: Immediately" answers 200 before any other node runs. If a guard
after it refuses the call, the caller still sees 200. Check the execution, or respond from
a Respond to Webhook node. [webhook-guard](webhook-guard/) explains both.

## A connection to a deleted node stops every run

If a workflow's connections still name a node that no longer exists (easy to do through
the API), every run fails before the first node, and a webhook answers "Workflow could not
be started!". Compare the connection names with the node names first.

## The executions API leaves out running runs

`GET /api/v1/executions` does not list running executions unless you ask for
`status=running`. Ask for `status=running` and `status=waiting` as well before you decide
a workflow never ran.

## Send Email ignores the old field names

Send Email version 2.1 reads `emailFormat` and `html` or `text`. A node still carrying the
older `emailType` and `message` keys sends an empty body, or fails at send time. Re-create
the node, or rename the keys.
