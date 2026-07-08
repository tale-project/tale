'use client';

/**
 * Registry of platform-rendered ("builtin") views an automation manifest can opt
 * into via `builtinViews: [{ id }]` (schema:
 * `lib/shared/schemas/automations.ts#automationBuiltinViewSchema` — a CLOSED id enum, so
 * the schema and this map grow together). The automation page renders these BEFORE
 * any bundled JSON views; each entry's title/description come from the
 * platform catalog, never from bundle labels — builtin views are platform UI.
 */
import type { ComponentType } from 'react';

import { useT } from '@/lib/i18n/client';
import type { AutomationBuiltinView } from '@/lib/shared/schemas/automations';

import type { AutomationSummary } from '../hooks/use-automations';
import { InboxView } from './inbox-view';

export interface BuiltinViewProps {
  /** The hosting automation — builtin views derive their scope (e.g. the provider
   *  integration) from the manifest instead of duplicating it as config. */
  automation: AutomationSummary;
}

export type BuiltinViewId = AutomationBuiltinView['id'];

export const BUILTIN_VIEW_COMPONENTS: Record<
  BuiltinViewId,
  ComponentType<BuiltinViewProps>
> = {
  inbox: InboxView,
};

/** Narrow a manifest-declared id to one this platform build can render. */
export function isBuiltinViewId(id: string): id is BuiltinViewId {
  return id in BUILTIN_VIEW_COMPONENTS;
}

/** The renderable builtin views a summary declares, in manifest order. */
export function knownBuiltinViews(
  views: AutomationBuiltinView[] | undefined,
): AutomationBuiltinView[] {
  return (views ?? []).filter((view) => isBuiltinViewId(view.id));
}

interface BuiltinViewMeta {
  title: string;
  description: string;
}

function metaOf(
  id: BuiltinViewId,
  t: (key: string) => string,
): BuiltinViewMeta {
  switch (id) {
    case 'inbox': {
      return { title: t('inbox.title'), description: t('inbox.description') };
    }
    default: {
      // Exhaustiveness: a new registry id without a header fails to compile.
      const unhandled: never = id;
      throw new Error(`Unknown builtin view: ${String(unhandled)}`);
    }
  }
}

/** A builtin view's localized header (platform catalog, not bundle labels). */
export function useBuiltinViewMeta(id: BuiltinViewId): BuiltinViewMeta {
  const { t } = useT('automations');
  return metaOf(id, t);
}

/** Localized titles for the pre-install "Pages" chips, in manifest order. */
export function useBuiltinViewTitles(
  views: AutomationBuiltinView[] | undefined,
): string[] {
  const { t } = useT('automations');
  return knownBuiltinViews(views).map((view) => metaOf(view.id, t).title);
}
