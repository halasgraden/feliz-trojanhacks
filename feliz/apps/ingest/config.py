
"""Central configuration for the tenant resource scraper."""

import os
from pathlib import Path

# Project directories
PROJECT_ROOT = Path(__file__).resolve().parent.parent

SOURCES_FILE = Path(
    os.getenv("SCRAPER_SOURCES_FILE", str(PROJECT_ROOT / "sources.csv"))
)

OUTPUT_DIR = Path(
    os.getenv("SCRAPER_OUTPUT_DIR", str(PROJECT_ROOT / "data"))
)

DOWNLOADS_DIR = OUTPUT_DIR / "downloads"

# Crawl settings
MAX_PAGES = int(os.getenv("SCRAPER_MAX_PAGES", "50"))
MAX_DEPTH = int(os.getenv("SCRAPER_MAX_DEPTH", "2"))
REQUEST_DELAY = float(os.getenv("SCRAPER_REQUEST_DELAY", "1.0"))
REQUEST_TIMEOUT = int(os.getenv("SCRAPER_REQUEST_TIMEOUT", "30"))

# HTTP settings
USER_AGENT = os.getenv(
    "SCRAPER_USER_AGENT",
    "TenantResourceResearchBot/1.0",
)

MAX_RETRIES = int(os.getenv("SCRAPER_MAX_RETRIES", "3"))

# Supported resource types
SUPPORTED_HTML_TYPES = {
    "text/html",
    "application/xhtml+xml",
}

SUPPORTED_DATASET_EXTENSIONS = {
    ".csv",
    ".json",
}

SUPPORTED_DOCUMENT_EXTENSIONS = {
    ".pdf",
}

# Output filenames
COMBINED_DOCUMENTS_FILE = OUTPUT_DIR / "documents.jsonl"
SOURCE_INVENTORY_FILE = OUTPUT_DIR / "source_inventory.json"
CRAWL_REPORT_FILE = OUTPUT_DIR / "crawl_report.json"
CRAWL_FAILURES_FILE = OUTPUT_DIR / "crawl_failures.json"


def validate_config() -> None:
    """Validate configuration values before a crawl begins."""
    if MAX_PAGES < 1:
        raise ValueError("SCRAPER_MAX_PAGES must be at least 1.")

    if MAX_DEPTH < 0:
        raise ValueError("SCRAPER_MAX_DEPTH cannot be negative.")

    if REQUEST_DELAY < 0:
        raise ValueError("SCRAPER_REQUEST_DELAY cannot be negative.")

    if REQUEST_TIMEOUT < 1:
        raise ValueError("SCRAPER_REQUEST_TIMEOUT must be positive.")

    if MAX_RETRIES < 0:
        raise ValueError("SCRAPER_MAX_RETRIES cannot be negative.")


def create_output_directories() -> None:
    """Create output directories if they do not exist."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
