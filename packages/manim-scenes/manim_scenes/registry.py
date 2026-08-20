"""Name -> archetype module. The only sanctioned lookup.

``ARCHETYPE_NAMES`` here must stay identical to the array in
packages/spec/src/archetypes.ts; ``test_archetypes.py`` fails loudly if the two
ever drift.
"""

from __future__ import annotations

from types import ModuleType
from typing import Any

from .archetypes import (
    accumulation, branch, containment, cycle, fan_out, layered_build,
    parallel_race, reveal_conceal, sequence, spatial_map, transformation,
    zoom_detail,
)
from .base import MIN_HOLD

__all__ = ["ARCHETYPES", "ARCHETYPE_NAMES", "UnknownArchetype", "build_beat", "parse_beat_params"]


ARCHETYPES: dict[str, ModuleType] = {
    "sequence": sequence,
    "branch": branch,
    "containment": containment,
    "transformation": transformation,
    "fan_out": fan_out,
    "layered_build": layered_build,
    "zoom_detail": zoom_detail,
    "parallel_race": parallel_race,
    "accumulation": accumulation,
    "cycle": cycle,
    "spatial_map": spatial_map,
    "reveal_conceal": reveal_conceal,
}

ARCHETYPE_NAMES: tuple[str, ...] = tuple(ARCHETYPES)


class UnknownArchetype(KeyError):
    """The spec named an archetype that does not exist."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(
            f"unknown archetype {name!r}; the library is: {', '.join(ARCHETYPE_NAMES)}"
        )

    def __str__(self) -> str:  # KeyError repr-quotes its message otherwise
        return self.args[0]


def module_for(name: str) -> ModuleType:
    try:
        return ARCHETYPES[name]
    except KeyError:
        raise UnknownArchetype(name) from None


def parse_beat_params(beat: dict) -> Any:
    """Validate one beat's raw params against its own archetype's schema."""
    module = module_for(beat.get("archetype", ""))
    return module.parse_params(beat.get("params") or {})


def build_beat(scene: Any, beat_dict: dict, timeline_for_beat: Any = None) -> None:
    """Look the archetype up, validate its params, and play it on ``scene``.

    ``beat_dict`` is a Beat from packages/spec/src/schema.ts.
    ``timeline_for_beat`` is the matching BeatTimeline, or None before TTS has
    run — archetypes fall back to an even distribution across the beat.
    """
    name = beat_dict.get("archetype", "")
    module = module_for(name)
    params = module.parse_params(beat_dict.get("params") or {})

    duration = float(beat_dict.get("durationSeconds") or 0.0)
    if timeline_for_beat is not None:
        measured = (
            timeline_for_beat.get("audioSeconds")
            if isinstance(timeline_for_beat, dict)
            else getattr(timeline_for_beat, "audioSeconds", None)
        )
        # The measured audio is the truth once it exists; the spec's number was
        # only ever an estimate for the planner.
        if measured:
            duration = float(measured)

    # Rule 2 is a floor the beat may raise, never lower.
    hold = max(MIN_HOLD, float(beat_dict.get("holdAfterSeconds") or 0.0))
    scene.archetype = name
    scene.begin(duration, events=1, hold=hold)  # replaced by the archetype's own begin()
    scene._hold = hold
    module.build(scene, params, duration, timeline_for_beat)
