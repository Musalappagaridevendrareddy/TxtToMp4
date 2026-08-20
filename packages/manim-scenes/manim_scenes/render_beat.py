"""CLI: render one beat (or all of them) to transparent WebM.

    python -m manim_scenes.render_beat --spec fixtures/x.json --beat-id hook \
        --out renders/ [--timeline renders/timeline.json] [--quality l|h] [--all]

Always prints a single JSON object on stdout so the Node side can consume it
without parsing manim's chatter — manim's own output goes to stderr::

    {"ok": true, "beats": [{"beatId": "hook", "path": "C:/.../hook.webm"}]}

Exit code is 0 only if every requested beat rendered.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from .registry import module_for
from .theme import FPS

# 480p for iteration, 1080p for the real thing. Both at the project's 30fps —
# manim's own quality presets would quietly change the frame rate.
RESOLUTIONS = {"l": (854, 480), "h": (1920, 1080)}

ENTRY = Path(__file__).resolve().parent / "_scene_entry.py"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def _fail(message: str, **extra) -> int:
    json.dump({"ok": False, "error": message, **extra}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def _render_one(
    *, spec_path: Path, beat_id: str, out_dir: Path, timeline_path: Path | None, quality: str
) -> Path:
    """Shell out to manim for one beat and return the WebM it produced."""
    media_dir = out_dir / "media"
    width, height = RESOLUTIONS[quality]

    env = dict(os.environ)
    env["EXPLAINER_SPEC"] = str(spec_path)
    env["EXPLAINER_BEAT_ID"] = beat_id
    if timeline_path is not None:
        env["EXPLAINER_TIMELINE"] = str(timeline_path)
    else:
        env.pop("EXPLAINER_TIMELINE", None)
    # The entry file is executed standalone by manim, so the package has to be
    # importable by absolute name whether or not it was pip-installed.
    env["PYTHONPATH"] = os.pathsep.join(
        [str(PACKAGE_ROOT)] + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else [])
    )

    command = [
        sys.executable, "-m", "manim", "render",
        "--format=webm",
        "--transparent",
        "--fps", str(FPS),
        "-r", f"{width},{height}",
        "--media_dir", str(media_dir),
        "-o", beat_id,
        str(ENTRY), "BeatScene",
    ]
    result = subprocess.run(command, env=env, stdout=sys.stderr, stderr=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"manim exited {result.returncode} while rendering beat {beat_id!r}")

    # manim buries the file under media/videos/<stem>/<res>/; find it rather
    # than trying to predict the directory name across manim versions.
    matches = sorted(media_dir.rglob(f"{beat_id}.webm"), key=lambda p: p.stat().st_mtime)
    if not matches:
        raise RuntimeError(
            f"manim reported success but no {beat_id}.webm appeared under {media_dir}"
        )
    return matches[-1].resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m manim_scenes.render_beat",
        description="Render VideoSpec beats to transparent WebM with Manim.",
    )
    parser.add_argument("--spec", required=True, help="path to the VideoSpec json")
    parser.add_argument("--beat-id", help="id of the beat to render")
    parser.add_argument("--all", action="store_true", help="render every beat in the spec")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--timeline", help="path to the Timeline json from WhisperX")
    parser.add_argument("--quality", choices=sorted(RESOLUTIONS), default="h")
    args = parser.parse_args(argv)

    if not args.all and not args.beat_id:
        return _fail("pass --beat-id <id> or --all")

    spec_path = Path(args.spec).resolve()
    if not spec_path.is_file():
        return _fail(f"spec not found: {spec_path}")
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return _fail(f"spec is not valid json: {exc}")

    timeline_path = Path(args.timeline).resolve() if args.timeline else None
    if timeline_path is not None and not timeline_path.is_file():
        return _fail(f"timeline not found: {timeline_path}")

    beats = spec.get("beats") or []
    known = [b.get("id") for b in beats]
    if args.all:
        wanted = list(beats)
    else:
        wanted = [b for b in beats if b.get("id") == args.beat_id]
        if not wanted:
            return _fail(f"beat {args.beat_id!r} is not in the spec", knownBeats=known)

    # Validate every beat's params before starting any render: a 90 second
    # render that dies on the last beat because of a typo is a waste of a coffee.
    for beat in wanted:
        try:
            module = module_for(beat.get("archetype", ""))
            module.parse_params(beat.get("params") or {})
        except Exception as exc:  # ParamsError / UnknownArchetype
            return _fail(str(exc), beatId=beat.get("id"))

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    rendered = []
    for beat in wanted:
        beat_id = beat.get("id", "")
        try:
            path = _render_one(
                spec_path=spec_path,
                beat_id=beat_id,
                out_dir=out_dir,
                timeline_path=timeline_path,
                quality=args.quality,
            )
        except (RuntimeError, OSError) as exc:
            return _fail(str(exc), beatId=beat_id, rendered=rendered)
        rendered.append({"beatId": beat_id, "path": str(path)})

    json.dump({"ok": True, "beats": rendered}, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
