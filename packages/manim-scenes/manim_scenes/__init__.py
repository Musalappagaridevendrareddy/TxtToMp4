"""explainer-manim-scenes — the twelve animations an explainer video is made of.

The Node side emits a VideoSpec (packages/spec) and a Timeline; this package
turns one beat of that spec into one transparent WebM. The model never writes
animation code — it picks an archetype name and fills typed params.

Entry points::

    python -m manim_scenes.render_beat --spec spec.json --beat-id hook --out renders/
    from manim_scenes.registry import build_beat
"""

from __future__ import annotations

from .base import (
    BaseArchetype, Event, Fields, LayoutError, MIN_HOLD, Node, NullScene,
    ParamsError, ParamsModel,
)
from .registry import ARCHETYPE_NAMES, ARCHETYPES, UnknownArchetype, build_beat
from .theme import MAX_ELEMENTS, PALETTE_NAMES, Palette, get_palette

__version__ = "0.1.0"

__all__ = [
    "ARCHETYPES", "ARCHETYPE_NAMES", "build_beat", "UnknownArchetype",
    "BaseArchetype", "NullScene", "Event",
    "LayoutError", "ParamsError", "Fields", "Node", "ParamsModel",
    "Palette", "get_palette", "PALETTE_NAMES", "MAX_ELEMENTS", "MIN_HOLD",
    "__version__",
]
