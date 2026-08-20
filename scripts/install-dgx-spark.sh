#!/usr/bin/env bash
#
# One-shot installer for the explainer engine on an NVIDIA DGX Spark
# (GB10 Grace Blackwell, aarch64, DGX OS / Ubuntu 24.04).
#
#   ./scripts/install-dgx-spark.sh                 # everything
#   ./scripts/install-dgx-spark.sh --skip-gpu      # CPU only (Manim + Kokoro)
#   ./scripts/install-dgx-spark.sh --skip-infra    # no docker compose stack
#   ./scripts/install-dgx-spark.sh --verify-only   # change nothing, just report
#
# Design notes:
#   * Idempotent. Re-running is safe and is the intended way to resume after a
#     failed stage.
#   * Staged. An optional stage that fails (WhisperX, IndexTTS-2) is reported
#     and skipped rather than aborting the run — neither is needed to render
#     your first video.
#   * Verifies rather than assumes. Every stage ends in a real check, and the
#     GPU check launches an actual kernel: on Blackwell,
#     `torch.cuda.is_available()` returns True even when the wheel carries no
#     sm_121 kernels, and you would otherwise discover that mid-render.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_GPU=0
SKIP_INFRA=0
VERIFY_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-gpu)    SKIP_GPU=1 ;;
    --skip-infra)  SKIP_INFRA=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    -h|--help)     sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- output ----
if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; X=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; X=''
fi

WARNINGS=()
SKIPPED=()

step()  { printf '\n%s==> %s%s\n' "$B" "$*" "$X"; }
ok()    { printf '  %s[ ok ]%s %s\n' "$G" "$X" "$*"; }
warn()  { printf '  %s[warn]%s %s\n' "$Y" "$X" "$*"; WARNINGS+=("$*"); }
skip()  { printf '  %s[skip]%s %s\n' "$Y" "$X" "$*"; SKIPPED+=("$*"); }
die()   { printf '  %s[fail]%s %s\n' "$R" "$X" "$*"; exit 1; }
have()  { command -v "$1" >/dev/null 2>&1; }

# sudo only when not already root, and only if it exists.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  have sudo || die "not root and sudo is unavailable; run as root or install sudo"
  SUDO="sudo"
fi

VENV="$REPO_ROOT/.venv"
PY="$VENV/bin/python"

# ------------------------------------------------------------ 0. platform ----
step "Platform"

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ok "architecture $ARCH (expected for DGX Spark)" ;;
  x86_64) warn "architecture is $ARCH, not aarch64 — this script targets DGX Spark. It still works, but the CUDA wheel selection below is tuned for aarch64 + Blackwell." ;;
  *) warn "unrecognised architecture $ARCH" ;;
esac

if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "os ${PRETTY_NAME:-unknown}"
  case "${ID:-}" in
    ubuntu|debian) : ;;
    *) warn "this installer uses apt-get; ${ID:-your distro} may need the system-package stage done by hand" ;;
  esac
else
  warn "cannot read /etc/os-release"
fi

if have nvidia-smi; then
  GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)"
  CC="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 || true)"
  ok "gpu ${GPU_NAME:-present} (compute capability ${CC:-unknown})"
else
  warn "nvidia-smi not found — treating this as a CPU-only host"
  SKIP_GPU=1
fi

[ "$VERIFY_ONLY" -eq 1 ] && step "Verify-only mode: nothing will be installed"

# ---------------------------------------------------- 1. system packages ----
# cairo/pango are Manim's text and vector backend; espeak-ng is Kokoro's
# phonemiser; ffmpeg muxes every stage's output.
APT_PACKAGES=(
  build-essential pkg-config git curl ca-certificates
  ffmpeg
  libcairo2-dev libpango1.0-dev
  espeak-ng
  python3-dev python3-venv python3-pip
)

if [ "$VERIFY_ONLY" -eq 0 ]; then
  step "System packages (apt-get)"
  missing=()
  for pkg in "${APT_PACKAGES[@]}"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done

  if [ ${#missing[@]} -eq 0 ]; then
    ok "all ${#APT_PACKAGES[@]} system packages already present"
  else
    printf '  installing: %s\n' "${missing[*]}"
    $SUDO apt-get update -qq
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
    ok "installed ${#missing[@]} package(s)"
  fi
fi

for bin in ffmpeg git curl; do
  have "$bin" && ok "$bin present" || die "$bin missing after the system stage"
done

# --------------------------------------------------------------- 2. Node ----
step "Node.js (>= 20)"

node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }

if have node && [ "$(node_major)" -ge 20 ] 2>/dev/null; then
  ok "node $(node -v) already satisfies >= 20"
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  warn "node missing or older than 20 (verify-only, not installing)"
else
  echo "  installing Node.js 20 from NodeSource (arm64)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  have node && [ "$(node_major)" -ge 20 ] || die "node install did not produce >= 20"
  ok "node $(node -v)"
fi

# ------------------------------------------------------- 3. JS workspaces ----
if [ "$VERIFY_ONLY" -eq 0 ]; then
  step "JavaScript workspaces"
  # `npm ci` requires the lockfile to match package.json exactly; fall back to
  # install so a drifted lockfile cannot block the whole setup.
  if [ -f package-lock.json ] && npm ci --no-audit --no-fund 2>/dev/null; then
    ok "npm ci (lockfile honoured)"
  else
    warn "npm ci unavailable or lockfile drifted — falling back to npm install"
    npm install --no-audit --no-fund
  fi
  npm run build --workspaces --if-present
  ok "all workspaces built"
fi

# -------------------------------------------------------- 4. Python venv ----
step "Python virtualenv"

if [ "$VERIFY_ONLY" -eq 0 ]; then
  [ -d "$VENV" ] || python3 -m venv "$VENV"
  "$PY" -m pip install --quiet --upgrade pip setuptools wheel
  ok "venv at $VENV ($("$PY" --version))"

  # Editable installs so `manim_scenes` / `narration` import from source.
  "$PY" -m pip install --quiet -e packages/manim-scenes -e "packages/narration[dev]"
  ok "explainer packages installed (editable)"
else
  [ -x "$PY" ] && ok "venv present ($("$PY" --version))" || warn "no venv at $VENV"
fi

[ -x "$PY" ] || die "no python at $PY"
"$PY" -c "import manim_scenes, narration" 2>/dev/null \
  && ok "manim_scenes + narration import cleanly" \
  || die "explainer python packages do not import"

# ------------------------------------------------------------- 5. Manim -----
step "Manim"

if "$PY" -c "import manim" 2>/dev/null; then
  ok "manim $("$PY" -c 'import manim; print(manim.__version__)' 2>/dev/null)"
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  warn "manim not installed (verify-only)"
else
  "$PY" -m pip install --quiet "manim>=0.18"
  "$PY" -c "import manim" 2>/dev/null \
    && ok "manim $("$PY" -c 'import manim; print(manim.__version__)')" \
    || die "manim installed but will not import — check libcairo2-dev / libpango1.0-dev"
fi

# ------------------------------------------------------- 6. Kokoro (CPU) ----
step "Kokoro TTS (draft narration, CPU)"

if "$PY" -c "import kokoro" 2>/dev/null; then
  ok "kokoro already installed"
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  warn "kokoro not installed (verify-only)"
elif "$PY" -m pip install --quiet -e "packages/narration[kokoro]"; then
  ok "kokoro installed"
else
  warn "kokoro install failed — draft narration unavailable. The pipeline still runs with --skip narration."
fi
have espeak-ng && ok "espeak-ng on PATH" || warn "espeak-ng missing — kokoro will fail at phonemisation"

# ---------------------------------------------------------- 7. GPU stack ----
# The delicate part. GB10 needs a wheel carrying sm_121 kernels; an x86-era
# CUDA index silently yields either no wheel at all, or a wheel that imports
# fine and then dies at the first kernel launch.
if [ "$SKIP_GPU" -eq 1 ]; then
  step "GPU stack"
  skip "skipped (--skip-gpu or no nvidia-smi). Kokoro on CPU covers all development."
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  step "GPU stack"
  "$PY" -c "import torch" 2>/dev/null \
    && ok "torch $("$PY" -c 'import torch; print(torch.__version__)')" \
    || warn "torch not installed"
else
  step "PyTorch (CUDA, aarch64 + Blackwell)"

  torch_works() {
    # Not `is_available()` — that returns True on Blackwell even with no kernels.
    "$PY" - <<'PYEOF' >/dev/null 2>&1
import torch
assert torch.cuda.is_available()
x = torch.randn(64, 64, device="cuda")
(x @ x).sum().item()
torch.cuda.synchronize()
PYEOF
  }

  if torch_works; then
    ok "torch $("$PY" -c 'import torch; print(torch.__version__)') already launches CUDA kernels"
  else
    installed=0
    # Newest CUDA line first: GB10 needs 12.8+ to have sm_121 kernels at all.
    for idx in cu130 cu129 cu128; do
      echo "  trying https://download.pytorch.org/whl/$idx"
      if "$PY" -m pip install --quiet --upgrade torch torchaudio \
           --index-url "https://download.pytorch.org/whl/$idx" 2>/dev/null; then
        if torch_works; then
          ok "torch $("$PY" -c 'import torch; print(torch.__version__)') from $idx — kernel launch verified"
          installed=1
          break
        fi
        warn "$idx wheel installed but no working sm_121 kernel; trying the next index"
      fi
    done

    if [ "$installed" -eq 0 ]; then
      warn "no PyTorch build produced a working CUDA kernel on this host."
      warn "Fall back to NVIDIA's NGC container, which ships a torch built for GB10:"
      warn "  docker run --gpus all -it --rm -v \$PWD:/w -w /w nvcr.io/nvidia/pytorch:25.01-py3"
      warn "Everything except IndexTTS-2 and GPU WhisperX still works without it."
    fi
  fi

  # ----------------------------------------------------- 7b. WhisperX -----
  step "WhisperX (word-level alignment)"
  if "$PY" -c "import whisperx" 2>/dev/null; then
    ok "whisperx already installed"
  elif "$PY" -m pip install --quiet -e "packages/narration[align]"; then
    ok "whisperx installed"
  else
    warn "whisperx install failed — this is the known-weak link on aarch64 (CTranslate2)."
    warn "The pipeline degrades gracefully: timings fall back to estimation and the"
    warn "timeline records estimated=true. Sync will be visibly loose but nothing breaks."
  fi

  # ---------------------------------------------------- 7c. IndexTTS-2 ----
  step "IndexTTS-2 (final narration, optional)"
  if "$PY" -c "import indextts" 2>/dev/null; then
    ok "indextts already installed"
  elif "$PY" -m pip install --quiet -e "packages/narration[indextts2]"; then
    ok "indextts installed (set INDEXTTS2_MODEL_DIR in .env to use it)"
  else
    warn "indextts install failed — only needed for final renders. Keep TTS_ENGINE=kokoro."
  fi
fi

# -------------------------------------------------------------- 8. .env ----
step "Environment file"

if [ -f .env ]; then
  ok ".env already exists (leaving it alone)"
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  warn "no .env (verify-only, not creating)"
else
  cp .env.example .env
  ok "created .env from .env.example"
fi

if [ -f .env ]; then
  if grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
    ok "ANTHROPIC_API_KEY is set"
  else
    warn "ANTHROPIC_API_KEY is empty in .env — the planner and critique stages will not run until you fill it"
  fi
  # WhisperX should use the GPU here; the default is cpu for laptops.
  if [ "$SKIP_GPU" -eq 0 ] && grep -q '^WHISPERX_DEVICE=cpu' .env; then
    warn "WHISPERX_DEVICE is still 'cpu' — set it to 'cuda' to use the GB10"
  fi
fi

# ------------------------------------------------------------- 9. infra ----
step "Infrastructure (Postgres, Redis, MinIO)"

if [ "$SKIP_INFRA" -eq 1 ]; then
  skip "skipped (--skip-infra)"
elif ! have docker; then
  warn "docker not found — only the service stage needs it, nothing before it does"
elif ! docker info >/dev/null 2>&1; then
  warn "docker daemon unreachable. If this is a permissions problem:"
  warn "  sudo usermod -aG docker \$USER   # then log out and back in"
  warn "Be aware that docker group membership is root-equivalent on this host."
elif ! docker compose version >/dev/null 2>&1; then
  warn "the docker compose plugin is missing: sudo apt-get install -y docker-compose-plugin"
elif [ "$VERIFY_ONLY" -eq 1 ]; then
  ok "docker + compose available (verify-only, not starting)"
else
  ( cd infra && docker compose up -d )
  ok "compose stack up"

  # Postgres accepts TCP before it accepts queries; wait for real readiness.
  printf '  waiting for postgres'
  for _ in $(seq 1 30); do
    if ( cd infra && docker compose exec -T postgres pg_isready -U explainer >/dev/null 2>&1 ); then
      printf '\n'; ok "postgres ready"; break
    fi
    printf '.'; sleep 2
  done

  if npm run migrate --workspace packages/api >/tmp/ee-migrate.log 2>&1; then
    ok "migrations applied"
  else
    warn "migrations failed — see /tmp/ee-migrate.log and 'cd infra && docker compose logs postgres'"
  fi
fi

# ------------------------------------------------------------ 10. verify ----
step "Verification"

npm test --workspaces --if-present >/tmp/ee-js-test.log 2>&1 \
  && ok "JavaScript tests pass" \
  || warn "JavaScript tests failed — see /tmp/ee-js-test.log"

"$PY" -m pytest packages -q >/tmp/ee-py-test.log 2>&1 \
  && ok "Python tests pass ($(tail -1 /tmp/ee-py-test.log))" \
  || warn "Python tests failed — see /tmp/ee-py-test.log"

node scripts/validate-fixtures.mjs >/tmp/ee-fixtures.log 2>&1 \
  && ok "all fixtures validate ($(tail -1 /tmp/ee-fixtures.log))" \
  || warn "fixture validation failed — see /tmp/ee-fixtures.log"

# The single most valuable check: one real Manim beat, rendered.
if [ "$VERIFY_ONLY" -eq 0 ] && "$PY" -c "import manim" 2>/dev/null; then
  step "Smoke render (one beat, ~1 min)"
  if "$PY" -m manim_scenes.render_beat \
        --spec fixtures/hashmap.json --beat-id the-trick \
        --out renders/smoke >/tmp/ee-smoke.log 2>&1; then
    OUT="$(find renders/smoke \( -name '*.webm' -o -name '*.mp4' \) 2>/dev/null | head -1)"
    if [ -n "$OUT" ]; then
      ok "rendered $OUT"
      printf '\n  %sOpen that file and look at it before going any further.%s\n' "$B" "$X"
    else
      warn "render reported success but produced no video — see /tmp/ee-smoke.log"
    fi
  else
    warn "smoke render failed — see /tmp/ee-smoke.log. This is Phase 0; fix it before anything else."
  fi
fi

# -------------------------------------------------------------- summary ----
printf '\n%s─────────────────────────────────────────────%s\n' "$B" "$X"
if [ ${#WARNINGS[@]} -eq 0 ] && [ ${#SKIPPED[@]} -eq 0 ]; then
  printf '%sEverything installed and verified.%s\n' "$G" "$X"
else
  if [ ${#SKIPPED[@]} -gt 0 ]; then
    printf '%s%d stage(s) skipped:%s\n' "$Y" "${#SKIPPED[@]}" "$X"
    printf '  · %s\n' "${SKIPPED[@]}"
  fi
  if [ ${#WARNINGS[@]} -gt 0 ]; then
    printf '%s%d warning(s):%s\n' "$Y" "${#WARNINGS[@]}" "$X"
    printf '  · %s\n' "${WARNINGS[@]}"
  fi
fi

cat <<'EOF'

Next:
  1. Look at the smoke render. Phase 0 is a judgement call, not a test.
  2. Full pipeline, no AI involved:
       node scripts/render.mjs --spec fixtures/hashmap.json --out renders/hashmap
  3. Fill ANTHROPIC_API_KEY in .env, then:
       npm start --workspace packages/api        # http://localhost:8080
       npm run worker --workspace packages/api
       curl -X POST localhost:8080/render -H 'content-type: application/json' \
            -d '{"question":"How does a hash map work?"}'

Re-run this script any time; it is idempotent. Use --verify-only to re-check
without changing anything.
EOF
