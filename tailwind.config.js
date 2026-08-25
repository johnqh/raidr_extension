import { createTailwindPreset } from '@sudobility/design';

/** @type {import('tailwindcss').Config} */
export default {
  // Maps the design system's semantic tokens (bg-primary, border-border,
  // text-destructive, ...) to hsl(var(--primary)) etc. The values come from
  // src/sidepanel/index.css, so library components and semantic utilities are
  // theme-aware and follow the browser's light/dark preference.
  presets: [createTailwindPreset()],
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,html}',
    './node_modules/@sudobility/components/dist/**/*.{js,jsx,ts,tsx}',
    './node_modules/@sudobility/design/dist/**/*.{js,jsx,ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
};
