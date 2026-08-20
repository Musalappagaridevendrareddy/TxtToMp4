"""branch — a decision that forks.

The question sits alone at the top long enough to actually be read as a
question. Then each outcome drops in below with the arrow that reaches it, left
to right, so the fork is felt as a fork and not as a diagram that was already
finished before we arrived.

Mirrors ArchetypeParams.branch in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, UP, Create, FadeIn, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import GAP, GAP_WIDE, SAFE_WIDTH

ARCHETYPE = "branch"


@dataclass(frozen=True)
class Params(ParamsModel):
    question: Node
    outcomes: tuple[Node, ...]


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    question = f.node("question")
    outcomes = f.node_list("outcomes", lo=2, hi=3)
    f.done()
    return Params(question=question, outcomes=tuple(outcomes))


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    outcomes = params.outcomes
    n = len(outcomes)
    scene.begin(duration, events=1 + n)

    question = scene.card(
        Node(scene.wrap_label(params.question.label, 22), params.question.detail),
        color=palette.accent,
        max_width=SAFE_WIDTH * 0.55,
    )
    question.move_to(UP * (GAP_WIDE * 1.1))

    slot = SAFE_WIDTH / (n + 0.4)
    cards = [
        scene.card(
            Node(scene.wrap_label(node.label, 16), node.detail),
            color=palette.cycle(i),
            max_width=slot,
        )
        for i, node in enumerate(outcomes)
    ]
    row = VGroup(*cards).arrange(RIGHT, buff=GAP)
    row.next_to(question, DOWN, buff=GAP_WIDE * 1.5)

    # Arrow last: it has to reach a card that already knows where it lives.
    elements = [scene.unit(scene.connect(question, card, color=palette.muted), card)
                for card in cards]

    scene.stage(VGroup(question, *elements))

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(question, animation=Create(question), label=params.question.label)

    for i, element in enumerate(elements):
        scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / (n + 1))
        scene.reveal(element, animation=FadeIn(element, shift=DOWN * 0.25),
                     label=outcomes[i].label)

    scene.pad_to(duration)
