'use client';

import { ContentArea } from '@tale/ui/content-area';
import type { ReactNode } from 'react';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsPageTitleProvider } from '@/app/features/settings/components/settings-page-title';

/**
 * The frame of a project tab that is a settings form (General, Environment):
 * the general settings page in the tab's content area — the composition
 * Settings uses (routes/dashboard/$id/settings.tsx) — so a project's settings
 * read as the same system as the organization's: one column, one section
 * rhythm, one row layout (#2794). Tabs that are not forms (Tasks, Chats,
 * Knowledge, Agents, Dispatch) keep frames of their own.
 *
 * `title` is the open tab's label. The tab strip names the page the way the
 * settings header does, so a first section titled the same keeps its heading
 * for assistive tech and lets its description lead.
 */
export function ProjectSettingsPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <ContentArea>
      <SettingsPageTitleProvider value={title}>
        <SettingsPage>{children}</SettingsPage>
      </SettingsPageTitleProvider>
    </ContentArea>
  );
}
