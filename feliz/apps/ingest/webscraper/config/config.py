"""Central configuration for the Feliz webscraper."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = DATA_DIR / "processed"

OUTPUT_FILE = OUTPUT_DIR / "documents.jsonl"

DEFAULT_START_URLS = [
    "https://housing.lacity.gov/",
    "https://selfhelp.courts.ca.gov/",
]

ALLOWED_HOSTS = {
    "housing.lacity.gov",
    "selfhelp.courts.ca.gov",
}

REQUEST_TIMEOUT = float(os.getenv("SCRAPER_TIMEOUT", "20"))
REQUEST_DELAY = float(os.getenv("SCRAPER_DELAY", "0.5"))
MAX_PAGES = int(os.getenv("SCRAPER_MAX_PAGES", "50"))
MAX_DEPTH = int(os.getenv("SCRAPER_MAX_DEPTH", "2"))

USER_AGENT = (
    "FelizResearchBot/1.0 "
    "(educational housing-information research project)"
)

ALLOWED_CONTENT_TYPES = {
    "text/html",
    "application/pdf",
}

MAX_RESPONSE_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 100