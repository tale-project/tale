import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';

import '../src/globals.css';

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
