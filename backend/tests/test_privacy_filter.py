from app.privacy import scrub_event


def test_error_reports_keep_the_error_and_lose_the_person():
    event = {
        "user": {"email": "a@b.co", "ip_address": "1.2.3.4"},
        "request": {"url": "https://api.test/api/auth/login?token=abc", "data": {"password": "p"}, "cookies": {"s": "1"},
                    "headers": {"authorization": "Bearer x"}, "query_string": "token=abc", "method": "POST"},
        "breadcrumbs": {"values": [{"category": "http", "message": "POST /login for jane@x.co", "data": {"url": "x"}, "level": "info"}]},
        "contexts": {"user": {"email": "a@b.co"}, "runtime": {"name": "CPython"}},
        "exception": {"values": [{"type": "ValueError", "value": "boom"}]},
    }
    out = scrub_event(event)
    assert "user" not in out
    assert out["request"] == {"url": "https://api.test/api/auth/login", "method": "POST"}
    assert out["breadcrumbs"]["values"] == [{"category": "http", "level": "info"}]
    assert out["contexts"] == {"runtime": {"name": "CPython"}}
    assert out["exception"]["values"][0]["value"] == "boom"


def test_missing_parts_are_fine():
    assert scrub_event({}) == {}
    assert scrub_event({"request": None, "breadcrumbs": None}) == {"request": None, "breadcrumbs": None}
