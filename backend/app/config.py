"""Application settings — loaded from environment / .env file."""
from functools import lru_cache

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:3000"

    # Auth — SECRET_KEY signs session tokens. Production refuses to start with
    # the dev default (see validate_for_production).
    secret_key: str = "dev-secret"
    access_token_expire_minutes: int = 60
    # "true"/"false" forces the Secure flag on session cookies; blank = Secure in production or over https.
    cookie_secure: str = ""
    # Requests per minute per client IP. One dashboard page load makes ~25 API calls and offices share an IP.
    rate_limit_per_minute: int = 900
    # Comma-separated emails of platform owners (credential vault, all users,
    # audit log, demo reset).
    owner_emails: str = ""

    # Email verification for password signups (docs/social-sign-in.md). The
    # code is emailed; outside production with no email provider the API
    # returns it so local development works. In production with no email
    # provider verification can't be delivered, so it isn't enforced.
    email_verification: bool = True

    # Social sign-in (docs/social-sign-in.md). Each provider is offered only
    # once its credentials are set. Callback URLs are
    # PUBLIC_API_URL + /api/auth/oauth/<provider>/callback.
    public_api_url: str = ""
    google_client_id: str | None = None
    google_client_secret: str | None = None
    github_client_id: str | None = None
    github_client_secret: str | None = None
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    microsoft_tenant: str = "common"
    # Sign in with Apple: the Services ID, team, and a Sign in with Apple key
    # (.p8 contents; literal "\n" sequences are accepted for one-line env vars).
    apple_client_id: str | None = None
    apple_team_id: str | None = None
    apple_key_id: str | None = None
    apple_private_key: str | None = None

    # Optional hardening — when set, mutating requests require X-API-Key.
    api_key: str | None = None

    # LLM — Groq (OpenAI-compatible). Free tier model works for the demo.
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"

    # Email — either provider works, both have free tiers.
    # Option A: Resend API (resend.com — 3,000 emails/mo free).
    resend_api_key: str | None = None
    resend_from: str = "Autopilot <onboarding@resend.dev>"
    # Option B: any free SMTP (Brevo 300/day, Gmail app password, MailerSend).
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None  # defaults to smtp_user

    # Database — MongoDB Atlas (Motor). When unset the app keeps working
    # fully in-memory.
    mongodb_uri: str | None = None
    mongodb_db: str = "autopilot"
    # Production refuses to start without MONGODB_URI (data would vanish on
    # every restart). Set true ONLY for a throwaway demo deployment.
    allow_in_memory_db: bool = False

    # Freelancer.com connector — official API (OAuth). When unset, the connector
    # serves a realistic sandbox feed so the UI works in the demo.
    freelancer_oauth_token: str | None = None
    freelancer_sandbox: bool = True
    # Keep production API calls disabled until written permission covers this
    # commercial, multi-user product (see docs/platform-matrix.md).
    freelancer_api_approved: bool = False


    # Reddit's Data API requires OAuth, and commercial use requires approval.
    reddit_access_token: str | None = None
    reddit_commercial_approved: bool = False
    hn_commercial_reuse_approved: bool = False

    # Job Radar sources (backend/app/job_sources.py). Comma-separated source ids.
    # APPROVED turns on public feeds whose reuse terms needed a recorded review;
    # DISABLED switches any source off, including default-on public feeds.
    job_sources_approved: str = ""
    job_sources_disabled: str = ""
    # Optional keys for job-search APIs; each source stays off until its key is set
    # (The Muse works without one at a lower rate limit).
    the_muse_api_key: str | None = None
    usajobs_api_key: str | None = None
    usajobs_user_agent: str | None = None  # the email registered with the key
    adzuna_app_id: str | None = None
    adzuna_app_key: str | None = None
    adzuna_country: str = "us"
    jooble_api_key: str | None = None
    reed_api_key: str | None = None
    findwork_api_token: str | None = None
    web3_career_token: str | None = None

    # Automation Worker (browser automation, separate service). When unset, the
    # automation engine simulates the step log so the queue/approval UX works.
    worker_url: str | None = None
    worker_key: str | None = None

    # Launch mode: only real data. Demo/fabricated seeds are opt-IN for
    # development — set SEED_DEMO_DATA=true locally to explore with mock data.
    # When false, startup also purges fabricated collections already persisted.
    seed_demo_data: bool = False
    database_url: str | None = None
    redis_url: str | None = None
    sentry_dsn: str | None = None
    chromadb_url: str | None = None
    inbound_email_domain: str | None = None
    inbound_email_webhook_secret: str | None = None
    inbound_email_platforms: str = ""
    # Outlook inbox import stays disabled until the approved OAuth consent,
    # Mail.Read scope, and privacy review are complete.
    outlook_inbox_read_approved: bool = False
    nango_secret_key: str | None = None
    nango_base_url: str = "https://api.nango.dev"
    # Comma-separated Nango integration IDs explicitly enabled for user OAuth.
    nango_integrations: str = ""
    # Environment Settings > Webhooks > Signing key in Nango (not the API
    # secret). Without it, /api/orders/webhooks/nango rejects every call.
    nango_webhook_signing_key: str | None = None
    composio_api_key: str | None = None
    # Empty means no toolkit can be exposed to an agent.
    composio_allowed_toolkits: str = ""
    # Capital program (investor pool, early payment, protection fund). All
    # settlement is simulated: no money moves until a licensed settlement
    # partner is integrated. Comma-separated ISO-2 countries investors may
    # come from; empty means no allowlist, acceptable only while simulated.
    capital_investor_jurisdictions: str = ""
    # Token program: pool shares as a permissioned ERC-3643 token
    # (docs/token-program.md). Off by default. Only test networks are
    # allowed until every launch-gate item is recorded AND
    # TOKEN_MAINNET_ENABLED is true. The backend reads the chain and drafts
    # Safe transactions; it never holds a private key.
    token_program_enabled: bool = False
    token_mainnet_enabled: bool = False
    token_chain_id: int = 84532  # Base Sepolia
    token_rpc_url: str | None = None
    token_address: str | None = None
    token_identity_registry: str | None = None
    token_id_factory: str | None = None
    token_safe_address: str | None = None
    token_usdc_address: str | None = None
    token_start_block: int = 0
    token_confirmations: int = 10
    token_lockup_days: int = 365
    # Encrypts stored third-party credentials (OAuth tokens). One or more Fernet keys,
    # comma-separated; the first encrypts. See app/crypto.py. Kept for future connectors.
    token_encryption_key: str | None = None
    # Invoice pay links (docs/payments.md). Clients pay an invoice or a
    # milestone through Stripe Checkout. Without STRIPE_SECRET_KEY the pay
    # page works but says online payment isn't switched on, and nothing is
    # charged. STRIPE_WEBHOOK_SECRET is the endpoint's signing secret
    # (whsec_...); without it the webhook rejects every call. Crypto (USDC
    # through Stripe's stablecoin payments) also needs the method enabled on
    # the Stripe account, then PAYMENTS_CRYPTO_ENABLED=true.
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    payments_crypto_enabled: bool = False
    # Public frontend origin for Stripe's return URLs; blank means the first
    # CORS origin.
    public_site_url: str = ""
    activepieces_webhook_url: str | None = None
    activepieces_webhook_secret: str | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _blank_is_unset(cls, value, info: ValidationInfo):
        # Hosting dashboards (Render prompts for every `sync: false` key) can
        # store a cleared variable as "". For switches and numbers that means
        # "use the default"; blank strings stay blank so tests can override .env.
        if value == "" and info.field_name:
            field = cls.model_fields[info.field_name]
            if field.annotation in (bool, int):
                return field.default
        return value

    @property
    def cookie_secure_flag(self) -> bool | None:
        return {"true": True, "1": True, "false": False, "0": False}.get(self.cookie_secure.strip().lower())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def site_url(self) -> str:
        url = self.public_site_url.strip() or (self.cors_origin_list or ["http://localhost:3000"])[0]
        return url.rstrip("/")

    @property
    def owner_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.owner_emails.split(",") if e.strip()}

    def production_problems(self) -> list[str]:
        """Everything that makes a production deploy unsafe or lossy."""
        problems: list[str] = []
        if self.secret_key in ("dev-secret", "change-me-in-production") or len(self.secret_key) < 32:
            problems.append("SECRET_KEY must be a random value of at least 32 characters in production.")
        if not (self.mongodb_uri or "").strip() and not self.allow_in_memory_db:
            problems.append(
                "MONGODB_URI is not set: accounts and data would live in memory and be lost on every "
                "restart. Set it (MongoDB Atlas), or set ALLOW_IN_MEMORY_DB=true for a throwaway demo."
            )
        origins = self.cors_origin_list
        if not origins or "*" in origins:
            problems.append("CORS_ORIGINS must list the real frontend origin(s); '*' is not allowed with credentials.")
        elif all(o.startswith("http://localhost") or o.startswith("http://127.0.0.1") for o in origins):
            problems.append("CORS_ORIGINS only lists localhost; set the deployed frontend origin.")
        if (self.token_encryption_key or "").strip():
            from .crypto import key_problem  # cryptography is only needed once a key is set
            problem = key_problem(self.token_encryption_key)
            if problem:
                problems.append(problem)
        return problems

    def validate_for_production(self) -> None:
        """Fail fast on settings that would make a production deploy insecure."""
        if self.environment != "production":
            return
        problems = self.production_problems()
        if problems:
            raise RuntimeError("Refusing to start in production:\n - " + "\n - ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
