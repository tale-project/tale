import webuiPreset from '@tale/webui/tailwind-preset';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [webuiPreset],
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './node_modules/@tale/ui/src/**/*.{ts,tsx}',
    './node_modules/@tale/webui/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
};

export default config;
