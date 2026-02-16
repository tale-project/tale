import { addons } from 'storybook/manager-api';

import { taleTheme } from './theme';

addons.setConfig({
  theme: taleTheme,
  enableShortcuts: true,
  showPanel: true,
  sidebar: {
    showRoots: true,
    collapsedRoots: ['other'],
  },
});
