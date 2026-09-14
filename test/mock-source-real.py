"""test100 の実在する友だち1人の lineUserId(ローカルファイルから読む)で来店実績を返す偽ソース。書き込みはプラグイン側の DRY_RUN で抑止。"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
uid = open("test/.friend_uid").read().strip()
FEED = {"items": [{"lineUserId": uid, "visitCount": 3, "lastVisitAt": "2026-09-13", "firstVisitAt": "2026-08-21"},
                  {"lineUserId": "U" + "f" * 32, "visitCount": 1}], "nextCursor": None}
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer src-token": self.send_response(401); self.send_header("Content-Length","0"); self.end_headers(); return
        b = json.dumps(FEED).encode(); self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
HTTPServer(("127.0.0.1", 8791), H).serve_forever()
