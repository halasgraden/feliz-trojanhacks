
"""Command-line entry point for the Feliz webscraper."""

import argparse
import logging
from pathlib import Path

from config.config import DEFAULT_START_URLS, MAX_DEPTH, MAX_PAGES, OUTPUT_FILE
from pipeline import run_pipeline


def main() -> None:

    parser = argparse.ArgumentParser(
        description="Scrape official housing and legal information."
    )

    parser.add_argument(
        "--url",
        action="append",
        dest="urls",
        help="Seed URL. Can be specified multiple times.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=MAX_PAGES,
        help="Maximum number of pages to crawl.",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=MAX_DEPTH,
        help="Maximum link depth to follow.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Delay between requests in seconds.",
    )
    parser.add_argument(
        "--output",
        default=str(OUTPUT_FILE),
        help="Path to the output JSONL file.",
    )

    args = parser.parse_args()

    if args.max_pages < 1:
        parser.error("--max-pages must be at least 1")

    if args.max_depth < 0:
        parser.error("--max-depth cannot be negative")

    if args.delay < 0:
        parser.error("--delay cannot be negative")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    urls = args.urls if args.urls is not None else None

    documents = run_pipeline(
    start_urls=urls,
    output_file=Path(args.output),
    max_pages=args.max_pages,
    max_depth=args.max_depth,
    delay=args.delay,
)

    print(f"Successfully saved {len(documents)} documents.")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
