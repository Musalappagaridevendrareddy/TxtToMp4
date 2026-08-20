# Build report

Built overnight from the Explainer Engine plan. Everything in the plan is
implemented. This document is the honest account of what runs, what does not,
and what I would look at first.

## State

All eight phases of the plan have code. Three commits on `main`:

```
9b955c5  spec contract, planner, fixtures
7d96a66  renderer, narration, compositor, service
f6c873b  build errors surfaced by real dependencies
```

311 tests pass: 83 TypeScript, 228 Python. `npm run build`, `npm run typecheck`
and `npm test` are clean across all four TypeScript workspaces. All 7 fixtures
validate against the real parser.

## What is proven, and what is only written

Proven by execution on this machine:

- The whole TypeScript build, typecheck and test suite.
- Every archetype's layout, timing budget and element-count enforcement, run
  headless against a geometry-faithful Manim stub.
- The narration timeline builder, including emphasis-to-word-cue resolution.
- `scripts/render.mjs` from a spec through narration to a written `timeline.json`.
- **The spec hash agrees across languages.** TypeScript and Python independently
  produce `9ad2ee1bee978143` for `fixtures/hashmap.json`. That was the single
  most likely silent integration failure and it is closed.

Written but never executed anywhere, because this machine has no ML stack:

- Manim producing an actual transparent WebM.
- Kokoro or IndexTTS-2 producing actual audio.
- WhisperX alignment.
- Remotion producing an actual MP4.
- The live Claude API calls. Their *request shapes* are pinned by tests against
  a scripted fake client — forced tool use, the repair transcript, refusal
  handling — so what is unverified is only the live service's answers.
- Postgres, Redis and MinIO.

`SETUP.md` has the install steps and a four-step ramp that adds exactly one
unverified component at a time.

## Integration defects found and fixed

Four packages were built in parallel, which surfaced real disagreements rather
than hiding them:

1. **The Manim safe area did not clear the caption band.** Remotion puts
   word-level captions across the bottom 18% of the frame; Manim's safe area
   reserved a uniform 7.5%. Every beat would have drawn behind the caption
   plate. Fixed with an asymmetric bottom margin (`theme.BOTTOM_MARGIN = 1.44`
   scene units), a matching `SAFE_CENTER_Y` so vertically-centred content shifts
   up, and a regression test.

2. **The API worker assumed the wrong planner signature.** It expected
   `emitSpec({question, plan, feedback}) -> raw` plus its own retry loop; the
   planner exports `emitSpec(question, planText) -> {spec, attempts, repairs}`
   and owns a better loop (it keeps the rejected attempt in the transcript).
   Fixed by writing real adapters at the worker's port boundary and dropping
   `MAX_SPEC_ATTEMPTS` to 1 so the two loops do not multiply.

3. **The compositor's `renderExplainer` signature differed** from what the
   worker called. Same fix, same place.

4. **Two build errors were hidden by hand-written type stubs** and appeared only
   once the real dependencies were installed: `ioredis`'s default export is the
   namespace under NodeNext, not the constructor, and Fastify types its error
   handler's error as `unknown`.

A fifth was found by the API agent itself: a job cancellation could be silently
clobbered by the next stage's status write. Fixed at the shared function rather
than at the eight call sites.

## Deliberate decisions worth knowing

**The three rules are enforced in the base class, not in prompts.** `reveal()`
plays exactly one animation on exactly one element, always ends in a hold of at
least 1.5s, and raises a `LayoutError` naming the archetype and the count if a
sixth element would appear.

**The hold floor is published, not clipped.** If an archetype's minimum holds do
not fit the beat the model asked for, the scene overruns and exposes
`required_seconds` rather than quietly shortening a hold. A rushed reveal is
worse than a long beat.

**Validation messages are written to be read by the model that made the
mistake.** That is the entire retry strategy: on failure the validator's own
text goes back as a `tool_result` with `is_error`, with the rejected attempt
left in the transcript.

**The critique loop can say "ship".** Ship is a first-class tool rather than the
absence of output, and the prompt says explicitly not to invent problems. A
critic that feels obliged to find something will always find something, and a
spec revised for a defect that was not there is worse than one left alone. An
invalid proposed revision is also discarded in favour of the working spec.

**Untrusted input never reaches a shell.** The question crosses to Python as a
file path, `execFile` with `shell: false` is pinned, and two tests guard it —
one behavioural with a shell-injection payload, one a source scan banning
`exec(` and `shell: true`.

## What I would do first, in order

1. **Phase 0 for real.** Install Manim and render one beat:
   `python -m manim_scenes.render_beat --spec ../../fixtures/hashmap.json --beat-id the-trick --out ../../renders/probe`.
   Then look at it. The plan is right that if this does not look good, nothing
   downstream improves on it. The palettes and timing budget are considered but
   unlooked-at, and text metrics are the most likely thing to be off — the
   headless stub estimates glyph widths at roughly 0.0064 x font size per
   character, which a real Pango metric could contradict.

2. **Confirm the transparent WebM.** `--transparent --format=webm` is assumed to
   yield an alpha channel that Remotion's `OffthreadVideo` composites correctly.
   If it does not, that is a compositor-side change, not an archetype one.

3. **One full offline render**, then the critique loop on it.

4. **Only then** the service. Nothing about Postgres or BullMQ affects whether
   the video is any good.

## Things left undone on purpose

- No web editor, no multi-language narration, no interactive video, no
  free-form code generation — all explicitly out of scope in the plan.
- Kokoro ignores the target duration; only IndexTTS-2 honours it. Draft renders
  will drift from the spec's beat durations, and the timeline records the
  measured length rather than the requested one, so sync stays correct.
- `renders/` and `node_modules/` are gitignored. I installed the Node toolchain
  and dependencies locally to verify the builds actually compile; delete
  `node_modules/` if you would rather the machine stayed clean.
