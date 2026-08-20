"""zoom_detail — show the whole, then magnify one part.

Three moves. The overview establishes the context. One small thing inside it is
named. Then the context leaves and that small thing *grows into* the frame it
vacated — a ReplacementTransform, so the audience keeps hold of which part they
are now looking at — and its internals appear beneath it.

Mirrors ArchetypeParams.zoom_detail in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import (
    DOWN, RIGHT, UP, Create, FadeIn, RoundedRectangle, Text, VGroup,
)
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import (
    CARD_PAD_Y, CORNER_RADIUS, FILL_OPACITY, FONT_BODY, FONT_TITLE, GAP,
    GAP_TIGHT, SAFE_HEIGHT, SAFE_WIDTH, STROKE_THIN,
)

ARCHETYPE = "zoom_detail"


@dataclass(frozen=True)
class Params(ParamsModel):
    overview: Node
    focus: Node
    revealed: tuple[Node, ...]


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    overview = f.node("overview")
    focus = f.node("focus")
    revealed = f.node_list("revealed", lo=1, hi=3)
    f.done()
    return Params(overview=overview, focus=focus, revealed=tuple(revealed))


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    revealed = params.revealed
    n = len(revealed)
    events = 3 + n
    scene.begin(duration, events=events)

    # --- the whole ---------------------------------------------------
    frame = RoundedRectangle(
        corner_radius=CORNER_RADIUS,
        width=SAFE_WIDTH * 0.62,
        height=SAFE_HEIGHT * 0.58,
        color=palette.muted,
        stroke_width=STROKE_THIN,
        fill_color=palette.muted,
        fill_opacity=FILL_OPACITY * 0.4,
    )
    frame_label = Text(
        scene.wrap_label(params.overview.label, 20), font_size=FONT_BODY, color=palette.primary
    )
    scene.fit(frame_label, max_width=frame.width * 0.8)
    frame_label.move_to(frame.get_top() + DOWN * (CARD_PAD_Y + frame_label.height / 2))
    overview = scene.unit(frame, frame_label)

    focus = scene.card(
        Node(scene.wrap_label(params.focus.label, 14), params.focus.detail),
        color=palette.accent,
        max_width=frame.width * 0.45,
    )
    focus.move_to(frame.get_center() + DOWN * GAP * 0.4)

    scene.stage(scene.unit(overview, focus), max_scale=1.0)

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(overview, animation=Create(overview), label=params.overview.label)

    scene.cue_wait(timeline, nth_phrase(timeline, 1), duration / events)
    scene.reveal(focus, animation=FadeIn(focus, scale=0.6), label=params.focus.label)

    # --- the part ----------------------------------------------------
    # Context leaves first so the magnified detail lands in an empty frame.
    scene.retire(overview)

    headline = Text(
        scene.wrap_label(params.focus.label, 22), font_size=FONT_TITLE, color=palette.accent
    )
    scene.fit(headline, max_width=SAFE_WIDTH * 0.8)
    rule = RoundedRectangle(
        corner_radius=0.02, width=max(headline.width, 2.0), height=0.05,
        color=palette.accent, stroke_width=0, fill_color=palette.accent, fill_opacity=0.9,
    )
    rule.next_to(headline, DOWN, buff=GAP_TIGHT)
    focus_big = scene.unit(headline, rule)

    detail_cards = [
        scene.card(
            Node(scene.wrap_label(node.label, 20), node.detail),
            color=palette.primary,
            max_width=SAFE_WIDTH / (n + 0.6),
        )
        for node in revealed
    ]
    details = VGroup(*detail_cards).arrange(RIGHT if n > 1 else DOWN, buff=GAP * 0.9)
    details.next_to(focus_big, DOWN, buff=GAP * 1.1)
    scene.stage(scene.unit(focus_big, details), max_scale=1.15)

    scene.cue_wait(timeline, nth_phrase(timeline, 2), duration * 2 / events)
    scene.morph(focus, focus_big, label=params.focus.label)

    for i, card in enumerate(detail_cards):
        scene.cue_wait(timeline, nth_phrase(timeline, 3 + i), duration * (3 + i) / events)
        scene.reveal(card, animation=FadeIn(card, shift=UP * 0.25), label=revealed[i].label)

    scene.pad_to(duration)
