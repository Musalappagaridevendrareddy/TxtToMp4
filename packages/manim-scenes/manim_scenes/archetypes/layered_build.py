"""layered_build — concepts stacking on top of each other.

Built bottom up, because that is the only order in which a stack makes sense:
nothing rests on something that is not there yet. Plates are a uniform width so
the stack reads as one object rather than a bar chart. The optional
``stackLabel`` arrives last, braced against the finished stack — it names the
whole thing, so it cannot arrive before the whole thing exists.

Mirrors ArchetypeParams.layered_build in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, LEFT, UP, FadeIn, Line, Text, VGroup
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import FONT_BODY, GAP, GAP_TIGHT, SAFE_HEIGHT, SAFE_WIDTH, STROKE, STROKE_THIN

ARCHETYPE = "layered_build"


@dataclass(frozen=True)
class Params(ParamsModel):
    layers: tuple[Node, ...]
    stackLabel: str | None = None


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    layers = f.node_list("layers", lo=2, hi=4)
    stack_label = f.sublabel("stackLabel")
    f.done()
    return Params(layers=tuple(layers), stackLabel=stack_label)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    layers = params.layers
    n = len(layers)
    events = n + (1 if params.stackLabel else 0)
    scene.begin(duration, events=events)

    plate_width = SAFE_WIDTH * 0.44
    plates = [
        scene.card(
            Node(scene.wrap_label(node.label, 22), node.detail),
            color=palette.cycle(i),
            max_width=plate_width,
            min_width=plate_width,
        )
        for i, node in enumerate(layers)
    ]

    # layers[0] is the foundation, so it goes at the bottom and the stack grows up.
    stack = VGroup(*plates).arrange(UP, buff=GAP * 0.28)
    scene.fit(stack, max_height=SAFE_HEIGHT * 0.82)

    parts: list[Any] = [stack]
    brace = None
    if params.stackLabel:
        spine = Line(
            stack.get_corner(DOWN + LEFT), stack.get_corner(UP + LEFT),
            color=palette.muted, stroke_width=STROKE_THIN,
        )
        spine.next_to(stack, LEFT, buff=GAP * 0.6)
        caption = Text(params.stackLabel, font_size=FONT_BODY * 0.85, color=palette.muted)
        scene.fit(caption, max_width=SAFE_WIDTH * 0.22)
        caption.next_to(spine, LEFT, buff=GAP_TIGHT)
        brace = scene.unit(spine, caption)
        parts.append(brace)

    scene.stage(VGroup(*parts))

    for i, plate in enumerate(plates):
        scene.cue_wait(timeline, nth_phrase(timeline, i), duration * i / events)
        scene.reveal(plate, animation=FadeIn(plate, shift=UP * 0.4), label=layers[i].label)

    if brace is not None:
        scene.cue_wait(timeline, nth_phrase(timeline, n), duration * n / events)
        scene.reveal(brace, animation=FadeIn(brace, shift=LEFT * 0.25),
                     label=params.stackLabel or "stack")

    scene.pad_to(duration)
