"""The archetype library. Twelve animations; there is no thirteenth.

Every module here exports the same three names::

    Params        # frozen dataclass mirroring the Zod schema in archetypes.ts
    parse_params  # dict -> Params, raising ParamsError with every problem
    build         # (scene, params, duration, timeline) -> None

Import them through ``manim_scenes.registry``, not by hand.
"""

from __future__ import annotations

__all__ = [
    "sequence", "branch", "containment", "transformation", "fan_out",
    "layered_build", "zoom_detail", "parallel_race", "accumulation", "cycle",
    "spatial_map", "reveal_conceal",
]
