"""containment — things nested inside things.

The outer boundary is drawn first and drawn empty, because the point of this
archetype is that the boundary exists before you know what is in it. Then the
contents appear inside it, and if there is a third level it appears inside the
first item — which was built with the room already reserved, so nothing jumps.

Mirrors ArchetypeParams.containment in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, UP, Create, FadeIn, RoundedRectangle, Text, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import (
    CARD_PAD_X, CARD_PAD_Y, CORNER_RADIUS, FILL_OPACITY, FONT_BODY, GAP,
    GAP_TIGHT, SAFE_WIDTH, STROKE, STROKE_THIN,
)

ARCHETYPE = "containment"


@dataclass(frozen=True)
class Params(ParamsModel):
    outer: Node
    inner: tuple[Node, ...]
    innermost: Node | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    outer = f.node("outer")
    inner = f.node_list("inner", lo=1, hi=3)
    innermost = f.optional_node("innermost")
    f.done()
    return Params(outer=outer, inner=tuple(inner), innermost=innermost)


def _shell(scene: Any, node: Node, color: str, *, reserve: float, max_width: float):
    """A box with its label pinned to the top and ``reserve`` units of empty
    room beneath it, waiting for whatever gets nested inside later."""
    label = Text(scene.wrap_label(node.label, 16), font_size=FONT_BODY, color=scene.palette.accent)
    scene.fit(label, max_width=max_width - 2 * CARD_PAD_X)
    box = RoundedRectangle(
        corner_radius=CORNER_RADIUS,
        width=max(label.width + 2 * CARD_PAD_X, max_width * 0.8),
        height=label.height + 2 * CARD_PAD_Y + reserve,
        color=color,
        stroke_width=STROKE,
        fill_color=color,
        fill_opacity=FILL_OPACITY,
    )
    label.move_to(box.get_top() + DOWN * (CARD_PAD_Y + label.height / 2))
    return scene.unit(box, label), box


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    inner = params.inner
    n = len(inner)
    events = 1 + n + (1 if params.innermost else 0)
    scene.begin(duration, events=events)

    # Build innermost first: its height decides how much room inner[0] reserves.
    innermost_card = None
    reserve = 0.0
    if params.innermost:
        innermost_card = scene.card(
            Node(scene.wrap_label(params.innermost.label, 12), params.innermost.detail),
            color=palette.accent,
            max_width=SAFE_WIDTH / (n + 1),
            fill=False,
        )
        reserve = innermost_card.height + GAP_TIGHT

    slot = (SAFE_WIDTH * 0.82) / n
    shells: list[Any] = []
    boxes: list[Any] = []
    for i, node in enumerate(inner):
        unit, box = _shell(
            scene, node, palette.cycle(i),
            reserve=reserve if i == 0 else 0.0,
            max_width=slot,
        )
        shells.append(unit)
        boxes.append(box)

    row = VGroup(*shells).arrange(RIGHT, buff=GAP, aligned_edge=UP)
    if innermost_card is not None:
        innermost_card.move_to(
            boxes[0].get_bottom() + UP * (CARD_PAD_Y + innermost_card.height / 2)
        )

    # The outer boundary wraps the row with room at the top for its own name.
    outer_label = Text(
        scene.wrap_label(params.outer.label, 20), font_size=FONT_BODY, color=palette.accent
    )
    scene.fit(outer_label, max_width=SAFE_WIDTH * 0.7)
    outer_box = RoundedRectangle(
        corner_radius=CORNER_RADIUS,
        width=row.width + 2 * GAP,
        height=row.height + outer_label.height + 3 * GAP_TIGHT + 2 * CARD_PAD_Y,
        color=palette.primary,
        stroke_width=STROKE_THIN,
        fill_color=palette.primary,
        fill_opacity=FILL_OPACITY * 0.5,
    )
    outer_box.move_to(row.get_center())
    outer_box.shift(DOWN * ((outer_label.height + GAP_TIGHT) / 2))
    outer_label.move_to(outer_box.get_top() + DOWN * (CARD_PAD_Y + outer_label.height / 2))
    row.move_to(outer_box.get_center() + DOWN * ((outer_label.height + GAP_TIGHT) / 2))
    if innermost_card is not None:
        innermost_card.move_to(
            boxes[0].get_bottom() + UP * (CARD_PAD_Y + innermost_card.height / 2)
        )

    outer = scene.unit(outer_box, outer_label)
    scene.stage(scene.unit(outer, row, *( [innermost_card] if innermost_card else [] )))

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(outer, animation=Create(outer), label=params.outer.label)

    for i, shell in enumerate(shells):
        scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / events)
        scene.reveal(shell, animation=FadeIn(shell, shift=UP * 0.2), label=inner[i].label)

    if innermost_card is not None:
        scene.cue_wait(timeline, nth_phrase(timeline, n + 1), duration * (n + 1) / events)
        scene.reveal(
            innermost_card,
            animation=FadeIn(innermost_card, scale=0.7),
            label=params.innermost.label,  # type: ignore[union-attr]
        )

    scene.pad_to(duration)
