"""
AirFlow AI — Version 3: Personalized Health Risk & AQI Advisory Platform
=========================================================================
Flask application factory. Registers all blueprints and initialises
Firebase Admin SDK, APScheduler background jobs, CORS, rate limiting,
and security headers.

Usage:
    python app.py
    # or with gunicorn for production:
    gunicorn -w 2 -b 0.0.0.0:5000 "app:create_app()"
"""

import os
import sys
import logging
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from flask import Flask, jsonify, request, g
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('v3.app')

# ── Global rate limiter (in-memory storage) ───────────────────────────────────
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["300 per hour", "60 per minute"],
    storage_uri="memory://",
)


def create_app() -> Flask:
    app = Flask(__name__, static_folder='../frontend', static_url_path='')
    app.config['SECRET_KEY'] = config.SECRET_KEY
    app.config['MAX_CONTENT_LENGTH'] = 64 * 1024  # 64 KB max request body

    # ── CORS ──────────────────────────────────────────────────────────────────
    CORS(
        app,
        origins=config.CORS_ORIGINS,
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    # ── Rate Limiter ──────────────────────────────────────────────────────────
    limiter.init_app(app)

    # ── Firebase (graceful startup even without credentials) ──────────────────
    try:
        from services.firebase_service import init_firebase
        init_firebase()
        logger.info("Firebase Admin SDK initialised")
    except Exception as e:
        logger.warning(f"Firebase init skipped: {e}. Some features will be unavailable.")

    # ── Compute Worker ────────────────────────────────────────────────────────
    try:
        from worker.compute_worker import compute_worker
        compute_worker.start()
        logger.info("Background ComputeWorker started")
    except Exception as e:
        logger.warning(f"ComputeWorker failed to start: {e}")

    # ── Background Scheduler (push notifications) ─────────────────────────────
    try:
        from services.notification_scheduler import start_scheduler
        start_scheduler(app)
        logger.info(f"Notification scheduler started (every {config.SCHEDULER_INTERVAL_MINUTES} min)")
    except Exception as e:
        logger.warning(f"Notification scheduler failed to start: {e}")

    # ── Register Blueprints ───────────────────────────────────────────────────
    from routes.auth          import auth_bp
    from routes.profile       import profile_bp
    from routes.aqi           import aqi_bp
    from routes.advisory      import advisory_bp
    from routes.notifications import notifications_bp

    app.register_blueprint(auth_bp,          url_prefix='/api/auth')
    app.register_blueprint(profile_bp,       url_prefix='/api/profile')
    app.register_blueprint(aqi_bp,           url_prefix='/api/aqi')
    app.register_blueprint(advisory_bp,      url_prefix='/api/advisory')
    app.register_blueprint(notifications_bp, url_prefix='/api/notifications')

    # ── Security: Apply rate limits per blueprint ─────────────────────────────
    # More restrictive on auth endpoints to prevent brute-force
    limiter.limit("10 per minute")(auth_bp)
    limiter.limit("30 per minute")(profile_bp)

    # ── Serve Frontend SPA ────────────────────────────────────────────────────
    @app.route('/')
    def index():
        return app.send_static_file('index.html')

    @app.route('/dashboard')
    def dashboard():
        return app.send_static_file('dashboard.html')

    @app.route('/profile')
    def profile_page():
        return app.send_static_file('profile.html')

    # ── Health Check ──────────────────────────────────────────────────────────
    @app.route('/api/health')
    @limiter.exempt
    def health():
        return jsonify({'status': 'ok', 'version': '3.0.0'})

    # ── Security Headers (after every response) ───────────────────────────────
    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options']    = 'nosniff'
        response.headers['X-Frame-Options']            = 'DENY'
        response.headers['X-XSS-Protection']           = '1; mode=block'
        response.headers['Referrer-Policy']            = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy']         = 'geolocation=(self), notifications=(self)'
        # Only add CSP on non-HTML responses to avoid breaking frontend
        if not response.content_type.startswith('text/html'):
            response.headers['Content-Security-Policy'] = (
                "default-src 'none'; "
                "connect-src 'self'; "
                "frame-ancestors 'none'"
            )
        # Cache control for API responses
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    # ── Request Timing (for performance logging) ──────────────────────────────
    @app.before_request
    def start_timer():
        g.start_time = time.monotonic()

    @app.after_request
    def log_request_time(response):
        if hasattr(g, 'start_time') and request.path.startswith('/api/'):
            elapsed = (time.monotonic() - g.start_time) * 1000
            if elapsed > 1000:  # Log slow requests (>1s)
                logger.warning(f"SLOW {request.method} {request.path} — {elapsed:.0f}ms")
        return response

    # ── Global Error Handlers ─────────────────────────────────────────────────
    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({'error': 'Bad request', 'details': str(e)}), 400

    @app.errorhandler(401)
    def unauthorized(e):
        return jsonify({'error': 'Unauthorised — please sign in'}), 401

    @app.errorhandler(404)
    def not_found(e):
        # For SPA routes (non-API), serve index.html
        if not request.path.startswith('/api/'):
            try:
                return app.send_static_file('index.html')
            except Exception:
                pass
        return jsonify({'error': 'Endpoint not found'}), 404

    @app.errorhandler(413)
    def request_too_large(e):
        return jsonify({'error': 'Request body too large (max 64KB)'}), 413

    @app.errorhandler(429)
    def ratelimit_handler(e):
        return jsonify({'error': f'Too many requests: {e.description}'}), 429

    @app.errorhandler(500)
    def server_error(e):
        logger.exception("Internal server error")
        return jsonify({'error': 'Internal server error. Please try again.'}), 500

    return app


if __name__ == '__main__':
    application = create_app()
    application.run(
        host='0.0.0.0',
        port=config.PORT,
        debug=config.DEBUG,
        use_reloader=False,  # Prevent double-starting scheduler
    )
