import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS v4 Configuration
 *
 * Theme customizations are now in globals.css using @theme directive.
 * This config file is kept for content scanning and dark mode configuration.
 */
export default {
  darkMode: ['class', '.dark'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
  ],
} satisfies Config;
