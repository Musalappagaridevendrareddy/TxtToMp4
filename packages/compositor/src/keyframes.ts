import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Sample stills out of a finished render so the Phase-5 vision critique has
 * something to look at.
 *
 * ponytail: shells out to the system ffmpeg rather than pulling in a wrapper
 * library. Override with FFMPEG_PATH / FFPROBE_PATH when the worker image puts
 * them somewhere unusual.
 */
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export async function probeDurationSeconds(videoPath: string): Promise<number> {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe could not read a duration from ${videoPath}`);
  }
  return duration;
}

/**
 * Timestamps of `count` evenly spaced samples across `duration`.
 *
 * Sampling at the midpoint of each slice rather than at its edge keeps the
 * first and last frames -- which are a fade-in and a fade-out -- out of the
 * sample set.
 */
export function keyframeTimestamps(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
}

/**
 * Extract `count` evenly spaced PNGs from `videoPath` into `outDir`.
 * Returns the written paths, in chronological order.
 */
export async function extractKeyframes(
  videoPath: string,
  outDir: string,
  count: number,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${String(count)}`);
  }

  await mkdir(outDir, { recursive: true });
  const duration = await probeDurationSeconds(videoPath);
  const timestamps = keyframeTimestamps(duration, count);
  const width = String(timestamps.length).length;

  const outputs: string[] = [];
  for (const [index, at] of timestamps.entries()) {
    const outPath = path.join(outDir, `keyframe-${String(index + 1).padStart(width, '0')}.png`);
    // -ss before -i seeks by keyframe index, which is both fast and accurate
    // enough for a critique pass over a 30fps render.
    await run(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      at.toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      outPath,
    ]);
    outputs.push(outPath);
  }

  return outputs;
}
