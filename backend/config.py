# backend/config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME: str = "Mu'azib - Dar Najd Kitchen AI Host"
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_BASE_URL: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek/deepseek-v4.1-flash:nitro")
    MENU_PATH: str = os.getenv("MENU_PATH", "data/menu.json")

    @property
    def DATABASE_URL(self) -> str:
        url = os.getenv("DATABASE_URL", "sqlite:///./muazib.db")
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://") and "+psycopg2" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url

settings = Settings()
