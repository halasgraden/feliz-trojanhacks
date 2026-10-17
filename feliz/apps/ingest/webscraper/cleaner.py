
"""Text cleaning utilities for the Feliz webscraper."""

import re
import unicodedata


def clean_text(text: str) -> str:
    """Normalize whitespace and remove unwanted control characters."""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(
        char
        for char in text
        if char in "\n\t" or unicodedata.category(char) != "Cc"
    )
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_title(title: str) -> str:
    """Clean a page title."""
    return clean_text(title)


def is_useful_content(text: str, minimum_length: int = 80) -> bool:
    """Check whether extracted text is long enough to process."""
    return len(clean_text(text)) >= minimum_length


def deduplicate_documents(documents: list[dict]) -> list[dict]:
    """Remove documents with duplicate URLs or content hashes."""
    seen_urls = set()
    seen_hashes = set()
    unique_documents = []

    for document in documents:
        url = document["source_url"]
        content_hash = document["content_hash"]

        if url in seen_urls or content_hash in seen_hashes:
            continue

        seen_urls.add(url)
        seen_hashes.add(content_hash)
        unique_documents.append(document)

    return unique_documents
