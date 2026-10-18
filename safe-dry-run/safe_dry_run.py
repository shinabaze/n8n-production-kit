"""Import this first in any script that changes an n8n instance. Importing is enough.

* An unknown --flag stops the script before anything runs (exit 2). A flag counts as
  known when the script's own source mentions it, so a typo like --chek can never fall
  through to "apply".
* Under --check or --dry-run, PUT, PATCH and DELETE anywhere, and POST to the n8n API,
  are refused (exit 3).
* A PUT that replaces a workflow is refused when it would drop a "patch: <name>"
  marker that the script does not name itself (exit 4).
"""
import http.client
import json
import os
import re
import sys

READ_ONLY_FLAGS = ("--check", "--dry-run")
MARKER = re.compile(r"\bpatch:\s*([a-z0-9][a-z0-9._-]*)")
WORKFLOW_PATH = re.compile(r"^/api/v1/workflows/([A-Za-z0-9]+)$")

_script = os.path.abspath(sys.argv[0]) if sys.argv and sys.argv[0].endswith(".py") else ""
try:
    SOURCE = open(_script, encoding="utf-8").read() if _script else ""
except OSError:
    SOURCE = ""
FLAGS = [a.split("=", 1)[0] for a in sys.argv[1:] if a.startswith("--")]
# A child process started by a check inherits it, so a check cannot shell out to an apply.
READ_ONLY = any(f in READ_ONLY_FLAGS for f in FLAGS) or os.environ.get("SAFE_DRY_RUN") == "1"
if READ_ONLY:
    os.environ["SAFE_DRY_RUN"] = "1"


def refuse(message, code):
    sys.stdout.flush()
    sys.stderr.write(message + "\n")
    raise SystemExit(code)


def mentions(text, token):
    # "--check" must not count as mentioned just because "--checksum" is.
    return re.search(re.escape(token) + r"(?![\w-])", text) is not None


def check_flags(flags=FLAGS, source=SOURCE):
    unknown = [f for f in flags if not mentions(source, f)]
    if source and unknown:
        refuse(f"unknown flag: {' '.join(unknown)} (nothing was run)", 2)


def is_write(method, path):
    method = method.upper()
    if method in ("PUT", "PATCH", "DELETE"):
        return True
    return method == "POST" and path.startswith("/api/v1/")


def markers(workflow):
    return set(MARKER.findall(json.dumps(workflow.get("nodes", []))))


def check_put(workflow_id, live, new, source=SOURCE):
    allowed = set(MARKER.findall(source))
    allowed |= {m for m in os.environ.get("ALLOW_MARKER_LOSS", "").split(",") if m}
    lost = sorted(markers(live) - markers(new) - allowed)
    if lost:
        refuse(f"refused: this PUT to workflow {workflow_id} would remove {', '.join(lost)}, "
               "which another patch put there. Revert that patch first, or, if losing it is "
               f"intended, run again with ALLOW_MARKER_LOSS={','.join(lost)}", 4)


def _read_live(conn, url, headers):
    other = conn.__class__(conn.host, conn.port, timeout=30)
    try:
        other.request("GET", url, headers={k: v for k, v in headers.items() if k.lower() != "content-length"})
        resp = other.getresponse()
        data = resp.read()
    finally:
        other.close()
    if resp.status != 200:
        refuse(f"refused: could not read the workflow before replacing it (GET {resp.status})", 4)
    return json.loads(data)


_putrequest = http.client.HTTPConnection.putrequest
_request = http.client.HTTPConnection.request


def _guarded_putrequest(self, method, url, *args, **kwargs):
    # Every client built on http.client starts a request here, whatever wraps it.
    path = url.split("?", 1)[0]
    if READ_ONLY and is_write(method, path):
        why = " ".join(f for f in FLAGS if f in READ_ONLY_FLAGS) or "SAFE_DRY_RUN=1"
        refuse(f"read-only ({why}): refused {method} {path}, nothing was written", 3)
    return _putrequest(self, method, url, *args, **kwargs)


def _guarded_request(self, method, url, body=None, headers=None, **kwargs):
    match = WORKFLOW_PATH.match(url.split("?", 1)[0])
    if match and method.upper() == "PUT" and not READ_ONLY:
        check_put(match.group(1), _read_live(self, url, headers or {}), json.loads(body))
    return _request(self, method, url, body=body, headers=headers or {}, **kwargs)


def install():
    if getattr(http.client.HTTPConnection, "_safe_dry_run", False):
        return
    http.client.HTTPConnection.putrequest = _guarded_putrequest
    http.client.HTTPConnection.request = _guarded_request
    http.client.HTTPConnection._safe_dry_run = True


check_flags()
install()
