
"""Discover and crawl approved website pages."""

import time
from collections import deque
from urllib.parse import urldefrag, urlsplit

from config.config import (
    ALLOWED_HOSTS,
    DEFAULT_START_URLS,
    MAX_DEPTH,
    MAX_PAGES,
    REQUEST_DELAY,
)
from scraper import ScrapedPage, fetch_page, is_allowed_url


def crawl(
    start_urls: list[str] | None = None,
    max_pages: int = MAX_PAGES,
    max_depth: int = MAX_DEPTH,
    delay: float = REQUEST_DELAY,
) -> list[ScrapedPage]:
    """Crawl approved pages using breadth-first traversal."""
    if max_pages < 1:
        raise ValueError("max_pages must be at least 1")

    if max_depth < 0:
        raise ValueError("max_depth cannot be negative")

    if delay < 0:
        raise ValueError("delay cannot be negative")

    seeds = start_urls or DEFAULT_START_URLS
    queue = deque()
    queued = set()
    visited = set()
    pages = []

    for url in seeds:
        url, _ = urldefrag(url)

        if is_allowed_url(url) and url not in queued:
            queue.append((url, 0))
            queued.add(url)

    while queue and len(pages) < max_pages:
        url, depth = queue.popleft()

        if url in visited:
            continue

        visited.add(url)

        page = fetch_page(url)
        if page is None:
            continue

        # Only keep pages whose final URL is on an approved host.
        if not is_allowed_url(page.url):
            continue

        if urlsplit(page.url).hostname not in ALLOWED_HOSTS:
            continue

        pages.append(page)

        if depth < max_depth:
            for link in page.links:
                link, _ = urldefrag(link)

                if (
                    is_allowed_url(link)
                    and link not in queued
                    and link not in visited
                ):
                    queue.append((link, depth + 1))
                    queued.add(link)

        if queue and delay:
            time.sleep(delay)

    return pages
