'use client';

import { SegmentedControl } from '@tale/ui/segmented-control';
import {
  Inbox,
  Layers,
  ListChecks,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import type { HomeView } from '../lib/home-items';

export interface HomeViewOption {
  readonly view: HomeView;
  /** Items in this view waiting on the caller — shown as a quiet dot.
   * `null` when the read behind them failed: no dot claims a count. */
  readonly attention: number | null;
}

/** The glyph each view is known by: a chat's bubble as on its rows, the
 * Tasks view's checklist and the Inbox's tray as on their empty states. */
const VIEW_ICONS: Record<HomeView, LucideIcon> = {
  all: Layers,
  chats: MessageCircle,
  tasks: ListChecks,
  inbox: Inbox,
};

/**
 * All · Chats · Tasks · Inbox — which kind of work the Home stream shows.
 * One icon per view, and only the open view's name beside its icon: a long
 * label (Aufgaben, Réception) never has to share the row with the others,
 * and another view costs an icon rather than a word. A radio group, so the
 * arrow keys move between views, and every view is named in full.
 */
export function HomeViewSwitcher({
  value,
  options,
  onChange,
}: {
  value: HomeView;
  options: readonly HomeViewOption[];
  onChange: (view: HomeView) => void;
}) {
  const { t } = useT('home');
  return (
    <SegmentedControl
      aria-label={t('views.label')}
      labels="selected"
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.view === next);
        if (option !== undefined) onChange(option.view);
      }}
      options={options.map((option) => ({
        value: option.view,
        label: t(`views.${option.view}`),
        icon: VIEW_ICONS[option.view],
        ...(option.attention !== null && option.attention > 0
          ? { attention: t('aria.attention', { count: option.attention }) }
          : {}),
      }))}
    />
  );
}
