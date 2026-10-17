
"""Standard document format for the Feliz ingestion pipeline."""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit


def canonicalize_url(url: str) -> str:
    """Normalize a URL and remove its fragment."""
    parts = urlsplit(url.strip())

    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path or "/",
            parts.query,
            "",
        )
    )


def calculate_content_hash(text: str) -> str:
    """Generate a stable hash for document text."""
    normalized_text = " ".join(text.split())
    return hashlib.sha256(
        normalized_text.encode("utf-8")
    ).hexdigest()


def build_document(
    *,
    url: str,
    title: str,
    text: str,
    source_name: str,
    content_type: str = "html",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a normalized document record."""
    canonical_url = canonicalize_url(url)
    cleaned_text = text.strip()

    document_id = hashlib.sha256(
        canonical_url.encode("utf-8")
    ).hexdigest()

    return {
        "document_id": document_id,
        "title": title.strip() or canonical_url,
        "source_url": canonical_url,
        "source_name": source_name,
        "content_type": content_type,
        "text": cleaned_text,
        "content_hash": calculate_content_hash(cleaned_text),
        "last_fetched_at": datetime.now(timezone.utc).isoformat(),
        "metadata": metadata or {},
    }


def serialize_document(document: dict[str, Any]) -> str:
    """Serialize a document as one JSONL record."""
    return json.dumps(document, ensure_ascii=False)
