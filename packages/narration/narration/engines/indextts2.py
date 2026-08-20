"""IndexTTS-2 adapter — the final engine, and the reason this architecture works.

IndexTTS-2 accepts a TARGET DURATION for a line and hits it. That single property
inverts the usual pipeline: instead of synthesizing audio and then bending the
animation to fit it, we decide `beat.durationSeconds` in the spec, hand it to the
model, and know every animation timing BEFORE any audio exists. Manim can render
in parallel with narration.

Timbre and emotion are kept separate on purpose:
  * timbre  <- the speaker reference (`reference_audio`, or a synthetic voice id)
  * emotion <- an emotion vector, applied on top of that timbre
Never swap the speaker prompt to "sound more excited"; that changes who is
talking. The mapping from our four spec emotions to IndexTTS-2's emotion vector
lives in `EMOTION_VECTORS` below.

Hardware: GPU expected (~8GB VRAM, fp16). CPU fallback works and is documented —
pass `device="cpu"` or set `INDEXTTS2_DEVICE=cpu`. It is roughly an order of
magnitude slower than realtime, which is fine for an overnight batch of finals
and useless for the draft loop (use Kokoro for that).

Install on the Nvidia box:
    pip install "explainer-narration[indextts2]"
    # plus torch matched to the CUDA runtime, e.g.
    #   pip install torch --index-url https://download.pytorch.org/whl/cu124
    # and the checkpoints:
    #   huggingface-cli download IndexTeam/IndexTTS-2 --local-dir ./checkpoints
Point the adapter at them with INDEXTTS2_MODEL_DIR (default ./checkpoints).

VOICE CONSENT: cloning a real person's voice from `reference_audio` requires a
`consent.json` sitting next to that audio file recording WHO consented and WHEN.
No file, no synthesis — the adapter refuses. See VOICE_CONSENT.md at the package
root. Synthetic/built-in voices need no such file.
"""

from __future__ import annotations

import inspect
import json
import os
from pathlib import Path

from .base import TTSError, validate_emotion, wav_seconds

DEFAULT_MODEL_DIR = "./checkpoints"

#: IndexTTS-2's emotion vector slots, in order.
EMOTION_SLOTS = (
    "happy",
    "angry",
    "sad",
    "afraid",
    "disgusted",
    "melancholic",
    "surprised",
    "calm",
)

#: Our four spec emotions -> {slot: weight}. Deliberately gentle: an explainer
#: narrator that emotes hard sounds like an advert. `neutral` sends no vector at
#: all, which leaves the reference timbre completely untouched.
EMOTION_VECTORS: dict[str, dict[str, float]] = {
    "neutral": {},
    "curious": {"surprised": 0.45},
    "emphatic": {"happy": 0.30, "surprised": 0.20},
    "calm": {"calm": 0.60},
}

#: Parameter names IndexTTS-2 releases have used for duration control, best
#: first. Resolved by introspecting the model's own `infer` signature so a
#: version bump that renames it does not silently drop duration control.
#: Override with INDEXTTS2_DURATION_PARAM if you are on a fork.
DURATION_PARAM_CANDIDATES = (
    "target_duration_seconds",
    "target_duration",
    "duration_seconds",
    "target_seconds",
    "duration",
    "target_len",
    "num_speech_tokens",
    "target_token_count",
)

#: Params measured in speech tokens rather than seconds; `target_seconds` is
#: converted with INDEXTTS2_TOKENS_PER_SECOND (IndexTTS-2's codec runs at 25Hz).
_TOKEN_PARAMS = {"target_len", "num_speech_tokens", "target_token_count"}
DEFAULT_TOKENS_PER_SECOND = 25.0

_INSTALL_HINT = (
    "IndexTTS-2 is not installed. On the render box run:\n"
    '    pip install "explainer-narration[indextts2]"\n'
    "  (equivalently: pip install indextts>=0.2 plus a CUDA-matched torch, e.g.\n"
    "   pip install torch --index-url https://download.pytorch.org/whl/cu124)\n"
    "then fetch the checkpoints:\n"
    "    huggingface-cli download IndexTeam/IndexTTS-2 --local-dir ./checkpoints\n"
    "and set INDEXTTS2_MODEL_DIR if they live somewhere else."
)


def check_voice_consent(reference_audio: Path) -> dict:
    """Refuse to clone a voice without a recorded, dated consent note.

    Requires `consent.json` beside the reference audio with a who-field
    (`speaker` / `consented_by` / `who`) and a when-field (`consented_at` /
    `date` / `when`). A synthetic voice never reaches this function.
    """
    reference_audio = Path(reference_audio)
    if not reference_audio.exists():
        raise TTSError(f"reference audio not found: {reference_audio}")

    consent_path = reference_audio.parent / "consent.json"
    if not consent_path.exists():
        raise TTSError(
            f"refusing to clone the voice in {reference_audio.name}: no consent record.\n"
            f"Create {consent_path} recording who consented and when, e.g.\n"
            '    {"speaker": "Jane Doe", "consented_at": "2026-08-15", '
            '"scope": "explainer narration", "contact": "jane@example.com"}\n'
            "See VOICE_CONSENT.md. Synthetic voices need no consent file — omit "
            "reference_audio to use one."
        )

    try:
        record = json.loads(consent_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TTSError(f"{consent_path} is not readable JSON: {exc}") from exc
    if not isinstance(record, dict):
        raise TTSError(f"{consent_path} must contain a JSON object, got {type(record).__name__}")

    who = next((record[k] for k in ("speaker", "consented_by", "who") if record.get(k)), None)
    when = next((record[k] for k in ("consented_at", "date", "when") if record.get(k)), None)
    missing = [
        label
        for label, value in (("who consented (speaker)", who), ("when (consented_at)", when))
        if not value
    ]
    if missing:
        raise TTSError(
            f"{consent_path} is incomplete — missing {', '.join(missing)}. "
            "A consent record that does not say who and when is not a consent record."
        )
    return record


class IndexTTS2Engine:
    """Duration-controlled final engine. GPU by default, CPU fallback documented."""

    name = "indextts2"

    def __init__(
        self,
        *,
        model_dir: str | Path | None = None,
        reference_audio: str | Path | None = None,
        device: str | None = None,
        tokens_per_second: float | None = None,
        duration_param: str | None = None,
        model: object | None = None,
    ) -> None:
        """`model` is an injection seam for tests; production leaves it None.

        The consent gate runs BEFORE the model loads, so a missing consent.json
        fails in milliseconds instead of after a 30 second checkpoint load.
        """
        self.device = device or os.environ.get("INDEXTTS2_DEVICE", "cuda")
        self.model_dir = Path(model_dir or os.environ.get("INDEXTTS2_MODEL_DIR", DEFAULT_MODEL_DIR))
        self.tokens_per_second = float(
            tokens_per_second
            or os.environ.get("INDEXTTS2_TOKENS_PER_SECOND", DEFAULT_TOKENS_PER_SECOND)
        )

        reference_audio = reference_audio or os.environ.get("INDEXTTS2_REFERENCE_AUDIO") or None
        self.reference_audio = Path(reference_audio) if reference_audio else None
        self.consent = (
            check_voice_consent(self.reference_audio) if self.reference_audio else None
        )

        if model is not None:
            self._model = model
        else:
            self._model = self._load_model()

        self.duration_param = duration_param or os.environ.get(
            "INDEXTTS2_DURATION_PARAM"
        ) or self._resolve_duration_param()

    def _load_model(self) -> object:
        try:
            from indextts.infer_v2 import IndexTTS2  # type: ignore[import-not-found]
        except ImportError as exc:
            raise TTSError(f"{_INSTALL_HINT}\n\noriginal error: {exc}") from exc

        cfg = self.model_dir / "config.yaml"
        if not cfg.exists():
            raise TTSError(
                f"IndexTTS-2 checkpoints not found: expected {cfg}.\n"
                "    huggingface-cli download IndexTeam/IndexTTS-2 --local-dir ./checkpoints\n"
                "or set INDEXTTS2_MODEL_DIR to where they already are."
            )
        try:
            return IndexTTS2(
                cfg_path=str(cfg),
                model_dir=str(self.model_dir),
                device=self.device,
                use_fp16=self.device.startswith("cuda"),
            )
        except Exception as exc:
            hint = (
                "\nIf this is an out-of-memory or CUDA error, the CPU fallback works: "
                "set INDEXTTS2_DEVICE=cpu (roughly 10x slower than realtime — fine for a "
                "batch of finals, too slow for the draft loop, use Kokoro there)."
                if self.device.startswith("cuda")
                else ""
            )
            raise TTSError(f"IndexTTS-2 failed to load from {self.model_dir}: {exc}{hint}") from exc

    def _resolve_duration_param(self) -> str | None:
        """Find the model's duration-control kwarg by introspecting `infer`."""
        infer = getattr(self._model, "infer", None)
        if infer is None:
            raise TTSError("the IndexTTS-2 model object has no .infer() method")
        try:
            params = inspect.signature(infer).parameters
        except (TypeError, ValueError):  # pragma: no cover - C-implemented callable
            return None
        for candidate in DURATION_PARAM_CANDIDATES:
            if candidate in params:
                return candidate
        if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
            return DURATION_PARAM_CANDIDATES[0]  # forwarded through **generation_kwargs
        return None

    def _duration_kwargs(self, target_seconds: float | None) -> dict[str, object]:
        if target_seconds is None:
            return {}
        if target_seconds <= 0:
            raise TTSError(f"target_seconds must be positive, got {target_seconds}")
        if not self.duration_param:
            raise TTSError(
                "this IndexTTS-2 build exposes no duration-control parameter, which is the "
                f"whole reason it is the final engine. Tried {DURATION_PARAM_CANDIDATES}. "
                "Set INDEXTTS2_DURATION_PARAM to the right name for your build, or render "
                "the draft with TTS_ENGINE=kokoro."
            )
        if self.duration_param in _TOKEN_PARAMS:
            return {self.duration_param: int(round(target_seconds * self.tokens_per_second))}
        return {self.duration_param: float(target_seconds)}

    def _emotion_kwargs(self, emotion: str) -> dict[str, object]:
        weights = EMOTION_VECTORS[validate_emotion(emotion)]
        if not weights:
            return {}
        # Positional 8-vector; timbre is untouched because the speaker prompt is
        # a separate argument.
        return {"emo_vector": [float(weights.get(slot, 0.0)) for slot in EMOTION_SLOTS]}

    def synthesize(
        self,
        text: str,
        out_path: Path,
        *,
        target_seconds: float | None = None,
        emotion: str = "neutral",
    ) -> float:
        """Synthesize to `out_path` aiming at `target_seconds`; return MEASURED length.

        The model aims at the target but is not guaranteed to land exactly on it,
        so the timeline is still built from the measured duration.
        """
        text = text.strip()
        if not text:
            raise TTSError("refusing to synthesize empty narration")
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        kwargs: dict[str, object] = {
            "spk_audio_prompt": str(self.reference_audio) if self.reference_audio else None,
            "text": text,
            "output_path": str(out_path),
        }
        kwargs.update(self._emotion_kwargs(emotion))
        kwargs.update(self._duration_kwargs(target_seconds))

        try:
            self._model.infer(**kwargs)  # type: ignore[attr-defined]
        except Exception as exc:
            raise TTSError(f"IndexTTS-2 failed on {text[:60]!r}: {exc}") from exc

        if not out_path.exists():
            raise TTSError(f"IndexTTS-2 reported success but wrote no file at {out_path}")
        return wav_seconds(out_path)
