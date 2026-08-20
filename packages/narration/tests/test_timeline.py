"""Timeline layout and cue resolution. No audio, no models — fake words only."""

import pytest

from narration.align import ESTIMATED
from narration.timeline import TimelineError, build_timeline, find_phrase


def words(*spans):
    """(word, start, end) triples -> the word dicts alignment would have produced."""
    return [{"word": w, "start": s, "end": e, "score": 0.9} for w, s, e in spans]


BEAT_A_WORDS = words(
    ("The", 0.0, 0.20),
    ("state", 0.20, 0.60),
    ("machine", 0.60, 1.10),
    ("never", 1.10, 1.50),
    ("forgets.", 1.50, 2.00),
)
BEAT_B_WORDS = words(
    ("Every", 0.0, 0.40),
    ("write", 0.40, 0.80),
    ("is", 0.80, 0.95),
    ("append", 0.95, 1.40),
    ("only.", 1.40, 1.80),
)
BEAT_C_WORDS = words(
    ("So", 0.0, 0.25),
    ("replay", 0.25, 0.90),
    ("is", 0.90, 1.05),
    ("free.", 1.05, 1.60),
)


def make_spec():
    return {
        "topic": "event sourcing",
        "beats": [
            {
                "id": "hook",
                "narration": "The state machine never forgets.",
                "durationSeconds": 2.0,
                "emphasis": ["state machine", "forgets"],
                "holdAfterSeconds": 1.0,
            },
            {
                "id": "build",
                "narration": "Every write is append only.",
                "durationSeconds": 1.8,
                "emphasis": ["append only"],
                "holdAfterSeconds": 1.5,
            },
            {
                "id": "payoff",
                "narration": "So replay is free.",
                "durationSeconds": 1.6,
                "emphasis": ["replay"],
                "holdAfterSeconds": 2.0,
            },
        ],
    }


def build(tmp_path, spec=None, **kwargs):
    spec = spec or make_spec()
    return build_timeline(
        spec,
        tmp_path / "audio",
        kwargs.pop("engine_name", "kokoro"),
        kwargs.pop("fps", 30),
        kwargs.pop(
            "words_by_beat",
            {"hook": BEAT_A_WORDS, "build": BEAT_B_WORDS, "payoff": BEAT_C_WORDS},
        ),
        spec_hash=kwargs.pop("spec_hash", "deadbeefcafe0001"),
        render_root=tmp_path,
        **kwargs,
    )


def test_beat_offsets_accumulate_audio_plus_hold(tmp_path):
    beats = build(tmp_path)["timeline"]["beats"]

    # audioSeconds falls out of the last word's end time.
    assert [b["audioSeconds"] for b in beats] == [2.0, 1.8, 1.6]
    assert [b["holdSeconds"] for b in beats] == [1.0, 1.5, 2.0]
    # 0, then 2.0 + 1.0, then 3.0 + 1.8 + 1.5
    assert [b["startSeconds"] for b in beats] == [0.0, 3.0, 6.3]


def test_total_seconds_is_the_sum_of_audio_and_holds(tmp_path):
    timeline = build(tmp_path)["timeline"]
    assert timeline["totalSeconds"] == pytest.approx(2.0 + 1.0 + 1.8 + 1.5 + 1.6 + 2.0)
    last = timeline["beats"][-1]
    assert last["startSeconds"] + last["audioSeconds"] + last["holdSeconds"] == pytest.approx(
        timeline["totalSeconds"]
    )


def test_cues_are_beat_relative_and_multi_word_phrases_match(tmp_path):
    beats = {b["beatId"]: b for b in build(tmp_path)["timeline"]["beats"]}

    hook = {c["phrase"]: c["atSeconds"] for c in beats["hook"]["cues"]}
    assert hook == {"state machine": 0.20, "forgets": 1.50}

    # 'append only' starts at the FIRST word of the run, and is relative to this
    # beat's own start (3.0s into the track), not to the track.
    assert beats["build"]["cues"] == [{"phrase": "append only", "atSeconds": 0.95}]
    assert beats["build"]["startSeconds"] == 3.0


def test_missing_phrase_warns_and_is_omitted_not_crashed(tmp_path):
    spec = make_spec()
    spec["beats"][0]["emphasis"] = ["state machine", "never happened"]

    built = build(tmp_path, spec)

    cues = built["timeline"]["beats"][0]["cues"]
    assert [c["phrase"] for c in cues] == ["state machine"]
    assert built["report"]["cuesMissing"] == 1
    assert any("never happened" in w for w in built["report"]["warnings"])


def test_phrase_matching_is_case_and_punctuation_insensitive(tmp_path):
    spec = make_spec()
    spec["beats"][0]["emphasis"] = ["Never Forgets"]
    cues = build(tmp_path, spec)["timeline"]["beats"][0]["cues"]
    assert cues == [{"phrase": "Never Forgets", "atSeconds": 1.10}]


def test_non_contiguous_words_do_not_match():
    # "write only" appears as two words in the beat but not next to each other.
    assert find_phrase(BEAT_B_WORDS, "write only") is None
    assert find_phrase(BEAT_B_WORDS, "is append only") == pytest.approx(0.80)


def test_audio_paths_are_render_root_relative_posix(tmp_path):
    beats = build(tmp_path)["timeline"]["beats"]
    assert [b["audioPath"] for b in beats] == [
        "audio/hook.wav",
        "audio/build.wav",
        "audio/payoff.wav",
    ]
    assert build(tmp_path)["timeline"]["audioPath"] == "narration.wav"


def test_measured_durations_override_word_ends(tmp_path):
    built = build(tmp_path, audio_seconds_by_beat={"hook": 2.4, "build": 1.8, "payoff": 1.6})
    beats = built["timeline"]["beats"]
    assert beats[0]["audioSeconds"] == 2.4
    assert beats[1]["startSeconds"] == pytest.approx(3.4)


def test_duration_drift_is_reported_not_fatal(tmp_path):
    built = build(tmp_path, audio_seconds_by_beat={"hook": 4.0, "build": 1.8, "payoff": 1.6})
    assert any("drift" in w for w in built["report"]["warnings"])
    assert built["timeline"]["beats"][0]["audioSeconds"] == 4.0


def test_alignment_path_is_recorded(tmp_path):
    assert build(tmp_path)["timeline"]["alignment"] == "whisperx"
    assert build(tmp_path, alignment=ESTIMATED)["timeline"]["alignment"] == ESTIMATED


def test_beat_with_no_words_falls_back_to_spec_duration(tmp_path):
    built = build(tmp_path, words_by_beat={"hook": BEAT_A_WORDS, "build": BEAT_B_WORDS})
    payoff = built["timeline"]["beats"][2]
    assert payoff["audioSeconds"] == 1.6
    assert payoff["words"] == []
    assert any("replay" in w for w in built["report"]["warnings"])


def test_unknown_engine_is_rejected(tmp_path):
    with pytest.raises(TimelineError, match="not in the Timeline contract"):
        build(tmp_path, engine_name="elevenlabs")


def test_missing_spec_hash_is_rejected(tmp_path):
    with pytest.raises(TimelineError, match="spec_hash is required"):
        build(tmp_path, spec_hash="")


def test_validation_catches_a_broken_timeline(tmp_path):
    from narration.timeline import validate_timeline

    timeline = build(tmp_path)["timeline"]
    timeline["beats"][1]["startSeconds"] = 99.0
    with pytest.raises(TimelineError, match="end to end"):
        validate_timeline(timeline)
