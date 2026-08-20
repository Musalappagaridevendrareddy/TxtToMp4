"""accumulation — something filling, compounding, growing.

Magnitudes arrive from the spec already normalised 0..1, so they are used
directly as bar heights: no autoscaling, no axis, no invented numbers. Each bar
grows up out of the baseline rather than fading in, because growth is the whole
claim being made. The subject and its baseline are one element and every bar
attaches to it — a chart is one thing on screen, not six.

Mirrors ArchetypeParams.accumulation in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import (
    DOWN, LEFT, RIGHT, UP, Create, GrowFromEdge, Line, Rectangle, Text,
)
from ..base import Fields, Node, ParamsModel, nth_phrase
from ..theme import (
    FONT_BODY, GAP, GAP_TIGHT, SAFE_HEIGHT, SAFE_WIDTH, STROKE, STROKE_THIN,
)

ARCHETYPE = "accumulation"


@dataclass(frozen=True)
class Stage:
    label: str
    magnitude: float


@dataclass(frozen=True)
class Params(ParamsModel):
    subject: Node
    stages: tuple[Stage, ...]


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    subject = f.node("subject")

    stages: list[Stage] = []
    for i, item in enumerate(f.raw_list("stages", lo=2, hi=5)):
        entry = Fields(ARCHETYPE, item if isinstance(item, dict) else {}, prefix=f"stages.{i}")
        entry.issues = f.issues
        if not isinstance(item, dict):
            f.fail(f"stages.{i}: expected an object with 'label' and 'magnitude'")
            continue
        label = entry.label("label")
        magnitude = entry.number("magnitude", lo=0.0, hi=1.0)
        stages.append(Stage(label=label, magnitude=magnitude if magnitude is not None else 0.0))

    # Mirrors the cross-field check in packages/spec/src/schema.ts: this
    # archetype animates growth, so a shrinking series is a spec bug.
    for i in range(1, len(stages)):
        if stages[i].magnitude < stages[i - 1].magnitude:
            f.fail(
                f"stages.{i}.magnitude: {stages[i].magnitude} is lower than the previous "
                f"stage ({stages[i - 1].magnitude}) — accumulation only grows"
            )
            break

    f.done()
    return Params(subject=subject, stages=tuple(stages))


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    stages = params.stages
    n = len(stages)
    events = 1 + n
    scene.begin(duration, events=events)

    plot_width = SAFE_WIDTH * 0.72
    plot_height = SAFE_HEIGHT * 0.46
    slot = plot_width / n
    bar_width = slot * 0.52
    baseline_y = -SAFE_HEIGHT * 0.20

    baseline = Line(
        LEFT * (plot_width / 2) + UP * baseline_y,
        RIGHT * (plot_width / 2) + UP * baseline_y,
        color=palette.muted,
        stroke_width=STROKE,
    )

    subject = scene.card(
        Node(scene.wrap_label(params.subject.label, 18), params.subject.detail),
        color=palette.primary,
        max_width=SAFE_WIDTH * 0.34,
    )
    subject.move_to(
        LEFT * (plot_width / 2 - subject.width / 2)
        + UP * (baseline_y + plot_height + GAP * 0.9 + subject.height / 2)
    )
    chart = scene.unit(subject, baseline)

    bars = []
    for i, stage in enumerate(stages):
        # A zero-magnitude stage still has to be visible, or the beat has a hole.
        height = max(0.12, stage.magnitude) * plot_height
        x = -plot_width / 2 + slot * (i + 0.5)
        bar = Rectangle(
            width=bar_width,
            height=height,
            color=palette.cycle(i),
            stroke_width=STROKE_THIN,
            fill_color=palette.cycle(i),
            fill_opacity=0.55,
        )
        bar.move_to(RIGHT * x + UP * (baseline_y + height / 2))
        tick = Text(scene.wrap_label(stage.label, 12), font_size=FONT_BODY * 0.66,
                    color=palette.muted)
        scene.fit(tick, max_width=slot * 0.95)
        tick.move_to(RIGHT * x + UP * (baseline_y - GAP_TIGHT - tick.height / 2))
        bars.append(scene.unit(bar, tick))

    scene.stage(scene.unit(chart, *bars), max_scale=1.1)

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(chart, animation=Create(chart), label=params.subject.label)

    for i, bar in enumerate(bars):
        scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / events)
        scene.reveal(
            bar,
            animation=GrowFromEdge(bar, DOWN),
            into=chart,
            label=stages[i].label,
        )

    scene.pad_to(duration)
