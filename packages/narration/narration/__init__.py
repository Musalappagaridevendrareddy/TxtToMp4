"""Narration for the explainer engine.

Turns a VideoSpec into narration audio plus the authoritative `timeline.json`
that Manim and Remotion both read. Nothing here imports torch / kokoro /
whisperx at module scope, so the package (and its tests) work on a laptop with
no models installed.
"""

from .align import align, estimate_words
from .timeline import TimelineError, build_timeline

__all__ = ["align", "estimate_words", "build_timeline", "TimelineError"]
__version__ = "0.1.0"
