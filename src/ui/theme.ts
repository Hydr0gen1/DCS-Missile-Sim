/**
 * App theme — Claude Desktop dark mode aesthetic.
 * Deep navy background, warm orange accent, soft lavender text.
 */
export const T = {
  // Backgrounds
  bgBase:    '#13131e',   // deepest background
  bgSurface: '#1e1e2e',   // panels / cards
  bgRaised:  '#26263a',   // inputs, buttons
  bgHover:   '#30304a',   // hover states

  // Borders
  border:    '#32324a',
  borderDim: '#22222e',

  // Text
  textBright: '#e2e2ee',
  text:       '#b8b8d0',
  textDim:    '#6a6a88',
  textFaint:  '#3a3a55',

  // Accents — Claude orange/amber
  accent:    '#d4845a',
  accentBright: '#e8a080',
  accentDim: '#7a4a30',

  // Semantic
  success:   '#4aaa7a',
  successDim: '#2a6a4a',
  danger:    '#e05555',
  dangerDim: '#7a2222',
  warning:   '#d4845a',  // same as accent
  info:      '#5a9ad4',

  // Type colors
  typeARH:   '#5a9ad4',
  typeSARH:  '#d4a45a',
  typeIR:    '#e06060',

  // Fonts
  fontMono:  '"Share Tech Mono", "Courier New", monospace',
  fontUI:    '"Inter", "Segoe UI", system-ui, sans-serif',
} as const;
