"""Word-level alignment: where in the audio each word actually lands.

Two paths, and the timeline records which one produced it:

  * `align()`      - WhisperX forced alignment. Real measurements, real scores.
  * `estimate_words()` - a proportional GUESS used when WhisperX is not
    installed. Good enough to keep the pipeline runnable end to end on a laptop;
    NOT good enough to ship a video against, because a cue landing 200ms early
    is visible. Estimated words carry `score: 0.0` so downstream code can tell.

Install WhisperX on the Nvidia box:
    pip install "explainer-narration[align]"
    # (whisperx pulls torch + faster-whisper; match torch to your CUDA runtime)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

#: Mirrors `Word` in packages/spec/src/timeline.ts: {word, start, end, score?}.
Word = Dict[str, Any]

#: Values written to `timeline.alignment` so a reviewer can tell at a glance
#: whether the sync was measured or guessed.
WHISPERX = "whisperx"
ESTIMATED = "estimated"

_INSTALL_HINT = (
    "WhisperX is not installed. On the render box run:\n"
    '    pip install "explainer-narration[align]"\n'
    "  (equivalently: pip install whisperx, which pulls torch + faster-whisper;\n"
    "   match torch to your CUDA runtime for GPU alignment)\n"
    "Or run the pipeline with --no-align to fall back to estimated word times."
)


class AlignError(RuntimeError):
    """Alignment could not be performed. Message says how to fix it."""


def align(
    audio_path: str | Path,
    transcript: str,
    device: str = "cpu",
    model: Any = None,
    *,
    language: str = "en",
    whisperx_module: Any = None,
) -> List[Word]:
    """Force-align `transcript` against `audio_path`, returning word timings.

    Times are relative to the START OF THIS AUDIO FILE (i.e. beat-relative),
    which is exactly what `BeatTimeline.words` wants.

    `model` is an already-loaded `(align_model, metadata)` pair. Pass it when
    aligning many beats — loading the alignment model costs seconds per call.
    `whisperx_module` is an injection seam for tests; production leaves it None.
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise AlignError(f"cannot align: {audio_path} does not exist")
    transcript = transcript.strip()
    if not transcript:
        raise AlignError("cannot align an empty transcript")

    whisperx = whisperx_module
    if whisperx is None:
        try:
            import whisperx  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AlignError(f"{_INSTALL_HINT}\n\noriginal error: {exc}") from exc

    try:
        audio = whisperx.load_audio(str(audio_path))
        if model is None:
            model = whisperx.load_align_model(language_code=language, device=device)
        align_model, metadata = model
        duration = len(audio) / 16_000  # whisperx.load_audio always resamples to 16kHz
        result = whisperx.align(
            [{"text": transcript, "start": 0.0, "end": duration}],
            align_model,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )
    except AlignError:
        raise
    except Exception as exc:
        raise AlignError(f"WhisperX failed to align {audio_path.name}: {exc}") from exc

    raw = result.get("word_segments") or []
    if not raw:
        raise AlignError(
            f"WhisperX returned no word segments for {audio_path.name}. The audio is "
            "probably silent or the transcript does not match what was spoken."
        )
    return _repair(raw, duration)


def load_align_model(device: str = "cpu", language: str = "en", whisperx_module: Any = None) -> Any:
    """Load the `(align_model, metadata)` pair once and reuse it across beats.

    Loading costs seconds; a 14 beat spec would otherwise pay it 14 times.
    """
    whisperx = whisperx_module
    if whisperx is None:
        try:
            import whisperx  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AlignError(f"{_INSTALL_HINT}\n\noriginal error: {exc}") from exc
    try:
        return whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:
        raise AlignError(
            f"WhisperX could not load its {language!r} alignment model on device {device!r}: {exc}"
        ) from exc


def _repair(raw: List[Dict[str, Any]], audio_seconds: float) -> List[Word]:
    """Fill the timings WhisperX leaves out and force monotonicity.

    WhisperX emits words with no start/end when it cannot align them (numerals,
    unknown tokens). Dropping them would break contiguous phrase matching, so
    they are interpolated from their neighbours instead.
    """
    words: List[Word] = [
        {
            "word": str(item.get("word", "")).strip(),
            "start": _num(item.get("start")),
            "end": _num(item.get("end")),
            "score": _num(item.get("score")),
        }
        for item in raw
    ]
    words = [w for w in words if w["word"]]

    cursor = 0.0
    for index, word in enumerate(words):
        if word["start"] is None:
            word["start"] = cursor
        word["start"] = max(0.0, min(float(word["start"]), audio_seconds))
        if word["start"] < cursor:
            word["start"] = cursor
        if word["end"] is None:
            nxt = next((w["start"] for w in words[index + 1 :] if w["start"] is not None), None)
            word["end"] = float(nxt) if nxt is not None else audio_seconds
        word["end"] = max(float(word["start"]), min(float(word["end"]), audio_seconds))
        word["score"] = 0.0 if word["score"] is None else max(0.0, min(1.0, float(word["score"])))
        cursor = float(word["end"])
    return words


def _num(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


_WORD_SPLIT = re.compile(r"\s+")


def estimate_words(transcript: str, audio_seconds: float) -> List[Word]:
    """ESTIMATE word timings by splitting `audio_seconds` over character counts.

    Longer words take longer to say — a crude but monotonic model that beats
    dividing the duration equally. The words tile the whole clip with no gaps:
    the first starts at 0, the last ends exactly at `audio_seconds`.

    Every word gets `score: 0.0`, which is the contract's "this sync is a guess"
    signal, and any timeline built from these must set `alignment: "estimated"`.
    """
    if audio_seconds < 0:
        raise ValueError(f"audio_seconds must not be negative, got {audio_seconds}")
    tokens = [t for t in _WORD_SPLIT.split(transcript.strip()) if t]
    if not tokens:
        return []

    weights = [float(len(t)) for t in tokens]
    total = sum(weights)
    words: List[Word] = []
    elapsed = 0.0
    cursor = 0.0
    for index, token in enumerate(tokens):
        elapsed += weights[index]
        end = audio_seconds if index == len(tokens) - 1 else elapsed / total * audio_seconds
        end = max(cursor, min(end, audio_seconds))
        words.append({"word": token, "start": cursor, "end": end, "score": 0.0})
        cursor = end
    return words
