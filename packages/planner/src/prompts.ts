import {
  ARCHETYPE_DESCRIPTIONS,
  ARCHETYPE_EXAMPLES,
  ARCHETYPE_NAMES,
  archetypeParamsJsonSchemas,
  MAX_ELEMENTS,
} from '@explainer/spec';

/**
 * The archetype catalog is the highest-leverage prompt content in the system.
 * It is generated from the schemas themselves so it can never drift from what
 * the renderer will actually accept.
 */
export function archetypeCatalog(): string {
  return ARCHETYPE_NAMES.map((name) => {
    const schema = JSON.stringify(archetypeParamsJsonSchemas[name]);
    const example = JSON.stringify(ARCHETYPE_EXAMPLES[name], null, 2);
    return [
      `### ${name}`,
      ARCHETYPE_DESCRIPTIONS[name],
      '',
      `params schema: ${schema}`,
      '',
      'worked example:',
      '```json',
      example,
      '```',
    ].join('\n');
  }).join('\n\n');
}

/**
 * Step 1. Free-form reasoning, no JSON. Structured output degrades reasoning
 * quality, so the model thinks in prose first and that prose is passed into
 * the spec call as context.
 */
export function plannerPrompt(question: string): string {
  return `The user asked: ${question}

Think through this before anyone animates anything.

- What is the single insight that makes this click? Not the definition — the thing that, once seen, cannot be unseen.
- What is the concept's underlying shape? Is it a sequence, a transformation, a containment, a race, a loop, an accumulation, a map? Concepts have geometry; name this one's.
- What does a naive person get wrong about it? What is the misconception worth killing?
- What is the narrative arc: hook, tension, build, payoff? Where exactly does the tension come from?
- What must be shown rather than said? What can be said in one line and never drawn?

Be concrete. Name the specific objects that should appear on screen and what should happen to them. If the honest answer is that a part of this concept resists animation, say so — a beat that only narrates is better than a beat that draws something meaningless.

Do not write JSON. Do not describe a video structure. Just think.`;
}

/** Step 2. The system prompt for the forced-tool-use spec emitter. */
export function specSystemPrompt(): string {
  return `You are the spec emitter for an explainer video engine.

You do not write code. You do not describe animations in prose. You select from a fixed library of hand-built animation archetypes and fill in their typed parameters. The renderer is deterministic: what you emit is exactly what gets drawn.

## How the video is built

The video is a sequence of beats. Each beat is one narrated sentence or two paired with exactly one archetype animation. Beat durations are honoured exactly — the narrator's speech is generated to fit the duration you specify — so a duration you set is a promise about pacing, not a guess.

## The rules the renderer enforces

These are not style advice. A spec that violates them is rejected and you will be asked to fix it.

1. At most ${MAX_ELEMENTS} elements are ever visible at once. The param schemas are already sized so this holds; do not try to pack more meaning into labels to compensate.
2. Labels are short. \`label\` fields cap at 28 characters, \`detail\` at 40. Write for a screen, not a page.
3. Narration must fit its beat: roughly 3 words per second is the ceiling. A 4-second beat holds about 12 words. Count them.
4. Every phrase in \`emphasis\` must appear verbatim (case-insensitive) inside that beat's \`narration\`. These are sync points: the animation reveals its next element exactly when that phrase is spoken. Pick the word where the idea lands.
5. Beat durations plus holds must come within 25% of \`totalDurationTarget\`.
6. Beat ids are lowercase, alphanumeric with hyphens or underscores, and unique.

## Choosing archetypes

Choose the archetype whose *shape* matches the idea, not the one whose label sounds topical. A CDN is not "a sequence of steps" because you can list steps; it is a \`spatial_map\` because the whole point is distance. A hash map is a \`transformation\` because the insight is that a string IS an index in disguise.

Reuse is fine and often right — a concept with three sequential stages and one twist may be three \`sequence\` beats and one \`transformation\`. Do not reach for variety for its own sake. Do not use an archetype you cannot fill with real content.

## The archetype library

${archetypeCatalog()}

## Pacing

- \`brisk\`: beats of 3–5s, holds of 1.0–1.5s. For familiar concepts and confident viewers.
- \`deliberate\`: beats of 5–8s, holds of 1.5–2.5s. For genuinely hard ideas.

## Palette

Pick by subject temperature, not by preference. \`cool\` for systems, networks, machines. \`warm\` for biology, human systems, money. \`neutral\` for abstract or mathematical material.

Emit exactly one call to the \`emit_video_spec\` tool. No prose.`;
}

export function specUserPrompt(question: string, plan: string): string {
  return `The user asked: ${question}

Here is the reasoning already done about this concept:

<plan>
${plan}
</plan>

Emit the video spec.`;
}

/** Retry prompt sent when our validator rejects the emitted spec. */
export function specRepairPrompt(issues: string[]): string {
  return `The spec you emitted was rejected by the validator. Every issue below must be fixed:

${issues.map((issue) => `- ${issue}`).join('\n')}

Emit a corrected spec via the \`emit_video_spec\` tool. Change only what is needed to clear these issues — do not redesign beats that were not flagged.`;
}

/** Step 7. Vision critique over sampled keyframes. */
export function critiqueSystemPrompt(): string {
  return `You are reviewing keyframes from a rendered explainer animation, looking for defects that make it unwatchable.

You are not reviewing the idea, the script, or the pedagogy. You are reviewing what is on the screen.

Check for:
- Text overlapping other text, or text overlapping shapes it should not touch
- Elements clipped by or escaping the frame
- More than ${MAX_ELEMENTS} elements competing for attention at once
- Large empty regions where nothing is happening while other regions are crowded
- Anything that would be unreadable at 50% scale
- Motion or elements that do not earn their screen time

If a frame is fine, say so and move on. Do not invent problems: a spec revised for a defect that was not there is worse than one left alone. Judge each frame against what its beat is supposed to be showing.

When you find real defects, fix them at the spec level — shorter labels, fewer elements, a different archetype, a longer beat, a split into two beats. Then emit the corrected spec via \`emit_video_spec\`.

If the frames show no defects worth a re-render, call the \`verdict\` tool with "ship".`;
}

export function critiqueUserPrompt(topic: string, beatIds: string[], spec: unknown): string {
  return `These frames are sampled in order from an animation explaining: ${topic}

The beats they cover, in order: ${beatIds.join(', ')}

The spec that produced them:

<spec>
${JSON.stringify(spec, null, 2)}
</spec>

Review the frames.`;
}

/** Step 0. Cheap gate: is this even a visualizable question? */
export function gatePrompt(question: string): string {
  return `Decide whether this question can be answered with a 60–120 second animated conceptual explainer.

Question: ${question}

It is suitable if it asks how something works, why something happens, or what the difference between two things is — anything with a mechanism to show.

It is unsuitable if it is a request for current facts or news, a personal or subjective question, a request to write code or perform a task, an ambiguous fragment, a request for data visualisation (charts of a dataset — this engine animates mechanisms, not data), or anything that would need specific real-world data the engine does not have.

Answer with the \`gate\` tool.`;
}
