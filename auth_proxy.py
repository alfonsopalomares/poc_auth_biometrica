#!/usr/bin/env python3
import base64
import os
import sys
from http import HTTPStatus
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit
# Bind to 0.0.0.0 to listen on all available network interfaces (IPv4 and IPv6)
HOST = os.environ.get("AUTH_PROXY_HOST", "0.0.0.0")
PORT = int(os.environ.get("AUTH_PROXY_PORT", "8080"))
AUTH_USER = os.environ.get("AUTH_USER", "charly")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "V3l3z")
FRONTEND_UPSTREAM = os.environ.get("FRONTEND_UPSTREAM", "http://127.0.0.1:5174")
BACKEND_UPSTREAM = os.environ.get("BACKEND_UPSTREAM", "http://127.0.0.1:8000")


class AuthProxyHandler(BaseHTTPRequestHandler):
    server_version = "AuthProxy/1.0"

    def do_GET(self):
        self._handle_request("GET")

    def do_HEAD(self):
        self._handle_request("HEAD")

    def do_POST(self):
        self._handle_request("POST")

    def do_PUT(self):
        self._handle_request("PUT")

    def do_PATCH(self):
        self._handle_request("PATCH")

    def do_DELETE(self):
        self._handle_request("DELETE")

    def do_OPTIONS(self):
        self._handle_request("OPTIONS")

    def log_message(self, format, *args):
        return

    def _handle_request(self, method):
        if not self._is_authorized():
            body = b"Unauthorized: provide basic authentication credentials."
            self.send_response(HTTPStatus.UNAUTHORIZED)
            self.send_header("WWW-Authenticate", 'Basic realm="PoC"')
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        self._proxy_request(method)

    def _is_authorized(self):
        expected = f"{AUTH_USER}:{AUTH_PASSWORD}".encode("utf-8")
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Basic "):
            return False
        try:
            value = base64.b64decode(auth_header.split(" ", 1)[1]).decode("utf-8")
        except Exception:
            return False
        return value == expected.decode("utf-8")

    def _proxy_request(self, method):
        target = (
            BACKEND_UPSTREAM
            if self.path.startswith("/api/") or self.path.startswith("/admin")
            else FRONTEND_UPSTREAM
        )
        parsed = urlsplit(target)
        conn = HTTPConnection(parsed.hostname or "127.0.0.1", parsed.port or 80, timeout=5)
        body = b""
        content_length = self.headers.get("Content-Length")
        if content_length:
            body = self.rfile.read(int(content_length))

        headers = {}
        for name, value in self.headers.items():
            lower = name.lower()
            if lower in {"host", "authorization", "connection", "keep-alive", "transfer-encoding"}:
                continue
            headers[name] = value

        try:
            conn.request(method, self.path, body=body, headers=headers)
            response = conn.getresponse()
            self.send_response(response.status)

            for header, value in response.getheaders():
                lower = header.lower()
                if lower in {"transfer-encoding", "connection", "content-length"}:
                    continue
                self.send_header(header, value)

            body_bytes = response.read()
            if method != "HEAD":
                self.send_header("Content-Length", str(len(body_bytes)))
                self.end_headers()
                if body_bytes:
                    self.wfile.write(body_bytes)
            else:
                self.end_headers()
        finally:
            conn.close()


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), AuthProxyHandler)
    print(f"auth-proxy listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
