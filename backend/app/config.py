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
    sla_check_interval_seconds: int = 60

    # Storage
    knowledge_base_dir: Path = BASE_DIR / "knowledge_base"
    data_dir: Path = BASE_DIR / "data"
    database_path: Path = BASE_DIR / "storage" / "relay.db"
    checkpoint_path: Path = BASE_DIR / "storage" / "checkpoints.db"

    # API
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    admin_api_key: str | None = None  # when set, console/KB/analytics endpoints require X-Admin-Key
    chat_rate_limit_per_minute: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
