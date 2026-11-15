"""Privacy filter for error reports sent to Sentry: keeps the error and stack, drops anything about the person."""


def scrub_event(event: dict, hint: dict | None = None) -> dict:
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "headers", "query_string", "env"):
            request.pop(key, None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = url.split("?")[0].split("#")[0]
    crumbs = event.get("breadcrumbs")
    values = crumbs.get("values") if isinstance(crumbs, dict) else crumbs
    if isinstance(values, list):
        cleaned = [{k: v for k, v in c.items() if k not in ("data", "message")} for c in values if isinstance(c, dict)]
        if isinstance(crumbs, dict):
            crumbs["values"] = cleaned
        else:
            event["breadcrumbs"] = cleaned
    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        contexts.pop("user", None)
    return event
