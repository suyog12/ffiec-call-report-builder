import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    FFIEC_BASE_URL: str = os.getenv("FFIEC_BASE_URL", "")
    FFIEC_USER_ID: str = os.getenv("FFIEC_USER_ID", "")
    FFIEC_PWS_TOKEN: str = os.getenv("FFIEC_PWS_TOKEN", "")


settings = Settings()