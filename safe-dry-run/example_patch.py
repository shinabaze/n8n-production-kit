"""A patch script with the bug safe-dry-run is for: it writes even on --check.

    python example_patch.py --check    refused at the PUT, exit 3
    python example_patch.py            replaces the code of the "Say Hello" node

Any other flag, a typo included, is refused before anything runs (exit 2).

N8N_URL, N8N_API_KEY and WORKFLOW_ID point it at an n8n. demo.py runs it against a fake one.
"""
import safe_dry_run  # noqa: F401  must come first: it guards every request made after it
import json
import os
import sys
import urllib.request

BASE = os.environ.get("N8N_URL", "http://localhost:5678").rstrip("/")
WORKFLOW_ID = os.environ.get("WORKFLOW_ID", "demo")
# Its own earlier version. Naming it here is what lets this script remove it.
OLD_MARKER = "patch: greeting-v1"
NEW_CODE = "// patch: greeting-v2\nreturn [{ json: { greeting: 'hello from the patch' } }];"


def call(method, path, body=None):
    request = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-N8N-API-KEY": os.environ.get("N8N_API_KEY", ""), "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read() or b"{}")


workflow = call("GET", f"/api/v1/workflows/{WORKFLOW_ID}")
node = next(n for n in workflow["nodes"] if n["name"] == "Say Hello")
print("now:", node["parameters"]["jsCode"].splitlines()[0])
node["parameters"]["jsCode"] = NEW_CODE
if "--check" in sys.argv:
    print("check: would replace that code")  # the bug: it carries on to the PUT below
call("PUT", f"/api/v1/workflows/{WORKFLOW_ID}",
     {key: workflow[key] for key in ("name", "nodes", "connections", "settings")})
print("updated workflow", WORKFLOW_ID)
