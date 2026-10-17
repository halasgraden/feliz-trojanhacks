
from unittest.mock import patch

import pytest

from crawler import crawl
from scraper import ScrapedPage


def make_page(url, links=None):
    return ScrapedPage(
        url=url,
        title="Tenant Guide",
        text="Information about tenant rights and housing.",
        content_type="html",
        links=links or [],
    )


def test_crawler_visits_discovered_pages():
    first_url = "https://housing.lacity.gov/"
    second_url = "https://housing.lacity.gov/tenant-guide"

    first_page = make_page(first_url, [second_url])
    second_page = make_page(second_url)

    with patch(
        "crawler.fetch_page",
        side_effect=[first_page, second_page],
    ) as mock_fetch:
        pages = crawl(
            start_urls=[first_url],
            max_pages=5,
            max_depth=1,
            delay=0,
        )

    assert len(pages) == 2
    assert mock_fetch.call_count == 2
    assert pages[1].url == second_url


def test_crawler_respects_max_pages():
    first_url = "https://housing.lacity.gov/"
    second_url = "https://housing.lacity.gov/tenant-guide"

    with patch(
        "crawler.fetch_page",
        side_effect=[
            make_page(first_url, [second_url]),
            make_page(second_url),
        ],
    ) as mock_fetch:
        pages = crawl(
            start_urls=[first_url],
            max_pages=1,
            max_depth=2,
            delay=0,
        )

    assert len(pages) == 1
    assert mock_fetch.call_count == 1


def test_crawler_rejects_external_seed():
    with patch("crawler.fetch_page") as mock_fetch:
        pages = crawl(
            start_urls=["https://example.com/"],
            max_pages=5,
            max_depth=1,
            delay=0,
        )

    assert pages == []
    mock_fetch.assert_not_called()


def test_crawler_rejects_invalid_limits():
    with pytest.raises(ValueError):
        crawl(max_pages=0)

    with pytest.raises(ValueError):
        crawl(max_depth=-1)

    with pytest.raises(ValueError):
        crawl(delay=-1)
