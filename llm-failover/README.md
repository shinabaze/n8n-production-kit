# llm-failover

A Code node that calls an LLM and keeps going when a key or a model fails. It tries the
next key on the same model first, then the next model. It has one deadline for the whole
node and it never sleeps.

I wrote it after the model I relied on stopped answering on every key I had, while a
smaller model answered on all of them. A plain HTTP node with one key fails in that case,
and so does its retry, because it retries the same key on the same model.

## Use it

1. Add a Code node, mode "Run Once for All Items", and paste in [`failover.js`](failover.js).
2. Put your keys in the n8n environment as `LLM_KEY_1`, `LLM_KEY_2`, `LLM_KEY_3`. Set
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, or Code nodes cannot read them.
3. Give each input item its request body in a field called `request`.
4. Set the node's On Error to "Continue (using error output)" and wire the second output
   to whatever should handle a failure.

Or import [`demo-workflow.json`](demo-workflow.json) and run it. With no key set, both items
go to the Failed branch with the reason, which shows the error output working.

## What each failure means

| The call returned | What that says | Next try |
|---|---|---|
| 429, 401, 402, 403, or a message about quota or the API key | this key is used up on this model | next key, same model |
| 400, 404, or a 200 with no text in it | this model cannot do this request | next model |
| a 5xx, a timeout or a network error | the model looks unwell | next key, and after two of these, next model |

What the first item learns, the others use. The first item runs alone. Then the rest run
three at a time, and no item calls a key and model pair that already failed in this run.

## Worked example

`node llm-failover/example.mjs` simulates 10 items and three keys. The first model is
rate-limited on two keys and hangs on the third:

```
item  1: gemini-flash-lite-latest on LLM_KEY_1
           after gemini-flash-latest/LLM_KEY_1: 429 Resource has been exhausted
           after gemini-flash-latest/LLM_KEY_2: 429 Resource has been exhausted
           after gemini-flash-latest/LLM_KEY_3: NET timeout of 60000ms exceeded
item  2: gemini-flash-lite-latest on LLM_KEY_1
...
item 10: gemini-flash-lite-latest on LLM_KEY_1

13 calls for 10 items. Without sharing what item 1 learned, each item makes 4: 40 calls.
```

In a real run that hang costs the full 60 second timeout once, not ten times.

## What comes out

A success is the provider's response with `_failover: { model, key, failedBefore }` added.
`key` is the name of the env var, never its value. A failure is
`{ error: { message, name, attempts } }`, paired to its input item. That is the shape n8n
sends to the error output. Set `THROW_ON_FAIL = true` to fail the node instead, so your
error workflow fires.

The settings are at the top of the file: the models in order, the key names, the body
field, the call timeout (60 s), the node deadline (5 min), how many 5xx or timeouts skip a
model (2), and how many items run at once (3).

## Another provider

The request shape is Gemini's. To use another API, change `requestFor` and `emptyReason`.
Nothing else in the file knows which provider it is talking to.

## Limits

- A 400 moves to the next model. That is right when one model rejects a field another
  accepts. A request that is wrong for every model fails on every model, so read `attempts`.
- A key that hit a per-minute limit stays skipped until the next run, even if the limit
  clears in 30 seconds.
- Each call's timeout is cut to the time left, so the node stops within about a second of
  its deadline, not exactly on it.

## Tests

```bash
node --test llm-failover/failover.test.mjs
```
