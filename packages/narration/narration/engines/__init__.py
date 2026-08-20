"""Engine registry. `TTS_ENGINE=kokoro` for drafts, `indextts2` for finals."""

from __future__ import annotations

import os

from .base import EMOTIONS, TTSEngine, TTSError, wav_seconds, write_wav_mono16

#: Must stay in sync with `Timeline.engine` in packages/spec/src/timeline.ts.
ENGINE_NAMES = ("kokoro", "indextts2")

DEFAULT_ENGINE = "kokoro"


def get_engine(name: str | None = None, **kwargs: object) -> TTSEngine:
    """Build an engine by name, defaulting to $TTS_ENGINE and then to kokoro.

    Imports the adapter lazily so asking for kokoro never touches IndexTTS-2's
    dependencies and vice versa.
    """
    name = (name or os.environ.get("TTS_ENGINE") or DEFAULT_ENGINE).strip().lower()
    if name == "kokoro":
        from .kokoro import KokoroEngine

        return KokoroEngine(**kwargs)  # type: ignore[arg-type]
    if name == "indextts2":
        from .indextts2 import IndexTTS2Engine

        return IndexTTS2Engine(**kwargs)  # type: ignore[arg-type]
    raise TTSError(f"unknown TTS engine {name!r}; expected one of {', '.join(ENGINE_NAMES)}")


__all__ = [
    "EMOTIONS",
    "ENGINE_NAMES",
    "DEFAULT_ENGINE",
    "TTSEngine",
    "TTSError",
    "get_engine",
    "wav_seconds",
    "write_wav_mono16",
]
