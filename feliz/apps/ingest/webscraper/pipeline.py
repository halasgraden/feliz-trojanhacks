
"""End-to-end scraping and document preparation pipeline."""

import json
import logging
from pathlib import Path

from cleaner import clean_text, deduplicate_documents, is_useful_content
from config.config import OUTPUT_FILE
from crawler import crawl
from document_schema import build_document
from source_loader import Source, load_sources

logger = logging.getLogger(__name__)


def run_pipeline(
    start_urls: list[str] | None = None,
    output_file: Path | None = None,
    max_pages: int = 50,
    max_depth: int = 2,
    delay: float = 0.5,
) -> list[dict]:
    """Crawl configured sources and write normalized JSONL documents."""
    target = Path(output_file) if output_file else OUTPUT_FILE

    if start_urls is None:
        sources = load_sources()
    else:
        # Preserve the existing interface for explicit URL overrides.
        sources = [
            Source(name=url.split("/")[2], url=url)
            for url in start_urls
        ]

    documents = []

    for source in sources:
        logger.info("Processing source: %s (%s)", source.name, source.url)

        pages = crawl(
            start_urls=[source.url],
            max_pages=max_pages,
            max_depth=max_depth,
            delay=delay,
        )

        for page in pages:
            text = clean_text(page.text)

            if not is_useful_content(text):
                logger.info("Skipping short content: %s", page.url)
                continue

            document = build_document(
                url=page.url,
                title=page.title,
                text=text,
                source_name=source.name,
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
