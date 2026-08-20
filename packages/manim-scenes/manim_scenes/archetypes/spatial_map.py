"""spatial_map — position and distance carry the meaning.

Normalised 0..1 coordinates are mapped straight onto the plot area, y flipped so
that 0 is the top (the convention every author reaches for). Nodes are dots, not
boxes: a box implies containment, and here the only claim being made is *where*.
Edges attach to the node they leave from, so a graph stays one shape on screen
instead of eating the element budget one line at a time.

Mirrors ArchetypeParams.spatial_map in packages/spec/src/archetypes.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._manim import DOWN, RIGHT, UP, Create, Dot, FadeIn, Line, Text, VGroup
from ..base import Fields, ParamsModel, nth_phrase
from ..theme import FONT_BODY, GAP_TIGHT, SAFE_HEIGHT, SAFE_WIDTH, STROKE_THIN

ARCHETYPE = "spatial_map"


@dataclass(frozen=True)
class MapNode:
    label: str
    x: float
    y: float


@dataclass(frozen=True)
class Edge:
    source: int
    target: int
    label: str | None = None


@dataclass(frozen=True)
class Params(ParamsModel):
    nodes: tuple[MapNode, ...]
    edges: tuple[Edge, ...] = ()


def parse_params(raw: dict) -> Params:
    f = Fields(ARCHETYPE, raw)

    nodes: list[MapNode] = []
    for i, item in enumerate(f.raw_list("nodes", lo=2, hi=5)):
        if not isinstance(item, dict):
            f.fail(f"nodes.{i}: expected an object with 'label', 'x' and 'y'")
            continue
        entry = Fields(ARCHETYPE, item, prefix=f"nodes.{i}")
        entry.issues = f.issues
        nodes.append(
            MapNode(
                label=entry.label("label"),
                x=entry.number("x", lo=0.0, hi=1.0) or 0.0,
                y=entry.number("y", lo=0.0, hi=1.0) or 0.0,
            )
        )

    edges: list[Edge] = []
    for i, item in enumerate(f.raw_list("edges", lo=0, hi=4, default_empty=True)):
        if not isinstance(item, dict):
            f.fail(f"edges.{i}: expected an object with 'from' and 'to'")
            continue
        entry = Fields(ARCHETYPE, item, prefix=f"edges.{i}")
        entry.issues = f.issues
        source = entry.integer("from", lo=0, hi=4)
        target = entry.integer("to", lo=0, hi=4)
        label = entry.sublabel("label")
        if source is None or target is None:
            continue
        # Mirrors the cross-field checks in packages/spec/src/schema.ts.
        if source >= len(nodes) or target >= len(nodes):
            f.fail(f"edges.{i}: references a node index that does not exist "
                   f"({len(nodes)} nodes defined)")
            continue
        if source == target:
            f.fail(f"edges.{i}: an edge cannot start and end at the same node")
            continue
        edges.append(Edge(source=source, target=target, label=label))

    f.done()
    return Params(nodes=tuple(nodes), edges=tuple(edges))


def build(scene: Any, params: Params, duration: float, timeline: Any = None) -> None:
    palette = scene.palette
    nodes = params.nodes
    edges = params.edges
    events = len(nodes) + len(edges)
    scene.begin(duration, events=events)

    plot_width = SAFE_WIDTH * 0.74
    plot_height = SAFE_HEIGHT * 0.56

    dots = []
    markers = []
    for i, node in enumerate(nodes):
        point = RIGHT * ((node.x - 0.5) * plot_width) + UP * ((0.5 - node.y) * plot_height)
        dot = Dot(point, radius=0.11, color=palette.cycle(i))
        caption = Text(scene.wrap_label(node.label, 16), font_size=FONT_BODY * 0.85,
                       color=palette.accent)
        scene.fit(caption, max_width=plot_width / max(1, len(nodes)))
        caption.next_to(dot, UP, buff=GAP_TIGHT * 0.8)
        dots.append(dot)
        markers.append(scene.unit(dot, caption))

    connectors = []
    for edge in edges:
        line = Line(
            dots[edge.source].get_center(),
            dots[edge.target].get_center(),
            color=palette.muted,
            stroke_width=STROKE_THIN,
            buff=0.22,
        )
        parts: list[Any] = [line]
        if edge.label:
            caption = Text(edge.label, font_size=FONT_BODY * 0.66, color=palette.muted)
            scene.fit(caption, max_width=max(1.1, line.width * 0.8))
            caption.next_to(line, DOWN, buff=GAP_TIGHT * 0.6)
            parts.append(caption)
        connectors.append(scene.unit(*parts))

    scene.stage(VGroup(*markers, *connectors))

    for i, marker in enumerate(markers):
        scene.cue_wait(timeline, nth_phrase(timeline, i), duration * i / events)
        scene.reveal(marker, animation=FadeIn(marker, scale=0.6), label=nodes[i].label)

    for j, connector in enumerate(connectors):
        index = len(nodes) + j
        scene.cue_wait(timeline, nth_phrase(timeline, index), duration * index / events)
        scene.reveal(
            connector,
            animation=Create(connector),
            into=markers[edges[j].source],
            label=edges[j].label or f"{nodes[edges[j].source].label} to {nodes[edges[j].target].label}",
        )

    scene.pad_to(duration)
