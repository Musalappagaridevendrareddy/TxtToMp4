"""CLI: spec in, narration audio + timeline.json out.

    python -m narration.synthesize --spec fixtures/x.json --out renders/<id>/ \
        [--engine kokoro] [--fps 30] [--no-align] [--dry-run]

`--dry-run` is the important one for anyone without models: it skips synthesis
entirely, builds the timeline from the spec's own durations and estimated word
times, and still writes a byte-for-byte valid timeline.json. The whole pipeline
downstream of here can be exercised with zero GB of weights on disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

from .align import ESTIMATED, WHISPERX, AlignError, align, estimate_words, load_align_model
from .engines import DEFAULT_ENGINE, ENGINE_NAMES, TTSError, get_engine
from .engines.base import wav_sample_rate
from .timeline import TimelineError, build_timeline

DEFAULT_FPS = 30
DEFAULT_SAMPLE_RATE = 24_000


class PipelineError(RuntimeError):
    """A failure the user can fix, reported without a stack trace."""


# --------------------------------------------------------------------------- hash


def spec_hash(spec: Any) -> str:
    """Port of `specHash` in packages/spec/src/hash.ts — sha256 of a stable
    stringify, first 16 hex chars. Key order must not matter.

    Kept byte-identical to the TypeScript on purpose: the hash is what stops a
    timeline being reused against a spec it was not built from, so a Python-side
    variant would silently defeat it. Prefer `--spec-hash` (passing the value the
    TS planner already computed) when you have it.
    """
    return hashlib.sha256(_stable_stringify(spec).encode("utf-8")).hexdigest()[:16]


def _stable_stringify(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_stable_stringify(v) for v in value) + "]"
    if isinstance(value, Mapping):
        items = sorted(value, key=str)
        return (
            "{"
            + ",".join(
                f"{json.dumps(str(k), ensure_ascii=False)}:{_stable_stringify(value[k])}"
                for k in items
            )
            + "}"
        )
    raise PipelineError(f"cannot hash a {type(value).__name__}")


def _js_number(value: float | int) -> str:
    """JSON.stringify's number formatting: 4.0 serialises as "4", not "4.0"."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(float(value)) if isinstance(value, float) else str(value)


# ------------------------------------------------------------------------- ffmpeg


def check_ffmpeg() -> str:
    """Locate ffmpeg before doing 40 minutes of synthesis that it has to finish."""
    path = shutil.which("ffmpeg")
    if not path:
        raise PipelineError(
            "ffmpeg is not on PATH, and the per-beat wavs cannot be concatenated without it.\n"
            "    Windows: winget install Gyan.FFmpeg\n"
            "    Debian/Ubuntu: sudo apt-get install ffmpeg\n"
            "    macOS: brew install ffmpeg\n"
            "Or re-run with --dry-run to build the timeline without touching audio."
        )
    return path


def concat_wavs(
    parts: Sequence[tuple[Path, float]],
    out_path: Path,
    *,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    ffmpeg: str = "ffmpeg",
) -> None:
    """Concatenate `(wav, hold_seconds)` pairs, inserting the holds as silence.

    One ffmpeg call: each beat and each silence is an input, everything is
    forced to the same mono format, then the concat filter joins them. The
    silences are what make the rendered audio line up with `holdSeconds` in the
    timeline — drop them and every beat after the first drifts.
    """
    if not parts:
        raise PipelineError("nothing to concatenate")

    inputs: List[str] = []
    labels: List[str] = []
    filters: List[str] = []
    index = 0
    for wav, hold in parts:
        inputs += ["-i", str(wav)]
        filters.append(
            f"[{index}:a]aformat=sample_fmts=s16:sample_rates={sample_rate}:"
            f"channel_layouts=mono[a{index}]"
        )
        labels.append(f"[a{index}]")
        index += 1
        if hold > 0:
            inputs += ["-f", "lavfi", "-t", f"{hold:.4f}", "-i", f"anullsrc=r={sample_rate}:cl=mono"]
            filters.append(
                f"[{index}:a]aformat=sample_fmts=s16:sample_rates={sample_rate}:"
                f"channel_layouts=mono[a{index}]"
            )
            labels.append(f"[a{index}]")
            index += 1

    filter_complex = ";".join(filters) + ";" + "".join(labels) + f"concat=n={index}:v=0:a=1[out]"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]", "-ar", str(sample_rate), "-ac", "1",
        str(out_path),
    ]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise PipelineError(
            f"ffmpeg failed to build {out_path.name} (exit {result.returncode}):\n"
            f"{(result.stderr or '').strip()[:2000]}"
        )


# ---------------------------------------------------------------------------- run


def run(
    spec_path: Path,
    out_dir: Path,
    *,
    engine_name: str = DEFAULT_ENGINE,
    fps: int = DEFAULT_FPS,
    do_align: bool = True,
    dry_run: bool = False,
    spec_hash_value: str | None = None,
    device: str = "cpu",
    language: str = "en",
    engine: Any = None,
) -> Dict[str, Any]:
    """Synthesize every beat, align it, write timeline.json. Returns the summary."""
    spec = _load_spec(spec_path)
    beats = spec["beats"]
    audio_dir = out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    digest = spec_hash_value or spec_hash(spec)

    if engine_name not in ENGINE_NAMES:
        raise PipelineError(f"unknown engine {engine_name!r}; expected one of {', '.join(ENGINE_NAMES)}")

    ffmpeg = None if dry_run else check_ffmpeg()
    if engine is None and not dry_run:
        engine = get_engine(engine_name)

    align_model = None
    if do_align and not dry_run:
        align_model = load_align_model(device=device, language=language)

    words_by_beat: Dict[str, List[Dict[str, Any]]] = {}
    seconds_by_beat: Dict[str, float] = {}
    parts: List[tuple[Path, float]] = []
    alignment = WHISPERX if (do_align and not dry_run) else ESTIMATED
    notes: List[str] = []

    for beat in beats:
        beat_id = str(beat["id"])
        narration = str(beat["narration"])
        target = float(beat.get("durationSeconds") or 0.0) or None
        wav_path = audio_dir / f"{beat_id}.wav"

        if dry_run:
            # No model, no audio: the spec's own duration IS the estimate.
            audio_seconds = float(beat.get("durationSeconds") or 0.0)
        else:
            audio_seconds = float(
                engine.synthesize(
                    narration,
                    wav_path,
                    target_seconds=target,
                    emotion=str(beat.get("emotion") or "neutral"),
                )
            )
            parts.append((wav_path, float(beat.get("holdAfterSeconds") or 0.0)))

        if do_align and not dry_run:
            try:
                words = align(wav_path, narration, device=device, model=align_model, language=language)
            except AlignError as exc:
                notes.append(f"{beat_id}: alignment failed, falling back to estimates ({exc})")
                words = estimate_words(narration, audio_seconds)
                alignment = ESTIMATED
        else:
            words = estimate_words(narration, audio_seconds)

        words_by_beat[beat_id] = words
        seconds_by_beat[beat_id] = audio_seconds

    built = build_timeline(
        spec,
        audio_dir,
        engine_name,
        fps,
        words_by_beat,
        spec_hash=digest,
        audio_seconds_by_beat=seconds_by_beat,
        audio_path="narration.wav",
        alignment=alignment,
        render_root=out_dir,
    )
    timeline = built["timeline"]
    report = built["report"]

    narration_path = out_dir / "narration.wav"
    if not dry_run:
        rate = wav_sample_rate(parts[0][0]) if parts else DEFAULT_SAMPLE_RATE
        concat_wavs(parts, narration_path, sample_rate=rate, ffmpeg=ffmpeg or "ffmpeg")

    timeline_path = out_dir / "timeline.json"
    timeline_path.write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")

    return {
        "specHash": timeline["specHash"],
        "engine": timeline["engine"],
        "fps": timeline["fps"],
        "totalSeconds": timeline["totalSeconds"],
        "beats": len(timeline["beats"]),
        "alignment": alignment,
        "audioPath": str(narration_path) if not dry_run else None,
        "timelinePath": str(timeline_path),
        "dryRun": dry_run,
        "cuesResolved": report["cuesResolved"],
        "cuesMissing": report["cuesMissing"],
        "warnings": report["warnings"] + notes,
    }


def _load_spec(spec_path: Path) -> Dict[str, Any]:
    if not spec_path.exists():
        raise PipelineError(f"spec not found: {spec_path}")
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PipelineError(f"{spec_path} is not valid JSON: {exc}") from exc
    if not isinstance(spec, dict) or not isinstance(spec.get("beats"), list) or not spec["beats"]:
        raise PipelineError(f"{spec_path} is not a VideoSpec: expected a non-empty 'beats' array")
    for index, beat in enumerate(spec["beats"]):
        for field in ("id", "narration"):
            if not beat.get(field):
                raise PipelineError(f"{spec_path}: beats.{index} is missing {field!r}")
    return spec


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m narration.synthesize",
        description="Synthesize narration for a VideoSpec and emit timeline.json.",
    )
    parser.add_argument("--spec", required=True, type=Path, help="path to the VideoSpec JSON")
    parser.add_argument("--out", required=True, type=Path, help="render directory, e.g. renders/<id>/")
    parser.add_argument(
        "--engine",
        default=None,
        choices=list(ENGINE_NAMES),
        help=f"TTS engine (default: $TTS_ENGINE, else {DEFAULT_ENGINE})",
    )
    parser.add_argument("--fps", type=int, default=DEFAULT_FPS)
    parser.add_argument(
        "--no-align",
        action="store_true",
        help="skip WhisperX; use estimated word times (marks the timeline 'estimated')",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="skip synthesis entirely; build a timeline from the spec's own durations",
    )
    parser.add_argument(
        "--spec-hash",
        default=None,
        help="hash from packages/spec (hash.ts). Computed locally if omitted.",
    )
    parser.add_argument("--device", default="cpu", help="device for WhisperX alignment")
    parser.add_argument("--language", default="en", help="language code for WhisperX alignment")
    return parser


def main(argv: Sequence[str] | None = None, *, engine: Any = None) -> int:
    import os

    args = build_parser().parse_args(argv)
    engine_name = args.engine or os.environ.get("TTS_ENGINE") or DEFAULT_ENGINE
    try:
        summary = run(
            args.spec,
            args.out,
            engine_name=engine_name,
            fps=args.fps,
            do_align=not args.no_align,
            dry_run=args.dry_run,
            spec_hash_value=args.spec_hash,
            device=args.device,
            language=args.language,
            engine=engine,
        )
    except (PipelineError, TTSError, AlignError, TimelineError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
