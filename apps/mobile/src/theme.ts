/**
 * Greyscale tokens matching "Life OS — Low-fi Wireframes v1".
 * No brand colour yet — the wireframes are greyscale on purpose. System font throughout.
 */
export const colors = {
  background: '#FFFFFF',
  text: '#111111',
  textSecondary: '#5C5C5C',
  textTertiary: '#8A8A8A',
  fill: '#1C1C1C',
  fillMuted: '#BDBDBD',
  track: '#E6E6E6',
  card: '#F2F2F2',
  border: '#DADADA',
  divider: '#E8E8E8',
  inverseText: '#FFFFFF',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Apple HIG minimum touch target. */
export const MIN_TOUCH = 44;

export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.2 },
  title: { fontSize: 22, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  callout: { fontSize: 15, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  overline: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 1 },
};
