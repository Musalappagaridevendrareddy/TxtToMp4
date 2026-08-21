"""Kokoro-82M adapter — the draft engine.

Why it exists: 82M params, CPU-only, roughly 33x realtime. A 90 second script
narrates in about three seconds, so the author can iterate on wording and
animation without ever touching a GPU.

What it CANNOT do: hit a target duration. Kokoro has no duration control, so
`synthesize` IGNORES `target_seconds` entirely and returns whatever length it
produced. The timeline is then built from the MEASURED audio, which is why draft
videos drift from `spec.durationSeconds` and final (IndexTTS-2) renders do not.
Kokoro also has no emotion control; `emotion` is validated and then ignored.
Emotional colour on a draft comes from voice choice alone.

Install (Nvidia box or any laptop — CPU is fine):
    pip install "explainer-narration[kokoro]"
which pulls `kokoro>=0.9` and `soundfile`, and needs the `espeak-ng` binary
on PATH for out-of-dictionary words.
"""

from __future__ import annotations

import os
from pathlib import Path

from .base import TTSError, to_float_samples, validate_emotion, write_wav_mono16

DEFAULT_VOICE = "af_heart"
DEFAULT_SAMPLE_RATE = 24_000
#: Kokoro's language codes: 'a' = American English, 'b' = British English, etc.
DEFAULT_LANG_CODE = "a"

_INSTALL_HINT = (
    "Kokoro is not installed. On the render box run:\n"
    '    pip install "explainer-narration[kokoro]"\n'
    "  (equivalently: pip install kokoro>=0.9 soundfile)\n"
    "and install the espeak-ng binary so out-of-dictionary words can be spoken:\n"
    "    Windows: winget install eSpeak-NG.eSpeak-NG\n"
    "    Debian/Ubuntu: sudo apt-get install espeak-ng"
)


class KokoroEngine:
    """CPU draft engine. Fast, cheap, duration-blind."""

    name = "kokoro"

    def __init__(
        self,
        *,
        voice: str | None = None,
        lang_code: str = DEFAULT_LANG_CODE,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        pipeline: object | None = None,
    ) -> None:
        """`pipeline` is an injection seam for tests; production leaves it None.

        The kokoro package is imported HERE, not at module scope, so importing
        `narration.engines.kokoro` works on a machine with no models installed.
        """
        self.voice = voice or os.environ.get("KOKORO_VOICE", DEFAULT_VOICE)
        self.sample_rate = sample_rate
        self.lang_code = lang_code

        if pipeline is not None:
            self._pipeline = pipeline
            return

        try:
            from kokoro import KPipeline  # type: ignore[import-not-found]
        except ImportError as exc:
            raise TTSError(f"{_INSTALL_HINT}\n\noriginal error: {exc}") from exc

        try:
            self._pipeline = KPipeline(lang_code=lang_code)
        except Exception as exc:  # model download / weights failure
            raise TTSError(
                f"Kokoro failed to load (lang_code={lang_code!r}). Its weights are "
                f"fetched from HuggingFace on first use, so this box needs network "
                f"access or a warm HF cache.\n\noriginal error: {exc}"
            ) from exc

    def synthesize(
        self,
        text: str,
        out_path: Path,
        *,
        target_seconds: float | None = None,
        emotion: str = "neutral",
    ) -> float:
        """Synthesize `text` to `out_path`, returning the MEASURED duration.

        `target_seconds` is accepted for protocol compatibility and deliberately
        ignored — see the module docstring. `emotion` is validated (so a bad spec
        fails the same way on both engines) and then ignored.
        """
        validate_emotion(emotion)
        text = text.strip()
        if not text:
            raise TTSError("refusing to synthesize empty narration")

        try:
            chunks = self._pipeline(text, voice=self.voice)
            samples: list[float] = []
            for chunk in chunks:
                # KPipeline yields Result objects in newer versions, or (graphemes, phonemes, audio) triples.
                if hasattr(chunk, "audio"):
                    audio = chunk.audio
                else:
                    audio = chunk[-1] if isinstance(chunk, (tuple, list)) else chunk
                samples.extend(to_float_samples(audio))
        except TTSError:
            raise
        except Exception as exc:
            raise TTSError(
                f"Kokoro failed on voice {self.voice!r}. If the voice name is wrong "
                f"the pipeline raises here — check KOKORO_VOICE.\n\n"
                f"original error: {exc}"
            ) from exc

        if not samples:
            raise TTSError(f"Kokoro produced no audio for: {text[:60]!r}")

        return write_wav_mono16(out_path, samples, self.sample_rate)
