"""sequence — steps that follow one another.

Left to right, one card at a time, each arriving with the arrow that leads into
it so the connection and the destination land in the same instant. The optional
``arrowLabel`` is spent once, on the first hop, where it establishes the
relationship for every hop that follows.

Mirrors ArchetypeParams.sequence in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import ORIGIN, RIGHT, UP, Create, FadeIn, Text, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import FONT_BODY, GAP, GAP_TIGHT, SAFE_WIDTH

ARCHETYPE = "sequence"


@dataclass(frozen=True)
class Params(ParamsModel):
    steps: tuple[Node, ...]
    arrowLabel: str | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    steps = f.node_list("steps", lo=2, hi=4)
    arrow_label = f.sublabel("arrowLabel")
    f.done()
    return Params(steps=tuple(steps), arrowLabel=arrow_label)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    steps = params.steps
    n = len(steps)
    scene.begin(duration, events=n)

    # Width is the scarce axis: four cards plus three arrows share 13 units, so
    # wrap the labels onto two lines rather than letting them scale into ants.
    wrap_at = {2: 20, 3: 15, 4: 11}.get(n, 12)
    hop = GAP * 1.15

    cards = [
        scene.card(
            Node(scene.wrap_label(node.label, wrap_at), node.detail),
            color=palette.cycle(i),
            max_width=SAFE_WIDTH / n,
        )
        for i, node in enumerate(steps)
    ]

    cards[0].move_to(ORIGIN)
    elements: list[Any] = [cards[0]]
    previous = cards[0]
    for i in range(1, n):
        shaft = scene.arrow(direction=RIGHT, length=hop, color=palette.muted)
        # next_to off the previous *card* (not the previous unit) keeps every
        # card on one baseline even when the first arrow carries a caption.
        shaft.next_to(previous, RIGHT, buff=GAP * 0.35)
        cards[i].next_to(shaft, RIGHT, buff=GAP * 0.35)
        parts = [shaft]
        if params.arrowLabel and i == 1:
            caption = Text(params.arrowLabel, font_size=FONT_BODY * 0.7, color=palette.muted)
            scene.fit(caption, max_width=hop * 2.2)
            caption.next_to(shaft, UP, buff=GAP_TIGHT * 0.6)
            parts.append(caption)
        parts.append(cards[i])
        elements.append(scene.unit(*parts))
        previous = cards[i]

    scene.stage(VGroup(*elements))

    for i, element in enumerate(elements):
        scene.cue_wait(timeline, nth_phrase(timeline, i), duration * i / n)
        animation = Create(element) if i == 0 else FadeIn(element, shift=RIGHT * 0.3)
        scene.reveal(element, animation=animation, label=steps[i].label)

    scene.pad_to(duration)
