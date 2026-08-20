"""The three rules, enforced in code.

Every explainer we have ever liked obeys three rules. Prompts do not enforce
rules; classes do. So:

1. **One new element enters at a time.** ``reveal()`` plays exactly one
   animation on exactly one top-level element. Hand it a bare ``VGroup`` of two
   unrelated things and it raises.
2. **Hold after every reveal.** ``reveal()`` always ends in a wait of at least
   ``MIN_HOLD`` seconds. A beat may ask for longer. Nothing may ask for shorter.
3. **Fade out what is no longer relevant.** At most ``MAX_ELEMENTS`` element
   slots may be occupied. Exceed it and you get a ``LayoutError`` that names the
   archetype and the count, not a soup of overlapping boxes.

The module imports cleanly without manim (see ``_manim``) so all of the layout,
timing, budgeting and validation logic is unit-testable headlessly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from . import theme
from ._manim import (
    DOWN, ORIGIN, RIGHT, UP,
    Arrow, Circumscribe, FadeIn, FadeOut, Indicate, ReplacementTransform,
    RoundedRectangle, Text, VGroup,
)
from .theme import (
    CARD_PAD_X, CARD_PAD_Y, CORNER_RADIUS, EASE_IN, EASE_OUT, FILL_OPACITY,
    FONT_BODY, FRAME_HEIGHT, FRAME_WIDTH, GAP_TIGHT, MARGIN, MAX_ELEMENTS,
    SAFE_HEIGHT, SAFE_WIDTH, STROKE, STROKE_THIN, Palette, get_palette,
)

__all__ = [
    "LayoutError", "ParamsError", "Node", "ParamsModel", "Fields",
    "BaseArchetype", "NullScene", "Event", "nth_phrase",
    "MIN_HOLD", "MIN_RUN_TIME", "MAX_RUN_TIME",
]


# Rule 2, as a number. Below this the eye has not finished reading the thing
# that just appeared and the next reveal is wasted.
MIN_HOLD = 1.5

# A reveal faster than this reads as a pop; slower than this reads as a stall.
MIN_RUN_TIME = 0.35
MAX_RUN_TIME = 1.60


# ------------------------------------------------------------------ exceptions


class LayoutError(Exception):
    """A scene tried to put something impossible on screen."""


class ParamsError(ValueError):
    """Raw params did not match an archetype's schema.

    Carries *every* problem, not just the first, so the spec-emitting model can
    fix the whole beat in one retry.
    """

    def __init__(self, archetype: str, issues: Sequence[str]) -> None:
        self.archetype = archetype
        self.issues = list(issues)
        detail = "\n".join(f"  - {i}" for i in self.issues)
        super().__init__(f"invalid params for archetype '{archetype}':\n{detail}")


# ---------------------------------------------------------------------- params


@dataclass(frozen=True)
class Node:
    """The universal atom of every archetype: a label and an optional detail.

    Mirrors ``Node`` in packages/spec/src/archetypes.ts.
    """

    label: str
    detail: str | None = None


@dataclass(frozen=True)
class ParamsModel:
    """Base for every archetype's ``Params``.

    Deliberately a plain frozen dataclass rather than pydantic: this package is
    shelled out to from Node, and every dependency is a thing that can fail to
    install on a render box at 3am. Validation lives in ``Fields``.
    """

    def as_dict(self) -> dict[str, Any]:
        from dataclasses import asdict

        return asdict(self)


# Mirrors the Zod string caps in archetypes.ts. Long strings wreck layout.
LABEL_MAX = 28
SUBLABEL_MAX = 40


class Fields:
    """Explicit, exhaustive validator. Collects problems instead of raising early.

    ``Fields`` mirrors the Zod schemas in packages/spec/src/archetypes.ts field
    for field. When they change, this changes.
    """

    def __init__(self, archetype: str, raw: Any, prefix: str = "") -> None:
        self.archetype = archetype
        self.prefix = prefix
        self.issues: list[str] = []
        if not isinstance(raw, dict):
            self.issues.append(
                f"{prefix or 'params'}: expected an object, got {type(raw).__name__}"
            )
            self.raw: dict[str, Any] = {}
        else:
            self.raw = raw

    def _p(self, path: str) -> str:
        return f"{self.prefix}.{path}" if self.prefix else path

    # -- primitives ----------------------------------------------------
    def _text(self, value: Any, path: str, cap: int) -> str:
        if not isinstance(value, str):
            self.issues.append(f"{path}: expected a string, got {type(value).__name__}")
            return ""
        if len(value) < 1:
            self.issues.append(f"{path}: must not be empty")
        if len(value) > cap:
            self.issues.append(
                f"{path}: {len(value)} characters is too long (max {cap}) — "
                f"long strings wreck the layout, shorten it"
            )
        return value

    def label(self, key: str, *, required: bool = True) -> str:
        path = self._p(key)
        if key not in self.raw:
            if required:
                self.issues.append(f"{path}: required")
            return ""
        return self._text(self.raw[key], path, LABEL_MAX)

    def sublabel(self, key: str, *, default: str | None = None) -> str | None:
        if key not in self.raw or self.raw[key] is None:
            return default
        return self._text(self.raw[key], self._p(key), SUBLABEL_MAX)

    def number(
        self, key: str, *, lo: float, hi: float,
        required: bool = True, default: float | None = None,
    ) -> float | None:
        path = self._p(key)
        if key not in self.raw or self.raw[key] is None:
            if required:
                self.issues.append(f"{path}: required")
            return default
        value = self.raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            self.issues.append(f"{path}: expected a number, got {type(value).__name__}")
            return default
        if not (lo <= value <= hi):
            self.issues.append(f"{path}: {value} is outside the allowed range {lo}..{hi}")
            return default
        return float(value)

    def integer(
        self, key: str, *, lo: int, hi: int, required: bool = True,
        default: int | None = None,
    ) -> int | None:
        path = self._p(key)
        if key not in self.raw or self.raw[key] is None:
            if required:
                self.issues.append(f"{path}: required")
            return default
        value = self.raw[key]
        if isinstance(value, bool) or not isinstance(value, int):
            self.issues.append(f"{path}: expected an integer, got {type(value).__name__}")
            return default
        if not (lo <= value <= hi):
            self.issues.append(f"{path}: {value} is outside the allowed range {lo}..{hi}")
            return default
        return value

    def boolean(self, key: str, *, default: bool) -> bool:
        if key not in self.raw or self.raw[key] is None:
            return default
        value = self.raw[key]
        if not isinstance(value, bool):
            self.issues.append(
                f"{self._p(key)}: expected true or false, got {type(value).__name__}"
            )
            return default
        return value

    # -- composites ----------------------------------------------------
    def node(self, key: str, *, required: bool = True) -> Node:
        path = self._p(key)
        if key not in self.raw or self.raw[key] is None:
            if required:
                self.issues.append(f"{path}: required")
            return Node(label="")
        return self._node_value(self.raw[key], path)

    def optional_node(self, key: str) -> Node | None:
        if key not in self.raw or self.raw[key] is None:
            return None
        return self._node_value(self.raw[key], self._p(key))

    def _node_value(self, value: Any, path: str) -> Node:
        if not isinstance(value, dict):
            self.issues.append(f"{path}: expected an object with a 'label', got {type(value).__name__}")
            return Node(label="")
        label = self._text(value.get("label"), f"{path}.label", LABEL_MAX) if "label" in value else ""
        if "label" not in value:
            self.issues.append(f"{path}.label: required")
        detail = None
        if value.get("detail") is not None:
            detail = self._text(value["detail"], f"{path}.detail", SUBLABEL_MAX)
        return Node(label=label, detail=detail)

    def _sequence(self, key: str, lo: int, hi: int, *, default_empty: bool = False) -> list[Any]:
        path = self._p(key)
        if key not in self.raw or self.raw[key] is None:
            if default_empty:
                return []
            self.issues.append(f"{path}: required")
            return []
        value = self.raw[key]
        if not isinstance(value, list):
            self.issues.append(f"{path}: expected a list, got {type(value).__name__}")
            return []
        if len(value) < lo:
            self.issues.append(f"{path}: needs at least {lo} entries, got {len(value)}")
        if len(value) > hi:
            self.issues.append(
                f"{path}: at most {hi} entries allowed, got {len(value)} — "
                f"more than {MAX_ELEMENTS} things on screen is never readable"
            )
        return value[:hi]

    def node_list(self, key: str, *, lo: int, hi: int) -> list[Node]:
        return [
            self._node_value(item, f"{self._p(key)}.{i}")
            for i, item in enumerate(self._sequence(key, lo, hi))
        ]

    def label_list(self, key: str, *, lo: int, hi: int) -> list[str]:
        return [
            self._text(item, f"{self._p(key)}.{i}", LABEL_MAX)
            for i, item in enumerate(self._sequence(key, lo, hi))
        ]

    def sub(self, key: str, *, required: bool = True) -> "Fields":
        """Descend into a nested object, sharing this validator's issue list."""
        value = self.raw.get(key)
        child = Fields(self.archetype, value if isinstance(value, dict) else {}, prefix=self._p(key))
        child.issues = self.issues  # share, so `done()` sees every problem at once
        if not isinstance(value, dict):
            if required:
                self.issues.append(f"{self._p(key)}: expected an object")
        return child

    def raw_list(self, key: str, *, lo: int, hi: int, default_empty: bool = False) -> list[Any]:
        return self._sequence(key, lo, hi, default_empty=default_empty)

    def fail(self, message: str) -> None:
        """Record a cross-field problem the per-field checks cannot express."""
        self.issues.append(message)

    def done(self) -> None:
        if self.issues:
            raise ParamsError(self.archetype, self.issues)


# ----------------------------------------------------------------- event trace


@dataclass
class Event:
    """One thing that happened on screen, for tests and for debugging."""

    kind: str            # "reveal" | "morph" | "emphasize" | "retire" | "hold" | "cue" | "pad"
    run_time: float = 0.0
    anims: int = 0
    label: str = ""
    visible_after: int = 0


# ------------------------------------------------------------------- the mixin


class BaseArchetype:
    """Mixin over ``manim.Scene`` carrying the rules, the budget and the helpers.

    Mixed in first so its ``play``/``wait`` bookkeeping wraps the real Scene::

        Klass = type("Beat_hook", (BaseArchetype, Scene), {...})
    """

    #: Overridden on the dynamically-built scene class by ``render_beat``.
    PALETTE_NAME: str = "cool"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        try:
            super().__init__(*args, **kwargs)
        except TypeError:
            super().__init__()
        self.palette: Palette = get_palette(self.PALETTE_NAME)
        self.archetype: str = getattr(self, "ARCHETYPE", type(self).__name__)
        self._visible: list[Any] = []
        self._elapsed: float = 0.0
        self._hold: float = MIN_HOLD
        self._duration: float | None = None
        self._events_left: int = 0
        self.events: list[Event] = []

    # -- budget --------------------------------------------------------
    def begin(self, duration: float, events: int, hold: float | None = None) -> None:
        """Declare the beat's length and how many timed events will fill it.

        Every reveal then takes its run time from what is left after reserving a
        full hold for each remaining event, so the animation grows to fill the
        beat instead of finishing early and staring at the audience.
        """
        self._duration = float(duration)
        self._events_left = max(1, int(events))
        if hold is not None:
            self.set_hold(hold)

    def set_hold(self, seconds: float) -> None:
        """Rule 2 is a floor. A beat may raise it; nothing may lower it.

        Set from the beat's ``holdAfterSeconds`` before ``build`` runs, and left
        alone by the archetype's own ``begin()``.
        """
        self._hold = max(MIN_HOLD, float(seconds or 0.0))

    @property
    def elapsed(self) -> float:
        """Seconds of animation played so far."""
        return self._elapsed

    @property
    def visible(self) -> tuple[Any, ...]:
        """The element slots currently occupied."""
        return tuple(self._visible)

    def _budget_run_time(self) -> float:
        if self._duration is None:
            return 0.8
        remaining = max(1, self._events_left)
        free = self._duration - self._elapsed - remaining * self._hold
        return _clamp(free / remaining, MIN_RUN_TIME, MAX_RUN_TIME)

    def _spend(self, run_time: float | None) -> float:
        rt = self._budget_run_time() if run_time is None else max(MIN_RUN_TIME, float(run_time))
        self._events_left = max(0, self._events_left - 1)
        return rt

    # -- primitive plumbing -------------------------------------------
    def _play(self, *animations: Any, run_time: float, rate_func: Callable[[float], float] = EASE_IN) -> None:
        self.play(*animations, run_time=run_time, rate_func=rate_func)
        self._elapsed += run_time

    def _hold_for(self, seconds: float) -> None:
        self.wait(seconds)
        self._elapsed += seconds
        self.events.append(Event(kind="hold", run_time=seconds, visible_after=len(self._visible)))

    # -- rule 1 + 2 + 3 ------------------------------------------------
    def reveal(
        self,
        mobject: Any,
        *,
        animation: Any | None = None,
        run_time: float | None = None,
        hold: float | None = None,
        into: Any | None = None,
        label: str = "",
    ) -> Any:
        """Bring exactly one new element on screen, then hold.

        ``into`` attaches the mobject to an already-visible element slot instead
        of claiming a new one — for parts that belong to a thing already on
        screen (a bar in a chart, an edge between two nodes). It still plays one
        animation and still holds; it just does not spend an element budget.
        """
        self._assert_single_element(mobject)
        self.assert_in_frame(mobject)

        if into is None:
            if len(self._visible) + 1 > MAX_ELEMENTS:
                raise LayoutError(
                    f"{self.archetype}: revealing {label or _describe(mobject)!r} would put "
                    f"{len(self._visible) + 1} elements on screen but the limit is "
                    f"{MAX_ELEMENTS}. Retire something first with scene.retire(...)."
                )
        elif into not in self._visible:
            raise LayoutError(
                f"{self.archetype}: reveal(into=...) was given an element that is not on "
                f"screen. Reveal the container before attaching parts to it."
            )

        rt = self._spend(run_time)
        anim = animation if animation is not None else FadeIn(mobject, shift=UP * 0.18)
        self._play(anim, run_time=rt, rate_func=EASE_IN)

        if into is None:
            self._visible.append(mobject)
        self.events.append(
            Event("reveal", run_time=rt, anims=1, label=label or _describe(mobject),
                  visible_after=len(self._visible))
        )
        self._hold_for(max(self._hold, float(hold) if hold else 0.0))
        return mobject

    def morph(
        self,
        source: Any,
        target: Any,
        *,
        run_time: float | None = None,
        hold: float | None = None,
        label: str = "",
    ) -> Any:
        """Turn one element into another in place. The slot count does not change."""
        self.assert_in_frame(target)
        rt = self._spend(run_time)
        self._play(ReplacementTransform(source, target), run_time=rt, rate_func=EASE_IN)
        if source in self._visible:
            self._visible[self._visible.index(source)] = target
        else:
            if len(self._visible) + 1 > MAX_ELEMENTS:
                raise LayoutError(
                    f"{self.archetype}: morph target would exceed {MAX_ELEMENTS} elements."
                )
            self._visible.append(target)
        self.events.append(
            Event("morph", run_time=rt, anims=1, label=label or _describe(target),
                  visible_after=len(self._visible))
        )
        self._hold_for(max(self._hold, float(hold) if hold else 0.0))
        return target

    def emphasize(
        self,
        mobject: Any,
        *,
        circumscribe: bool = False,
        run_time: float | None = None,
        hold: float | None = None,
        label: str = "",
    ) -> Any:
        """Point at something already on screen. Adds no element, still holds."""
        rt = self._spend(run_time)
        anim = (
            Circumscribe(mobject, color=self.palette.accent, buff=GAP_TIGHT)
            if circumscribe
            else Indicate(mobject, color=self.palette.accent, scale_factor=1.08)
        )
        self._play(anim, run_time=rt, rate_func=EASE_IN)
        self.events.append(
            Event("emphasize", run_time=rt, anims=1, label=label or _describe(mobject),
                  visible_after=len(self._visible))
        )
        self._hold_for(max(self._hold, float(hold) if hold else 0.0))
        return mobject

    def retire(self, *mobjects: Any, run_time: float = 0.45) -> None:
        """Rule 3. Fade out everything that has said its piece.

        One ``play`` call for the whole batch: things leaving together should
        leave together, and an exit is not a reveal so it does not hold.
        """
        going = [m for m in mobjects if m is not None]
        if not going:
            return
        self._play(*[FadeOut(m) for m in going], run_time=run_time, rate_func=EASE_OUT)
        for m in going:
            if m in self._visible:
                self._visible.remove(m)
        self.events.append(
            Event("retire", run_time=run_time, anims=len(going),
                  label=", ".join(_describe(m) for m in going),
                  visible_after=len(self._visible))
        )

    def retire_all(self, *, keep: Iterable[Any] = ()) -> None:
        keep_set = list(keep)
        self.retire(*[m for m in list(self._visible) if m not in keep_set])

    def pad_to(self, duration: float) -> None:
        """Sit on the final frame until the beat's audio is done.

        Called as the last line of every ``build``. Without it a short animation
        cuts to the next beat while the narrator is still talking.
        """
        remaining = float(duration) - self._elapsed
        if remaining > 0.02:
            self.wait(remaining)
            self._elapsed += remaining
            self.events.append(Event("pad", run_time=remaining, visible_after=len(self._visible)))

    # -- cue sync ------------------------------------------------------
    def cue_wait(
        self,
        beat_timeline: Any,
        phrase: str | None,
        fallback_at: float | None = None,
    ) -> float:
        """Stall until the narrator reaches ``phrase``, then return.

        ``beat_timeline`` is a ``BeatTimeline`` dict (or object) from
        packages/spec/src/timeline.ts. With no timeline — drafts, tests, the
        first pass before TTS exists — falls back to ``fallback_at``, which
        callers compute as an even distribution across the beat.
        """
        target = _cue_seconds(beat_timeline, phrase)
        if target is None:
            target = fallback_at
        if target is None:
            return 0.0
        delta = float(target) - self._elapsed
        if delta <= 0.02:
            return 0.0
        # Never overrun the beat waiting for a cue that the audio drifted past.
        if self._duration is not None:
            headroom = self._duration - self._elapsed - self._events_left * (self._hold + MIN_RUN_TIME)
            delta = min(delta, max(0.0, headroom))
            if delta <= 0.02:
                return 0.0
        self.wait(delta)
        self._elapsed += delta
        self.events.append(Event("cue", run_time=delta, label=phrase or "",
                                 visible_after=len(self._visible)))
        return delta

    # -- frame safety --------------------------------------------------
    def assert_in_frame(self, mobject: Any) -> None:
        """Raise unless the mobject sits inside the frame minus the margin."""
        half_w = FRAME_WIDTH / 2 - MARGIN
        half_h = FRAME_HEIGHT / 2 - MARGIN
        left, right = mobject.get_left()[0], mobject.get_right()[0]
        bottom, top = mobject.get_bottom()[1], mobject.get_top()[1]
        tol = 1e-3
        overflow = []
        if left < -half_w - tol:
            overflow.append(f"left by {(-half_w - left):.2f}")
        if right > half_w + tol:
            overflow.append(f"right by {(right - half_w):.2f}")
        if bottom < -half_h - tol:
            overflow.append(f"bottom by {(-half_h - bottom):.2f}")
        if top > half_h + tol:
            overflow.append(f"top by {(top - half_h):.2f}")
        if overflow:
            raise LayoutError(
                f"{self.archetype}: {_describe(mobject)!r} escapes the safe frame "
                f"({', '.join(overflow)} units). Safe area is "
                f"{SAFE_WIDTH:.2f} x {SAFE_HEIGHT:.2f} scene units."
            )

    def _assert_single_element(self, mobject: Any) -> None:
        if mobject is None:
            raise LayoutError(f"{self.archetype}: reveal() was given None.")
        subs = getattr(mobject, "submobjects", None)
        if subs and len(subs) > 1 and not getattr(mobject, "_explainer_unit", False):
            raise LayoutError(
                f"{self.archetype}: reveal() was handed a group of {len(subs)} top-level "
                f"elements. Rule 1 is one new element at a time — reveal them in "
                f"separate calls, or compose them into a single element with scene.unit(...)."
            )

    # -- construction helpers -----------------------------------------
    def unit(self, *mobjects: Any) -> Any:
        """Compose several mobjects into ONE element for the purposes of rule 1.

        Legitimate uses: a box and its label; a step and the arrow that leads
        into it; two lockstep lanes revealed as a single row. Not a loophole for
        dumping four unrelated boxes on screen at once.
        """
        group = VGroup(*[m for m in mobjects if m is not None])
        group._explainer_unit = True
        return group

    def card(
        self,
        node: Node | str,
        *,
        color: str | None = None,
        max_width: float | None = None,
        font_size: float = FONT_BODY,
        fill: bool = True,
        min_width: float = 0.0,
    ) -> Any:
        """The workhorse: a tinted, rounded box with a label and optional detail."""
        if isinstance(node, str):
            node = Node(label=node)
        ink = color or self.palette.primary
        cap = max_width if max_width is not None else SAFE_WIDTH / 2

        label = Text(node.label, font_size=font_size, color=self.palette.accent)
        parts = [label]
        if node.detail:
            detail = Text(node.detail, font_size=font_size * 0.72, color=self.palette.muted)
            detail.next_to(label, DOWN, buff=GAP_TIGHT * 0.6)
            parts.append(detail)
        text = VGroup(*parts)
        self.fit(text, max_width=cap - 2 * CARD_PAD_X)

        box = RoundedRectangle(
            corner_radius=CORNER_RADIUS,
            width=max(min_width, text.width + 2 * CARD_PAD_X),
            height=text.height + 2 * CARD_PAD_Y,
            color=ink,
            stroke_width=STROKE,
            fill_color=ink,
            fill_opacity=FILL_OPACITY if fill else 0.0,
        )
        box.move_to(text.get_center())
        return self.unit(box, text)

    def arrow(
        self,
        *,
        direction: Any = RIGHT,
        length: float = 0.9,
        color: str | None = None,
        label: str | None = None,
    ) -> Any:
        """A connector, optionally captioned. Returned pre-centred on the origin."""
        ink = color or self.palette.secondary
        half = direction * (length / 2)
        shaft = Arrow(
            ORIGIN - half, ORIGIN + half,
            color=ink, stroke_width=STROKE, buff=0,
            max_tip_length_to_length_ratio=0.32,
        )
        if not label:
            return shaft
        cap = Text(label, font_size=FONT_BODY * 0.72, color=self.palette.muted)
        self.fit(cap, max_width=max(length * 1.6, 1.4))
        cap.next_to(shaft, UP, buff=GAP_TIGHT * 0.5)
        return self.unit(shaft, cap)

    def connect(self, source: Any, target: Any, *, color: str | None = None,
                label: str | None = None, buff: float = 0.14) -> Any:
        """An arrow from the edge of one placed mobject to the edge of another."""
        ink = color or self.palette.secondary
        shaft = Arrow(
            source.get_center(), target.get_center(),
            color=ink, stroke_width=STROKE_THIN, buff=buff,
            max_tip_length_to_length_ratio=0.28,
        )
        if not label:
            return shaft
        cap = Text(label, font_size=FONT_BODY * 0.68, color=self.palette.muted)
        self.fit(cap, max_width=max(1.2, shaft.width * 0.9))
        cap.next_to(shaft, UP, buff=GAP_TIGHT * 0.4)
        return self.unit(shaft, cap)

    @staticmethod
    def wrap_label(text: str, max_chars: int = 14, max_lines: int = 2) -> str:
        """Greedy word wrap so long labels get taller instead of wider.

        Width is the scarce axis in every one of these layouts; height is not.
        """
        words = text.split()
        if not words:
            return text
        lines: list[str] = [words[0]]
        for word in words[1:]:
            if len(lines) < max_lines and len(lines[-1]) + 1 + len(word) > max_chars:
                lines.append(word)
            else:
                lines[-1] = f"{lines[-1]} {word}"
        return "\n".join(lines)

    def title(self, text: str, *, color: str | None = None) -> Any:
        """A single line of display type, already fitted to the safe width."""
        mob = Text(text, font_size=theme.FONT_TITLE, color=color or self.palette.accent)
        self.fit(mob, max_width=SAFE_WIDTH)
        return mob

    def caption(self, text: str, *, color: str | None = None) -> Any:
        mob = Text(text, font_size=FONT_BODY, color=color or self.palette.muted)
        self.fit(mob, max_width=SAFE_WIDTH)
        return mob

    def stage(
        self,
        composition: Any,
        *,
        width_frac: float = 0.86,
        height_frac: float = 0.78,
        max_scale: float = 1.5,
    ) -> Any:
        """Scale a finished composition to fill the frame, then centre it.

        Called once, after everything is placed and before anything is revealed.
        Scaling the whole shot uniformly is the only resizing that preserves the
        design; per-element fudging is how layouts end up looking assembled.
        Capped at ``max_scale`` so a two-word beat does not become a billboard.
        """
        target_w = SAFE_WIDTH * width_frac
        target_h = SAFE_HEIGHT * height_frac
        factor = min(target_w / composition.width, target_h / composition.height)
        factor = min(factor, max_scale)
        if abs(factor - 1.0) > 1e-3:
            composition.scale(factor)
        composition.move_to(ORIGIN)
        return composition

    @staticmethod
    def fit(mobject: Any, *, max_width: float = SAFE_WIDTH, max_height: float = SAFE_HEIGHT) -> Any:
        """Scale down (never up) until the mobject fits the given box."""
        factor = 1.0
        if mobject.width > max_width > 0:
            factor = min(factor, max_width / mobject.width)
        if mobject.height > max_height > 0:
            factor = min(factor, max_height / mobject.height)
        if factor < 1.0:
            mobject.scale(factor)
        return mobject

    # -- subclass contract --------------------------------------------
    def build(self, params: Any, duration: float, timeline: Any = None) -> None:
        """Play this beat. Implemented by the generated scene class."""
        raise NotImplementedError(
            f"{type(self).__name__} must implement build(params, duration, timeline)"
        )

    # manim calls this
    def construct(self) -> None:  # pragma: no cover - needs a real render
        self.build(self.PARAMS, self.DURATION, self.TIMELINE)  # type: ignore[attr-defined]


# ------------------------------------------------------------------ null scene


class NullScene(BaseArchetype):
    """A ``Scene`` that draws nothing and remembers everything.

    Lets the whole package be exercised — layout maths, element budget, hold
    enforcement, timing — on a machine with no manim, no ffmpeg and no GPU.
    """

    def __init__(self, palette: str = "cool", archetype: str = "test") -> None:
        self.PALETTE_NAME = palette
        super().__init__()
        self.archetype = archetype
        self.calls: list[tuple[str, float, int]] = []
        self.mobjects: list[Any] = []

    def play(self, *animations: Any, run_time: float = 1.0, **_kwargs: Any) -> None:
        self.calls.append(("play", float(run_time), len(animations)))

    def wait(self, duration: float = 1.0, **_kwargs: Any) -> None:
        self.calls.append(("wait", float(duration), 0))

    def add(self, *mobjects: Any) -> None:
        self.mobjects.extend(mobjects)

    def remove(self, *mobjects: Any) -> None:
        for m in mobjects:
            if m in self.mobjects:
                self.mobjects.remove(m)

    # -- assertions the tests lean on ---------------------------------
    @property
    def total_time(self) -> float:
        """Wall-clock seconds this beat would occupy."""
        return sum(t for _, t, _ in self.calls)

    @property
    def max_visible(self) -> int:
        return max((e.visible_after for e in self.events), default=0)


# ---------------------------------------------------------------------- helpers


def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def _describe(mobject: Any) -> str:
    text = getattr(mobject, "text", None)
    if isinstance(text, str):
        return text
    for sub in getattr(mobject, "submobjects", []) or []:
        found = _describe(sub)
        if found and not found.startswith("<"):
            return found
    return f"<{type(mobject).__name__}>"


def _cue_seconds(beat_timeline: Any, phrase: str | None) -> float | None:
    """Pull ``cues[phrase].atSeconds`` out of a BeatTimeline dict or object."""
    if beat_timeline is None or not phrase:
        return None
    cues = beat_timeline.get("cues") if isinstance(beat_timeline, dict) else getattr(beat_timeline, "cues", None)
    if not cues:
        return None
    wanted = phrase.strip().lower()
    for cue in cues:
        text = cue.get("phrase") if isinstance(cue, dict) else getattr(cue, "phrase", "")
        if (text or "").strip().lower() == wanted:
            at = cue.get("atSeconds") if isinstance(cue, dict) else getattr(cue, "atSeconds", None)
            return float(at) if at is not None else None
    return None


def nth_phrase(beat_timeline: Any, index: int) -> str | None:
    """The emphasis phrase the n-th reveal of a beat should land on.

    Cues arrive in narration order, so reveal *i* syncs to cue *i*. When the
    beat has fewer cues than reveals the extra reveals fall back to the even
    distribution in ``cue_wait``.
    """
    if beat_timeline is None or index < 0:
        return None
    cues = (
        beat_timeline.get("cues")
        if isinstance(beat_timeline, dict)
        else getattr(beat_timeline, "cues", None)
    )
    if not cues or index >= len(cues):
        return None
    cue = cues[index]
    phrase = cue.get("phrase") if isinstance(cue, dict) else getattr(cue, "phrase", None)
    return phrase or None
