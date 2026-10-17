
"""Extract text from PDF documents."""

from io import BytesIO

from pypdf import PdfReader

from config.config import MAX_PDF_PAGES


def extract_pdf(content: bytes) -> str:
    """Extract text from a PDF byte stream."""
    try:
        reader = PdfReader(BytesIO(content), strict=False)

        if reader.is_encrypted:
            return ""

        extracted_pages = []

        for page in reader.pages[:MAX_PDF_PAGES]:
            page_text = page.extract_text() or ""

            if page_text.strip():
                extracted_pages.append(page_text)

        return "\n".join(extracted_pages).strip()

    except Exception:
        return ""
