'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import { useApps } from './use-apps';

/**
 * Resolve an app's pack label catalog for a locale, with graceful fallback:
 * exact locale → base language (de-CH → de) → en → empty. Pure, so the app shell
 * (which already has the app doc) and the run-view hook share one rule.
 */
export function resolvePackLabels(
  messages: Record<string, Record<string, string>> | undefined,
  locale: string,
): Record<string, string> {
  if (!messages) return {};
  return (
    messages[locale] ?? messages[locale.split('-')[0]] ?? messages.en ?? {}
  );
}

/**
 * An installed app's pack label catalog for the ACTIVE locale. The single source
 * of `AppRuntime.labels`, so the app shell AND the run view resolve `ui.labelKey`
 * against the same catalog (the run view previously had none, so pack labels
 * silently fell back to verbose raw step names).
 */
export function useAppPackLabels(
  organizationId: string,
  appSlug: string,
): { labels: Record<string, string>; isLoading: boolean } {
  const { locale } = useLocale();
  const { apps, isLoading } = useApps(organizationId);
  const messages = apps.find((a) => a.slug === appSlug)?.messages;
  const labels = useMemo<Record<string, string>>(
    () => resolvePackLabels(messages, locale),
    [messages, locale],
  );
  return { labels, isLoading };
}
