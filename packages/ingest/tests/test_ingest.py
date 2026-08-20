import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from ingest import IngestError, Source, classify, clean, extract_all, extract_file, resolve
from ingest.core import MAX_CHARS, finish


# ------------------------------------------------------------ classify ----


@pytest.mark.parametrize(
    "name,expected",
    [
        ("notes.md", "text"),
        ("data.CSV", "text"),
        ("paper.pdf", "pdf"),
        ("whiteboard.JPG", "image"),
        ("scan.tiff", "image"),
        ("archive.zip", "unsupported"),
        ("noextension", "unsupported"),
    ],
)
def test_classify_is_case_insensitive(name, expected):
    assert classify(Path(name)) == expected


# --------------------------------------------------------------- clean ----


def test_clean_strips_control_characters_and_normalises_ligatures():
    # A PDF text layer emits both; left in, they waste prompt budget and blur
    # where the source ends.
    assert clean("de\x00fine the ﬁeld") == "define the field"


def test_clean_collapses_ragged_whitespace_but_keeps_paragraphs():
    assert clean("a\n\n\n\n\nb   c\r\nd  ") == "a\n\nb c\nd"


# -------------------------------------------------------------- finish ----


def test_finish_truncates_and_says_so():
    source = finish(Source("big.txt", "text", "text", "x" * (MAX_CHARS + 5_000)))

    assert source.truncated is True
    assert source.chars <= MAX_CHARS
    assert any("truncated" in w for w in source.warnings)


def test_finish_leaves_short_text_alone():
    source = finish(Source("small.txt", "text", "text", "just a line"))

    assert source.truncated is False
    assert source.text == "just a line"
    assert source.chars == len("just a line")


# ------------------------------------------------------------- extract ----


def test_text_file_needs_no_ocr_engine(tmp_path):
    # The point: a text upload works on a machine with no OCR installed.
    path = tmp_path / "notes.md"
    path.write_text("# Hash maps\n\nA table plus a hash function.", encoding="utf-8")

    source = extract_file(path)

    assert source.kind == "text"
    assert source.engine == "text"
    assert "hash function" in source.text
    assert source.warnings == []


def test_unsupported_type_names_what_is_supported(tmp_path):
    path = tmp_path / "archive.zip"
    path.write_bytes(b"PK\x03\x04")

    with pytest.raises(IngestError, match="unsupported type"):
        extract_file(path)


def test_missing_file_is_reported_as_such(tmp_path):
    with pytest.raises(IngestError, match="Not a file"):
        extract_file(tmp_path / "absent.png")


def test_one_bad_upload_does_not_sink_the_batch(tmp_path):
    good = tmp_path / "good.txt"
    good.write_text("readable content", encoding="utf-8")
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"PK")

    sources = extract_all([good, bad])

    assert len(sources) == 2
    assert sources[0].text == "readable content"
    # The failure is recorded rather than swallowed or raised.
    assert sources[1].kind == "unsupported"
    assert sources[1].text == ""
    assert sources[1].warnings and "unsupported type" in sources[1].warnings[0]


def test_batch_order_is_preserved(tmp_path):
    names = ["a.txt", "b.txt", "c.txt"]
    for name in names:
        (tmp_path / name).write_text(name, encoding="utf-8")

    sources = extract_all([tmp_path / n for n in names])

    assert [s.filename for s in sources] == names


# -------------------------------------------------------------- engine ----


def test_explicit_unavailable_engine_raises_rather_than_downgrading(monkeypatch):
    # Silently falling back would ship a worse transcription while the caller
    # believed it had the better one.
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(IngestError, match="requested but is not installed"):
        resolve("vlm")


def test_unknown_engine_lists_the_valid_ones():
    with pytest.raises(IngestError, match="Unknown OCR engine"):
        resolve("surya")


def test_vlm_is_available_when_a_local_endpoint_is_configured(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")

    assert resolve("vlm") == "vlm"


def test_auto_reports_clearly_when_nothing_is_installed(monkeypatch):
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("OCR_ENGINE", raising=False)
    monkeypatch.setattr("ingest.engines.available", lambda _engine: False)

    with pytest.raises(IngestError, match="No OCR engine is available"):
        resolve("auto")


# ----------------------------------------------------------------- cli ----


def _env() -> dict:
    """conftest puts the package on sys.path for *this* process only.

    The CLI runs in a subprocess, which inherits none of that, so the package
    root has to travel via PYTHONPATH or `python -m ingest.cli` cannot resolve.
    """
    root = str(Path(__file__).resolve().parents[1])
    existing = os.environ.get("PYTHONPATH", "")
    return {
        **os.environ,
        "PYTHONPATH": f"{root}{os.pathsep}{existing}" if existing else root,
    }


def test_cli_emits_the_documented_json_shape(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("compound interest accelerates", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "-m", "ingest.cli", str(path)],
        capture_output=True,
        text=True,
        check=False,
        env=_env(),
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert list(payload) == ["sources"]
    source = payload["sources"][0]
    assert source["filename"] == "notes.txt"
    assert source["engine"] == "text"
    assert "compound interest" in source["text"]
    assert source["truncated"] is False


def test_cli_exits_non_zero_when_nothing_could_be_read(tmp_path):
    path = tmp_path / "bad.zip"
    path.write_bytes(b"PK")

    result = subprocess.run(
        [sys.executable, "-m", "ingest.cli", str(path)],
        capture_output=True,
        text=True,
        check=False,
        env=_env(),
    )

    assert result.returncode == 1
    assert json.loads(result.stdout)["sources"][0]["kind"] == "unsupported"
