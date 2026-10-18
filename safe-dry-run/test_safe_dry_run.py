import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_n8n  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORKFLOW = {
    "name": "Hello",
    "nodes": [
        {"name": "Run", "type": "n8n-nodes-base.manualTrigger", "parameters": {}},
        {"name": "Say Hello", "type": "n8n-nodes-base.code",
         "parameters": {"jsCode": "return [{ json: { greeting: 'hello' } }];"}},
    ],
    "connections": {"Run": {"main": [[{"node": "Say Hello", "type": "main", "index": 0}]]}},
    "settings": {"executionOrder": "v1"},
}


def run_patch(*flags, workflow=WORKFLOW, env=None):
    """Run example_patch.py against a fake n8n. Returns (exit code, output, requests, state)."""
    server, url, requests, state = fake_n8n.start(workflow)
    try:
        result = subprocess.run(
            [sys.executable, os.path.join(HERE, "example_patch.py"), *flags],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "N8N_URL": url, "SAFE_DRY_RUN": "", **(env or {})})
    finally:
        server.shutdown()
        server.server_close()
    return result.returncode, result.stdout + result.stderr, requests, state


def with_marker(name):
    workflow = {**WORKFLOW, "nodes": [dict(n, parameters=dict(n["parameters"])) for n in WORKFLOW["nodes"]]}
    say = workflow["nodes"][1]["parameters"]
    say["jsCode"] = f"// patch: {name}\n" + say["jsCode"]
    return workflow


class SafeDryRun(unittest.TestCase):
    def test_apply_writes(self):
        code, out, requests, state = run_patch()
        self.assertEqual(code, 0, out)
        self.assertIn(("PUT", "/api/v1/workflows/demo"), requests)
        self.assertIn("greeting-v2", state["workflow"]["nodes"][1]["parameters"]["jsCode"])

    def test_check_cannot_write(self):
        code, out, requests, state = run_patch("--check")
        self.assertEqual(code, 3, out)
        self.assertIn("refused PUT /api/v1/workflows/demo", out)
        self.assertEqual([m for m, _ in requests], ["GET"])
        self.assertEqual(state["workflow"], WORKFLOW)

    def test_unknown_flag_runs_nothing(self):
        code, out, requests, _ = run_patch("--chek")
        self.assertEqual(code, 2, out)
        self.assertIn("unknown flag: --chek", out)
        self.assertEqual(requests, [])

    def test_read_only_is_inherited_through_the_environment(self):
        code, out, requests, _ = run_patch(env={"SAFE_DRY_RUN": "1"})
        self.assertEqual(code, 3, out)
        self.assertNotIn("PUT", [m for m, _ in requests])

    def test_put_that_drops_another_patch_is_refused(self):
        code, out, requests, state = run_patch(workflow=with_marker("retry-fix-v1"))
        self.assertEqual(code, 4, out)
        self.assertIn("would remove retry-fix-v1", out)
        self.assertNotIn("PUT", [m for m, _ in requests])
        self.assertIn("retry-fix-v1", state["workflow"]["nodes"][1]["parameters"]["jsCode"])

    def test_a_marker_the_script_names_may_go(self):
        code, out, _, state = run_patch(workflow=with_marker("greeting-v1"))
        self.assertEqual(code, 0, out)
        self.assertNotIn("greeting-v1", state["workflow"]["nodes"][1]["parameters"]["jsCode"])

    def test_marker_loss_can_be_allowed_on_purpose(self):
        code, out, _, _ = run_patch(workflow=with_marker("retry-fix-v1"), env={"ALLOW_MARKER_LOSS": "retry-fix-v1"})
        self.assertEqual(code, 0, out)


class Rules(unittest.TestCase):
    def setUp(self):
        import safe_dry_run
        self.guard = safe_dry_run

    def test_what_counts_as_a_write(self):
        self.assertTrue(self.guard.is_write("PUT", "/anything"))
        self.assertTrue(self.guard.is_write("delete", "/api/v1/workflows/1"))
        self.assertTrue(self.guard.is_write("POST", "/api/v1/workflows/1/activate"))
        self.assertFalse(self.guard.is_write("POST", "/webhook/run-report"))
        self.assertFalse(self.guard.is_write("GET", "/api/v1/workflows/1"))

    def test_a_flag_must_be_named_exactly(self):
        self.assertTrue(self.guard.mentions('if "--check" in sys.argv', "--check"))
        self.assertFalse(self.guard.mentions('if "--checksum" in sys.argv', "--check"))


class Demo(unittest.TestCase):
    def test_demo_shows_all_four_outcomes(self):
        result = subprocess.run([sys.executable, os.path.join(HERE, "demo.py")],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
