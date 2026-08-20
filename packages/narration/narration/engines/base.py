"""The TTS seam.

Everything downstream of this file only knows `TTSEngine.synthesize`. That is
what lets the draft loop run on Kokoro (fast, CPU, no duration control) and the
final render on IndexTTS-2 (slow, GPU, hits a target duration per line) without
the pipeline caring which one produced the wav.
"""

from __future__ import annotations

import sys
import wave
from array import array
from pathlib import Path
from typing import Iterable, Protocol, runtime_checkable

#: The four emotions the spec allows (mirrors `Emotion` in packages/spec/src/schema.ts).
EMOTIONS = ("neutral", "curious", "emphatic", "calm")


class TTSError(RuntimeError):
    """Anything that stops an engine producing audio.

    Raised with a message a human can act on: which package to install, which
    file to create, which env var to set. Never a bare stack trace.
    """


@runtime_checkable
class TTSEngine(Protocol):
    """Protocol every engine adapter satisfies.

    `name` must be one of the literals in the Timeline contract
    (`'kokoro' | 'indextts2'`), because it is written straight into
    `timeline.json`.
    """

    name: str

    def synthesize(
        self,
        text: str,
        out_path: Path,
        *,
        target_seconds: float | None = None,
        emotion: str = "neutral",
    ) -> float:
        """Write mono wav to `out_path` and return its ACTUAL duration in seconds.

        `target_seconds` is a request, not a promise. Engines that cannot control
        duration (Kokoro) ignore it. Callers must use the returned value, never
        the requested one — the timeline is built from measured audio.
        """
        ...


def validate_emotion(emotion: str) -> str:
    if emotion not in EMOTIONS:
        raise TTSError(
            f"unknown emotion {emotion!r}; the spec allows {', '.join(EMOTIONS)}"
        )
    return emotion


def write_wav_mono16(path: Path, samples: Iterable[float], sample_rate: int) -> float:
    """Write float samples in [-1, 1] as 16-bit mono PCM. Returns duration.

    stdlib `wave` on purpose: soundfile/torchaudio would drag a native dependency
    into the base install for something the standard library already does.
    """
    if sample_rate <= 0:
        raise TTSError(f"sample_rate must be positive, got {sample_rate}")
    pcm = array("h", (int(round(max(-1.0, min(1.0, float(s))) * 32767)) for s in samples))
    if sys.byteorder == "big":  # wav is little-endian; array is native-endian
        pcm.byteswap()
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())
    return len(pcm) / sample_rate


def wav_seconds(path: Path) -> float:
    """Measured length of a wav file."""
    try:
        with wave.open(str(path), "rb") as handle:
            rate = handle.getframerate()
            if rate <= 0:
                raise TTSError(f"{path} reports a sample rate of {rate}")
            return handle.getnframes() / rate
    except wave.Error as exc:  # pragma: no cover - corrupt file path
        raise TTSError(f"{path} is not a readable wav file: {exc}") from exc


def wav_sample_rate(path: Path) -> int:
    try:
        with wave.open(str(path), "rb") as handle:
            return handle.getframerate()
    except wave.Error as exc:  # pragma: no cover - corrupt file path
        raise TTSError(f"{path} is not a readable wav file: {exc}") from exc


def to_float_samples(chunk: object) -> list[float]:
    """Flatten whatever a model handed back (torch tensor, ndarray, list) to floats.

    Kept here so neither adapter has to import torch or numpy to touch its own
    output.
    """
    obj = chunk
    for attr in ("detach", "cpu", "numpy"):  # torch tensor -> ndarray
        method = getattr(obj, attr, None)
        if callable(method):
            obj = method()
    flatten = getattr(obj, "flatten", None)
    if callable(flatten):
        obj = flatten()
    tolist = getattr(obj, "tolist", None)
    if callable(tolist):
        obj = tolist()
    if isinstance(obj, (int, float)):
        return [float(obj)]
    out: list[float] = []
    for value in obj:  # type: ignore[union-attr]
        if isinstance(value, (list, tuple)):
            out.extend(float(v) for v in value)
        else:
            out.append(float(value))
    return out
