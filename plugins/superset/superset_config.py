"""Superset configuration for e2e testing."""

import os

# Database
SQLALCHEMY_DATABASE_URI = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://superset:superset@postgres:5432/superset"
)

# Redis
REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
CELERY_REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
CACHE_REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/1"

# Secret key
SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "e2e-test-secret-key-for-flask")

# Enable embedded dashboards
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "EMBEDDABLE_DASHBOARDS": True,
}

# Guest token
GUEST_ROLE_NAME = "EmbeddedGuest"
GUEST_TOKEN_JWT_SECRET = os.environ.get("SUPERSET_GUEST_TOKEN_JWT_SECRET", "e2e-test-secret-at-least-32-chars-long")
GUEST_TOKEN_JWT_ALGO = "HS256"
GUEST_TOKEN_HEADER_NAME = "X-GuestToken"

# Disable Talisman for e2e (no HTTPS)
TALISMAN_ENABLED = False

# CORS
ENABLE_CORS = True
CORS_OPTIONS = {
    "origins": ["*"],
    "supports_credentials": False,
}

# Allowed domains for embedded dashboards — allows localhost for e2e tests
# This is set per-dashboard via the API, but the default is permissive for e2e
HTTP_HEADERS = {}

# Session
SESSION_COOKIE_SECURE = False

# Logging
LOG_LEVEL = "INFO"
