"""Frac Challenge server: JSON API under /api/ and the static front end (game/web/) at /.

    python game/server.py [--port 8765] [--static DIR] [--no-sim]

Python standard library only. One Julia worker serves every run; runs are serialised.
"""
import argparse
import gzip
import json
import mimetypes
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import careerapi  # noqa: E402
import steerapi  # noqa: E402
import mgapi  # noqa: E402
import engine  # noqa: E402
import levels as lv  # noqa: E402
import sim  # noqa: E402

GAME = Path(__file__).resolve().parent


def make_handler(worker, static_dir):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write("  " + fmt % args + "\n")

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            zipped = len(data) > 2048 and "gzip" in self.headers.get("Accept-Encoding", "")
            if zipped:
                data = gzip.compress(data, compresslevel=5)
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            if zipped:
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send(204, b"", "text/plain")

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/api/status":
                return self._send(200, {"sim": worker.status() if worker else "off"})
            if u.path == "/api/levels":
                return self._send(200, lv.public_levels())
            if u.path == "/api/scores":
                q = parse_qs(u.query)
                return self._send(200, engine.leaderboard(q.get("level", [""])[0]))
            if u.path == "/api/field":
                data = engine.field_payload(parse_qs(u.query).get("run", [""])[0])
                if data is None:
                    return self._send(404, {"ok": False, "errors": ["no field output for this run"]})
                return self._send(200, data)
            if u.path == "/api/careers" or u.path.startswith("/api/career"):
                return self._send(*careerapi.handle("GET", u.path, parse_qs(u.query), {}, worker))
            if u.path.startswith("/api/steer"):
                return self._send(*steerapi.handle("GET", u.path, parse_qs(u.query), {}, worker))
            if u.path == "/api/mg" or u.path.startswith("/api/mg/"):
                return self._send(*mgapi.handle("GET", u.path, parse_qs(u.query), {}, worker))
            if u.path.startswith("/api/"):
                return self._send(404, {"ok": False, "errors": ["no such endpoint"]})
            return self._static(u.path)

        def do_POST(self):
            u = urlparse(self.path)
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"ok": False, "errors": ["body must be JSON"]})
            if not isinstance(body, dict):
                return self._send(400, {"ok": False, "errors": ["body must be a JSON object"]})
            if u.path.startswith("/api/career"):
                return self._send(*careerapi.handle("POST", u.path, {}, body, worker))
            if u.path.startswith("/api/steer"):
                return self._send(*steerapi.handle("POST", u.path, {}, body, worker))
            if u.path.startswith("/api/mg/"):
                return self._send(*mgapi.handle("POST", u.path, {}, body, worker))
            if u.path != "/api/run":
                return self._send(404, {"ok": False, "errors": ["no such endpoint"]})
            if worker is None:
                return self._send(503, {"ok": False, "errors": ["server started with --no-sim"]})
            res = engine.play(worker, body.get("level"), body.get("design"), body.get("player") or "anonymous", record=body.get("record", True) is not False)
            self._send(200 if res.get("ok") else 400, res)

        def _static(self, path):
            root = static_dir.resolve()
            f = (root / path.lstrip("/")).resolve()
            if f.is_dir():
                f = f / "index.html"
            if root not in f.parents and f != root or not f.is_file():
                if path in ("/", "/index.html"):
                    return self._send(200, b"<p>Frac Challenge API is running. The front end goes in game/web/.</p>", "text/html")
                return self._send(404, b"not found", "text/plain")
            self._send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or "application/octet-stream")
    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--static", default=str(GAME / "web"))
    ap.add_argument("--no-sim", action="store_true", help="serve levels and scores only (front-end work without Julia)")
    ap.add_argument("--open", action="store_true", help="open the browser")
    a = ap.parse_args()
    worker = None
    if not a.no_sim:
        worker = sim.Worker()
        worker.start()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(worker, Path(a.static)))
    url = f"http://127.0.0.1:{a.port}/"
    print(f"Frac Challenge on {url}  (simulator warming up; about 10-60 s)", flush=True)
    if a.open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker and worker.stop()


if __name__ == "__main__":
    main()
