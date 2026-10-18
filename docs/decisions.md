# Decisions

Why the tools are built the way they are. One short paragraph each.

## llm-failover

### A Code node, not the HTTP node's retry

Retry repeats the same key on the same model. When that key is used up, three retries are
three failures. Failover has to change something between attempts, and the HTTP node cannot.

### The first item runs alone

If ten items start together, all ten hit the dead key at the same moment, and the run pays
for ten failures to learn one fact. Running the first item alone costs a little time and
makes every later item start from what it found.

### A 5xx or a hang marks the model, not only the key

A key problem is about that key. An overloaded model is overloaded for every key, so walking
all of them into the same outage only adds timeouts. Two strikes and the model is skipped
for the rest of the run.

### No sleep, and a deadline

Code nodes share one task runner, so a node that waits holds up every other Code node on the
instance. The node never waits between calls, and it stops at its deadline even if keys are
left.

### The output names the key, never its value

Execution data is stored and shown in the editor. A key value in an item is a key value in
the database and on the screen.

### The error item keeps n8n's shape

`{ error: {...} }` with `pairedItem` is what n8n's own nodes produce, so "Continue (using
error output)" routes it, and the error branch can still read the original item's fields.

## webhook-guard

### It fails closed

If `HOOK_SECRET` is missing, a naive check can end up comparing "nothing" with "nothing" and
let the call in. The guard refuses everything until a secret is set.

### No early exit in the compare

A plain string compare can stop at the first wrong character, which in theory tells a caller
how much of a guess was right. Removing that costs nothing.

### A Code node, even though Header Auth exists

Header Auth is better when it fits. The Code node lets one env var guard many workflows, and
it leaves a failed execution behind for every refused call.

## safe-dry-run

### Guard the HTTP layer, not the script

The bug is in the script, so a fix that relies on the script being right does not fix it.
Refusing at `http.client` works however the script is written.

### A flag is known if the source names it

It needs no list of flags to keep up to date. A script that handles `--check` has the string
`--check` in it, and a typo does not.

### Markers live in the code they mark

A comment like `// patch: retry-fix-v1` travels with the node into every export and every
PUT, so the guard can see it in the live workflow without a separate record of what was
applied.

## workflow-lint

### Three rules and no config

Each rule is a mistake I shipped and did not notice at first. A rule I have not seen fail
would be a guess, and a config file is one more thing to keep in step.

## The repo

### The demos are built from the source

`scripts/sync-demos.mjs` copies each Code node's file into its demo workflow, and a test
fails if they differ, so the demo you import is the code that was tested.

### No dependencies

Everything runs on Node and Python's standard libraries, so a fresh clone runs its tests
with no install step and no supply chain to check.
