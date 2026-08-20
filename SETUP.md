# Setup

The repo was authored on a machine with no ML stack installed. Everything that
does not need a model is verified and green there; this document is what to run
on the box that actually renders.

## What is verified vs what is not

| Verified on the dev machine | Not yet executed anywhere |
|---|---|
| Full TypeScript build of all four TS packages | Manim rendering a real WebM |
| TS tests: spec, planner, compositor | Kokoro / IndexTTS-2 synthesis |
| Narration tests, with no torch installed | WhisperX alignment |
| All 12 archetypes' layout/timing logic, headless | Remotion producing an MP4 |
| 7 fixtures against the real validator | Postgres / Redis / MinIO |
| Spec hash agreement between TypeScript and Python | The live Claude API calls |

The Claude calls are covered by tests against a scripted fake client, so the
request shapes (forced tool use, repair transcript, refusal handling) are
pinned; what is unverified is only that the live service answers as expected.

## 1. Node side

```bash
npm install
npm run build --workspaces
npm test --workspaces
node scripts/validate-fixtures.mjs
```

Node 20+ is required (24 was used). `packages/compositor` pulls Remotion, which
downloads a Chromium build on first render.

## 2. Python side

Python 3.10+. Two independent packages; install both editable.

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e packages/manim-scenes
pip install -e packages/narration
python -m pytest packages/narration/tests packages/manim-scenes/tests -q
```

### Manim

```bash
pip install "manim>=0.18"
```

Manim needs a system Cairo/Pango. LaTeX is only required for `Tex`/`MathTex` —
the archetypes here use `Text` exclusively, so you can skip it.

### ffmpeg

Required by the narration concatenation step and by keyframe extraction.

```bash
winget install Gyan.FFmpeg          # Windows
sudo apt-get install ffmpeg         # Debian/Ubuntu
```

### Kokoro (draft narration, CPU)

Runs at roughly 33x real time on CPU. Use it for every iteration.

```bash
pip install "explainer-narration[kokoro]"
winget install eSpeak-NG.eSpeak-NG   # or: apt-get install espeak-ng
```

### IndexTTS-2 (final narration, GPU)

This is the reason the architecture works: it accepts a target duration per
line, so animation timings are known before audio exists.

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install "explainer-narration[indextts2]"
huggingface-cli download IndexTeam/IndexTTS-2 --local-dir ./checkpoints
export INDEXTTS2_MODEL_DIR=./checkpoints
```

Set `INDEXTTS2_DEVICE=cpu` to fall back to CPU — slower, but acceptable for
batch finals.

**Voice policy.** Use a synthetic voice, or a recording of someone who consented
in writing. The adapter refuses to load reference audio unless a sibling
`consent.json` exists recording who consented and when. See
`packages/narration/VOICE_CONSENT.md`.

### WhisperX (word alignment)

```bash
pip install "explainer-narration[align]"
```

Without it the pipeline still runs: `align.estimate_words` distributes words
proportionally to character length and the timeline records that the timings
are estimates rather than measurements. Sync will be approximately right and
visibly imperfect.

## 3. AMD / ROCm note

The plan targets a Strix Halo box. Manim and Kokoro are CPU-bound and fine
there. IndexTTS-2 and WhisperX want CUDA. If the PyTorch/ROCm path fights you,
do not let it block anything: Kokoro on CPU covers all development, and finals
can run on a separate CUDA machine as a batch job. Verify ROCm early, but treat
it as optional.

## 4. Infrastructure (only needed for the service)

```bash
docker compose -f infra/docker-compose.yml up -d
npm run migrate --workspace @explainer/api
npm run dev     --workspace @explainer/api
npm run worker  --workspace @explainer/api
```

Postgres, Redis and MinIO. See `infra/README.md`.

## 5. Environment

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`. Credentials also
resolve from `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile, so an unset
`ANTHROPIC_API_KEY` does not necessarily mean unauthenticated.

Everything else in `.env.example` has a working default for local development.

## 6. First real render

Work up in order — each step adds exactly one unverified component:

```bash
# 1. no models at all: spec -> timeline
node scripts/render.mjs --spec fixtures/hashmap.json --dry-run --skip manim,compositor

# 2. add Manim: one beat first
cd packages/manim-scenes
python -m manim_scenes.render_beat --spec ../../fixtures/hashmap.json --beat-id the-trick --out ../../renders/probe

# 3. add real narration
node scripts/render.mjs --spec fixtures/hashmap.json --skip compositor

# 4. the whole thing
node scripts/render.mjs --spec fixtures/hashmap.json
```

Phase 0 of the plan says: build one beautiful scene and look at it before
anything else. Step 2 is that check. If `the-trick` does not look good, fix the
theme and the `transformation` archetype before going further — nothing
downstream improves on it.
