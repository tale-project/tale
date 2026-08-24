'use client';

/**
 * Provisional CHATS-row shown while the composer is on a fresh (not-yet-
 * created) conversation. The quiet gray leading dot is the draft marker —
 * real threads only light blue (streaming) or green (unread).
 */

import { Link } from '@tanstack/react-router';

import {
  SUB_PANEL_ROW_CLASS,
  useSubPanelRowTreatment,
} from '@/app/components/layout/sub-panel-list';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface NewChatDraftRowProps {
  organizationId: string;
  /** When set, the draft is scoped to a project's New-chat flow. */
  projectId?: string;
}

export function NewChatDraftRow({
  organizationId,
  projectId,
}: NewChatDraftRowProps) {
  const { t } = useT('chat');
  const treatment = useSubPanelRowTreatment(true);

  return (
    <li className="relative flex items-center rounded-md">
      <Link
        to="/dashboard/$id/chat"
        params={{ id: organizationId }}
        search={
          projectId !== undefined ? { projectId, new: true } : { new: true }
        }
        aria-current="page"
        aria-label={t('newChat')}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'min-w-0 flex-1 gap-1.5',
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        <span
          aria-hidden
          className="bg-muted-foreground/50 size-2 shrink-0 rounded-full"
        />
        <span className="truncate leading-snug">{t('newChat')}</span>
      </Link>
    </li>
  );
}
