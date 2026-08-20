"""Alignment: the estimated fallback, and the repair of WhisperX's gaps."""

import pytest

from narration.align import AlignError, align, estimate_words

TRANSCRIPT = "The state machine never forgets anything at all"


def test_estimate_words_covers_the_whole_duration():
    words = estimate_words(TRANSCRIPT, 4.0)
    assert len(words) == len(TRANSCRIPT.split())
    assert words[0]["start"] == 0.0
    assert words[-1]["end"] == pytest.approx(4.0)


def test_estimate_words_is_monotonic_and_gapless():
    words = estimate_words(TRANSCRIPT, 4.0)
    for previous, current in zip(words, words[1:]):
        assert previous["end"] <= current["start"] + 1e-9
        assert current["start"] == pytest.approx(previous["end"])
        assert current["end"] >= current["start"]


def test_estimate_words_is_proportional_to_character_length():
    words = {w["word"]: w["end"] - w["start"] for w in estimate_words(TRANSCRIPT, 4.0)}
    total_chars = sum(len(t) for t in TRANSCRIPT.split())
    for token, seconds in words.items():
        assert seconds == pytest.approx(len(token) / total_chars * 4.0, abs=1e-6)
    # "machine" (7 chars) must take longer than "at" (2 chars).
    assert words["machine"] > words["at"]


def test_estimated_words_are_flagged_as_guesses():
    assert all(w["score"] == 0.0 for w in estimate_words(TRANSCRIPT, 4.0))


def test_estimate_words_handles_empty_and_whitespace():
    assert estimate_words("   ", 4.0) == []
    assert estimate_words("", 0.0) == []


def test_estimate_words_rejects_negative_duration():
    with pytest.raises(ValueError):
        estimate_words(TRANSCRIPT, -1.0)


# --------------------------------------------------------------------- whisperx


class FakeWhisperX:
    """Stands in for the real package so the alignment path is testable."""

    def __init__(self, word_segments):
        self.word_segments = word_segments
        self.loaded = 0

    def load_audio(self, path):
        return [0.0] * 32_000  # 2.0s at whisperx's fixed 16kHz

    def load_align_model(self, language_code, device):
        self.loaded += 1
        return ("model", {"language": language_code})

    def align(self, segments, model, metadata, audio, device, return_char_alignments=False):
        assert segments[0]["end"] == pytest.approx(2.0)
        return {"word_segments": self.word_segments}


def test_align_returns_word_timings(tmp_path):
    audio = tmp_path / "hook.wav"
    audio.write_bytes(b"not really a wav, the fake never reads it")
    fake = FakeWhisperX(
        [
            {"word": "The", "start": 0.0, "end": 0.2, "score": 0.91},
            {"word": "state", "start": 0.2, "end": 0.6, "score": 0.88},
        ]
    )

    result = align(audio, "The state", device="cpu", whisperx_module=fake)

    assert [w["word"] for w in result] == ["The", "state"]
    assert result[1]["start"] == pytest.approx(0.2)
    assert result[1]["score"] == pytest.approx(0.88)


def test_align_interpolates_words_whisperx_could_not_place(tmp_path):
    """Dropping unplaced words would break contiguous phrase matching."""
    audio = tmp_path / "hook.wav"
    audio.write_bytes(b"x")
    fake = FakeWhisperX(
        [
            {"word": "seven", "start": 0.0, "end": 0.5, "score": 0.9},
            {"word": "1972", "start": None, "end": None},  # unalignable numeral
            {"word": "records", "start": 1.2, "end": 1.8, "score": 0.8},
        ]
    )

    result = align(audio, "seven 1972 records", device="cpu", whisperx_module=fake)

    assert len(result) == 3
    assert result[1]["start"] == pytest.approx(0.5)
    assert result[1]["end"] == pytest.approx(1.2)
    assert result[1]["score"] == 0.0
    starts = [w["start"] for w in result]
    assert starts == sorted(starts)


def test_align_refuses_a_missing_file(tmp_path):
    with pytest.raises(AlignError, match="does not exist"):
        align(tmp_path / "nope.wav", "hello", whisperx_module=FakeWhisperX([]))


def test_align_reports_an_empty_result_clearly(tmp_path):
    audio = tmp_path / "hook.wav"
    audio.write_bytes(b"x")
    with pytest.raises(AlignError, match="no word segments"):
        align(audio, "hello", whisperx_module=FakeWhisperX([]))
