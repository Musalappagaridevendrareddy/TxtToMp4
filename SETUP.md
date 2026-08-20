# Setup

The repo was authored on a machine with no ML stack installed. Everything that
does not need a model is verified and green there; this document is what to run
on the box that actually renders.

## Shortcut: DGX Spark

On a DGX Spark (GB10, aarch64, DGX OS) the whole of this document is automated:

```bash
./scripts/install-dgx-spark.sh
```

It is idempotent, skips optional stages that fail rather than aborting, and
ends by rendering one real Manim beat so you have something to look at. Use
`--verify-only` to re-check an existing install without changing anything, and
`--skip-gpu` to set up the CPU path alone. Read the rest of this document when
a stage warns and you want to know what it was trying to do.

## What is verified vs what is not

| Verified on the dev machine | Not yet executed anywhere |
|---|---|
| `npm run build/typecheck/test --workspaces` all clean | Manim rendering a real WebM |
| 99 TypeScript tests (spec 16, planner 24, compositor 25, api 34) | Kokoro / IndexTTS-2 synthesis |
| 228 Python tests (manim-scenes 181, narration 47) | WhisperX alignment |
| All 12 archetypes' layout, timing and budget logic, headless | Remotion producing an MP4 |
| 8 fixtures against the real validator | Postgres / Redis / MinIO |
| The API boots and serves `/healthz`, `/render`, `/jobs` | The worker against real infra |
| The OpenAI-compat adapter against a stubbed transport | Any real local model server |
| Spec hash agreement between TypeScript and Python | The live Claude API calls |
| `scripts/render.mjs` through spec -> narration -> timeline | ffmpeg concatenation |

327 tests total. None of them needs an API key, a GPU, or a model download.

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

> **On a DGX Spark, do not use the `cu124` index below.** GB10 is aarch64 with
> compute capability 12.1, and the x86-era CUDA 12.4 wheels either do not exist
> for that architecture or install and then fail at the first kernel launch —
> `torch.cuda.is_available()` returns `True` either way, so the failure surfaces
> mid-render rather than at install time. Run `scripts/install-dgx-spark.sh`,
> which tries `cu130`/`cu129`/`cu128` in order and verifies each by launching a
> real kernel. The line below is for x86 hosts with a CUDA 12.4 runtime.

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

## 5b. Running the decision stages on a local model

The AI is used at exactly two points, both upstream of the VideoSpec: turning a
question into a spec, and the critique loop. Everything downstream — Manim, the
TTS engines, WhisperX, Remotion, ffmpeg — never contacts a model. So this
setting changes *authoring*, not rendering.

To run those two stages on a locally hosted model instead of the Claude API:

```bash
LLM_PROVIDER=openai-compat
LLM_BASE_URL=http://localhost:11434/v1     # Ollama; vLLM is :8000, LM Studio :1234
PLANNER_MODEL=qwen2.5:32b
SPEC_MODEL=qwen2.5:32b
GATE_MODEL=qwen2.5:7b
```

`ANTHROPIC_API_KEY` is then not required — the config refuses to boot without
*a* credential, but accepts either. One adapter covers Ollama, vLLM,
llama.cpp's server, LM Studio and TGI, since all five speak OpenAI's
`/chat/completions`.

### The part that actually decides whether this works

The spec emitter depends on **forced tool use** to get a schema-valid object
back. Hosted Claude does this reliably; local servers vary, and smaller models
often narrate around the JSON instead of emitting it. `LLM_STRUCTURED_OUTPUT`
picks the strategy:

| Value | Behaviour | Use when |
|---|---|---|
| `auto` (default) | Ask for tool calling; if the model replies with bare or fenced JSON, parse that instead | You do not know what the server supports |
| `json_schema` | `response_format` with the spec's JSON Schema — constrained decoding on vLLM and llama.cpp | Most reliable for smaller models |
| `tools` | Strict OpenAI function calling, no salvage | The server implements tool calling well and you want failures loud |

Prefer a larger model for `SPEC_MODEL` than for `GATE_MODEL`. The spec is a
deeply nested object with cross-field constraints, and the validator's repair
loop only helps if the model can act on the feedback.

### Vision

The critique stage sends rendered PNGs. Most local text models cannot see them,
so `LLM_VISION` defaults to `0` and the stage **refuses** rather than quietly
reviewing frames it cannot read. Either point `CRITIQUE_MODEL` at a
vision-capable model and set `LLM_VISION=1`, or disable the loop with
`MAX_CRITIQUE_ITERATIONS=0`.

### Not verified

The adapter's translation layer is covered by 12 tests against a stubbed
transport — request shape, the tool_result repair transcript, image encoding,
error paths. **No real local server has been contacted.** Expect the first run
against Ollama or vLLM to need adjustment.

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
