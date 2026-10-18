
import csv

import pytest

from source_loader import load_sources, validate_source_url


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["name", "url"])
        writer.writeheader()
        writer.writerows(rows)


def test_load_sources_reads_csv(tmp_path):
    path = tmp_path / "sources.csv"
    write_csv(
        path,
        [
            {
                "name": "LAHD Housing",
                "url": "https://housing.lacity.gov/",
            },
            {
                "name": "California Courts",
                "url": "https://selfhelp.courts.ca.gov/",
            },
        ],
    )

    sources = load_sources(path)

    assert len(sources) == 2
    assert sources[0].name == "LAHD Housing"
    assert sources[1].url == "https://selfhelp.courts.ca.gov/"


def test_rejects_unapproved_host():
    assert not validate_source_url("https://example.com/")


def test_rejects_non_http_url():
    assert not validate_source_url("javascript:alert(1)")


def test_rejects_invalid_csv_row(tmp_path):
    path = tmp_path / "sources.csv"
    write_csv(
        path,
        [{"name": "Unknown Site", "url": "https://example.com/"}],
    )

    with pytest.raises(ValueError, match="Unapproved"):
        load_sources(path)


def test_rejects_missing_columns(tmp_path):
    path = tmp_path / "sources.csv"
    path.write_text("title,website\nLAHD,https://housing.lacity.gov/\n")

    with pytest.raises(ValueError, match="name"):
        load_sources(path)


def test_deduplicates_identical_urls(tmp_path):
    path = tmp_path / "sources.csv"
    write_csv(
        path,
        [
            {
                "name": "LAHD",
                "url": "https://housing.lacity.gov/",
            },
            {
                "name": "LAHD duplicate",
                "url": "https://housing.lacity.gov/",
            },
        ],
    )

    assert len(load_sources(path)) == 1
