# Explained, for someone new to n8n

This page covers the few n8n ideas the tools depend on, with examples you can follow by
hand.

## Items, Code nodes and pairing

n8n passes **items** from node to node. An item is a small object, `{ json: {...} }`. A node
gets a list of items and returns a list of items.

A **Code node** runs your JavaScript. In "Run Once for All Items" mode it gets every item at
once through `$input.all()` and returns a new list. Each returned item can say which input
item it came from with `pairedItem: { item: 0 }`. Later nodes use that link: in the
llm-failover demo, the Answer node reads `$('Build Requests').item.json.question`, and n8n
follows the pairing back to the right question.

A node's **On Error** setting decides what a failure does. "Stop Workflow" ends the run.
"Continue (regular output)" passes the failure on as if it were data. "Continue (using error
output)" gives the node a second output, and failed items go there.

## Why a webhook answers 200 when it refuses

Follow this by hand with the webhook-guard demo, but with the Webhook node's Respond set to
"Immediately":

1. A caller sends `POST /webhook/guarded-demo` with no `x-hook-secret` header.
2. n8n receives it and, because Respond is "Immediately", sends back 200 straight away.
3. Only now does the workflow start. The guard reads the headers, finds no secret, and throws.
4. The execution ends with status Error, on the Verify Hook Secret node.

The caller saw 200 in step 2. The refusal happened in step 3, after the caller had its
answer. That is why the demo uses a Respond to Webhook node instead: the answer is sent
after the guard, so a refused call gets 403.

## Why a node with two inputs fails under executionOrder v1

Take `workflow-lint/fixtures/fan-in.json`:

```
Every Morning ─┬─ Fetch Orders ──┐
               └─ Fetch Refunds ─┴─ Build Report
```

v1 runs one branch to its end before it starts the next, top branch first. By hand:

1. Every Morning fires.
2. The top branch starts: Fetch Orders runs.
3. Its next node is Build Report, so Build Report runs now. Fetch Refunds has not run.
4. Build Report reads `$('Fetch Refunds')` and fails.

If Build Report did not read Fetch Refunds, it would succeed here, and then run a second
time when the bottom branch reaches it. Either way it does not run once with
both results. Chaining the fetches fixes it: Every Morning, Fetch Orders, Fetch Refunds,
Build Report.

## Failover by hand

Three items, keys K1 and K2, models A then B. Model A answers 429 on K1 and 503 on K2.

| Call | Item | Model, key | Result | What the node learns |
|---|---|---|---|---|
| 1 | 1 | A, K1 | 429 | A with K1 is used up |
| 2 | 1 | A, K2 | 503 | A with K2 is out, and A has one strike |
| 3 | 1 | B, K1 | 200 | item 1 done |
| 4 | 2 | B, K1 | 200 | item 2 skipped A entirely |
| 5 | 3 | B, K1 | 200 | item 3 too |

Five calls for three items. Item 1 paid for what the others knew.

## What a dry run is for

A patch script changes a live workflow. Its `--check` mode should show what it would change
and change nothing, so you can run it first. If the check can write by mistake, the one time
you run it to be careful is the time it does damage. safe-dry-run makes a write during a
check impossible, rather than unlikely.
