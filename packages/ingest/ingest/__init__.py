"""Turn uploads into sources for the planner.

An upload never replaces the question. It is additional evidence, carried
alongside it and clearly attributed, so the planner can ground the explanation
in what the user actually handed over.
"""

from .core import MAX_CHARS, Engine, IngestError, Kind, Source, classify, clean
from .engines import IMAGE_ENGINES, available, resolve
from .extract import MAX_OCR_PAGES, extract_all, extract_file

__all__ = [
    "IMAGE_ENGINES",
    "MAX_CHARS",
    "MAX_OCR_PAGES",
    "Engine",
    "IngestError",
    "Kind",
    "Source",
    "available",
    "classify",
    "clean",
    "extract_all",
    "extract_file",
    "resolve",
]
