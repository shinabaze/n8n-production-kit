#!/usr/bin/env bash
# Imports the four demo workflows into a throwaway n8n container and runs each one.
# CI runs it on every push. Locally: bash scripts/n8n-smoke.sh (needs Docker).
set -euo pipefail

IMAGE="${N8N_IMAGE:-n8nio/n8n:2.43.7}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="n8n-kit-smoke-$$"
NAME="n8n-kit-smoke-$$"
SECRET="smoke-secret-$$"
OUT="$(mktemp -d)"
ENV=(-e N8N_BLOCK_ENV_ACCESS_IN_NODE=false -e HOOK_SECRET="$SECRET" -e LLM_KEY_1=not-a-real-key
  -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false)

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

n8n() { docker run --rm -v "$VOLUME:/home/node/.n8n" -v "$ROOT:/kit:ro" "${ENV[@]}" "$IMAGE" "$@"; }

docker volume create "$VOLUME" >/dev/null
for demo in llm-failover webhook-guard safe-dry-run workflow-lint; do
  n8n import:workflow --input="/kit/$demo/demo-workflow.json"
done
n8n list:workflow | tee "$OUT/list.txt"
id_of() { grep -F "|$1" "$OUT/list.txt" | head -1 | cut -d'|' -f1; }

# A failed run exits non-zero, which is the point for the lint demo, so keep going.
run() {
  set +e
  n8n execute --id="$(id_of "$1")" --rawOutput >"$OUT/$2.out" 2>&1
  echo $? >"$OUT/$2.code"
  set -e
}
run "Demo: LLM failover" failover
run "Demo: safe dry run target" dry-run
run "Demo: fan-in (fails on purpose)" fan-in

python3 - "$OUT" <<'PY'
import json, pathlib, sys

out = pathlib.Path(sys.argv[1])

def result(name):
    text = (out / f"{name}.out").read_text()
    code = int((out / f"{name}.code").read_text())
    return text, code

def run_data(name):
    text, code = result(name)
    start = text.find("{")
    if code != 0 or start < 0:
        sys.exit(f"FAIL: {name} did not run cleanly (exit {code}):\n{text[-3000:]}")
    data, _ = json.JSONDecoder().raw_decode(text[start:])
    return data["data"]["resultData"]["runData"]

def items(runs, node):
    return runs[node][0]["data"]["main"][0] if node in runs else []

runs = run_data("failover")
failed, answered = items(runs, "Failed"), items(runs, "Answer")
assert len(failed) == 2 and not answered, (len(failed), len(answered))
for item in failed:
    assert item["json"]["question"], item
    assert "LLM failover" in item["json"]["reason"], item
    print("llm-failover: error branch got:", item["json"]["question"], "|", item["json"]["reason"][:90])

runs = run_data("dry-run")
assert items(runs, "Say Hello")[0]["json"]["greeting"] == "hello"
print("safe-dry-run: the target workflow runs")

text, code = result("fan-in")
assert code != 0 and "Fetch Refunds" in text, f"exit {code}:\n{text[-3000:]}"
print("workflow-lint: the fan-in demo fails as it should, on Fetch Refunds")
PY

guard="$(id_of "Demo: webhook guard")"
n8n publish:workflow --id="$guard" || n8n update:workflow --id="$guard" --active=true
docker run -d --name "$NAME" -p 5678:5678 -v "$VOLUME:/home/node/.n8n" "${ENV[@]}" "$IMAGE" >/dev/null

call() {
  curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5678/webhook/guarded-demo \
    -H 'Content-Type: application/json' "$@" -d '{}' || true
}
right=000
for _ in $(seq 60); do
  right="$(call -H "x-hook-secret: $SECRET")"
  case "$right" in 000|404) sleep 2 ;; *) break ;; esac
done
wrong="$(call -H "x-hook-secret: not-the-secret")"
none="$(call)"
echo "webhook-guard: right secret $right, wrong secret $wrong, no header $none"
if [ "$right $wrong $none" != "200 403 403" ]; then
  docker logs "$NAME" 2>&1 | tail -40
  echo "FAIL: expected 200 403 403"
  exit 1
fi

sleep 3 # let the refused runs finish saving
docker stop "$NAME" >/dev/null
docker cp "$NAME:/home/node/.n8n/database.sqlite" "$OUT/database.sqlite"
python3 - "$OUT/database.sqlite" "$guard" <<'PY'
import sqlite3, sys

rows = sqlite3.connect(sys.argv[1]).execute(
    "select status from execution_entity where workflowId = ? order by id", (sys.argv[2],)).fetchall()
statuses = [r[0] for r in rows]
print("webhook-guard: executions saved as", statuses)
assert statuses == ["success", "error", "error"], statuses
PY
echo "all four demos ran in $IMAGE"
