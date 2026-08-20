"""The tier chain: cheapest extraction that works, falling through to OCR.

Tier 0  text file              read it
Tier 0  PDF with a text layer  pypdf, no model, perfect fidelity
Tier 1  PDF without one        rasterise, then OCR each page
Tier 1  image                  OCR

Most uploaded documents are born-digital PDFs that already carry their text, so
the common path costs nothing and loses nothing. OCR is the fallback, not the
default — which is also why a missing OCR engine is not fatal for a text PDF.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from .core import TEXT_LAYER_MIN_CHARS_PER_PAGE, IngestError, Source, classify, finish
from .engines import read_image, resolve

#: Rasterising and OCR-ing a very long scan is slow and rarely adds signal past
#: the first pages, which is where a document states what it is about.
MAX_OCR_PAGES = 20


def extract_file(path: str | Path, engine: str | None = None) -> Source:
    """Turn one uploaded file into a `Source`.

    `engine` is consulted only when OCR is actually needed, so a text PDF
    extracts successfully on a machine with no OCR installed at all.
    """
    path = Path(path)
    if not path.is_file():
        raise IngestError(f"Not a file: {path}")

    kind = classify(path)
    if kind == "unsupported":
        raise IngestError(
            f"Cannot read {path.name}: unsupported type {path.suffix or '(none)'}. "
            "Supported: plain text and markdown, PDF, and common image formats."
        )

    if kind == "text":
        return finish(
            Source(
                filename=path.name,
                kind="text",
                engine="text",
                text=path.read_text(encoding="utf-8", errors="replace"),
                page_count=1,
            )
        )

    if kind == "pdf":
        return _extract_pdf(path, engine)

    resolved = resolve(engine)
    return finish(
        Source(
            filename=path.name,
            kind="image",
            engine=resolved,
            text=read_image(path, resolved),
            page_count=1,
        )
    )


def _extract_pdf(path: Path, engine: str | None) -> Source:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise IngestError(
            "Reading PDFs needs pypdf: pip install -e 'packages/ingest[pdf]'"
        ) from exc

    reader = PdfReader(str(path))
    pages = len(reader.pages)
    if pages == 0:
        raise IngestError(f"{path.name} has no pages")

    text = "\n\n".join((page.extract_text() or "") for page in reader.pages)

    # A born-digital PDF clears this comfortably. A scan yields a few stray
    # ligatures, which would otherwise pass as a successful extraction and
    # silently hand the planner an almost-empty source.
    if len(text.strip()) >= TEXT_LAYER_MIN_CHARS_PER_PAGE * min(pages, 3):
        return finish(
            Source(filename=path.name, kind="pdf", engine="pdf-text", text=text, page_count=pages)
        )

    return _ocr_pdf(path, pages, engine)


def _ocr_pdf(path: Path, pages: int, engine: str | None) -> Source:
    """Rasterise a scanned PDF and OCR it, page by page."""
    resolved = resolve(engine)

    try:
        import pypdfium2
    except ImportError as exc:
        raise IngestError(
            f"{path.name} has no text layer, so it must be rasterised before OCR: "
            "pip install -e 'packages/ingest[raster]'"
        ) from exc

    warnings: list[str] = []
    limit = min(pages, MAX_OCR_PAGES)
    if pages > limit:
        warnings.append(f"only the first {limit} of {pages} pages were read")

    scale = float(os.environ.get("OCR_RASTER_SCALE", "2.0"))
    chunks: list[str] = []

    document = pypdfium2.PdfDocument(str(path))
    try:
        for index in range(limit):
            bitmap = document[index].render(scale=scale)
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
                temp = Path(handle.name)
            try:
                bitmap.to_pil().save(temp)
                chunks.append(read_image(temp, resolved))
            finally:
                temp.unlink(missing_ok=True)
    finally:
        document.close()

    return finish(
        Source(
            filename=path.name,
            kind="pdf",
            engine=resolved,
            text="\n\n".join(chunks),
            page_count=pages,
            warnings=warnings,
        )
    )


def extract_all(paths: list[str | Path], engine: str | None = None) -> list[Source]:
    """Extract several uploads, preserving order.

    One unreadable file does not sink the batch: the question still stands on
    its own and the remaining sources are still worth having. The failure is
    recorded as a `Source` carrying the reason, so the caller can show it
    rather than pretending the upload succeeded.
    """
    sources: list[Source] = []
    for path in paths:
        try:
            sources.append(extract_file(path, engine))
        except IngestError as error:
            sources.append(
                Source(
                    filename=Path(path).name,
                    kind="unsupported",
                    engine="none",
                    text="",
                    warnings=[str(error)],
                )
            )
    return sources
