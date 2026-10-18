
import json

from scraper import ScrapedPage
from pipeline import run_pipeline
from source_loader import Source

def test_pipeline_saves_normalized_documents(tmp_path, monkeypatch):
    page = ScrapedPage(
        url="https://housing.lacity.gov/tenant-guide",
        title="Tenant Guide",
        text=(
            "This is useful tenant information about housing rights "
            "and responsibilities for renters in Los Angeles."
        ),
        content_type="html",
        links=[],
    )

    def fake_crawl(**kwargs):
        return [page]

    monkeypatch.setattr("pipeline.crawl", fake_crawl)

    output_file = tmp_path / "documents.jsonl"

    documents = run_pipeline(
        start_urls=["https://housing.lacity.gov/"],
        output_file=output_file,
        max_pages=1,
        max_depth=0,
        delay=0,
    )

    assert len(documents) == 1
    assert output_file.exists()

    lines = output_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1

    saved_document = json.loads(lines[0])

    assert saved_document["title"] == "Tenant Guide"
    assert saved_document["source_url"] == page.url
    assert saved_document["text"] == page.text
    assert saved_document["content_hash"]
    assert saved_document["document_id"]


def test_pipeline_skips_short_content(tmp_path, monkeypatch):
    page = ScrapedPage(
        url="https://housing.lacity.gov/short",
        title="Short Page",
        text="Too short",
        content_type="html",
        links=[],
    )

    monkeypatch.setattr("pipeline.crawl", lambda **kwargs: [page])
    monkeypatch.setattr(
        "pipeline.load_sources",
        lambda: [Source(
            name="LAHD Housing",
            url="https://housing.lacity.gov/",
        )],
    )

    output_file = tmp_path / "documents.jsonl"

    documents = run_pipeline(
        output_file=output_file,
        delay=0,
    )

    assert documents == []
    assert output_file.exists()
    assert output_file.read_text(encoding="utf-8") == ""


def test_pipeline_uses_csv_source_names(tmp_path, monkeypatch):
    from source_loader import Source

    page = ScrapedPage(
        url="https://housing.lacity.gov/tenant-guide",
        title="Tenant Guide",
        text=(
            "Information about tenant rights, housing protections, "
            "rental assistance, and responsibilities for renters."
        ),
        content_type="html",
        links=[],
    )

    monkeypatch.setattr(
        "pipeline.load_sources",
        lambda: [
            Source(
                name="LAHD Housing",
                url="https://housing.lacity.gov/",
            )
        ],
    )
    monkeypatch.setattr("pipeline.crawl", lambda **kwargs: [page])

    output_file = tmp_path / "documents.jsonl"

    documents = run_pipeline(
        output_file=output_file,
        delay=0,
    )

    assert len(documents) == 1
    assert documents[0]["source_name"] == "LAHD Housing"
