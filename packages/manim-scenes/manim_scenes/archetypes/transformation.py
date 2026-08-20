"""transformation — A becomes B.

The flagship. When the insight of a beat is "this thing you know is secretly
that other thing", this is the shot: the before object sits alone, an arrow
grows out of it carrying the name of the mechanism, and then the before object
*itself* travels along that arrow and morphs into the after object. Nothing
fades in beside it — the same pixels become the answer. Then one Circumscribe
says: that. That is the point.

Mirrors ArchetypeParams.transformation in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import LEFT, RIGHT, Create, GrowArrow
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import GAP_WIDE, SAFE_WIDTH

ARCHETYPE = "transformation"


@dataclass(frozen=True)
class Params(ParamsModel):
    before: Node
    after: Node
    via: str | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    before = f.node("before")
    after = f.node("after")
    via = f.sublabel("via")
    f.done()
    return Params(before=before, after=after, via=via)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    # before -> via -> morph -> emphasise. Four beats of screen time.
    scene.begin(duration, events=4)

    slot = (SAFE_WIDTH - GAP_WIDE * 2) / 2

    before = scene.card(
        Node(scene.wrap_label(params.before.label, 16), params.before.detail),
        color=palette.secondary,
        max_width=slot,
    )
    after = scene.card(
        Node(scene.wrap_label(params.after.label, 16), params.after.detail),
        color=palette.primary,
        max_width=slot,
    )
    link = scene.arrow(
        direction=RIGHT,
        length=GAP_WIDE * 1.6,
        color=palette.primary,
        label=params.via,
    )

    # Place the entire shot, then scale it once. Laying out before revealing is
    # what keeps every element inside the safe frame no matter how long the
    # labels turned out to be.
    before.next_to(link, LEFT, buff=GAP_WIDE * 0.4)
    after.next_to(link, RIGHT, buff=GAP_WIDE * 0.4)
    scene.stage(scene.unit(before, link, after))

    # GrowArrow only exists for a bare arrow; a captioned one is a group.
    link_anim = GrowArrow(link) if params.via is None else None

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(before, animation=Create(before), label=params.before.label)

    scene.cue_wait(timeline, nth_phrase(timeline, 1), duration * 0.25)
    scene.reveal(link, animation=link_anim, label=params.via or "via")

    # ReplacementTransform, not FadeOut + FadeIn: the audience must see one
    # object become the other, travelling along the arrow it was promised.
    scene.cue_wait(timeline, nth_phrase(timeline, 2), duration * 0.50)
    scene.morph(before, after, label=params.after.label)

    scene.cue_wait(timeline, nth_phrase(timeline, 3), duration * 0.78)
    scene.emphasize(after, circumscribe=True, label=params.after.label)

    scene.pad_to(duration)
