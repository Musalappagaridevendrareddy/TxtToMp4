"""reveal_conceal — hidden state becoming visible, or the reverse.

Forward: the cover sits alone, is believed, then lifts — and what was underneath
it all along is already in position. Reverse (``reverse: true``): the internals
are shown, understood, and then swallowed by the abstraction that will hide them
from here on. Same geometry, opposite argument.

Mirrors ArchetypeParams.reveal_conceal in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, UP, Create, FadeIn, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import GAP, SAFE_WIDTH

ARCHETYPE = "reveal_conceal"


@dataclass(frozen=True)
class Params(ParamsModel):
    cover: Node
    hidden: tuple[Node, ...]
    reverse: bool = False


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    cover = f.node("cover")
    hidden = f.node_list("hidden", lo=1, hi=3)
    reverse = f.boolean("reverse", default=False)
    f.done()
    return Params(cover=cover, hidden=tuple(hidden), reverse=reverse)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    hidden = params.hidden
    n = len(hidden)
    events = 1 + n
    scene.begin(duration, events=events)

    cards = [
        scene.card(
            Node(scene.wrap_label(node.label, 16), node.detail),
            color=palette.primary,
            max_width=SAFE_WIDTH / (n + 0.5),
        )
        for node in hidden
    ]
    row = VGroup(*cards).arrange(RIGHT if n > 1 else DOWN, buff=GAP)
    scene.stage(row, max_scale=1.25)

    # The cover is sized to the thing it hides — that is what makes it a cover
    # rather than a caption sitting on top of the internals.
    cover = scene.card(
        Node(scene.wrap_label(params.cover.label, 22), params.cover.detail),
        color=palette.accent,
        max_width=max(row.width, SAFE_WIDTH * 0.35),
        min_width=max(row.width * 0.9, SAFE_WIDTH * 0.3),
    )
    cover.move_to(row.get_center())
    scene.assert_in_frame(cover)

    if params.reverse:
        for i, card in enumerate(cards):
            scene.cue_wait(timeline, nth_phrase(timeline, i), duration * i / events)
            scene.reveal(card, animation=FadeIn(card, shift=UP * 0.2), label=hidden[i].label)
        scene.cue_wait(timeline, nth_phrase(timeline, n), duration * n / events)
        scene.reveal(cover, animation=FadeIn(cover, scale=1.3), label=params.cover.label)
        scene.retire(*cards)
    else:
        scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
        scene.reveal(cover, animation=Create(cover), label=params.cover.label)
        scene.retire(cover)
        for i, card in enumerate(cards):
            scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / events)
            scene.reveal(card, animation=FadeIn(card, scale=0.7), label=hidden[i].label)

    scene.pad_to(duration)
