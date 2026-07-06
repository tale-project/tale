// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { useTeamsTableConfig } from './use-teams-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

describe('useTeamsTableConfig', () => {
  // Regression for #2381: the Teams table renders under `SettingsPage`
  // (no `fitToContainer`), so it must NOT enable `stickyLayout`. A sticky inner
  // scroll container has no bounded-height ancestor here — it collapses to
  // content height and its `overscroll-contain` swallows the wheel over the
  // table, freezing the settings page. The page must own the vertical scroll.
  it('does not use the sticky scroll layout', () => {
    const { result } = renderHook(() => useTeamsTableConfig('org-1'), {
      wrapper: Providers,
    });

    expect(result.current.stickyLayout).toBe(false);
  });
});
