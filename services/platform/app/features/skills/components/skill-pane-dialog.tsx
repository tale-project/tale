'use client';

import { Dialog } from '@tale/ui/dialog/dialog';
import { useCallback, type RefObject } from 'react';

import { SkillDetailPane } from './skill-detail-pane';

/**
 * Full-size skill editor: file tree + editor side by side. Fixed height so
 * the frame doesn't jump when switching between files or sections.
 */
export function SkillDetailDialog({
  organizationId,
  slug,
  onClose,
  restoreFocusRef,
}: {
  organizationId: string;
  slug: string;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );

  return (
    <Dialog
      open
      onOpenChange={handleOpenChange}
      title={slug}
      size="3xl"
      restoreFocusRef={restoreFocusRef}
      className="md:h-[85dvh] md:max-h-[85dvh]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <SkillDetailPane
          organizationId={organizationId}
          slug={slug}
          onDeleted={onClose}
          onClose={onClose}
        />
      </div>
    </Dialog>
  );
}
