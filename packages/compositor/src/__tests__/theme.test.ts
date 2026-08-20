import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PALETTES, PALETTE_KEYS, PALETTE_NAMES } from '../theme';

/**
 * The compositor's palettes and the Manim palettes have to be byte-identical:
 * the beats are drawn in Python and composited on a background painted here, so
 * any drift shows up as a visible seam.
 *
 * This test reads the Python file and parses the hex values out of it rather
 * than duplicating them, so it cannot go stale the way a copied table would.
 */

const PYTHON_THEME = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'manim-scenes',
  'manim_scenes',
  'theme.py',
);

/**
 * Pull `{"cool": {"bg": "#0B1220", ...}, ...}` out of Python source.
 * Accepts both dict-literal (`"bg": "#..."`) and keyword (`bg="#..."`) styles.
 */
export function parsePythonPalettes(source: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const blockPattern = new RegExp(
    `["'](${PALETTE_NAMES.join('|')})["']\\s*:\\s*(?:[A-Za-z_][A-Za-z0-9_.]*\\s*\\()?\\{?([^{}()]*)`,
    'g',
  );

  for (const block of source.matchAll(blockPattern)) {
    const name = block[1]!;
    const body = block[2] ?? '';
    const colours: Record<string, string> = {};

    const entryPattern = /(?:["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:|([A-Za-z_][A-Za-z0-9_]*)\s*=)\s*["'](#[0-9a-fA-F]{6})["']/g;
    for (const entry of body.matchAll(entryPattern)) {
      const key = entry[1] ?? entry[2]!;
      colours[key] = entry[3]!.toUpperCase();
    }

    if (Object.keys(colours).length > 0) {
      result[name] = colours;
    }
  }

  return result;
}

test('the compositor palettes match packages/manim-scenes/manim_scenes/theme.py', (t) => {
  if (!existsSync(PYTHON_THEME)) {
    t.skip(
      `${PYTHON_THEME} does not exist yet. The Manim theme is written by the ` +
        'manim-scenes package; this test starts enforcing parity the moment it lands.',
    );
    return;
  }

  const parsed = parsePythonPalettes(readFileSync(PYTHON_THEME, 'utf8'));

  assert.deepEqual(
    Object.keys(parsed).sort(),
    [...PALETTE_NAMES].sort(),
    'the Python theme must define exactly the palettes cool, warm and neutral',
  );

  for (const name of PALETTE_NAMES) {
    const python = parsed[name]!;
    const typescript = PALETTES[name];

    assert.deepEqual(
      Object.keys(python).sort(),
      [...PALETTE_KEYS].sort(),
      `palette "${name}" has different keys in Python and TypeScript`,
    );

    for (const key of PALETTE_KEYS) {
      assert.equal(
        python[key],
        typescript[key].toUpperCase(),
        `palette "${name}".${key} differs: python ${String(python[key])} vs ts ${typescript[key]}`,
      );
    }
  }
});

test('the parser reads a dict-literal Python theme', () => {
  const parsed = parsePythonPalettes(`
PALETTES: dict[str, dict[str, str]] = {
    "cool": {
        "bg": "#0b1220",
        "primary": "#6FD3F7",
        "secondary": "#7C9CF5",
        "accent": "#4AE3B5",
        "muted": "#93A4C0",
    },
    "warm": {"bg": "#1A100D", "primary": "#FFB05C", "secondary": "#F2765E", "accent": "#FFD98E", "muted": "#C3A18C"},
}
`);

  assert.equal(parsed['cool']?.bg, '#0B1220');
  assert.equal(parsed['cool']?.accent, '#4AE3B5');
  assert.equal(parsed['warm']?.muted, '#C3A18C');
});

test('the parser reads a keyword-argument Python theme', () => {
  const parsed = parsePythonPalettes(`
PALETTES = {
    "neutral": Palette(bg="#101214", primary="#E8E6E1", secondary="#A8A6A1", accent="#D8B26A", muted="#6E6C68"),
}
`);

  assert.deepEqual(parsed['neutral'], {
    bg: '#101214',
    primary: '#E8E6E1',
    secondary: '#A8A6A1',
    accent: '#D8B26A',
    muted: '#6E6C68',
  });
});

test('every TypeScript palette defines every key as a six-digit hex', () => {
  for (const name of PALETTE_NAMES) {
    for (const key of PALETTE_KEYS) {
      assert.match(PALETTES[name][key], /^#[0-9A-F]{6}$/, `${name}.${key} must be #RRGGBB`);
    }
  }
});
