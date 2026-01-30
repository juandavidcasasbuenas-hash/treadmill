#!/usr/bin/env python3
"""
Simple server for Treadmill app with Strava OAuth and Gemini AI integration.
Keeps API keys secure on server side.
"""

import os
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from pathlib import Path


def load_env():
    """Load .env file manually to avoid external dependencies."""
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()


load_env()

STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
PORT = 8080

GEMINI_MODEL = 'gemini-2.0-flash'
GEMINI_URL = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'

WORKOUT_SYSTEM_PROMPT = """You are a running coach AI that creates structured treadmill workouts.

Given a user's objectives or a workout description, generate a structured interval workout.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. The response must be parseable JSON.

The JSON structure must be:
{
  "name": "Workout name",
  "description": "Brief description",
  "totalDuration": "estimated total time",
  "intervals": [
    {
      "name": "Interval name (e.g., 'Warm Up', 'Fast', 'Recovery', 'Cool Down')",
      "duration": duration in seconds (integer),
      "targetPace": "target pace in min:sec per km format (e.g., '5:30')",
      "targetSpeed": target speed in km/h (number),
      "type": "warmup" | "work" | "recovery" | "cooldown"
    }
  ]
}

Guidelines:
- Always include a warm-up (5-10 min at easy pace ~6:30-7:00/km)
- Always include a cool-down (5-10 min at easy pace)
- For intervals, alternate between "work" and "recovery" types
- Work intervals are faster, recovery intervals are slower
- Typical paces: Easy 6:00-7:00/km, Tempo 5:00-5:30/km, Fast 4:30-5:00/km, Sprint 4:00-4:30/km
- Keep total workout reasonable (20-60 minutes typically)
- If user pastes a specific workout, convert it to this format
- targetSpeed should be calculated from targetPace (e.g., 5:00/km = 12 km/h)"""


class TreadmillHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/auth/strava/callback':
            self.handle_strava_callback(parsed)
            return

        if parsed.path == '/api/config':
            self.send_json({
                'strava_client_id': STRAVA_CLIENT_ID,
                'gemini_enabled': bool(GEMINI_API_KEY)
            })
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/generate-workout':
            self.handle_generate_workout()
            return

        self.send_error(404, 'Not Found')

    def handle_generate_workout(self):
        """Generate workout intervals using Gemini AI."""
        if not GEMINI_API_KEY:
            self.send_json({'error': 'Gemini API not configured'}, status=500)
            return

        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            request_body = json.loads(post_data.decode('utf-8'))
            user_input = request_body.get('prompt', '')

            if not user_input:
                self.send_json({'error': 'No prompt provided'}, status=400)
                return

            # Call Gemini API
            gemini_request = {
                'contents': [{
                    'parts': [{
                        'text': f"{WORKOUT_SYSTEM_PROMPT}\n\nUser request: {user_input}"
                    }]
                }],
                'generationConfig': {
                    'temperature': 0.7,
                    'maxOutputTokens': 2048
                }
            }

            req = Request(
                f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                data=json.dumps(gemini_request).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )

            with urlopen(req, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))

                # Extract text from Gemini response
                text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')

                # Clean up the response - remove markdown code blocks if present
                text = text.strip()
                if text.startswith('```json'):
                    text = text[7:]
                if text.startswith('```'):
                    text = text[3:]
                if text.endswith('```'):
                    text = text[:-3]
                text = text.strip()

                # Parse the JSON workout
                workout = json.loads(text)
                self.send_json({'workout': workout})

        except json.JSONDecodeError as e:
            self.send_json({'error': f'Failed to parse workout response: {str(e)}'}, status=500)
        except HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"Gemini API error: {error_body}")
            self.send_json({'error': f'Gemini API error: {e.code}'}, status=500)
        except Exception as e:
            print(f"Error generating workout: {str(e)}")
            self.send_json({'error': str(e)}, status=500)

    def handle_strava_callback(self, parsed):
        """Exchange authorization code for access token."""
        query = parse_qs(parsed.query)
        code = query.get('code', [None])[0]

        if not code:
            self.send_error_page('No authorization code received')
            return

        token_url = 'https://www.strava.com/oauth/token'
        data = {
            'client_id': STRAVA_CLIENT_ID,
            'client_secret': STRAVA_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }

        try:
            req = Request(
                token_url,
                data=json.dumps(data).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urlopen(req) as response:
                result = json.loads(response.read().decode('utf-8'))
                access_token = result.get('access_token')
                athlete = result.get('athlete', {})

                self.send_response(302)
                self.send_header('Location', f'/?strava_token={access_token}&strava_athlete={athlete.get("firstname", "")}')
                self.end_headers()

        except HTTPError as e:
            error_body = e.read().decode('utf-8')
            self.send_error_page(f'Strava error: {error_body}')
        except Exception as e:
            self.send_error_page(f'Error: {str(e)}')

    def send_json(self, data, status=200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_page(self, message):
        """Send simple error page."""
        self.send_response(400)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        html = f'''
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Authentication Error</h1>
            <p>{message}</p>
            <a href="/">Back to App</a>
        </body>
        </html>
        '''
        self.wfile.write(html.encode('utf-8'))

    def end_headers(self):
        """Add cache-control headers to prevent browser caching during development."""
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Custom logging."""
        print(f"[{self.log_date_time_string()}] {args[0]}")


def main():
    print(f"Starting Treadmill server on http://localhost:{PORT}")
    print(f"Strava: {'Configured' if STRAVA_CLIENT_ID else 'Not configured'}")
    print(f"Gemini AI: {'Configured' if GEMINI_API_KEY else 'Not configured'}")
    print("-" * 50)

    server = HTTPServer(('', PORT), TreadmillHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()


if __name__ == '__main__':
    main()
