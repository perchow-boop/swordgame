"""靜態網頁加線上房間。用法：python serve.py"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import secrets
import threading

ROOMS = {}
LOCK = threading.Lock()


def room_key(code):
    key = "".join(ch for ch in str(code or "").upper() if ch.isalnum())[:6]
    if len(key) < 4:
        return None
    return key


def room_of(code, create):
    key = room_key(code)
    if key is None:
        return None, None
    rec = ROOMS.get(key)
    if rec is None and create:
        rec = {"seats": {}, "msgs": [], "n": 0}
        ROOMS[key] = rec
    return key, rec


def read_json(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0 or length > 120000:
        return None
    try:
        return json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/online/poll":
            super().do_GET()
            return
        query = parse_qs(parsed.query)
        room = (query.get("room") or [""])[0]
        token = (query.get("token") or [""])[0]
        try:
            after = int((query.get("after") or ["0"])[0])
        except ValueError:
            after = 0
        with LOCK:
            key, rec = room_of(room, False)
            if key is None or rec is None or token not in rec["seats"].values():
                self.send_json(404, {"error": "room"})
                return
            messages = [item for item in rec["msgs"] if item["n"] > after and item["token"] != token]
            peer = len(rec["seats"]) >= 2
        self.send_json(200, {"peer": peer, "messages": messages})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in ("/api/online/join", "/api/online/send"):
            self.send_error(404)
            return
        body = read_json(self)
        if not isinstance(body, dict):
            self.send_json(400, {"error": "json"})
            return
        with LOCK:
            key, rec = room_of(body.get("room"), parsed.path == "/api/online/join")
            if key is None or rec is None:
                self.send_json(400, {"error": "room"})
                return
            if parsed.path == "/api/online/join":
                seat = body.get("seat")
                if seat not in ("p1", "p2"):
                    self.send_json(400, {"error": "seat"})
                    return
                token = str(body.get("token") or "")
                current = rec["seats"].get(seat)
                if current and current != token:
                    self.send_json(409, {"error": "taken", "seat": seat})
                    return
                if not token:
                    token = secrets.token_hex(8)
                rec["seats"][seat] = token
                self.send_json(200, {"token": token, "seat": seat, "peer": len(rec["seats"]) >= 2})
                return
            token = str(body.get("token") or "")
            if token not in rec["seats"].values():
                self.send_json(404, {"error": "room"})
                return
            message = body.get("message")
            if not isinstance(message, dict) or not message.get("type"):
                self.send_json(400, {"error": "message"})
                return
            rec["n"] += 1
            rec["msgs"].append({"n": rec["n"], "token": token, "body": message})
            if len(rec["msgs"]) > 300:
                rec["msgs"] = rec["msgs"][-300:]
            self.send_json(200, {"n": rec["n"]})

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and args[0].startswith("GET /api/online/poll"):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8765), Handler)
    print("膠劍仔線上房 http://127.0.0.1:8765")
    server.serve_forever()
