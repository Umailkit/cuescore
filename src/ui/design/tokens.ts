/**
 * Programmatic design tokens (mirror of the CSS variables in index.css).
 * Use these in canvas/SVG/inline-style contexts where Tailwind classes can't reach
 * (e.g. snooker ball rendering, charts). Keep them in sync with index.css.
 */
export const palette = {
  dark: {
    bg: '#0a120f',
    surface: '#101a16',
    surface2: '#18251f',
    border: '#26362e',
    text: '#e8f0eb',
    muted: '#96aaa0',
    felt: '#1f7a4d',
    feltStrong: '#1a915c',
    gold: '#d4af37',
    danger: '#c83c3c',
  },
  light: {
    bg: '#f4f7f5',
    surface: '#ffffff',
    surface2: '#f0f4f2',
    border: '#d6deda',
    text: '#121c18',
    muted: '#5a6962',
    felt: '#16704c',
    feltStrong: '#128450',
    gold: '#b48c1e',
    danger: '#be3232',
  },
} as const;

/** Snooker ball colors, indexed by point value (used by the snooker engine/UI later). */
export const SNOOKER_BALL_COLORS: Record<number, string> = {
  1: '#e03a2f', // red
  2: '#f2c40d', // yellow
  3: '#1f9e4a', // green
  4: '#8a5a2b', // brown
  5: '#2f6fd6', // blue
  6: '#d63a8f', // pink
  7: '#1a1a1a', // black
};

export const THEME_COLOR = '#0b3d2e';
