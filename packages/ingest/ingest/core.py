"""Extraction core: what a source is, and how one is produced from a file.

The rule this package exists to serve: an upload is a *source alongside* the
question, never a replacement for it. Nothing here interprets the content or
decides what the video is about — it only turns bytes into text and records
honestly how that text was obtained.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

Kind = Literal["text", "pdf", "image", "unsupported"]
Engine = Literal["none", "text", "pdf-text", "rapidocr", "tesseract", "vlm"]

#: Per-source ceiling. The planner prompt already carries the archetype
#: catalogue; an unbounded 200-page PDF would crowd it out and degrade the very
#: reasoning the source is meant to inform. Truncation is always reported.
MAX_CHARS = 20_000

#: A PDF page yielding fewer than this many characters is treated as a scan
#: rather than as text. A genuinely text-bearing page clears it comfortably,
#: while a scanned page yields a handful of stray ligatures at most.
TEXT_LAYER_MIN_CHARS_PER_PAGE = 40

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".rst", ".csv", ".json", ".yaml", ".yml"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}
PDF_SUFFIXES = {".pdf"}


class IngestError(RuntimeError):
    """Raised when a file cannot be turned into text at all."""


@dataclass
class Source:
    """One uploaded file, reduced to text plus the provenance of that text."""

    filename: str
    kind: Kind
    engine: Engine
    text: str
    chars: int = 0
    page_count: int = 0
    truncated: bool = False
    #: Populated when extraction partly failed but still produced usable text,
    #: so callers can surface a degraded result instead of an all-or-nothing
    #: error.
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def classify(path: Path) -> Kind:
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return "text"
    if suffix in PDF_SUFFIXES:
        return "pdf"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    return "unsupported"


_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BLANK_RUN = re.compile(r"\n{3,}")
_SPACE_RUN = re.compile(r"[ \t]{2,}")


def clean(raw: str) -> str:
    """Normalise extracted text.

    OCR output and PDF text layers carry control characters and ragged
    whitespace that waste prompt budget and blur where a source ends. NFKC also
    folds the ligatures a PDF text layer loves to emit back into plain ASCII.
    """
    text = unicodedata.normalize("NFKC", raw)
    text = _CONTROL.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _SPACE_RUN.sub(" ", text)
    text = _BLANK_RUN.sub("\n\n", text)
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def finish(source: Source) -> Source:
    """Apply cleaning and the length ceiling, recording both."""
    source.text = clean(source.text)

    if len(source.text) > MAX_CHARS:
        window = source.text[:MAX_CHARS]
        # Prefer a paragraph boundary when one is near the end, so the tail is
        # not a severed sentence the model then tries to complete.
        cut = window.rfind("\n\n")
        source.text = window[:cut] if cut > MAX_CHARS * 0.8 else window
        source.truncated = True
        source.warnings.append(f"truncated to {len(source.text)} characters")

    source.chars = len(source.text)
    return source
