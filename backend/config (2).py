from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    deepseek_api_key: str
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    exa_api_key: str
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
