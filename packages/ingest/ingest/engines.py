"""OCR engines, selected at runtime and imported lazily.

Engine choice is a licensing and portability question as much as an accuracy
one, so the reasoning is recorded here rather than in a wiki nobody reads:

* **rapidocr** (default) — Apache-2.0, PP-OCR weights on ONNXRuntime, CPU only.
  Runs on aarch64 with no CUDA, which is why it is the default: it works on the
  DGX Spark on day one regardless of how the PyTorch/Blackwell situation lands.
* **tesseract** — Apache-2.0, ubiquitous, weakest on complex layouts. Kept as
  the fallback because it installs from apt anywhere.
* **vlm** — a vision-language model over the OpenAI-compatible endpoint the
  planner already talks to (`LLM_BASE_URL`). Best quality by a wide margin on
  messy layouts, handwriting, tables and diagrams, and needs no new serving
  infrastructure. Requires a vision-capable model such as Qwen2.5-VL.

Deliberately **not** offered: Surya/Marker and GutenOCR. Their code is
permissive but the *weights* are CC-BY-NC, waived only below revenue and
funding thresholds this project's owner is well above. HunyuanOCR ships a
custom licence carrying territory constraints. None is safe to default to.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from .core import Engine, IngestError

#: Engines that can read an image. Order is the auto-selection preference.
IMAGE_ENGINES: tuple[Engine, ...] = ("vlm", "rapidocr", "tesseract")

_VLM_PROMPT = (
    "Transcribe all text visible in this image, preserving reading order and "
    "line breaks. If the image contains a diagram, table or chart, describe its "
    "structure and transcribe every label. Output only the transcription."
)

_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _module_exists(name: str) -> bool:
    from importlib.util import find_spec

    try:
        return find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def available(engine: Engine) -> bool:
    """Whether an engine can actually run here, without importing it eagerly."""
    if engine == "rapidocr":
        return _module_exists("rapidocr_onnxruntime")
    if engine == "tesseract":
        return _module_exists("pytesseract")
    if engine == "vlm":
        return bool(os.environ.get("LLM_BASE_URL"))
    return False


def _install_hint(engine: Engine) -> str:
    return {
        "rapidocr": "Install with: pip install -e 'packages/ingest[rapidocr]'",
        "tesseract": (
            "Install with: pip install -e 'packages/ingest[tesseract]' "
            "and apt-get install tesseract-ocr"
        ),
        "vlm": "Set LLM_BASE_URL to an OpenAI-compatible server serving a vision model.",
    }.get(engine, "")


def resolve(requested: str | None = None) -> Engine:
    """Pick an engine, honouring an explicit request over availability.

    An explicit choice that is unavailable raises rather than silently falling
    back: a caller who asked for the VLM and quietly got Tesseract would ship a
    worse transcription believing it had the better one.
    """
    requested = (requested or os.environ.get("OCR_ENGINE") or "auto").lower()

    if requested != "auto":
        if requested not in IMAGE_ENGINES:
            raise IngestError(
                f"Unknown OCR engine {requested!r}. Use one of: auto, " + ", ".join(IMAGE_ENGINES)
            )
        if not available(requested):  # type: ignore[arg-type]
            raise IngestError(
                f"OCR engine {requested!r} was requested but is not installed or configured. "
                + _install_hint(requested)  # type: ignore[arg-type]
            )
        return requested  # type: ignore[return-value]

    for candidate in IMAGE_ENGINES:
        if available(candidate):
            return candidate

    raise IngestError(
        "No OCR engine is available. Install one:\n"
        "  pip install -e 'packages/ingest[rapidocr]'   # Apache-2.0, CPU, aarch64-safe\n"
        "  pip install -e 'packages/ingest[tesseract]'  # also needs the tesseract binary\n"
        "or set LLM_BASE_URL to a vision-capable OpenAI-compatible server."
    )


# ----------------------------------------------------------------- engines --


def read_image(path: Path, engine: Engine) -> str:
    if engine == "rapidocr":
        return _rapidocr(path)
    if engine == "tesseract":
        return _tesseract(path)
    if engine == "vlm":
        return _vlm(path)
    raise IngestError(f"Engine {engine!r} cannot read images")


def _rapidocr(path: Path) -> str:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:  # pragma: no cover - guarded by resolve()
        raise IngestError(_install_hint("rapidocr")) from exc

    result, _elapsed = RapidOCR()(str(path))
    if not result:
        return ""
    # RapidOCR returns [box, text, confidence] per detected line, already in
    # reading order.
    return "\n".join(line[1] for line in result if len(line) > 1 and line[1])


def _tesseract(path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - guarded by resolve()
        raise IngestError(_install_hint("tesseract")) from exc

    with Image.open(path) as image:
        return pytesseract.image_to_string(image)


def _vlm(path: Path) -> str:
    """Transcribe via the same OpenAI-compatible endpoint the planner uses."""
    base = (os.environ.get("LLM_BASE_URL") or "").rstrip("/")
    if not base:
        raise IngestError(_install_hint("vlm"))

    model = os.environ.get("OCR_VLM_MODEL") or os.environ.get("CRITIQUE_MODEL") or ""
    if not model:
        raise IngestError("Set OCR_VLM_MODEL to the vision model to transcribe with.")

    media_type = _MEDIA_TYPES.get(path.suffix.lower(), "image/png")
    data_uri = f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode()}"

    payload = json.dumps(
        {
            "model": model,
            "max_tokens": 4096,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _VLM_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ],
                }
            ],
        }
    ).encode()

    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=payload,
        headers={
            "content-type": "application/json",
            **(
                {"authorization": f"Bearer {os.environ['LLM_API_KEY']}"}
                if os.environ.get("LLM_API_KEY")
                else {}
            ),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise IngestError(f"Vision model server returned {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise IngestError(f"Could not reach the vision model server at {base}") from exc

    choices = body.get("choices") or []
    if not choices:
        raise IngestError("Vision model returned no choices")
    return choices[0].get("message", {}).get("content") or ""
