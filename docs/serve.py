#!/usr/bin/env python3
"""Simple SPA dev server - serves index.html for all non-file routes."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3333
DIR = os.path.dirname(os.path.abspath(__file__))

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        # Strip query string for file lookup
        path = self.path.split('?')[0]
        file_path = os.path.join(DIR, path.lstrip('/'))
        if os.path.isfile(file_path):
            super().do_GET()
        else:
            # Serve index.html for SPA routes
            self.path = '/index.html'
            super().do_GET()

print(f"SPA server on http://localhost:{PORT}")
http.server.HTTPServer(('', PORT), SPAHandler).serve_forever()
