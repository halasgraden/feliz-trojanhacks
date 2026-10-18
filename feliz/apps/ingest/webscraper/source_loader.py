
"""Load and validate website sources from a CSV file."""

import csv
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from config.config import ALLOWED_HOSTS, PROJECT_ROOT


DEFAULT_SOURCES_FILE = PROJECT_ROOT / "data" / "sources.csv"


@dataclass(frozen=True)
class Source:
    """A configured website source."""

    name: str
    url: str


def validate_source_url(url: str) -> bool:
    """Check that a URL uses HTTP(S) and an approved hostname."""
    try:
        parts = urlsplit(url.strip())

        return (
            parts.scheme.lower() in {"http", "https"}
            and parts.hostname is not None
            and parts.hostname.lower() in ALLOWED_HOSTS
            and parts.username is None
            and parts.password is None
        )
    except ValueError:
        return False


def load_sources(
    csv_path: str | Path = DEFAULT_SOURCES_FILE,
) -> list[Source]:
    """Read source names and URLs from CSV, rejecting invalid rows."""
    path = Path(csv_path)

    if not path.is_file():
        raise FileNotFoundError(f"Sources CSV not found: {path}")

    sources = []
    seen_urls = set()

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)

        if not reader.fieldnames or not {"name", "url"}.issubset(
            set(reader.fieldnames)
        ):
            raise ValueError("CSV must contain 'name' and 'url' columns")

        for line_number, row in enumerate(reader, start=2):
            name = (row.get("name") or "").strip()
            url = (row.get("url") or "").strip()

            if not name or not url:
                raise ValueError(
                    f"Missing name or URL on CSV line {line_number}"
                )

            if not validate_source_url(url):
                raise ValueError(
                    f"Unapproved or invalid URL on line {line_number}: {url}"
                )

            if url in seen_urls:
                continue

            seen_urls.add(url)
            sources.append(Source(name=name, url=url))

    return sources
