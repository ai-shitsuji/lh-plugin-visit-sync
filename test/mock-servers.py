"""ローカル検証用の偽サーバー。本体(L Harness)の /api/friends と外部ソースを模す。個人情報なし。"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

U = lambda ch: "U" + ch * 32
FRIENDS = [
    {"id": "f1", "lineUserId": U("a"), "displayName": None, "metadata": {"visitCount": 2}, "lineAccountId": "acc1", "tags": [], "isFollowing": True},
    {"id": "f2", "lineUserId": U("b"), "displayName": None, "metadata": {"visitCount": 5, "lastVisitAt": "2026-09-01"}, "lineAccountId": "acc1", "tags": [], "isFollowing": True},
    {"id": "f3", "lineUserId": U("c"), "displayName": None, "metadata": {}, "lineAccountId": "acc1", "tags": [], "isFollowing": True},
]
WRITES = []
SOURCE = {"items": [
    {"lineUserId": U("a"), "visitCount": 3, "lastVisitAt": "2026-09-11", "firstVisitAt": "2025-01-10"},
    {"lineUserId": U("b"), "visitCount": 5, "lastVisitAt": "2026-09-01"},
    {"lineUserId": U("d"), "visitCount": 9},
    {"lineUserId": "bogus", "visitCount": 1},
], "nextCursor": None}

def read_body(h):
    """Content-Length でも chunked でも本文を読む（workerd の fetch は chunked を使うことがある）。"""
    if h.headers.get("Transfer-Encoding", "").lower() == "chunked":
        out = b""
        while True:
            line = h.rfile.readline().strip()
            n = int(line.split(b";")[0] or b"0", 16)
            if n == 0:
                h.rfile.readline(); break
            out += h.rfile.read(n); h.rfile.readline()
        return out
    n = int(h.headers.get("Content-Length") or 0)
    return h.rfile.read(n) if n else b""

class LH(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if self.headers.get("Authorization") != "Bearer test-key": return self._send(401, {"success": False, "error": "unauthorized"})
        if u.path == "/api/friends":
            limit = int(q.get("limit", ["100"])[0]); offset = int(q.get("offset", ["0"])[0])
            items = FRIENDS[offset:offset+limit]
            return self._send(200, {"success": True, "data": {"items": items, "total": len(FRIENDS), "hasNextPage": offset+limit < len(FRIENDS)}})
        if u.path == "/__writes": return self._send(200, WRITES)
        self._send(404, {"success": False, "error": "not found"})
    def do_PUT(self):
        u = urlparse(self.path)
        if self.headers.get("Authorization") != "Bearer test-key": return self._send(401, {"success": False})
        if u.path.startswith("/api/friends/") and u.path.endswith("/metadata"):
            fid = u.path.split("/")[3]; body = json.loads(read_body(self) or b"{}")
            WRITES.append({"id": fid, "fields": body})
            for f in FRIENDS:
                if f["id"] == fid: f["metadata"] = {**f["metadata"], **body}; return self._send(200, {"success": True, "data": f})
            return self._send(404, {"success": False, "error": "Friend not found"})
        self._send(404, {"success": False})

class SRC(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer src-token":
            self.send_response(401); self.end_headers(); return
        b = json.dumps(SOURCE).encode(); self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

if __name__ == "__main__":
    lh = HTTPServer(("127.0.0.1", 8790), LH); src = HTTPServer(("127.0.0.1", 8791), SRC)
    threading.Thread(target=src.serve_forever, daemon=True).start()
    print("mock LH :8790 / mock source :8791", flush=True)
    lh.serve_forever()
