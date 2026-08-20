import { Config } from '@remotion/cli/config';

/**
 * CLI defaults. Frame size and fps are properties of the composition, not of
 * the config, so the canonical 1920x1080 @ 30fps lives in `src/theme.ts`
 * (`VIDEO`) and is applied by `src/Root.tsx`. Everything below is output
 * encoding, which the CLI does own.
 */

Config.setEntryPoint('./src/index.ts');

// H.264 in an mp4, high quality. CRF 16 is visually lossless for flat vector
// animation without blowing the file up; yuv420p keeps it playable everywhere.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setAudioCodec('aac');

Config.setOverwriteOutput(true);

// The Manim beats arrive as alpha WebMs; ANGLE is the renderer that handles
// them reliably across Windows and Linux workers.
Config.setChromiumOpenGlRenderer('angle');
