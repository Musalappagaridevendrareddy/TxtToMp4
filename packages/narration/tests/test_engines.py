"""Engine dispatch, the adapters' injectable seams, and CLI orchestration.

Nothing here imports torch, kokoro or whisperx: every engine is either injected
or expected to fail with an install hint.
"""

import importlib.util
import json
import math
from pathlib import Path

import pytest

from narration.engines import ENGINE_NAMES, TTSError, get_engine
from narration.engines.base import wav_seconds, write_wav_mono16
from narration.engines.indextts2 import EMOTION_SLOTS, IndexTTS2Engine, check_voice_consent
from narration.engines.kokoro import KokoroEngine
from narration import synthesize


# ------------------------------------------------------------------- dispatch


def test_get_engine_rejects_an_unknown_name():
    with pytest.raises(TTSError, match="unknown TTS engine"):
        get_engine("elevenlabs")


def test_get_engine_reads_the_env_var(monkeypatch):
    monkeypatch.setenv("TTS_ENGINE", "elevenlabs")
    with pytest.raises(TTSError, match="elevenlabs"):
        get_engine()


def test_engine_names_match_the_timeline_contract():
    assert ENGINE_NAMES == ("kokoro", "indextts2")


@pytest.mark.skipif(
    importlib.util.find_spec("kokoro") is not None, reason="kokoro is actually installed"
)
def test_missing_kokoro_says_what_to_install(monkeypatch):
    monkeypatch.delenv("TTS_ENGINE", raising=False)
    with pytest.raises(TTSError, match="pip install"):
        get_engine("kokoro")


@pytest.mark.skipif(
    importlib.util.find_spec("indextts") is not None, reason="indextts is actually installed"
)
def test_missing_indextts2_says_what_to_install():
    with pytest.raises(TTSError, match="pip install"):
        get_engine("indextts2")


# --------------------------------------------------------------------- kokoro


class FakePipeline:
    """Yields (graphemes, phonemes, audio) triples like KPipeline does."""

    def __init__(self, seconds=1.0, sample_rate=24_000):
        self.samples = int(seconds * sample_rate)
        self.calls = []

    def __call__(self, text, voice=None):
        self.calls.append((text, voice))
        half = self.samples // 2
        yield (text, "ph", [0.0] * half)
        yield (text, "ph", [0.0] * (self.samples - half))


def test_kokoro_ignores_target_seconds_and_returns_measured_length(tmp_path, monkeypatch):
    monkeypatch.setenv("KOKORO_VOICE", "af_bella")
    pipeline = FakePipeline(seconds=2.5)
    engine = KokoroEngine(pipeline=pipeline)
    out = tmp_path / "hook.wav"

    seconds = engine.synthesize("The state machine.", out, target_seconds=8.0, emotion="curious")

    assert seconds == pytest.approx(2.5, abs=0.01)  # NOT 8.0 — Kokoro cannot hit a target
    assert wav_seconds(out) == pytest.approx(seconds, abs=0.01)
    assert pipeline.calls == [("The state machine.", "af_bella")]


def test_kokoro_rejects_an_unknown_emotion(tmp_path):
    engine = KokoroEngine(pipeline=FakePipeline())
    with pytest.raises(TTSError, match="unknown emotion"):
        engine.synthesize("hello", tmp_path / "a.wav", emotion="furious")


def test_kokoro_rejects_empty_narration(tmp_path):
    engine = KokoroEngine(pipeline=FakePipeline())
    with pytest.raises(TTSError, match="empty narration"):
        engine.synthesize("   ", tmp_path / "a.wav")


# ------------------------------------------------------------------ indextts2


class FakeIndexModel:
    def __init__(self, seconds=3.0):
        self.seconds = seconds
        self.calls = []

    def infer(
        self,
        spk_audio_prompt,
        text,
        output_path,
        emo_vector=None,
        target_duration_seconds=None,
        verbose=False,
    ):
        self.calls.append(
            {
                "spk_audio_prompt": spk_audio_prompt,
                "text": text,
                "emo_vector": emo_vector,
                "target_duration_seconds": target_duration_seconds,
            }
        )
        seconds = target_duration_seconds or self.seconds
        write_wav_mono16(Path(output_path), [0.0] * int(seconds * 24_000), 24_000)


def test_indextts2_wires_target_seconds_to_duration_control(tmp_path):
    model = FakeIndexModel()
    engine = IndexTTS2Engine(model=model)

    seconds = engine.synthesize("Every write is append only.", tmp_path / "b.wav", target_seconds=3.5)

    assert engine.duration_param == "target_duration_seconds"
    assert model.calls[0]["target_duration_seconds"] == pytest.approx(3.5)
    assert seconds == pytest.approx(3.5, abs=0.01)


def test_indextts2_maps_emotions_without_touching_timbre(tmp_path):
    model = FakeIndexModel()
    engine = IndexTTS2Engine(model=model)

    engine.synthesize("hello", tmp_path / "a.wav", target_seconds=1.0, emotion="calm")
    engine.synthesize("hello", tmp_path / "b.wav", target_seconds=1.0, emotion="neutral")

    calm = model.calls[0]["emo_vector"]
    assert calm[EMOTION_SLOTS.index("calm")] == pytest.approx(0.6)
    assert sum(calm) == pytest.approx(0.6)  # nothing else is nudged
    assert model.calls[1]["emo_vector"] is None  # neutral sends no vector at all
    # the speaker prompt (timbre) is identical across emotions
    assert model.calls[0]["spk_audio_prompt"] == model.calls[1]["spk_audio_prompt"]


def test_indextts2_rejects_a_build_with_no_duration_control(tmp_path):
    class NoDurationModel:
        def infer(self, spk_audio_prompt, text, output_path):
            ...

    engine = IndexTTS2Engine(model=NoDurationModel())
    assert engine.duration_param is None
    with pytest.raises(TTSError, match="no duration-control parameter"):
        engine.synthesize("hello", tmp_path / "a.wav", target_seconds=2.0)


def test_voice_cloning_refuses_without_a_consent_file(tmp_path):
    reference = tmp_path / "jane.wav"
    write_wav_mono16(reference, [0.0] * 100, 24_000)

    with pytest.raises(TTSError, match="no consent record"):
        IndexTTS2Engine(model=FakeIndexModel(), reference_audio=reference)


def test_voice_cloning_refuses_an_incomplete_consent_file(tmp_path):
    reference = tmp_path / "jane.wav"
    write_wav_mono16(reference, [0.0] * 100, 24_000)
    (tmp_path / "consent.json").write_text(json.dumps({"speaker": "Jane Doe"}), encoding="utf-8")

    with pytest.raises(TTSError, match="when"):
        check_voice_consent(reference)


def test_voice_cloning_accepts_a_complete_consent_file(tmp_path):
    reference = tmp_path / "jane.wav"
    write_wav_mono16(reference, [0.0] * 100, 24_000)
    (tmp_path / "consent.json").write_text(
        json.dumps({"speaker": "Jane Doe", "consented_at": "2026-08-15"}), encoding="utf-8"
    )

    engine = IndexTTS2Engine(model=FakeIndexModel(), reference_audio=reference)
    assert engine.consent["speaker"] == "Jane Doe"


def test_synthetic_voice_needs_no_consent_file(tmp_path):
    engine = IndexTTS2Engine(model=FakeIndexModel())
    assert engine.consent is None
    engine.synthesize("hello", tmp_path / "a.wav", target_seconds=1.0)


# ------------------------------------------------------------- CLI end to end


SPEC = {
    "topic": "event sourcing",
    "beats": [
        {
            "id": "hook",
            "narration": "The state machine never forgets.",
            "durationSeconds": 3.0,
            "archetype": "reveal",
            "params": {},
            "emphasis": ["state machine"],
            "emotion": "curious",
            "holdAfterSeconds": 1.0,
        },
        {
            "id": "payoff",
            "narration": "So replay is free.",
            "durationSeconds": 2.0,
            "archetype": "reveal",
            "params": {},
            "emphasis": ["replay", "not spoken here"],
            "emotion": "calm",
            "holdAfterSeconds": 1.5,
        },
    ],
}


class FakeEngine:
    """Writes real wav files so the wav plumbing is exercised; hits the target."""

    name = "kokoro"

    def __init__(self):
        self.calls = []

    def synthesize(self, text, out_path, *, target_seconds=None, emotion="neutral"):
        self.calls.append({"text": text, "target": target_seconds, "emotion": emotion})
        seconds = target_seconds or 1.0
        return write_wav_mono16(Path(out_path), [0.0] * int(seconds * 24_000), 24_000)


@pytest.fixture
def spec_file(tmp_path):
    path = tmp_path / "spec.json"
    path.write_text(json.dumps(SPEC), encoding="utf-8")
    return path


@pytest.fixture
def no_ffmpeg(monkeypatch):
    """ffmpeg is not on this machine; record the call instead of running it."""
    calls = []
    monkeypatch.setattr(synthesize, "check_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(
        synthesize,
        "concat_wavs",
        lambda parts, out_path, **kw: (
            calls.append({"parts": list(parts), "out": out_path, **kw}),
            out_path.write_bytes(b"RIFFfake"),
        ),
    )
    return calls


def test_cli_orchestrates_synthesis_alignment_and_concat(tmp_path, spec_file, no_ffmpeg):
    engine = FakeEngine()
    out = tmp_path / "renders" / "abc"

    exit_code = synthesize.main(
        ["--spec", str(spec_file), "--out", str(out), "--engine", "kokoro", "--no-align"],
        engine=engine,
    )

    assert exit_code == 0
    # every beat was synthesized with its own target duration and emotion
    assert [c["target"] for c in engine.calls] == [3.0, 2.0]
    assert [c["emotion"] for c in engine.calls] == ["curious", "calm"]
    assert (out / "audio" / "hook.wav").exists()
    assert (out / "audio" / "payoff.wav").exists()

    # the holds went to ffmpeg as silence, in order
    parts = no_ffmpeg[0]["parts"]
    assert [p[1] for p in parts] == [1.0, 1.5]
    assert [Path(p[0]).name for p in parts] == ["hook.wav", "payoff.wav"]
    assert no_ffmpeg[0]["out"] == out / "narration.wav"

    timeline = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
    assert timeline["engine"] == "kokoro"
    assert timeline["fps"] == 30
    assert timeline["audioPath"] == "narration.wav"
    assert timeline["alignment"] == "estimated"  # --no-align
    assert [b["startSeconds"] for b in timeline["beats"]] == [0.0, 4.0]
    assert timeline["totalSeconds"] == pytest.approx(7.5)
    assert timeline["beats"][0]["cues"][0]["phrase"] == "state machine"
    # the unspoken phrase was dropped, the spoken one survived
    assert [c["phrase"] for c in timeline["beats"][1]["cues"]] == ["replay"]
    assert len(timeline["specHash"]) == 16


def test_cli_dry_run_needs_no_engine_and_no_ffmpeg(tmp_path, spec_file, monkeypatch):
    def explode():
        raise AssertionError("--dry-run must not look for ffmpeg")

    monkeypatch.setattr(synthesize, "check_ffmpeg", explode)
    out = tmp_path / "renders" / "dry"

    assert synthesize.main(["--spec", str(spec_file), "--out", str(out), "--dry-run"]) == 0

    timeline = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
    assert [b["audioSeconds"] for b in timeline["beats"]] == [3.0, 2.0]
    assert timeline["totalSeconds"] == pytest.approx(7.5)
    assert timeline["alignment"] == "estimated"
    assert not (out / "narration.wav").exists()
    assert not any((out / "audio").iterdir())


def test_cli_reports_a_bad_spec_path_without_a_traceback(tmp_path, capsys):
    code = synthesize.main(["--spec", str(tmp_path / "nope.json"), "--out", str(tmp_path / "o")])
    assert code == 1
    assert "spec not found" in capsys.readouterr().err


def test_missing_ffmpeg_is_reported_before_synthesis(tmp_path, spec_file, monkeypatch):
    monkeypatch.setattr(synthesize.shutil, "which", lambda name: None)
    engine = FakeEngine()

    code = synthesize.main(
        ["--spec", str(spec_file), "--out", str(tmp_path / "o"), "--no-align"], engine=engine
    )

    assert code == 1
    assert engine.calls == []  # failed before burning any synthesis time


def test_spec_hash_matches_the_typescript_stable_stringify():
    # key order must not matter, and 4.0 must serialise as "4" like JSON.stringify
    assert synthesize.spec_hash({"a": 1, "b": [2, 3]}) == synthesize.spec_hash({"b": [2, 3], "a": 1})
    assert synthesize._stable_stringify({"b": 4.0, "a": "x"}) == '{"a":"x","b":4}'
    assert synthesize._stable_stringify([True, None, 1.5]) == "[true,null,1.5]"


def test_concat_wavs_builds_one_ffmpeg_call_with_silences(tmp_path, monkeypatch):
    captured = {}

    class Result:
        returncode = 0
        stderr = ""

    monkeypatch.setattr(
        synthesize.subprocess, "run", lambda cmd, **kw: (captured.update(cmd=cmd), Result())[1]
    )
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    for path in (a, b):
        write_wav_mono16(path, [0.0] * 2400, 24_000)

    synthesize.concat_wavs([(a, 1.0), (b, 0.0)], tmp_path / "narration.wav", sample_rate=24_000)

    cmd = captured["cmd"]
    assert cmd.count("-i") == 3  # two beats + one silence (the second hold is zero)
    assert any("anullsrc" in part for part in cmd)
    assert "concat=n=3:v=0:a=1[out]" in cmd[cmd.index("-filter_complex") + 1]


def test_concat_wavs_surfaces_ffmpeg_failure(tmp_path, monkeypatch):
    class Result:
        returncode = 1
        stderr = "Invalid argument"

    monkeypatch.setattr(synthesize.subprocess, "run", lambda cmd, **kw: Result())
    wav = tmp_path / "a.wav"
    write_wav_mono16(wav, [0.0] * 2400, 24_000)

    with pytest.raises(synthesize.PipelineError, match="Invalid argument"):
        synthesize.concat_wavs([(wav, 0.0)], tmp_path / "out.wav")


def test_wav_helpers_round_trip(tmp_path):
    path = tmp_path / "tone.wav"
    samples = [math.sin(i / 24) * 0.5 for i in range(24_000)]
    assert write_wav_mono16(path, samples, 24_000) == pytest.approx(1.0)
    assert wav_seconds(path) == pytest.approx(1.0)
