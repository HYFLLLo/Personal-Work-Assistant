from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    deepseek_api_key: str
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    exa_api_key: str
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    
    # Ollama配置
    ollama_base_url: str = "http://localhost:11434"
    ollama_embed_model: str = "quentinz/bge-small-zh-v1.5:latest"  # 默认使用中文嵌入模型
    ollama_embed_model_fallback: str = "dengcao/Qwen3-Embedding-0.6B:F16"  # 备用模型

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
