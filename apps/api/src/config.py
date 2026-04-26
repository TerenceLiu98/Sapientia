from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings. Real values come in TASK-002."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
