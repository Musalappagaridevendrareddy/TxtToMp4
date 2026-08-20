"""Build `timeline.json` — the single source of truth for every renderer.

Manim and Remotion never measure audio themselves; they read this. So the shape
here must mirror packages/spec/src/timeline.ts exactly, and the layout rule is
the only one in the system:

    beat[0].startSeconds = 0
    beat[n].startSeconds = beat[n-1].startSeconds
                         + beat[n-1].audioSeconds
                         + beat[n-1].holdSeconds

Cues are the other half: each `emphasis` phrase in the spec is looked up in the
aligned word list and turned into a beat-relative time the animation reveals on.
A phrase that cannot be found is a warning, never a crash — one unmatched word
must not cost you a 40 minute render.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from .align import ESTIMATED, WHISPERX, Word

#: Mirrors `Timeline.engine` in the contract.
ENGINE_NAMES = ("kokoro", "indextts2")

DEFAULT_HOLD_SECONDS = 1.5  # matches Beat.holdAfterSeconds' default in schema.ts


class TimelineError(ValueError):
    """The timeline we were about to write would not survive the TS contract."""


_NORMALIZE = re.compile(r"[^0-9a-z']+")


def _normalize(token: str) -> str:
    """Fold a token to its comparable core: lowercase, punctuation stripped."""
    return _NORMALIZE.sub("", token.lower()).strip("'")


def _phrase_tokens(phrase: str) -> List[str]:
    return [t for t in (_normalize(p) for p in phrase.split()) if t]


def find_phrase(words: Sequence[Word], phrase: str) -> float | None:
    """Beat-relative start time of `phrase`, or None if it is not spoken.

    Case-insensitive, punctuation-insensitive, and multi-word phrases must match
    as a CONTIGUOUS run of words — "state machine" matches "…the state machine
    is…" but not "…state of the machine…". Tokens that normalize to nothing
    (standalone dashes, stray punctuation) are skipped rather than breaking the
    run.
    """
    needle = _phrase_tokens(phrase)
    if not needle:
        return None
    haystack = [(index, _normalize(str(w.get("word", "")))) for index, w in enumerate(words)]
    haystack = [(index, token) for index, token in haystack if token]
    if len(haystack) < len(needle):
        return None

    for offset in range(len(haystack) - len(needle) + 1):
        window = haystack[offset : offset + len(needle)]
        if [token for _, token in window] == needle:
            start = words[window[0][0]].get("start")
            return max(0.0, float(start)) if start is not None else 0.0
    return None


def build_timeline(
    spec: Mapping[str, Any],
    audio_dir: str | Path,
    engine_name: str,
    fps: int,
    words_by_beat: Mapping[str, Sequence[Word]],
    *,
    spec_hash: str,
    audio_seconds_by_beat: Mapping[str, float] | None = None,
    audio_path: str = "narration.wav",
    alignment: str = WHISPERX,
    render_root: str | Path | None = None,
) -> Dict[str, Any]:
    """Lay the beats end to end and resolve every emphasis phrase to a cue.

    `spec_hash` is passed in, never recomputed here — the hash is defined by
    packages/spec/src/hash.ts and having two implementations of it is how stale
    timelines get accepted.

    Returns `{"timeline": <the contract object>, "report": {...}}`. The report
    carries warnings (unmatched phrases, duration drift) that are advisory; the
    timeline itself is validated and will raise if it is malformed.
    """
    audio_dir = Path(audio_dir)
    root = Path(render_root) if render_root is not None else audio_dir.parent
    if engine_name not in ENGINE_NAMES:
        raise TimelineError(
            f"engine {engine_name!r} is not in the Timeline contract; expected one of "
            f"{', '.join(ENGINE_NAMES)}"
        )
    if alignment not in (WHISPERX, ESTIMATED):
        raise TimelineError(f"alignment must be {WHISPERX!r} or {ESTIMATED!r}, got {alignment!r}")
    if not spec_hash:
        raise TimelineError("spec_hash is required — a timeline with no hash cannot be cached")

    spec_beats = spec.get("beats")
    if not isinstance(spec_beats, Sequence) or not spec_beats:
        raise TimelineError("spec has no beats; nothing to narrate")

    warnings: List[str] = []
    beats: List[Dict[str, Any]] = []
    cursor = 0.0
    cues_resolved = 0

    for index, beat in enumerate(spec_beats):
        beat_id = str(beat.get("id") or "")
        if not beat_id:
            raise TimelineError(f"beats.{index}: missing id")
        words = list(words_by_beat.get(beat_id) or [])

        audio_seconds = _beat_audio_seconds(beat, beat_id, words, audio_seconds_by_beat)
        hold_seconds = float(beat.get("holdAfterSeconds", DEFAULT_HOLD_SECONDS))
        if hold_seconds < 0:
            raise TimelineError(f"beats.{index} ({beat_id}): holdAfterSeconds is negative")

        spec_seconds = beat.get("durationSeconds")
        if spec_seconds and audio_seconds > 0:
            drift = abs(audio_seconds - float(spec_seconds)) / float(spec_seconds)
            if drift > 0.25:
                warnings.append(
                    f"{beat_id}: audio is {audio_seconds:.2f}s but the spec asked for "
                    f"{float(spec_seconds):.2f}s ({drift * 100:.0f}% drift) — expected on "
                    f"Kokoro drafts, a bug on IndexTTS-2 finals"
                )

        cues: List[Dict[str, Any]] = []
        for phrase in beat.get("emphasis") or []:
            at = find_phrase(words, str(phrase))
            if at is None:
                warnings.append(
                    f"{beat_id}: emphasis phrase {str(phrase)!r} was not found in the aligned "
                    f"words — no cue emitted, the animation will use its default timing"
                )
                continue
            if at > audio_seconds:
                warnings.append(
                    f"{beat_id}: cue {str(phrase)!r} resolved to {at:.2f}s, past the "
                    f"{audio_seconds:.2f}s of audio — clamped"
                )
                at = audio_seconds
            cues.append({"phrase": str(phrase), "atSeconds": round(at, 4)})
            cues_resolved += 1

        beats.append(
            {
                "beatId": beat_id,
                "startSeconds": round(cursor, 4),
                "audioSeconds": round(audio_seconds, 4),
                "holdSeconds": round(hold_seconds, 4),
                "audioPath": _relative_posix(audio_dir / f"{beat_id}.wav", root),
                "words": [_clean_word(w, audio_seconds) for w in words],
                "cues": cues,
            }
        )
        cursor += audio_seconds + hold_seconds

    timeline: Dict[str, Any] = {
        "specHash": spec_hash,
        "engine": engine_name,
        "fps": int(fps),
        "totalSeconds": round(cursor, 4),
        "audioPath": audio_path,
        "beats": beats,
        # Not in the zod schema (which strips unknown keys) but written on purpose:
        # a reviewer must be able to see whether the sync was measured or guessed.
        "alignment": alignment,
    }
    validate_timeline(timeline)

    return {
        "timeline": timeline,
        "report": {
            "warnings": warnings,
            "cuesResolved": cues_resolved,
            "cuesMissing": sum(len(b.get("emphasis") or []) for b in spec_beats) - cues_resolved,
            "alignment": alignment,
            "beatCount": len(beats),
            "totalSeconds": timeline["totalSeconds"],
        },
    }


def _beat_audio_seconds(
    beat: Mapping[str, Any],
    beat_id: str,
    words: Sequence[Word],
    overrides: Mapping[str, float] | None,
) -> float:
    """Measured audio length, in order of trustworthiness."""
    if overrides is not None and beat_id in overrides:
        seconds = float(overrides[beat_id])
    elif words:
        seconds = max(float(w.get("end", 0.0) or 0.0) for w in words)
    else:
        seconds = float(beat.get("durationSeconds") or 0.0)
    if seconds < 0:
        raise TimelineError(f"{beat_id}: audio length is negative ({seconds})")
    return seconds


def _clean_word(word: Mapping[str, Any], audio_seconds: float) -> Word:
    start = max(0.0, float(word.get("start", 0.0) or 0.0))
    end = max(start, float(word.get("end", start) or start))
    cleaned: Word = {
        "word": str(word.get("word", "")),
        "start": round(start, 4),
        "end": round(min(end, audio_seconds) if audio_seconds else end, 4),
    }
    score = word.get("score")
    if score is not None:
        cleaned["score"] = round(max(0.0, min(1.0, float(score))), 4)
    return cleaned


def _relative_posix(path: Path, root: Path) -> str:
    """Render-root-relative path with forward slashes — this JSON is read on any OS."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def validate_timeline(timeline: Mapping[str, Any]) -> None:
    """Fail loudly here rather than in TypeScript twenty minutes into a render."""
    issues: List[str] = []

    if not isinstance(timeline.get("specHash"), str) or not timeline["specHash"]:
        issues.append("specHash must be a non-empty string")
    if timeline.get("engine") not in ENGINE_NAMES:
        issues.append(f"engine must be one of {', '.join(ENGINE_NAMES)}")
    fps = timeline.get("fps")
    if not isinstance(fps, int) or isinstance(fps, bool) or fps <= 0:
        issues.append("fps must be a positive integer")
    if not _is_number(timeline.get("totalSeconds")) or timeline["totalSeconds"] < 0:
        issues.append("totalSeconds must be a number >= 0")
    if not isinstance(timeline.get("audioPath"), str) or not timeline["audioPath"]:
        issues.append("audioPath must be a non-empty string")

    beats = timeline.get("beats")
    if not isinstance(beats, list) or not beats:
        issues.append("beats must be a non-empty list")
        raise TimelineError(_format(issues))

    seen: set[str] = set()
    expected_start = 0.0
    running_total = 0.0
    for index, beat in enumerate(beats):
        where = f"beats.{index}"
        beat_id = beat.get("beatId")
        if not isinstance(beat_id, str) or not beat_id:
            issues.append(f"{where}.beatId must be a non-empty string")
        elif beat_id in seen:
            issues.append(f"{where}.beatId: duplicate id {beat_id!r}")
        else:
            seen.add(beat_id)

        for field in ("startSeconds", "audioSeconds", "holdSeconds"):
            value = beat.get(field)
            if not _is_number(value) or value < 0:
                issues.append(f"{where}.{field} must be a number >= 0, got {value!r}")
        if not isinstance(beat.get("audioPath"), str) or not beat["audioPath"]:
            issues.append(f"{where}.audioPath must be a non-empty string")

        if _is_number(beat.get("startSeconds")) and abs(beat["startSeconds"] - expected_start) > 1e-3:
            issues.append(
                f"{where}.startSeconds is {beat['startSeconds']} but the beats before it end at "
                f"{round(expected_start, 4)} — beats must be laid end to end with no gaps"
            )
        if _is_number(beat.get("audioSeconds")) and _is_number(beat.get("holdSeconds")):
            expected_start = float(beat["startSeconds"]) + beat["audioSeconds"] + beat["holdSeconds"]
            running_total = expected_start

        issues.extend(_word_issues(beat, where))
        issues.extend(_cue_issues(beat, where))

    if _is_number(timeline.get("totalSeconds")) and abs(timeline["totalSeconds"] - running_total) > 1e-3:
        issues.append(
            f"totalSeconds is {timeline['totalSeconds']} but the beats add up to "
            f"{round(running_total, 4)}"
        )

    if issues:
        raise TimelineError(_format(issues))


def _word_issues(beat: Mapping[str, Any], where: str) -> Iterable[str]:
    words = beat.get("words")
    if not isinstance(words, list):
        yield f"{where}.words must be a list"
        return
    for index, word in enumerate(words):
        at = f"{where}.words.{index}"
        if not isinstance(word.get("word"), str):
            yield f"{at}.word must be a string"
        start, end = word.get("start"), word.get("end")
        if not _is_number(start) or start < 0:
            yield f"{at}.start must be a number >= 0, got {start!r}"
        if not _is_number(end) or end < 0:
            yield f"{at}.end must be a number >= 0, got {end!r}"
        if _is_number(start) and _is_number(end) and end < start:
            yield f"{at}: end ({end}) is before start ({start})"
        score = word.get("score")
        if score is not None and (not _is_number(score) or not 0.0 <= score <= 1.0):
            yield f"{at}.score must be between 0 and 1, got {score!r}"


def _cue_issues(beat: Mapping[str, Any], where: str) -> Iterable[str]:
    cues = beat.get("cues")
    if not isinstance(cues, list):
        yield f"{where}.cues must be a list"
        return
    for index, cue in enumerate(cues):
        at = f"{where}.cues.{index}"
        if not isinstance(cue.get("phrase"), str) or not cue["phrase"]:
            yield f"{at}.phrase must be a non-empty string"
        seconds = cue.get("atSeconds")
        if not _is_number(seconds) or seconds < 0:
            yield f"{at}.atSeconds must be a number >= 0, got {seconds!r}"


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _format(issues: Sequence[str]) -> str:
    return "timeline does not satisfy the contract:\n  - " + "\n  - ".join(issues)
