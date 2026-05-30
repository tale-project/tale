'use client';

import { IconButton } from '@tale/ui/icon-button';
import { useLocation, useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Bottom-nav-reachable destinations under `/dashboard/$id/`. A route at one of
 * these paths is "top-level" — no back button. Any deeper path is a sub-page
 * (project detail, agent detail, settings, conversation thread, …) and shows a
 * back button on the left of the mobile top bar.
 *
 * Conversations are keyed by status (`open` / `closed` / `spam` / `archived`)
 * so all of them count as top-level.
 */
const TOP_LEVEL_SUFFIXES = new Set([
  '',
  'chat',
  'projects',
  'conversations/open',
  'conversations/closed',
  'conversations/spam',
  'conversations/archived',
  'agents',
  'documents',
  'automations',
]);

interface MobileBackButtonProps {
  organizationId: string;
}

/**
 * Renders an iOS-style back chevron on the left of the mobile top bar for
 * sub-pages only. Prefers `router.history.back()` when there's app history,
 * else falls back to the natural parent route — so deep links from
 * notifications/email don't strand the user.
 */
export function MobileBackButton({ organizationId }: MobileBackButtonProps) {
  const location = useLocation();
  const router = useRouter();
  const { t } = useT('common');

  const orgRoot = `/dashboard/${organizationId}`;
  const pathSuffix = useMemo(() => {
    if (!location.pathname.startsWith(orgRoot)) return null;
    const tail = location.pathname.slice(orgRoot.length);
    return tail.startsWith('/') ? tail.slice(1) : tail;
  }, [location.pathname, orgRoot]);

  const isTopLevel = pathSuffix === null || TOP_LEVEL_SUFFIXES.has(pathSuffix);

  const handleBack = useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }
    // No app history (deep-link entry). Fall back to one path segment up, so
    // e.g. `/projects/abc/files` goes to `/projects/abc`, not all the way to
    // the org root.
    if (!pathSuffix) {
      router.history.push(orgRoot);
      return;
    }
    const segments = pathSuffix.split('/');
    segments.pop();
    const parent = segments.join('/');
    router.history.push(parent ? `${orgRoot}/${parent}` : orgRoot);
  }, [router, pathSuffix, orgRoot]);

  if (isTopLevel) return null;

  return (
    <IconButton
      icon={ChevronLeft}
      aria-label={t('aria.back')}
      onClick={handleBack}
    />
  );
}
