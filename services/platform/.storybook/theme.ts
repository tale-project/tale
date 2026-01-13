import { create } from '@storybook/theming/create';

export const taleTheme = create({
  base: 'light',

  // Brand
  brandTitle: 'Tale Design System',
  brandUrl: 'https://tale.so',
  brandTarget: '_self',

  // Colors (from globals.css)
  colorPrimary: 'hsl(240 5.9% 10%)',
  colorSecondary: '#0561E6',

  // UI
  appBg: 'hsl(0 0% 98.8%)',
  appContentBg: 'hsl(0 0% 100%)',
  appBorderColor: 'hsl(240 5.9% 90%)',
  appBorderRadius: 8,

  // Typography
  fontBase: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',

  // Text
  textColor: 'hsl(240 10% 3.9%)',
  textInverseColor: 'hsl(0 0% 98%)',
  textMutedColor: 'hsl(240 3.8% 46.1%)',

  // Toolbar
  barTextColor: 'hsl(240 3.8% 46.1%)',
  barSelectedColor: '#0561E6',
  barBg: 'hsl(0 0% 100%)',

  // Form
  inputBg: 'hsl(0 0% 100%)',
  inputBorder: 'hsl(240 5.9% 90%)',
  inputTextColor: 'hsl(240 10% 3.9%)',
  inputBorderRadius: 8,
});

export const taleDarkTheme = create({
  base: 'dark',
  brandTitle: 'Tale Design System',
  colorPrimary: 'hsl(0 0% 98%)',
  colorSecondary: '#0561E6',
  appBg: 'hsl(240 10% 3.9%)',
  appContentBg: 'hsl(240 10% 3.9%)',
  appBorderColor: 'hsl(240 3.7% 15.9%)',
  appBorderRadius: 8,
  fontBase: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  textColor: 'hsl(0 0% 98%)',
  textMutedColor: 'hsl(240 5% 64.9%)',
  barBg: 'hsl(240 10% 3.9%)',
  inputBg: 'hsl(240 3.7% 15.9%)',
  inputBorder: 'hsl(240 3.7% 15.9%)',
  inputTextColor: 'hsl(0 0% 98%)',
});
