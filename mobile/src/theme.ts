export const colors = {
  primary: '#0B3B2E',
  primaryLight: '#14614A',
  accent: '#C9A227',

  background: '#F4F6F5',
  surface: '#FFFFFF',
  surfaceMuted: '#EDF1EF',

  text: '#12211C',
  textMuted: '#5C6B65',
  textInverse: '#FFFFFF',

  border: '#DCE3E0',

  credit: '#1B7F4F',
  debit: '#B3261E',
  warning: '#8A6100',
  warningSurface: '#FFF4D6',
} as const;

export const spacing = {
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

export const typography = {
  display: { fontSize: 34, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;
