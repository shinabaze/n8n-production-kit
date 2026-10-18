"""A stand-in for the n8n REST API: one workflow in memory and a log of every request.
The tests and demo.py use it, so nothing here needs a real n8n."""
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def start(workflow, workflow_id="demo"):
    """Serve `workflow` on a free port. Returns (server, base_url, requests, state)."""
    state = {"workflow": copy.deepcopy(workflow)}
    requests = []
    path = f"/api/v1/workflows/{workflow_id}"

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            requests.append(("GET", self.path))
            if self.path == path:
                self.reply(200, state["workflow"])
            else:
                self.reply(404, {"message": "not found"})

        def do_PUT(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            requests.append(("PUT", self.path))
            state["workflow"].update(body)
            self.reply(200, state["workflow"])

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}", requests, state
