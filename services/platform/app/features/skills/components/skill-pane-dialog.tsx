'use client';

import { useCallback } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';

import { SkillDetailPane } from './skill-detail-pane';

/**
 * Full-size skill editor: file tree + editor side by side. Fixed height so
 * the frame doesn't jump when switching between files or sections.
 */
export function SkillDetailDialog({
  organizationId,
  slug,
  onClose,
}: {
  organizationId: string;
  slug: string;
  onClose: () => void;
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
