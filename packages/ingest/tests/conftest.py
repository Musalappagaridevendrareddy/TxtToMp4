"""Make `ingest` importable without installing it — no OCR engines, no pip.

Mirrors packages/narration/tests/conftest.py so `pytest packages` works from
the repo root, which is how the installer's verification step runs it.
"""

import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))
