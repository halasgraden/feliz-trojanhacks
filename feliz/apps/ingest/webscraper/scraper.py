
"""Fetch and extract content from individual web pages."""

from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

from cleaner import clean_text, clean_title
from config.config import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_HOSTS,
    MAX_RESPONSE_BYTES,
    REQUEST_TIMEOUT,
    USER_AGENT,
)


@dataclass
class ScrapedPage:
    """Content extracted from one webpage or PDF."""

    url: str
    title: str
    text: str
    content_type: str
    links: list[str]


def is_allowed_url(url: str) -> bool:
    """Allow only HTTP(S) URLs on configured hosts."""
    try:
        parts = urlsplit(url)

        return (
            parts.scheme.lower() in {"http", "https"}
            and parts.hostname is not None
            and parts.hostname.lower() in ALLOWED_HOSTS
            and parts.username is None
            and parts.password is None
        )
    except ValueError:
        return False


def extract_html(html: str, page_url: str) -> ScrapedPage:
    """Extract a page title, readable text, and approved links."""
    soup = BeautifulSoup(html, "html.parser")

    title_tag = soup.find("title")
    title = (
        clean_title(title_tag.get_text(" ", strip=True))
        if title_tag
        else ""
    )

    # Remove common navigation and non-content elements.
    for element in soup.find_all(
        ["script", "style", "noscript", "svg", "nav", "footer", "header"]
    ):
        element.decompose()

    main_content = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"role": "main"})
        or soup.body
        or soup
    )

    text = clean_text(main_content.get_text(" ", strip=True))

    links = []
    for anchor in soup.find_all("a", href=True):
        absolute_url = urljoin(page_url, anchor["href"]).split("#", 1)[0]

        if is_allowed_url(absolute_url):
            links.append(absolute_url)

    return ScrapedPage(
        url=page_url,
        title=title,
        text=text,
        content_type="html",
        links=list(dict.fromkeys(links)),
    )


def fetch_page(
    url: str,
    session: requests.Session | None = None,
) -> ScrapedPage | None:
    """Fetch a single approved HTML page or PDF."""
    if not is_allowed_url(url):
        return None

    client = session or requests.Session()

    try:
        with client.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/pdf;q=0.9",
            },
            timeout=REQUEST_TIMEOUT,
            stream=True,
            allow_redirects=True,
        ) as response:
            response.raise_for_status()

            # Do not accept a redirect to an unapproved host.
            if not is_allowed_url(response.url):
                return None

            content_type = (
                response.headers.get("Content-Type", "")
                .split(";", 1)[0]
                .strip()
                .lower()
            )

            if content_type not in ALLOWED_CONTENT_TYPES:
                return None

            content_length = response.headers.get("Content-Length")
            if content_length:
                try:
                    if int(content_length) > MAX_RESPONSE_BYTES:
                        return None
                except ValueError:
                    return None

            body = bytearray()

            for chunk in response.iter_content(chunk_size=8192):
                body.extend(chunk)

                if len(body) > MAX_RESPONSE_BYTES:
                    return None

            if content_type == "application/pdf":
                from pdf_parser import extract_pdf

                text = clean_text(extract_pdf(bytes(body)))

                if not text:
                    return None

                filename = urlsplit(response.url).path.rsplit("/", 1)[-1]

                return ScrapedPage(
                    url=response.url,
                    title=filename or "PDF document",
                    text=text,
                    content_type="pdf",
                    links=[],
                )

            encoding = response.encoding or "utf-8"
            html = bytes(body).decode(encoding, errors="replace")

            return extract_html(html, response.url)

    except (requests.RequestException, ValueError):
        return None
