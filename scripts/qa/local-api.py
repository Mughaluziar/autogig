"""Credential-free FastAPI process for the local Chromium suite."""
import json
import os
from pathlib import Path
import re

import httpx
import uvicorn

mongo = os.environ.get("MONGODB_URI", "")
database = os.environ.get("MONGODB_DB", "")
if (os.environ.get("ENVIRONMENT") != "test" or not re.fullmatch(r"mongodb://(?:127\.0\.0\.1|localhost):[0-9]+/?", mongo)
        or not database.startswith("autogig_browser_qa")):
    raise SystemExit("Browser QA requires test mode and a disposable loopback MongoDB database.")

os.environ.update({
    "GROQ_API_KEY": "local-browser-suite-fixture", "RESEND_API_KEY": "", "SMTP_HOST": "",
    "STRIPE_SECRET_KEY": "", "STRIPE_WEBHOOK_SECRET": "", "PAYMENTS_CRYPTO_ENABLED": "false",
    "TOKEN_PROGRAM_ENABLED": "false", "TOKEN_MAINNET_ENABLED": "false", "WORKER_URL": "", "SENTRY_DSN": "",
})
ai_log = Path(os.environ["AI_LOG"])


def mock_outbound(self, request, **kwargs):
    if request.url.host == "api.groq.com" and request.url.path == "/openai/v1/chat/completions":
        prompt = json.loads(request.content)
        with ai_log.open("a") as log:
            log.write(json.dumps(prompt) + "\n")
        draft = ('I read your brief for "React dashboard developer". I can start by reviewing the requirements '
                 'and confirming the expected behaviour, then share a concrete delivery plan for your review.')
        return httpx.Response(200, json={"choices": [{"message": {"content": draft}}]}, request=request)
    raise httpx.ConnectError("External provider disabled for local browser QA", request=request)


async def mock_async_outbound(self, request, **kwargs):
    return mock_outbound(self, request, **kwargs)


httpx.Client.send = mock_outbound
httpx.AsyncClient.send = mock_async_outbound
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("QA_API_PORT", "8010")), proxy_headers=False)
