'use client';

import { useCallback, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

import { useSkills } from '../hooks/queries';
import { SkillCreatePane } from './skill-create-pane';
import { SkillDetailPane } from './skill-detail-pane';
import {
  SkillLibraryCatalog,
  type SkillAddChoice,
} from './skill-library-catalog';
import { SkillUploadPane } from './skill-upload/skill-upload-pane';

type LibraryView =
  | { view: 'list' }
  | { view: 'create' }
  | { view: 'upload'; mode: 'zip' | 'folder' }
  | { view: 'detail'; slug: string };

/**
 * The skill library, opened from the chat composer's "+" menu — the ONE
 * management surface for skills: browse and search what you may use, create
 * a text-based skill, upload a bundle (zip or folder), inspect a bundle's
 * files, edit, share, delete. One wide dialog with an internal pane switch;
 * only confirm dialogs stack on top.
 */
export function SkillLibraryDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('skills');
  const [view, setView] = useState<LibraryView>({ view: 'list' });
  const skillsQuery = useSkills(organizationId);
  const existingSlugs = (skillsQuery.data?.skills ?? []).map(
    (skill: { slug: string }) => skill.slug,
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setView({ view: 'list' });
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const backToList = useCallback(() => setView({ view: 'list' }), []);

  const handleAdd = useCallback((choice: SkillAddChoice) => {
    if (choice.kind === 'blank') setView({ view: 'create' });
    else setView({ view: 'upload', mode: choice.mode });
  }, []);

  const title =
    view.view === 'list'
      ? t('library.title')
      : view.view === 'create'
        ? t('createDialog.title')
        : view.view === 'upload'
          ? t('upload.dialogTitle')
          : view.slug;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      // The settings measure, not `wide`: the library is a card catalog like the
      // settings catalogs, and at 1100px its two-line cards floated in space.
      size="3xl"
      // Fixed height, same as the expanded notifications panel: every pane
      // (list, create, upload, detail) fills the same frame instead of the
      // dialog resizing around whichever content happens to be shortest.
      className="md:h-[85dvh] md:max-h-[85dvh]"
      {...(view.view !== 'list'
        ? { onBack: backToList, backLabel: t('library.backToLibrary') }
        : {})}
    >
      <div className="flex h-full min-h-0 flex-col">
        {view.view === 'list' && (
          <SkillLibraryCatalog
            organizationId={organizationId}
            onOpen={(slug) => setView({ view: 'detail', slug })}
            onAdd={handleAdd}
          />
        )}
        {view.view === 'create' && (
          <SkillCreatePane
            organizationId={organizationId}
            existingSlugs={existingSlugs}
            onCreated={(slug) => setView({ view: 'detail', slug })}
            onCancel={backToList}
          />
        )}
        {view.view === 'upload' && (
          <SkillUploadPane
            organizationId={organizationId}
            mode={view.mode}
            onUploaded={(slug) => setView({ view: 'detail', slug })}
            onCancel={backToList}
          />
        )}
        {view.view === 'detail' && (
          <SkillDetailPane
            organizationId={organizationId}
            slug={view.slug}
            onDeleted={backToList}
            onClose={backToList}
          />
        )}
      </div>
    </Dialog>
  );
}
