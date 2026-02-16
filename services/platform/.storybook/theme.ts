import { create } from 'storybook/theming/create';

const shared = {
  brandTitle: 'Tale UI',
  brandUrl: 'https://tale.dev',
  brandTarget: '_self' as const,
  appBorderRadius: 8,
  fontBase: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  inputBorderRadius: 8,
};

export const taleLightTheme = create({
  base: 'light',
  ...shared,
  colorPrimary: 'hsl(240 5.9% 10%)',
  colorSecondary: '#0561E6',
  appBg: 'hsl(0 0% 98.8%)',
  appContentBg: 'hsl(0 0% 100%)',
  appBorderColor: 'hsl(240 5.9% 90%)',
  textColor: 'hsl(240 10% 3.9%)',
  textInverseColor: 'hsl(0 0% 98%)',
  textMutedColor: 'hsl(240 3.8% 46.1%)',
  barTextColor: 'hsl(240 3.8% 46.1%)',
  barSelectedColor: '#0561E6',
  barBg: 'hsl(0 0% 100%)',
  inputBg: 'hsl(0 0% 100%)',
  inputBorder: 'hsl(240 5.9% 90%)',
  inputTextColor: 'hsl(240 10% 3.9%)',
});

export const taleDarkTheme = create({
  base: 'dark',
  ...shared,
  colorPrimary: 'hsl(0 0% 98%)',
  colorSecondary: '#0561E6',
  appBg: 'hsl(240 10% 3.9%)',
  appContentBg: 'hsl(240 10% 3.9%)',
  appBorderColor: 'hsl(240 3.7% 15.9%)',
  textColor: 'hsl(0 0% 98%)',
  textInverseColor: 'hsl(240 10% 3.9%)',
  textMutedColor: 'hsl(240 5% 64.9%)',
  barTextColor: 'hsl(240 5% 64.9%)',
  barSelectedColor: '#0561E6',
  barBg: 'hsl(240 10% 3.9%)',
  inputBg: 'hsl(240 3.7% 15.9%)',
  inputBorder: 'hsl(240 3.7% 15.9%)',
  inputTextColor: 'hsl(0 0% 98%)',
});

export const taleTheme = taleLightTheme;
