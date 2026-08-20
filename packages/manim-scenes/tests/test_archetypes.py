"""Every archetype, exercised headlessly against the spec's own examples.

No manim, no ffmpeg, no frames. ``NullScene`` records what would have been
played, which is enough to prove the three rules hold and the timing budget
lands — the two things that actually make or break these videos.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from manim_scenes import theme
from manim_scenes.base import MIN_HOLD, LayoutError, NullScene, ParamsError
from manim_scenes.registry import ARCHETYPE_NAMES, ARCHETYPES, UnknownArchetype, build_beat

SPEC_TS = (
    Path(__file__).resolve().parents[3] / "packages" / "spec" / "src" / "archetypes.ts"
)

#: Copied verbatim from ARCHETYPE_EXAMPLES in packages/spec/src/archetypes.ts.
#: ``test_examples_have_not_drifted_from_the_typescript`` fails if they diverge.
ARCHETYPE_EXAMPLES: dict[str, dict] = {
    "sequence": {
        "steps": [
            {"label": "Send packet"},
            {"label": "Wait for ACK"},
            {"label": "Timeout"},
            {"label": "Resend"},
        ],
        "arrowLabel": "then",
    },
    "branch": {
        "question": {"label": "Slot occupied?"},
        "outcomes": [{"label": "Store here"}, {"label": "Probe next slot"}],
    },
    "containment": {
        "outer": {"label": "Process"},
        "inner": [{"label": "Thread A"}, {"label": "Thread B"}],
        "innermost": {"label": "Stack"},
    },
    "transformation": {
        "before": {"label": "apple"},
        "after": {"label": "index 4"},
        "via": "hash function",
    },
    "fan_out": {
        "source": {"label": "Origin server"},
        "targets": [
            {"label": "Edge: Tokyo"},
            {"label": "Edge: Paris"},
            {"label": "Edge: Iowa"},
        ],
        "highlightIndex": 1,
    },
    "layered_build": {
        "layers": [
            {"label": "Tokens"},
            {"label": "Parse tree"},
            {"label": "IR"},
            {"label": "Machine code"},
        ],
        "stackLabel": "compiler",
    },
    "zoom_detail": {
        "overview": {"label": "Hash map"},
        "focus": {"label": "Bucket 4"},
        "revealed": [{"label": "apple -> 3"}, {"label": "grape -> 7"}],
    },
    "parallel_race": {
        "laneA": {"label": "Thread A", "steps": ["read x = 0", "write x = 1"]},
        "laneB": {"label": "Thread B", "steps": ["read x = 0", "write x = 1"]},
        "verdict": "one increment is lost",
    },
    "accumulation": {
        "subject": {"label": "Balance"},
        "stages": [
            {"label": "Year 1", "magnitude": 0.1},
            {"label": "Year 10", "magnitude": 0.3},
            {"label": "Year 20", "magnitude": 0.62},
            {"label": "Year 30", "magnitude": 1},
        ],
    },
    "cycle": {
        "steps": [{"label": "Send"}, {"label": "Lost"}, {"label": "Timeout"}],
        "returnLabel": "retry",
    },
    "spatial_map": {
        "nodes": [
            {"label": "User", "x": 0.1, "y": 0.5},
            {"label": "Edge", "x": 0.45, "y": 0.5},
            {"label": "Origin", "x": 0.9, "y": 0.5},
        ],
        "edges": [
            {"from": 0, "to": 1, "label": "10ms"},
            {"from": 1, "to": 2, "label": "180ms"},
        ],
    },
    "reveal_conceal": {
        "cover": {"label": "Abstraction"},
        "hidden": [{"label": "Buffer"}, {"label": "Pointer"}],
        "reverse": False,
    },
}

DURATION = 10.0
TIMED_KINDS = {"reveal", "morph", "emphasize"}


def play(name: str, duration: float = DURATION, timeline=None, hold: float | None = None):
    module = ARCHETYPES[name]
    scene = NullScene(palette="cool", archetype=name)
    if hold is not None:
        scene.set_hold(hold)
    params = module.parse_params(ARCHETYPE_EXAMPLES[name])
    module.build(scene, params, duration, timeline)
    return scene


# --------------------------------------------------------------- the contract


def test_registry_matches_the_typescript_archetype_list():
    source = SPEC_TS.read_text(encoding="utf-8")
    block = re.search(r"ARCHETYPE_NAMES\s*=\s*\[(.*?)\]", source, re.S)
    assert block, "could not find ARCHETYPE_NAMES in archetypes.ts"
    names = tuple(re.findall(r"'([a-z_]+)'", block.group(1)))
    assert names == ARCHETYPE_NAMES


def test_max_elements_matches_the_typescript_contract():
    source = SPEC_TS.read_text(encoding="utf-8")
    found = re.search(r"MAX_ELEMENTS\s*=\s*(\d+)", source)
    assert found and int(found.group(1)) == theme.MAX_ELEMENTS


def test_examples_cover_every_archetype():
    assert set(ARCHETYPE_EXAMPLES) == set(ARCHETYPE_NAMES)


def test_examples_have_not_drifted_from_the_typescript():
    source = SPEC_TS.read_text(encoding="utf-8")
    for name, example in ARCHETYPE_EXAMPLES.items():
        for text in _strings(example):
            assert text in source, (
                f"{name}: example string {text!r} is no longer in archetypes.ts — "
                f"re-copy ARCHETYPE_EXAMPLES into this test"
            )


def test_every_archetype_module_exports_the_three_names():
    for name, module in ARCHETYPES.items():
        assert callable(module.parse_params), name
        assert callable(module.build), name
        assert hasattr(module, "Params"), name


# ------------------------------------------------------------------- rule one


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_example_params_parse(name):
    params = ARCHETYPES[name].parse_params(ARCHETYPE_EXAMPLES[name])
    assert params is not None


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_one_new_element_at_a_time(name):
    scene = play(name)
    reveals = [e for e in scene.events if e.kind in TIMED_KINDS]
    assert reveals, f"{name} played nothing"
    for event in reveals:
        assert event.anims == 1, (
            f"{name}: {event.kind} of {event.label!r} played {event.anims} animations; "
            f"rule 1 is one new element at a time"
        )


# ------------------------------------------------------------------- rule two


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_every_reveal_is_followed_by_a_hold(name):
    scene = play(name)
    events = scene.events
    for i, event in enumerate(events):
        if event.kind not in TIMED_KINDS:
            continue
        assert i + 1 < len(events), f"{name}: {event.label!r} is the last thing that happens"
        following = events[i + 1]
        assert following.kind == "hold", (
            f"{name}: {event.label!r} is followed by {following.kind}, not a hold"
        )
        assert following.run_time >= MIN_HOLD - 1e-9, (
            f"{name}: hold after {event.label!r} is {following.run_time:.2f}s, "
            f"below the {MIN_HOLD}s floor"
        )


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_a_beat_may_raise_the_hold_but_not_lower_it(name):
    longer = play(name, duration=12.0, hold=2.4)
    for event in longer.events:
        if event.kind == "hold":
            assert event.run_time >= 2.4 - 1e-9

    shorter = play(name, duration=12.0, hold=0.8)
    for event in shorter.events:
        if event.kind == "hold":
            assert event.run_time >= MIN_HOLD - 1e-9


# ----------------------------------------------------------------- rule three


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_never_more_than_max_elements_on_screen(name):
    scene = play(name)
    assert scene.max_visible <= theme.MAX_ELEMENTS, (
        f"{name} put {scene.max_visible} elements on screen"
    )


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_everything_stays_inside_the_safe_frame(name):
    # reveal() calls assert_in_frame on every element, so simply completing the
    # build is the assertion. This test documents that.
    play(name)


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_nothing_is_drawn_behind_the_caption_plate(name):
    # Remotion lays word-level captions across the bottom of the frame. Anything
    # Manim puts down there is invisible in the finished video.
    band_top = -theme.FRAME_HEIGHT / 2 + theme.BOTTOM_MARGIN
    ceiling = theme.FRAME_HEIGHT / 2 - theme.MARGIN
    scene = play(name)
    for element in scene.visible:
        assert element.get_bottom()[1] >= band_top - 1e-6, (
            f"{name}: an element reaches y={element.get_bottom()[1]:.2f}, "
            f"below the caption band at y={band_top:.2f}"
        )
        assert element.get_top()[1] <= ceiling + 1e-6


# --------------------------------------------------------------- timing budget


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_total_played_time_fills_the_beat(name):
    scene = play(name)
    assert scene.required_seconds <= DURATION, f"{name} cannot fit a {DURATION}s beat"
    assert scene.total_time == pytest.approx(DURATION, rel=0.10), (
        f"{name} played {scene.total_time:.2f}s of a {DURATION}s beat"
    )


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_timing_holds_across_the_legal_duration_range(name):
    for duration in (8.0, 12.0):
        scene = play(name, duration=duration)
        # A beat shorter than required_seconds cannot be honoured without
        # cutting a hold, and holds are not negotiable — it overruns instead.
        expected = max(duration, scene.required_seconds)
        assert scene.total_time == pytest.approx(expected, rel=0.10), (
            f"{name} played {scene.total_time:.2f}s of a {duration}s beat "
            f"(floor {scene.required_seconds:.2f}s)"
        )


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_a_beat_too_short_for_its_archetype_overruns_rather_than_clipping_a_hold(name):
    scene = play(name, duration=2.0)
    assert scene.total_time >= scene.required_seconds - 1e-6
    for event in scene.events:
        if event.kind == "hold":
            assert event.run_time >= MIN_HOLD - 1e-9


@pytest.mark.parametrize("name", ARCHETYPE_NAMES)
def test_run_times_stay_watchable(name):
    from manim_scenes.base import MAX_RUN_TIME, MIN_RUN_TIME

    for event in play(name).events:
        if event.kind in TIMED_KINDS:
            assert MIN_RUN_TIME - 1e-9 <= event.run_time <= MAX_RUN_TIME + 1e-9


# ------------------------------------------------------------------- cue sync


def test_reveals_wait_for_their_narration_cue():
    timeline = {
        "beatId": "hook",
        "startSeconds": 0,
        "audioSeconds": 10,
        "holdSeconds": 1.5,
        "audioPath": "hook.wav",
        "words": [],
        "cues": [
            {"phrase": "apple", "atSeconds": 0.0},
            {"phrase": "hash function", "atSeconds": 3.6},
        ],
    }
    scene = play("transformation", timeline=timeline)
    assert any(e.kind == "cue" and e.label == "hash function" for e in scene.events)
    # The arrow must not appear before the narrator names it.
    elapsed = 0.0
    for event in scene.events:
        if event.kind == "reveal" and event.label == "hash function":
            assert elapsed >= 3.6 - 1e-6
            break
        elapsed += event.run_time
    else:
        pytest.fail("the via-arrow was never revealed")


def test_a_missing_timeline_falls_back_to_even_distribution():
    with_cues = play("sequence", timeline=None)
    assert with_cues.total_time == pytest.approx(DURATION, rel=0.10)


def test_a_cue_that_drifts_past_the_beat_never_overruns_it():
    timeline = {
        "beatId": "hook",
        "cues": [{"phrase": "late", "atSeconds": 400.0}] * 4,
    }
    scene = play("sequence", timeline=timeline)
    assert scene.total_time <= DURATION * 1.10


# -------------------------------------------------------------------- registry


def test_build_beat_routes_through_the_registry():
    scene = NullScene()
    beat = {
        "id": "hook",
        "narration": "a is secretly b",
        "durationSeconds": 9.0,
        "archetype": "transformation",
        "params": ARCHETYPE_EXAMPLES["transformation"],
        "emphasis": [],
        "emotion": "neutral",
        "holdAfterSeconds": 1.5,
    }
    build_beat(scene, beat, None)
    assert scene.archetype == "transformation"
    assert scene.total_time == pytest.approx(9.0, rel=0.10)


def test_build_beat_prefers_measured_audio_over_the_specs_estimate():
    scene = NullScene()
    beat = {
        "id": "hook",
        "durationSeconds": 4.0,
        "archetype": "transformation",
        "params": ARCHETYPE_EXAMPLES["transformation"],
        "holdAfterSeconds": 1.5,
    }
    build_beat(scene, beat, {"beatId": "hook", "audioSeconds": 11.0, "cues": []})
    assert scene.total_time == pytest.approx(11.0, rel=0.10)


def test_unknown_archetype_lists_the_valid_names():
    with pytest.raises(UnknownArchetype) as exc:
        build_beat(NullScene(), {"archetype": "explosion", "params": {}}, None)
    message = str(exc.value)
    assert "explosion" in message
    for name in ARCHETYPE_NAMES:
        assert name in message


# ------------------------------------------------------------- bad params


def test_missing_required_field_names_the_field():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["transformation"].parse_params({"before": {"label": "apple"}})
    assert "after: required" in str(exc.value)


def test_every_problem_is_reported_not_just_the_first():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["transformation"].parse_params({})
    assert len(exc.value.issues) >= 2
    assert exc.value.archetype == "transformation"


def test_over_long_labels_are_rejected_with_the_limit():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["sequence"].parse_params(
            {"steps": [{"label": "x" * 40}, {"label": "ok"}]}
        )
    message = str(exc.value)
    assert "steps.0.label" in message
    assert "40 characters" in message and "28" in message


def test_too_few_entries_is_rejected():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["branch"].parse_params(
            {"question": {"label": "q"}, "outcomes": [{"label": "only one"}]}
        )
    assert "outcomes: needs at least 2 entries, got 1" in str(exc.value)


def test_too_many_entries_is_rejected():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["sequence"].parse_params(
            {"steps": [{"label": f"s{i}"} for i in range(6)]}
        )
    assert "at most 4 entries" in str(exc.value)


def test_out_of_range_numbers_are_rejected():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["accumulation"].parse_params(
            {
                "subject": {"label": "Balance"},
                "stages": [
                    {"label": "a", "magnitude": 0.2},
                    {"label": "b", "magnitude": 1.4},
                ],
            }
        )
    assert "stages.1.magnitude: 1.4 is outside the allowed range 0.0..1.0" in str(exc.value)


def test_accumulation_rejects_a_shrinking_series():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["accumulation"].parse_params(
            {
                "subject": {"label": "Balance"},
                "stages": [
                    {"label": "a", "magnitude": 0.8},
                    {"label": "b", "magnitude": 0.2},
                ],
            }
        )
    assert "accumulation only grows" in str(exc.value)


def test_fan_out_rejects_a_highlight_index_it_cannot_reach():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["fan_out"].parse_params(
            {
                "source": {"label": "Origin"},
                "targets": [{"label": "a"}, {"label": "b"}],
                "highlightIndex": 3,
            }
        )
    assert "out of range for 2 targets" in str(exc.value)


def test_spatial_map_rejects_a_dangling_edge():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["spatial_map"].parse_params(
            {
                "nodes": [{"label": "a", "x": 0, "y": 0}, {"label": "b", "x": 1, "y": 1}],
                "edges": [{"from": 0, "to": 4}],
            }
        )
    assert "does not exist" in str(exc.value)


def test_spatial_map_rejects_a_self_edge():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["spatial_map"].parse_params(
            {
                "nodes": [{"label": "a", "x": 0, "y": 0}, {"label": "b", "x": 1, "y": 1}],
                "edges": [{"from": 1, "to": 1}],
            }
        )
    assert "same node" in str(exc.value)


def test_nested_lane_problems_are_reported_with_their_path():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["parallel_race"].parse_params(
            {
                "laneA": {"label": "Thread A", "steps": ["only one"]},
                "laneB": {"label": "Thread B", "steps": ["a", "b"]},
            }
        )
    assert "laneA.steps: needs at least 2 entries" in str(exc.value)


def test_wrong_types_are_reported_not_coerced():
    with pytest.raises(ParamsError) as exc:
        ARCHETYPES["reveal_conceal"].parse_params(
            {"cover": {"label": "A"}, "hidden": [{"label": "b"}], "reverse": "yes"}
        )
    assert "reverse: expected true or false, got str" in str(exc.value)


# ----------------------------------------------------- the rules bite directly


def test_exceeding_max_elements_raises_with_the_archetype_and_the_count():
    from manim_scenes._manim import Text

    scene = NullScene(archetype="sequence")
    scene.begin(60.0, events=10)
    for i in range(theme.MAX_ELEMENTS):
        scene.reveal(Text(f"e{i}", font_size=20))
    with pytest.raises(LayoutError) as exc:
        scene.reveal(Text("one too many", font_size=20))
    message = str(exc.value)
    assert "sequence" in message and str(theme.MAX_ELEMENTS + 1) in message


def test_retiring_frees_the_budget_again():
    from manim_scenes._manim import Text

    scene = NullScene()
    scene.begin(60.0, events=10)
    made = [scene.reveal(Text(f"e{i}", font_size=20)) for i in range(theme.MAX_ELEMENTS)]
    scene.retire(made[0], made[1])
    assert len(scene.visible) == theme.MAX_ELEMENTS - 2
    scene.reveal(Text("room again", font_size=20))


def test_revealing_a_bare_group_of_several_elements_is_refused():
    from manim_scenes._manim import Text, VGroup

    scene = NullScene(archetype="branch")
    scene.begin(20.0, events=1)
    group = VGroup(Text("a", font_size=20), Text("b", font_size=20))
    with pytest.raises(LayoutError) as exc:
        scene.reveal(group)
    assert "one new element at a time" in str(exc.value)


def test_a_deliberate_unit_is_allowed_through():
    from manim_scenes._manim import Text

    scene = NullScene()
    scene.begin(20.0, events=1)
    scene.reveal(scene.unit(Text("box", font_size=20), Text("label", font_size=20)))
    assert len(scene.visible) == 1


def test_leaving_the_safe_frame_is_refused():
    from manim_scenes._manim import RIGHT, Text

    scene = NullScene(archetype="sequence")
    scene.begin(20.0, events=1)
    stray = Text("off screen", font_size=20)
    stray.move_to(RIGHT * 40)
    with pytest.raises(LayoutError) as exc:
        scene.reveal(stray)
    assert "escapes the safe frame" in str(exc.value)


def test_attaching_to_an_element_that_is_not_on_screen_is_refused():
    from manim_scenes._manim import Text

    scene = NullScene()
    scene.begin(20.0, events=2)
    orphan = Text("chart", font_size=20)
    with pytest.raises(LayoutError) as exc:
        scene.reveal(Text("bar", font_size=20), into=orphan)
    assert "not on screen" in str(exc.value)


# ------------------------------------------------------------------- helpers


def _strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []
