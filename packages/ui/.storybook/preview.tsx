import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';
import { useMemo } from 'react';
import type { DecoratorFunction } from 'storybook/internal/types';

import { ThemeContext } from '../src/theme';

import '../src/globals.css';
import '../src/markdown/globals.css';

/**
 * Bridge addon-themes' html-class toggle into the React `ThemeContext` so
 * components reading `useTheme()` (CodeBlock, Mermaid, etc.) see the same
 * state Storybook shows. Without this, `resolvedTheme` is pinned to
 * `'light'` even when the iframe has `.dark` on `<html>`.
 */
function WithTheme({
  Story,
  context,
}: {
  Story: Parameters<DecoratorFunction>[0];
  context: Parameters<DecoratorFunction>[1];
}) {
  const resolvedTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
  const value = useMemo(
    () => ({
      theme: resolvedTheme,
      resolvedTheme,
      setTheme: () => {},
    }),
    [resolvedTheme],
  );
  return (
    <ThemeContext.Provider value={value}>
      <Story />
    </ThemeContext.Provider>
  );
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'centered',
    a11y: {
      options: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
        },
      },
    },
  },
  decorators: [
    (Story, context) => <WithTheme Story={Story} context={context} />,
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
  initialGlobals: {
    theme: 'light',
  },
};

export default preview;
