"""The file the ``manim`` CLI is pointed at. Not imported by anything else.

Manim executes a scene file standalone, so this module uses absolute imports
and takes its configuration from the environment rather than from argv — the
CLI owns argv. ``render_beat`` sets:

    EXPLAINER_SPEC      path to the VideoSpec json
    EXPLAINER_BEAT_ID   which beat to render
    EXPLAINER_TIMELINE  path to the Timeline json (optional)

There is exactly one scene class here, always called ``BeatScene``, so the
render command never has to guess a name.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from manim import Scene, config

from manim_scenes.base import BaseArchetype
from manim_scenes.registry import build_beat
from manim_scenes.theme import FPS, PIXEL_HEIGHT, PIXEL_WIDTH


def _load(path: str | None):
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


SPEC = _load(os.environ.get("EXPLAINER_SPEC")) or {}
BEAT_ID = os.environ.get("EXPLAINER_BEAT_ID", "")
TIMELINE = _load(os.environ.get("EXPLAINER_TIMELINE"))

BEAT = next((b for b in SPEC.get("beats", []) if b.get("id") == BEAT_ID), None)
if BEAT is None:
    raise SystemExit(
        f"beat {BEAT_ID!r} is not in the spec; it has: "
        f"{', '.join(b.get('id', '?') for b in SPEC.get('beats', []))}"
    )

BEAT_TIMELINE = None
if TIMELINE:
    BEAT_TIMELINE = next(
        (b for b in TIMELINE.get("beats", []) if b.get("beatId") == BEAT_ID), None
    )

config.pixel_width = PIXEL_WIDTH
config.pixel_height = PIXEL_HEIGHT
config.frame_rate = FPS


class BeatScene(BaseArchetype, Scene):
    """One beat, rendered on transparent black for the compositor to layer."""

    PALETTE_NAME = SPEC.get("palette", "cool")

    def construct(self) -> None:
        # Only matters when someone renders without -t; with -t the alpha
        # channel wins and this is never seen.
        self.camera.background_color = self.palette.bg
        build_beat(self, BEAT, BEAT_TIMELINE)
