#!/usr/bin/env python3
"""A 40-line backend that satisfies doc.player's contract, so the player can be
run and tested with no mindX at all. Serves the project directory as static
files and answers /listen/* with a manifest plus real ogg bytes."""
import http.server, json, math, os, socketserver, struct, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = [{"n": 1, "file": "part-01.ogg", "words": 221, "seconds": 12.0,
          "bytes": 34560, "codec": "opus", "backend": "mock:tone"},
         {"n": 2, "file": "part-02.ogg", "words": 480, "seconds": 24.0,
          "bytes": 69120, "codec": "opus", "backend": "mock:tone"}]

def wav(seconds, freq=180.0, sr=22050):
    n = int(seconds * sr)
    data = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * i / sr))) for i in range(n))
    hdr = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
           + b"data" + struct.pack("<I", len(data)))
    return hdr + data

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith("/listen/"):
            tail = u.path.split("/listen/", 1)[1]
            if tail.endswith(".ogg"):
                sec = next((p["seconds"] for p in PARTS if p["file"] in tail), 12.0)
                body = wav(min(sec, 6))          # short, so a test is quick
                self.send_response(200); self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(body))); self.end_headers()
                self.wfile.write(body); return
            body = json.dumps({"doc": tail, "state": "ready", "key": "mock",
                               "manifest": {"doc": tail, "parts": PARTS, "complete": True,
                                            "voice": None, "rate": None}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body); return
        return super().do_GET()
    def log_message(self, *a): pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", port), H) as s:
    print(f"doc.player mock on http://127.0.0.1:{port}/examples/standalone.html")
    s.serve_forever()
