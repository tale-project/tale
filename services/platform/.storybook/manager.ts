import { addons } from '@storybook/manager-api';

import { taleTheme } from './theme';

addons.setConfig({
  theme: taleTheme,
  sidebar: {
    showRoots: true,
    collapsedRoots: ['other'],
  },
});
