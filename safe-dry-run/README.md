# safe-dry-run

One import that makes a Python script's `--check` unable to write. Put it first in any
script that changes an n8n instance through its REST API.

```python
import safe_dry_run  # noqa: F401
```

After that line:

| You run | What happens |
|---|---|
| `--check` or `--dry-run` | PUT, PATCH and DELETE, and any POST to `/api/v1/`, are refused before they leave the machine. Exit 3. |
| a flag the script never mentions, like `--chek` | Nothing runs. Exit 2. |
| a real run whose PUT would drop another patch's marker | That PUT is refused. Exit 4. |

## Why

A check that writes is worse than no check, because you run it exactly when you do not
want a write. The cause is usually one line: a script that tests for `--apply` and treats
anything else as a check, or the reverse, or a check branch that prints what it would do
and then carries on. Review misses it. This guard does not rely on the script being right.
It refuses the write at the HTTP layer.

## Try it

```bash
python safe-dry-run/demo.py
```

It runs [`example_patch.py`](example_patch.py), a script with exactly that bug, four ways
against a fake n8n:

```
1. --check, and the script tries to PUT anyway
  exit 3, requests the fake n8n saw: GET
  | read-only (--check): refused PUT /api/v1/workflows/demo, nothing was written

2. a typo in the flag
  exit 2, requests the fake n8n saw: none

3. the real run
  exit 0, requests the fake n8n saw: GET GET PUT

4. the real run, after another patch changed the same node
  exit 4, requests the fake n8n saw: GET GET
  | refused: this PUT to workflow demo would remove retry-fix-v1, which another patch put there. ...
```

To run it against a real n8n, import [`demo-workflow.json`](demo-workflow.json), create an
API key (Settings, n8n API), and run:

```bash
N8N_URL=http://localhost:5678 N8N_API_KEY=... WORKFLOW_ID=<id> python safe-dry-run/example_patch.py --check
```

## Markers

A script that PUTs a whole workflow, or rewrites a whole node, can erase a change another
script made since. So each patch leaves a marker as a comment in the code it changes, for
example `// patch: retry-fix-v1`. Before a PUT to `/api/v1/workflows/<id>`, the guard reads
the live workflow and refuses if a marker would disappear that the running script does not
name in its own source. A script names its own markers, older versions included, so it can
replace its own work and nothing else. To drop one on purpose, set
`ALLOW_MARKER_LOSS=retry-fix-v1`.

## How it works

It wraps two methods of `http.client.HTTPConnection`, which urllib and requests (through
urllib3) both use. A read-only run also sets `SAFE_DRY_RUN=1` in the environment, so a script
that a check starts is read-only too.

## Limits

- Only HTTP through `http.client`. A script that shells out to curl, writes files or talks
  to a database directly is not covered.
- A POST to a webhook is allowed during a check, because checks often probe one. If that
  webhook sends email, it sends email.
- A flag counts as known if it appears anywhere in the script, comments included.
- With `requests`, the read-only rule works but the marker check does not, because
  requests sends its body through a different method. Call `safe_dry_run.check_put()`
  yourself before the PUT.

## Tests

```bash
python -m unittest discover -s safe-dry-run
```
