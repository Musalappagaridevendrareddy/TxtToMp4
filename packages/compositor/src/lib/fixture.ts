import type { ExplainerProps, ExplainerBeatTimeline, CaptionWord } from './props';
import { ExplainerPropsSchema } from './props';

/**
 * A sample timeline shaped exactly like a real WhisperX output, so Studio opens
 * on something with real word timings instead of an empty canvas. `assets` are
 * blank on purpose: there is no media on disk in a fresh checkout, and blank
 * paths make the components skip the media rather than fail to load it.
 */

const WORDS_PER_SECOND = 2.9;

/** Lay a narration line out at a steady rate, with a small gap between words. */
function layOutWords(narration: string, startSeconds: number): CaptionWord[] {
  const tokens = narration.trim().split(/\s+/);
  const perWord = 1 / WORDS_PER_SECOND;
  const gap = perWord * 0.12;

  return tokens.map((token, index) => {
    const start = startSeconds + index * perWord;
    return {
      word: token,
      start: Number(start.toFixed(3)),
      end: Number((start + perWord - gap).toFixed(3)),
      score: 0.94,
    };
  });
}

interface DraftBeat {
  beatId: string;
  narration: string;
  holdSeconds: number;
}

const DRAFT_BEATS: DraftBeat[] = [
  {
    beatId: 'hook',
    narration: 'A hash map promises constant time lookups, but nothing is actually instant.',
    holdSeconds: 1.5,
  },
  {
    beatId: 'the-hash',
    narration: 'A hash function turns the key apple into a bucket index, every single time.',
    holdSeconds: 1.2,
  },
  {
    beatId: 'collision',
    narration: 'Two different keys can land in the same bucket, and that is a collision.',
    holdSeconds: 1.5,
  },
  {
    beatId: 'probe',
    narration: 'So the table probes the next slot, and the next, until it finds an empty one.',
    holdSeconds: 1.8,
  },
  {
    beatId: 'payoff',
    narration: 'Constant time is really a promise about the average, not about any one lookup.',
    holdSeconds: 2,
  },
];

function buildBeats(): ExplainerBeatTimeline[] {
  const beats: ExplainerBeatTimeline[] = [];
  let cursor = 0.4; // small lead-in of silence on the narration track

  for (const draft of DRAFT_BEATS) {
    const words = layOutWords(draft.narration, cursor);
    const last = words[words.length - 1];
    const audioSeconds = Number(((last?.end ?? cursor) - cursor).toFixed(3));

    beats.push({
      beatId: draft.beatId,
      startSeconds: Number(cursor.toFixed(3)),
      audioSeconds,
      holdSeconds: draft.holdSeconds,
      words,
    });
    cursor = Number((cursor + audioSeconds + draft.holdSeconds).toFixed(3));
  }

  return beats;
}

function buildFixture(): ExplainerProps {
  const beats = buildBeats();
  const last = beats[beats.length - 1]!;

  return ExplainerPropsSchema.parse({
    spec: { topic: 'Why hash maps are fast', palette: 'cool' },
    timeline: {
      fps: 30,
      totalSeconds: Number((last.startSeconds + last.audioSeconds + last.holdSeconds).toFixed(3)),
      beats,
    },
    assets: { beatsDir: '', audio: '' },
    kicker: 'An explainer',
  } satisfies ExplainerProps);
}

export const SAMPLE_PROPS: ExplainerProps = buildFixture();
