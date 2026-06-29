#!/usr/bin/env python3
"""
Space Rocks score server — zero extra dependencies (Python stdlib only).

Usage:
    python3 server.py          # listens on port 8765
    python3 server.py 9000     # custom port
"""

import http.server
import json
import os
import sqlite3
import sys
import threading
from pathlib import Path

PORT    = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DIR     = Path(__file__).parent
DB_PATH = DIR / 'scores.db'
_lock   = threading.Lock()

# ── Database ──────────────────────────────────────────────────────────────────

def open_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scores (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            score      INTEGER NOT NULL,
            created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    conn.commit()
    return conn

def top_scores(conn, limit=10):
    rows = conn.execute(
        'SELECT name, score, created_at FROM scores ORDER BY score DESC LIMIT ?',
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]

# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Only log API calls, not every static file request
        if '/api/' in self.path:
            print(f'[API] {self.command} {self.path} — {args[1]}')

    def do_OPTIONS(self):
        self._cors(200)

    def do_GET(self):
        if self.path == '/api/scores':
            with _lock:
                conn = open_db()
                data = top_scores(conn)
                conn.close()
            self._json(200, data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/scores':
            length = int(self.headers.get('Content-Length', 0))
            raw    = self.rfile.read(length)
            try:
                body  = json.loads(raw)
                name  = str(body.get('name', '')).strip().upper()[:12]
                score = int(body.get('score', 0))
                # Keep only safe characters in the name
                name  = ''.join(c for c in name if c.isalnum() or c in ' ._-') or 'PILOT'
                score = max(0, score)
            except Exception:
                self._json(400, {'error': 'invalid payload'})
                return

            with _lock:
                conn = open_db()
                conn.execute('INSERT INTO scores (name, score) VALUES (?, ?)', (name, score))
                conn.commit()
                data = top_scores(conn)
                conn.close()
            self._json(200, data)
        else:
            self._json(404, {'error': 'not found'})

    def _cors(self, status):
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Ensure the DB exists before the first request
    with _lock:
        conn = open_db()
        conn.close()

    server = http.server.ThreadingHTTPServer(('', PORT), Handler)
    print(f'Space Rocks  ▶  http://localhost:{PORT}')
    print(f'Scores DB    ▶  {DB_PATH}')
    print('Press Ctrl+C to stop.\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
