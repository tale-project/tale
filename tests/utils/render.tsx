import { AppShell } from '@tale/ui/app-shell';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';
import type { RenderOptions } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

import { marketingUiMessages } from '../../src/i18n/messages';

// The two design-system catalogs are the only ones a component test needs:
// every string a shipped component renders lives in `@tale/ui` or this
// package's `src/i18n/messages`. Services layer their catalogs on top of
// these at runtime, so a key missing here fails the test the same way it
// would fail a standalone consumer.
const i18n = initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages, marketingUiMessages],
});

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: AllProviders, ...options }),
  };
}

export * from '@testing-library/react';
export { customRender as render };
