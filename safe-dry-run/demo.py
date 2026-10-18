"""Runs example_patch.py four ways against a fake n8n and prints what the guard did.

    python safe-dry-run/demo.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import fake_n8n

HERE = Path(__file__).parent
DEMO = json.loads((HERE / "demo-workflow.json").read_text(encoding="utf-8"))


def run(title, flags=(), workflow=DEMO, expect=0):
    server, url, requests, _ = fake_n8n.start(workflow)
    try:
        result = subprocess.run(
            [sys.executable, str(HERE / "example_patch.py"), *flags], capture_output=True, text=True,
            env={**os.environ, "N8N_URL": url, "SAFE_DRY_RUN": ""}, timeout=60)
    finally:
        server.shutdown()
        server.server_close()
    print(f"{title}\n  exit {result.returncode}, requests the fake n8n saw: "
          + (" ".join(method for method, _ in requests) or "none"))
    for line in (result.stdout + result.stderr).strip().splitlines():
        print("  | " + line)
    print()
    return result.returncode == expect


# The same workflow after another patch has changed the node this script rewrites.
patched = json.loads(json.dumps(DEMO))
say = next(n for n in patched["nodes"] if n["name"] == "Say Hello")
say["parameters"]["jsCode"] = "// patch: retry-fix-v1\n" + say["parameters"]["jsCode"]

results = [
    run("1. --check, and the script tries to PUT anyway", ["--check"], expect=3),
    run("2. a typo in the flag", ["--chek"], expect=2),
    run("3. the real run", expect=0),
    run("4. the real run, after another patch changed the same node", workflow=patched, expect=4),
]
sys.exit(0 if all(results) else 1)
