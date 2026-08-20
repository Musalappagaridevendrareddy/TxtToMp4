"""parallel_race — two processes, step for step.

The comparison only works if the two lanes advance *together*, so a step pair is
one reveal: both cells of a row enter on the same animation. That is not a
loophole in the one-element-at-a-time rule, it is the rule applied to the right
unit — in this archetype the row is the element, and half a row means nothing.

Mirrors ArchetypeParams.parallel_race in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, UP, Create, DashedLine, FadeIn, Text, VGroup
from ..base import Fields, ParamsModel, nth_phrase
from ..theme import FONT_BODY, GAP, GAP_TIGHT, SAFE_HEIGHT, SAFE_WIDTH, STROKE_THIN

ARCHETYPE = "parallel_race"


@dataclass(frozen=True)
class Lane:
    label: str
    steps: tuple[str, ...]


@dataclass(frozen=True)
class Params(ParamsModel):
    laneA: Lane
    laneB: Lane
    verdict: str | None = None


def _lane(f: Fields, key: str) -> Lane:
    sub = f.sub(key)
    return Lane(label=sub.label("label"), steps=tuple(sub.label_list("steps", lo=2, hi=3)))


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)
    lane_a = _lane(f, "laneA")
    lane_b = _lane(f, "laneB")
    verdict = f.sublabel("verdict")
    f.done()
    return Params(laneA=lane_a, laneB=lane_b, verdict=verdict)


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    lanes = (params.laneA, params.laneB)
    rows = max(len(lanes[0].steps), len(lanes[1].steps))
    events = 1 + rows + (1 if params.verdict else 0)
    scene.begin(duration, events=events)

    column_x = SAFE_WIDTH * 0.23
    cell_width = SAFE_WIDTH * 0.40
    row_pitch = min(SAFE_HEIGHT * 0.20, 1.35)
    xs = (-column_x, column_x)
    inks = (palette.primary, palette.secondary)

    # --- header: both lane names plus the divider that separates them --
    heads = []
    for lane, x, ink in zip(lanes, xs, inks):
        head = scene.card(
            scene.wrap_label(lane.label, 18),
            color=ink,
            max_width=cell_width,
            min_width=cell_width * 0.9,
        )
        head.move_to(RIGHT * x)
        heads.append(head)

    total_height = row_pitch * (rows + 0.6)
    divider = DashedLine(
        UP * (heads[0].height / 2 + GAP_TIGHT),
        DOWN * total_height,
        color=palette.muted,
        stroke_width=STROKE_THIN,
        dash_length=0.12,
    )
    header = scene.unit(heads[0], heads[1], divider)

    # --- rows: one reveal per lockstep pair ----------------------------
    row_units = []
    for i in range(rows):
        cells = []
        for lane, x in zip(lanes, xs):
            if i >= len(lane.steps):
                continue
            cell = scene.card(
                scene.wrap_label(lane.steps[i], 18),
                color=palette.muted,
                max_width=cell_width,
                min_width=cell_width * 0.9,
                fill=False,
            )
            cell.move_to(RIGHT * x + DOWN * (row_pitch * (i + 1)))
            cells.append(cell)
        row_units.append(scene.unit(*cells))

    parts: list[Any] = [header, *row_units]

    verdict_mob = None
    if params.verdict:
        verdict_mob = Text(params.verdict, font_size=FONT_BODY * 0.95, color=palette.accent)
        scene.fit(verdict_mob, max_width=SAFE_WIDTH * 0.7)
        verdict_mob.move_to(DOWN * (row_pitch * (rows + 1) + GAP * 0.3))
        parts.append(verdict_mob)

    scene.stage(VGroup(*parts))

    scene.cue_wait(timeline, nth_phrase(timeline, 0), 0.0)
    scene.reveal(header, animation=Create(header), label=f"{lanes[0].label} | {lanes[1].label}")

    for i, row in enumerate(row_units):
        scene.cue_wait(timeline, nth_phrase(timeline, i + 1), duration * (i + 1) / events)
        scene.reveal(row, animation=FadeIn(row, shift=DOWN * 0.2), label=f"step {i + 1}")

    if verdict_mob is not None:
        scene.cue_wait(timeline, nth_phrase(timeline, rows + 1), duration * (rows + 1) / events)
        scene.reveal(
            verdict_mob,
            animation=FadeIn(verdict_mob, scale=0.85),
            label=params.verdict or "verdict",
        )

    scene.pad_to(duration)
