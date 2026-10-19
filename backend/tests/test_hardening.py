"""tests/test_hardening.py

Hardening and security verification tests:
1. Settings validation: DATABASE_URL must be sqlite, CORS_ORIGINS must not contain '*'.
2. Confirm no write endpoints: every route under /api allows only GET (plus HEAD/OPTIONS).
3. Consistent 500 error body without stack traces.
4. Request logging middleware functionality.
5. Integration status endpoint.
"""

import logging
import pytest
from starlette.testclient import TestClient

from app.core.config import Settings
from app.integrations.sap_sample_adapter import SAP_DISCLAIMER_TEXT
from app.main import create_app


def test_settings_sqlite_url_validation():
    # Valid sqlite url
    s = Settings(DATABASE_URL="sqlite:///./test.db")
    assert s.DATABASE_URL.startswith("sqlite")

    # Non-sqlite url must raise ValueError
    with pytest.raises(ValueError, match="DATABASE_URL must be an SQLite database URL"):
        Settings(DATABASE_URL="postgresql://user:password@localhost/testdb")


def test_settings_cors_origins_wildcard_rejected():
    # Explicit origins allowed
    s = Settings(CORS_ORIGINS=["http://localhost:5173", "http://127.0.0.1:5173"])
    assert len(s.CORS_ORIGINS) == 2

    # Wildcard rejected
    with pytest.raises(ValueError, match="CORS_ORIGINS cannot contain wildcard '\\*'"):
        Settings(CORS_ORIGINS=["*"])

    with pytest.raises(ValueError, match="CORS_ORIGINS cannot contain wildcard '\\*'"):
        Settings(CORS_ORIGINS="http://localhost:5173,*")


def test_no_write_endpoints_under_api():
    """Ensure all /api endpoints are strictly GET-only except explicit allowlist:
    exactly POST /api/import/validate, /api/import/load, /api/import/activate."""
    app = create_app()
    allowed_write_endpoints = {
        ("POST", "/api/import/validate"),
        ("POST", "/api/import/load"),
        ("POST", "/api/import/activate"),
        ("POST", "/api/locations/override"),
    }
    non_get_methods = {"POST", "PUT", "PATCH", "DELETE"}
    found_write_endpoints = set()

    openapi_paths = app.openapi().get("paths", {})
    for path, methods_dict in openapi_paths.items():
        if path.startswith("/api"):
            for m in methods_dict.keys():
                method_upper = m.upper()
                if method_upper in non_get_methods:
                    pair = (method_upper, path)
                    assert pair in allowed_write_endpoints, f"Endpoint '{method_upper} {path}' is not allowlisted"
                    found_write_endpoints.add(pair)

    assert found_write_endpoints == allowed_write_endpoints, (
        f"Expected exactly {allowed_write_endpoints}, but found {found_write_endpoints}"
    )


def test_unhandled_500_error_body_no_stacktrace():
    """Unhandled exceptions must return 500 with {"detail": "Internal server error"}."""
    app = create_app()

    # Add a route that deliberately raises an unexpected exception
    @app.get("/api/test-forced-error")
    def trigger_error():
        raise RuntimeError("Secret internal failure with sensitive details")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/test-forced-error")
    assert resp.status_code == 500
    data = resp.json()
    assert data == {"detail": "Internal server error"}
    # Verify no stack trace or sensitive info leaked in body
    assert "Secret internal failure" not in resp.text
    assert "Traceback" not in resp.text


def test_request_logging_middleware(caplog: pytest.LogCaptureFixture):
    """Middleware logs method, path, status, and duration without query params."""
    app = create_app()
    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="app.api"):
        resp = client.get("/api/health?secret_key=do_not_log_this")
        assert resp.status_code == 200

    # Ensure log captured path and status
    log_text = caplog.text
    assert "GET /api/health -> 200" in log_text
    # Ensure query string secrets are NOT present
    assert "secret_key" not in log_text
    assert "do_not_log_this" not in log_text


def test_integration_status_endpoint(client_seeded: TestClient):
    resp = client_seeded.get("/api/integration-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "active_source" in data
    assert data["is_live"] is False
    assert "entities_covered" in data
    assert "entities_missing" in data
    assert data["disclaimer"] == SAP_DISCLAIMER_TEXT
    assert "No live SAP connection is configured" in data["disclaimer"]
