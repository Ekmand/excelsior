#!/usr/bin/env python3
"""Serve Excelsior on localhost so it can be installed as an app."""

import http.server
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        guessed = super().guess_type(path)
        if str(path).endswith(".webmanifest"):
            if isinstance(guessed, tuple):
                return ("application/manifest+json", None)
            return "application/manifest+json"
        return guessed


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Excelsior is at http://127.0.0.1:{PORT}")
    server.serve_forever()
