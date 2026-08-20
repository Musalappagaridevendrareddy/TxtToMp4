"""cycle — a loop that returns to its start.

Steps are placed on a circle starting at twelve o'clock and running clockwise,
each arriving with the curved arrow that leads into it. The closing edge is
revealed last and on its own: the moment the loop actually closes is the point
of the whole archetype, and it deserves its own beat.

Mirrors ArchetypeParams.cycle in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .._manim import RIGHT, UP, Create, CurvedArrow, FadeIn, Text, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import FONT_BODY, SAFE_HEIGHT, SAFE_WIDTH, STROKE

ARCHETYPE = "cycle"


@dataclass(frozen=True)
class Params(ParamsModel):
    steps: tuple[Node, ...]
    returnLabel: str | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    steps = f.node_list("steps", lo=3, hi=4)
    return_label = f.sublabel("returnLabel")
    f.done()
    return Params(steps=tuple(steps), returnLabel=return_label)


def _rim_point(mobject: Any, toward: Any, pad: float = 0.14):
    """The point on ``mobject``'s rim facing ``toward``, so arrows start and end
    at the boxes instead of at their invisible centres."""
    here, there = mobject.get_center(), toward.get_center()
    dx, dy = there[0] - here[0], there[1] - here[1]
    distance = math.hypot(dx, dy) or 1.0
    radius = max(mobject.width, mobject.height) / 2 + pad
    return RIGHT * (here[0] + dx / distance * radius) + UP * (here[1] + dy / distance * radius)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    steps = params.steps
    n = len(steps)
    events = n + 1
    scene.begin(duration, events=events)

    radius = min(SAFE_WIDTH * 0.28, SAFE_HEIGHT * 0.34)
    cards = []
    for i, node in enumerate(steps):
        angle = math.pi / 2 - i * (2 * math.pi / n)  # twelve o'clock, clockwise
        card = scene.card(
            Node(scene.wrap_label(node.label, 14), node.detail),
            color=palette.cycle(i),
            max_width=SAFE_WIDTH * 0.28,
        )
        card.move_to(RIGHT * (radius * math.cos(angle)) + UP * (radius * math.sin(angle)))
        cards.append(card)

    # Each step after the first carries the arrow that reaches it.
    elements: list[Any] = [cards[0]]
    for i in range(1, n):
        hop = CurvedArrow(
            _rim_point(cards[i - 1], cards[i]),
            _rim_point(cards[i], cards[i - 1]),
            angle=-0.55,
            color=palette.muted,
            stroke_width=STROKE,
        )
        elements.append(scene.unit(hop, cards[i]))

    closing = CurvedArrow(
        _rim_point(cards[-1], cards[0]),
        _rim_point(cards[0], cards[-1]),
        angle=-0.55,
        color=palette.accent,
        stroke_width=STROKE,
    )
    closing_parts: list[Any] = [closing]
    if params.returnLabel:
        caption = Text(params.returnLabel, font_size=FONT_BODY * 0.72, color=palette.accent)
        scene.fit(caption, max_width=SAFE_WIDTH * 0.24)
        caption.move_to(closing.get_center())
        closing_parts.append(caption)
    closing_unit = scene.unit(*closing_parts)

    scene.stage(VGroup(*elements, closing_unit))

    for i, element in enumerate(elements):
        scene.cue_wait(timeline, nth_phrase(timeline, i), duration * i / events)
        animation = Create(element) if i == 0 else FadeIn(element)
        scene.reveal(element, animation=animation, label=steps[i].label)

    scene.cue_wait(timeline, nth_phrase(timeline, n), duration * n / events)
    scene.reveal(
        closing_unit,
        animation=Create(closing_unit),
        label=params.returnLabel or "return",
    )

    scene.pad_to(duration)
