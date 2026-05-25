import type { Preview } from '@storybook/react';
import { sharedStorybookPreview } from '@tale/ui/storybook/preview';

import '../app/globals.css';
// Bootstrap i18n so component stories that call `useT(...)` resolve real
// docs translations instead of the raw key names.
import '../lib/i18n/i18n';

const preview: Preview = sharedStorybookPreview;

export default preview;
