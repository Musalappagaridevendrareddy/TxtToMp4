"""Thin compatibility layer over Manim.

Every archetype imports its drawing primitives from here, never from ``manim``
directly. When Manim is installed these names ARE Manim's. When it is not, they
are geometrically honest stubs: they track a centre point and a bounding box, so
layout maths, frame-safety checks, element counting and timing budgets are all
exercised for real by the test suite without a single Cairo call.

ponytail: the stubs model position + bbox only. No bezier, no rendering, no
colour maths. Upgrade path if a layout bug ever slips past the stubs: widen
``_Text`` metrics, not the whole model.
"""

from __future__ import annotations

import math

__all__ = [
    "HAS_MANIM",
    "UP", "DOWN", "LEFT", "RIGHT", "ORIGIN", "UL", "UR", "DL", "DR",
    "Text", "Rectangle", "RoundedRectangle", "Circle", "Dot", "Line",
    "DashedLine", "Arrow", "CurvedArrow", "SurroundingRectangle", "VGroup",
    "Create", "Uncreate", "Write", "FadeIn", "FadeOut", "GrowArrow",
    "GrowFromEdge", "Transform", "ReplacementTransform", "Indicate",
    "Circumscribe", "rate_functions", "config", "Scene",
]

try:  # pragma: no cover - exercised only where manim is installed
    from manim import (  # type: ignore
        UP, DOWN, LEFT, RIGHT, ORIGIN, UL, UR, DL, DR,
        Text, Rectangle, RoundedRectangle, Circle, Dot, Line, DashedLine,
        Arrow, CurvedArrow, SurroundingRectangle, VGroup,
        Create, Uncreate, Write, FadeIn, FadeOut, GrowArrow, GrowFromEdge,
        Transform, ReplacementTransform, Indicate, Circumscribe,
        rate_functions, config, Scene,
    )

    HAS_MANIM = True

except ImportError:  # pragma: no cover - the path the tests take
    HAS_MANIM = False

    # ------------------------------------------------------------------ vector

    class Vec3:
        """Minimal 3-vector with the operator surface archetypes actually use.

        Mirrors what ``numpy.ndarray`` gives us under real Manim, so archetype
        code (``RIGHT * 2 + UP * 0.5``, ``point[0]``) is identical either way.
        """

        __slots__ = ("_v",)

        def __init__(self, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> None:
            self._v = (float(x), float(y), float(z))

        def __getitem__(self, i: int) -> float:
            return self._v[i]

        def __iter__(self):
            return iter(self._v)

        def __len__(self) -> int:
            return 3

        def __add__(self, o) -> "Vec3":
            o = _as_vec(o)
            return Vec3(self[0] + o[0], self[1] + o[1], self[2] + o[2])

        __radd__ = __add__

        def __sub__(self, o) -> "Vec3":
            o = _as_vec(o)
            return Vec3(self[0] - o[0], self[1] - o[1], self[2] - o[2])

        def __rsub__(self, o) -> "Vec3":
            return _as_vec(o) - self

        def __mul__(self, k) -> "Vec3":
            if isinstance(k, (int, float)):
                return Vec3(self[0] * k, self[1] * k, self[2] * k)
            o = _as_vec(k)
            return Vec3(self[0] * o[0], self[1] * o[1], self[2] * o[2])

        __rmul__ = __mul__

        def __truediv__(self, k: float) -> "Vec3":
            return Vec3(self[0] / k, self[1] / k, self[2] / k)

        def __neg__(self) -> "Vec3":
            return Vec3(-self[0], -self[1], -self[2])

        def __eq__(self, o) -> bool:
            try:
                o = _as_vec(o)
            except TypeError:
                return NotImplemented
            return all(abs(self[i] - o[i]) < 1e-9 for i in range(3))

        def __hash__(self) -> int:
            return hash(self._v)

        def __repr__(self) -> str:
            return f"Vec3({self[0]:.3f}, {self[1]:.3f}, {self[2]:.3f})"

        def norm(self) -> float:
            return math.sqrt(sum(c * c for c in self._v))

    def _as_vec(o) -> Vec3:
        if isinstance(o, Vec3):
            return o
        if isinstance(o, (tuple, list)):
            vals = list(o) + [0.0, 0.0, 0.0]
            return Vec3(vals[0], vals[1], vals[2])
        if isinstance(o, (int, float)):
            return Vec3(o, o, o)
        raise TypeError(f"cannot coerce {type(o).__name__} to a vector")

    ORIGIN = Vec3(0, 0, 0)
    UP = Vec3(0, 1, 0)
    DOWN = Vec3(0, -1, 0)
    LEFT = Vec3(-1, 0, 0)
    RIGHT = Vec3(1, 0, 0)
    UL = Vec3(-1, 1, 0)
    UR = Vec3(1, 1, 0)
    DL = Vec3(-1, -1, 0)
    DR = Vec3(1, -1, 0)

    # ----------------------------------------------------------------- mobject

    class Mobject:
        """A centre point plus a bounding box. That is the whole model."""

        def __init__(self, width: float = 1.0, height: float = 1.0, **kwargs) -> None:
            self._centre = Vec3(0, 0, 0)
            self._width = float(width)
            self._height = float(height)
            self.submobjects: list["Mobject"] = []
            self.color = kwargs.get("color")
            self.fill_opacity = kwargs.get("fill_opacity", 0.0)
            self.stroke_width = kwargs.get("stroke_width", 4.0)
            self.z_index = 0

        # -- geometry ----------------------------------------------------
        @property
        def width(self) -> float:
            return self._width

        @width.setter
        def width(self, value: float) -> None:
            self.scale(value / self._width if self._width else 1.0)

        @property
        def height(self) -> float:
            return self._height

        def get_center(self) -> Vec3:
            return self._centre

        def get_left(self) -> Vec3:
            return Vec3(self._centre[0] - self._width / 2, self._centre[1], 0)

        def get_right(self) -> Vec3:
            return Vec3(self._centre[0] + self._width / 2, self._centre[1], 0)

        def get_top(self) -> Vec3:
            return Vec3(self._centre[0], self._centre[1] + self._height / 2, 0)

        def get_bottom(self) -> Vec3:
            return Vec3(self._centre[0], self._centre[1] - self._height / 2, 0)

        def get_corner(self, direction) -> Vec3:
            d = _as_vec(direction)
            return Vec3(
                self._centre[0] + d[0] * self._width / 2,
                self._centre[1] + d[1] * self._height / 2,
                0,
            )

        def get_edge_center(self, direction) -> Vec3:
            return self.get_corner(direction)

        # -- transforms --------------------------------------------------
        def shift(self, *vectors) -> "Mobject":
            total = Vec3(0, 0, 0)
            for v in vectors:
                total = total + _as_vec(v)
            self._centre = self._centre + total
            for sub in self.submobjects:
                sub.shift(total)
            return self

        def move_to(self, target) -> "Mobject":
            point = target.get_center() if isinstance(target, Mobject) else _as_vec(target)
            return self.shift(point - self._centre)

        def next_to(self, target, direction=RIGHT, buff: float = 0.25) -> "Mobject":
            d = _as_vec(direction)
            anchor = target.get_center() if isinstance(target, Mobject) else _as_vec(target)
            tw = target.width / 2 if isinstance(target, Mobject) else 0.0
            th = target.height / 2 if isinstance(target, Mobject) else 0.0
            dx = d[0] * (tw + buff + self._width / 2)
            dy = d[1] * (th + buff + self._height / 2)
            return self.move_to(Vec3(anchor[0] + dx, anchor[1] + dy, 0))

        def align_to(self, target, direction) -> "Mobject":
            d = _as_vec(direction)
            edge = target.get_corner(d) if isinstance(target, Mobject) else _as_vec(target)
            mine = self.get_corner(d)
            dx = (edge[0] - mine[0]) if d[0] else 0.0
            dy = (edge[1] - mine[1]) if d[1] else 0.0
            return self.shift(Vec3(dx, dy, 0))

        def to_edge(self, direction=UP, buff: float = 0.5) -> "Mobject":
            d = _as_vec(direction)
            x, y = self._centre[0], self._centre[1]
            if d[0]:
                x = d[0] * (config.frame_width / 2 - buff - self._width / 2)
            if d[1]:
                y = d[1] * (config.frame_height / 2 - buff - self._height / 2)
            return self.move_to(Vec3(x, y, 0))

        def scale(self, factor: float, **kwargs) -> "Mobject":
            self._width *= factor
            self._height *= factor
            for sub in self.submobjects:
                sub._centre = self._centre + (sub._centre - self._centre) * factor
                sub.scale(factor)
            return self

        def rotate(self, *_args, **_kwargs) -> "Mobject":
            return self

        def arrange(self, direction=RIGHT, buff: float = 0.25, **_kwargs) -> "Mobject":
            if not self.submobjects:
                return self
            first, *rest = self.submobjects
            previous = first
            for sub in rest:
                sub.next_to(previous, direction, buff=buff)
                previous = sub
            self._recompute()
            return self

        # -- styling (no-ops that keep the fluent API alive) -------------
        def set_color(self, color) -> "Mobject":
            self.color = color
            return self

        def set_fill(self, color=None, opacity=None, **_kwargs) -> "Mobject":
            if opacity is not None:
                self.fill_opacity = opacity
            return self

        def set_stroke(self, color=None, width=None, **_kwargs) -> "Mobject":
            if width is not None:
                self.stroke_width = width
            return self

        def set_opacity(self, _opacity) -> "Mobject":
            return self

        def set_z_index(self, z) -> "Mobject":
            self.z_index = z
            return self

        def copy(self) -> "Mobject":
            import copy as _copy

            return _copy.deepcopy(self)

        def _recompute(self) -> None:
            if not self.submobjects:
                return
            xs_lo = min(s.get_left()[0] for s in self.submobjects)
            xs_hi = max(s.get_right()[0] for s in self.submobjects)
            ys_lo = min(s.get_bottom()[1] for s in self.submobjects)
            ys_hi = max(s.get_top()[1] for s in self.submobjects)
            self._width = xs_hi - xs_lo
            self._height = ys_hi - ys_lo
            self._centre = Vec3((xs_lo + xs_hi) / 2, (ys_lo + ys_hi) / 2, 0)

    class VMobject(Mobject):
        pass

    class VGroup(VMobject):
        def __init__(self, *mobjects, **kwargs) -> None:
            super().__init__(**kwargs)
            self.submobjects = [m for m in mobjects if m is not None]
            self._recompute()

        def add(self, *mobjects) -> "VGroup":
            self.submobjects.extend(m for m in mobjects if m is not None)
            self._recompute()
            return self

        def __iter__(self):
            return iter(self.submobjects)

        def __len__(self) -> int:
            return len(self.submobjects)

        def __getitem__(self, i):
            return self.submobjects[i]

    # -- concrete shapes -------------------------------------------------

    class Text(VMobject):
        """Metrics tuned against real Manim's Pango output, deliberately a hair
        wide so a layout that passes headless also passes rendered."""

        CHAR_W = 0.0064
        LINE_H = 0.0125

        def __init__(self, text: str, font_size: float = 48, **kwargs) -> None:
            self.text = text
            self.font_size = font_size
            longest = max((len(line) for line in text.split("\n")), default=0)
            lines = text.count("\n") + 1
            super().__init__(
                width=max(0.05, longest * font_size * self.CHAR_W),
                height=max(0.05, lines * font_size * self.LINE_H),
                **kwargs,
            )

    class Rectangle(VMobject):
        def __init__(self, width: float = 4.0, height: float = 2.0, **kwargs) -> None:
            super().__init__(width=width, height=height, **kwargs)

    class RoundedRectangle(Rectangle):
        def __init__(self, corner_radius: float = 0.5, **kwargs) -> None:
            self.corner_radius = corner_radius
            super().__init__(**kwargs)

    class Circle(VMobject):
        def __init__(self, radius: float = 1.0, **kwargs) -> None:
            self.radius = radius
            super().__init__(width=2 * radius, height=2 * radius, **kwargs)

    class Dot(Circle):
        def __init__(self, point=ORIGIN, radius: float = 0.08, **kwargs) -> None:
            super().__init__(radius=radius, **kwargs)
            self.move_to(point)

    class Line(VMobject):
        def __init__(self, start=LEFT, end=RIGHT, buff: float = 0.0, **kwargs) -> None:
            a = start.get_center() if isinstance(start, Mobject) else _as_vec(start)
            b = end.get_center() if isinstance(end, Mobject) else _as_vec(end)
            self.start, self.end = a, b
            super().__init__(
                width=max(abs(b[0] - a[0]), 0.02),
                height=max(abs(b[1] - a[1]), 0.02),
                **kwargs,
            )
            self.move_to((a + b) / 2)

        def get_start(self) -> Vec3:
            return self.start

        def get_end(self) -> Vec3:
            return self.end

    class DashedLine(Line):
        pass

    class Arrow(Line):
        def __init__(self, start=LEFT, end=RIGHT, **kwargs) -> None:
            kwargs.pop("stroke_width", None)
            kwargs.pop("max_tip_length_to_length_ratio", None)
            kwargs.pop("tip_length", None)
            kwargs.pop("buff", None)
            super().__init__(start=start, end=end, **kwargs)

    class CurvedArrow(Arrow):
        def __init__(self, start_point=LEFT, end_point=RIGHT, angle: float = math.pi / 2, **kwargs) -> None:
            kwargs.pop("angle", None)
            super().__init__(start=start_point, end=end_point, **kwargs)
            # A curve bulges beyond the chord; approximate the sagitta.
            chord = (self.end - self.start).norm()
            bulge = abs(angle) * chord / 8
            self._width += bulge
            self._height += bulge

    class SurroundingRectangle(Rectangle):
        def __init__(self, mobject, buff: float = 0.1, **kwargs) -> None:
            kwargs.pop("corner_radius", None)
            super().__init__(
                width=mobject.width + 2 * buff,
                height=mobject.height + 2 * buff,
                **kwargs,
            )
            self.move_to(mobject.get_center())

    # -- animations ------------------------------------------------------

    class Animation:
        def __init__(self, *mobjects, **kwargs) -> None:
            self.mobjects = mobjects
            self.mobject = mobjects[0] if mobjects else None
            self.run_time = kwargs.get("run_time")
            self.kwargs = kwargs

        def __repr__(self) -> str:
            return f"{type(self).__name__}()"

    class Create(Animation): pass
    class Uncreate(Animation): pass
    class Write(Animation): pass
    class FadeIn(Animation): pass
    class FadeOut(Animation): pass
    class GrowArrow(Animation): pass
    class GrowFromEdge(Animation): pass
    class Indicate(Animation): pass
    class Circumscribe(Animation): pass

    class Transform(Animation):
        def __init__(self, mobject, target_mobject, **kwargs) -> None:
            super().__init__(mobject, target_mobject, **kwargs)
            self.target_mobject = target_mobject

    class ReplacementTransform(Transform): pass

    class _RateFunctions:
        @staticmethod
        def smooth(t: float, inflection: float = 10.0) -> float:
            return t * t * t * (t * (6 * t - 15) + 10)

        @staticmethod
        def ease_out_cubic(t: float) -> float:
            return 1 - pow(1 - t, 3)

        @staticmethod
        def linear(t: float) -> float:
            return t

    rate_functions = _RateFunctions()

    class _Config:
        frame_width = 14.222222222222221
        frame_height = 8.0
        pixel_width = 1920
        pixel_height = 1080
        frame_rate = 30

    config = _Config()

    class Scene:  # pragma: no cover - only a base for the null scene
        def __init__(self, *_args, **_kwargs) -> None:
            self.mobjects: list = []

        def play(self, *_animations, **_kwargs) -> None:
            raise NotImplementedError("manim is not installed; use NullScene")

        def wait(self, _duration: float = 1.0, **_kwargs) -> None:
            raise NotImplementedError("manim is not installed; use NullScene")

        def add(self, *mobjects) -> None:
            self.mobjects.extend(mobjects)

        def remove(self, *mobjects) -> None:
            for m in mobjects:
                if m in self.mobjects:
                    self.mobjects.remove(m)
