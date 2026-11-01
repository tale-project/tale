'use client';

import { ContentArea } from '@tale/ui/content-area';
import type { ReactNode } from 'react';

import { SettingsPage } from './settings-page';
import { SettingsPageTitleProvider } from './settings-page-title';

/**
 * The frame of a tab that is a settings form — a project's General and
 * Environment, an automation's General: the general settings page in the
 * tab's content area — the composition Settings uses
 * (routes/dashboard/$id/settings.tsx) — so what a project or an automation
 * configures reads as the same system as the organization's: one column, one
 * section rhythm, one row layout (#2794).
 *
 * Pages that are not forms keep frames of their own: a project's Tasks (a
 * board), Chats, Knowledge, Agents and Dispatch (lists and dashboards); an
 * automation's Editor (the canvas and its inspector panels), Runs and
 * Versions (lists, a run, a comparison); the automations' Metrics (a
 * dashboard). A form in a dialog — an automation's settings, for one — keeps
 * the dialog's stacked fields.
 *
 * `title` is the open tab's label. The tab strip names the page the way the
 * settings header does, so a first section titled the same keeps its heading
 * for assistive tech and lets its description lead.
 */
export function SettingsTabPage({
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
