"""Application settings, loaded from environment variables / backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_prefix="RELAY_",
        extra="ignore",
    )

    # Branding (defaults; editable at runtime from the console's Settings page)
    company_name: str = "Aurora Outfitters"
    assistant_name: str = "Relay"
    accent_color: str = "#4f46e5"
    welcome_message: str = "I can track orders, handle returns, and answer billing, account and product questions — and I'll bring in a human whenever you need one."
    suggested_prompts: list[str] = ["Where is my order?", "What's your return policy?", "Talk to a human"]

    # LLM: "auto" picks Anthropic, then OpenAI, based on which key is present,
    # and falls back to the deterministic offline engine when neither is set.
    llm_provider: str = "auto"  # auto | anthropic | openai | offline
    anthropic_model: str = "claude-sonnet-5"
    openai_model: str = "gpt-4o-mini"
    anthropic_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("RELAY_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
    )
    openai_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("RELAY_OPENAI_API_KEY", "OPENAI_API_KEY")
    )
    llm_timeout_seconds: float = 45.0
    # Circuit breaker: after this many consecutive provider failures, skip the model (offline engine) for the cooldown,
    # instead of making every customer wait out timeouts and retries during an outage.
    llm_circuit_failure_threshold: int = 3
    llm_circuit_cooldown_seconds: float = 30.0
    # Token prices (USD per million tokens) for cost analytics. 0 = unknown: tokens are still counted, cost isn't.
    llm_input_cost_per_mtok: float = 0.0
    llm_output_cost_per_mtok: float = 0.0

    # Agent behaviour
    confidence_threshold: float = 0.6
    refund_approval_limit: float = 250.0
    low_confidence_streak_limit: int = 2
    retrieval_top_k: int = 4
    memory_window: int = 12  # messages kept verbatim before older turns are summarized
    auto_actions_enabled: bool = True  # AI may cancel orders / start returns after the customer confirms
    multilingual_enabled: bool = True  # detect the customer's language and reply in it

    # ROI model used by analytics
    minutes_per_human_ticket: float = 8.0
    cost_per_agent_hour: float = 32.0

    # Integrations
    webhook_async: bool = True  # deliver webhooks on a background thread (tests deliver inline)
    webhook_max_attempts: int = 6  # first try + retries with exponential backoff; then the delivery is dead-lettered
    webhook_retry_poll_seconds: int = 10
    # Webhook URLs that resolve to private, loopback or link-local addresses (incl. cloud metadata) are refused (SSRF).
    webhook_allow_private_networks: bool = False
    sla_check_interval_seconds: int = 60

    # Privacy
    pii_redaction_enabled: bool = True  # mask card numbers, SSNs, CVVs, passwords and one-time codes before storage / the LLM
    retention_days: int = 0  # anonymize closed conversations older than this; 0 keeps them forever

    # Observability
    log_format: str = "text"  # text | json
    metrics_token: str | None = None  # when set, GET /metrics requires "Authorization: Bearer <token>"
    trust_proxy_headers: bool = False  # take the client IP from X-Forwarded-For (only behind a proxy you control)
    hsts_enabled: bool = False  # send Strict-Transport-Security (only when served over HTTPS)

    # Storage
    knowledge_base_dir: Path = BASE_DIR / "knowledge_base"
    data_dir: Path = BASE_DIR / "data"
    database_path: Path = BASE_DIR / "storage" / "relay.db"
    checkpoint_path: Path = BASE_DIR / "storage" / "checkpoints.db"

    # API
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    admin_api_key: str | None = None  # when set, console/KB/analytics endpoints accept X-Admin-Key (scripts, automation)
    chat_rate_limit_per_minute: int = 30

    # Sign in with Google. Setting the client ID turns authentication on for the console.
    google_client_id: str | None = None
    google_client_secret: str | None = None  # used server-side to exchange the OAuth code; never sent to the browser
    # Must match an "Authorized redirect URI" on the OAuth client. Defaults to <API URL>/api/auth/google/callback.
    google_redirect_uri: str | None = None
    auth_admin_emails: str = ""  # comma-separated; these accounts become admins on first sign-in
    auth_allowed_domains: str = ""  # comma-separated Google Workspace domains whose users may join as agents
    session_ttl_hours: int = 24 * 7
    session_cookie_name: str = "relay_session"
    # Cross-site deployments (console and API on different sites) need secure=true and samesite=none.
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"  # lax | strict | none

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.google_client_id)

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.auth_admin_emails.split(",") if e.strip()}

    @property
    def allowed_domain_set(self) -> set[str]:
        return {d.strip().lower().lstrip("@") for d in self.auth_allowed_domains.split(",") if d.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
