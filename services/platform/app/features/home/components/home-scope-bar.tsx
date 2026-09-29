'use client';

/**
 * The phone Home screen's scope bar: which project the stream is narrowed to,
 * a labelled way into that project's page, and a way back to everything.
 * It stands between the Projects block and the stream, so the narrowing is
 * never something you have to remember you did.
 */

import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';

import type { ChatProjectSummary } from '@/app/features/chat/types';
import { useT } from '@/lib/i18n/client';

export function HomeScopeBar({
  organizationId,
  project,
  onClear,
}: {
  organizationId: string;
  project: ChatProjectSummary;
  onClear: () => void;
}) {
  const { t } = useT('home');
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pt-1">
      <p
        role="status"
        className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
      >
        {t('scope.showing', { project: project.name })}
      </p>
      <Button
        asChild
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 px-2.5 text-xs"
      >
        <Link
          to="/dashboard/$id/projects/$projectId"
          params={{ id: organizationId, projectId: project.id }}
        >
          {t('scope.open')}
        </Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        className="h-8 shrink-0 px-2.5 text-xs"
      >
        {t('scope.clear')}
      </Button>
    </div>
  );
}
