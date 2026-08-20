/**
 * Spec and timeline fixtures. Deliberately free of imports so they can be
 * exercised directly against the real validators in `@explainer/spec`.
 */

/** A spec that survives `parseVideoSpec`: 4 beats, 7.5s each, 30s target. */
export function validSpec(topic = 'How a packet reaches a server') {
  const beat = (id: string, narration: string, emphasis: string[]) => ({
    id,
    narration,
    durationSeconds: 6,
    archetype: 'sequence' as const,
    params: { steps: [{ label: 'Laptop' }, { label: 'Router' }, { label: 'Server' }] },
    emphasis,
    emotion: 'neutral' as const,
    holdAfterSeconds: 1.5,
  });

  return {
    topic,
    arc: 'walkthrough' as const,
    palette: 'cool' as const,
    pacing: 'brisk' as const,
    totalDurationTarget: 30,
    beats: [
      beat('intro', 'A packet leaves your laptop and starts its journey.', ['packet']),
      beat('hop', 'It hops through a router that reads the address.', ['router']),
      beat('route', 'Each hop moves the packet closer to the server.', ['closer']),
      beat('arrive', 'The server receives it and sends a reply back.', ['reply']),
    ],
  };
}

/** A timeline matching `validSpec`, for the given spec hash. */
export function validTimeline(specHash: string) {
  const beats = ['intro', 'hop', 'route', 'arrive'].map((beatId, index) => ({
    beatId,
    startSeconds: index * 7.5,
    audioSeconds: 6,
    holdSeconds: 1.5,
    audioPath: `beats/${beatId}.wav`,
    words: [],
    cues: [],
  }));
  return {
    specHash,
    engine: 'kokoro' as const,
    fps: 30,
    totalSeconds: 30,
    audioPath: 'narration.wav',
    beats,
  };
}
