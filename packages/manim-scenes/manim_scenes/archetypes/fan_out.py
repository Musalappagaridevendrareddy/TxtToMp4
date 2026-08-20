"""fan_out — one source, many destinations.

Source anchored left, targets stacked down the right, each arriving on its own
arrow. Reading order and causal order agree. If the spec nominated a
``highlightIndex`` we spend the palette's accent on it once, at the end, after
the fan is complete — an emphasis before the shape is finished is just noise.

Mirrors ArchetypeParams.fan_out in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, Create, FadeIn, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import GAP, GAP_WIDE, SAFE_WIDTH

ARCHETYPE = "fan_out"


@dataclass(frozen=True)
class Params(ParamsModel):
    source: Node
    targets: tuple[Node, ...]
    highlightIndex: int | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    source = f.node("source")
    targets = f.node_list("targets", lo=2, hi=4)
    highlight = f.integer("highlightIndex", lo=0, hi=3, required=False)
    if highlight is not None and targets and highlight >= len(targets):
        f.fail(
            f"highlightIndex: {highlight} is out of range for {len(targets)} targets"
        )
    f.done()
    return Params(source=source, targets=tuple(targets), highlightIndex=highlight)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    targets = params.targets
    n = len(targets)
    events = 1 + n + (1 if params.highlightIndex is not None else 0)
    scene.begin(duration, events=events)

    source = scene.card(
        Node(scene.wrap_label(params.source.label, 14), params.source.detail),
        color=palette.primary,
        max_width=SAFE_WIDTH * 0.30,
    )

    cards = [
        scene.card(
            Node(scene.wrap_label(node.label, 18), node.detail),
            color=palette.secondary,
            max_width=SAFE_WIDTH * 0.34,
            min_width=SAFE_WIDTH * 0.22,
        )
        for node in targets
    ]
    column = VGroup(*cards).arrange(DOWN, buff=GAP * 0.8)
    column.next_to(source, RIGHT, buff=GAP_WIDE * 1.6)

    # Each target owns the arrow that reaches it, so one reveal = one whole idea.
    elements = [
        scene.unit(scene.connect(source, card, color=palette.muted), card)
        for card in cards
    ]

    scene.stage(VGroup(source, *elements))

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(source, animation=Create(source), label=params.source.label)

    for i, element in enumerate(elements):
        scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / events)
        scene.reveal(element, animation=FadeIn(element, shift=RIGHT * 0.35),
                     label=targets[i].label)

    if params.highlightIndex is not None:
        index = params.highlightIndex
        scene.cue_wait(timeline, nth_phrase(timeline, n + 1), duration * (n + 1) / events)
        scene.emphasize(cards[index], circumscribe=True, label=targets[index].label)

    scene.pad_to(duration)
