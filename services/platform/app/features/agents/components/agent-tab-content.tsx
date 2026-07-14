'use client';

import type { ReactNode } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';

/**
 * Shared body wrapper for every agent-editor tab — one place for the measure
 * and rhythm (the same max-w-3xl reading width as the settings pages, #2567)
 * instead of a hand-copied `ContentArea` literal per tab. Tabs carry NO page
 * title: the tab strip already names the tab, the same rule the settings
 * pages follow (`SettingsPage`).
 */
export function AgentTabContent({ children }: { children: ReactNode }) {
  return (
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      {children}
    </ContentArea>
  );
}
