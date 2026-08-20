"""`explainer-ingest` — extract uploads to JSON on stdout.

Called by the render worker the same way `explainer-narrate` is: a subprocess
boundary keeps the Python OCR stack out of the Node process, and makes the
stage independently runnable when debugging a bad transcription.
"""

from __future__ import annotations

import argparse
import json
import sys

from .extract import extract_all


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="explainer-ingest",
        description="Extract text from uploaded documents and images.",
    )
    parser.add_argument("files", nargs="+", help="Paths to uploaded files")
    parser.add_argument(
        "--engine",
        default=None,
        help="auto (default), rapidocr, tesseract or vlm. Overrides OCR_ENGINE.",
    )
    parser.add_argument("--out", default=None, help="Write JSON here instead of stdout")
    args = parser.parse_args(argv)

    sources = extract_all(list(args.files), args.engine)
    payload = json.dumps({"sources": [s.to_dict() for s in sources]}, indent=2)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(payload)
    else:
        sys.stdout.write(payload)

    # A batch where nothing could be read is a failure worth a non-zero exit.
    # A partial success is not: the question still stands on its own.
    return 0 if any(s.text for s in sources) else 1


if __name__ == "__main__":
    raise SystemExit(main())
