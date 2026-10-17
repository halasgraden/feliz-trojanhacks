
"""End-to-end scraping and document preparation pipeline."""

import json
import logging
from pathlib import Path

from cleaner import clean_text, deduplicate_documents, is_useful_content
from config.config import DEFAULT_START_URLS, OUTPUT_FILE
from crawler import crawl
from document_schema import build_document

logger = logging.getLogger(__name__)


def run_pipeline(
    start_urls: list[str] | None = None,
    output_file: Path | None = None,
    max_pages: int = 50,
    max_depth: int = 2,
    delay: float = 0.5,
) -> list[dict]:
    """Crawl websites, normalize documents, and save JSONL output."""
    target = Path(output_file) if output_file else OUTPUT_FILE
    urls = start_urls if start_urls is not None else DEFAULT_START_URLS

    pages = crawl(
        start_urls=urls,
        max_pages=max_pages,
        max_depth=max_depth,
        delay=delay,
    )

    documents = []

    for page in pages:
        text = clean_text(page.text)

        if not is_useful_content(text):
            logger.info("Skipping short content: %s", page.url)
            continue

        document = build_document(
            url=page.url,
            title=page.title,
            text=text,
            source_name=page.url.split("/")[2],
            content_type=page.content_type,
            metadata={"extractor": "feliz-webscraper"},
        )

        documents.append(document)

    documents = deduplicate_documents(documents)

    target.parent.mkdir(parents=True, exist_ok=True)

    with target.open("w", encoding="utf-8") as output:
        for document in documents:
            output.write(
                json.dumps(document, ensure_ascii=False) + "\n"
            )

    logger.info("Saved %d documents to %s", len(documents), target)

    return documents
