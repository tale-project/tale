'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDeleteSkill, useSaveSkill } from '../hooks/mutations';
import { useSkill, useSkillAssets } from '../hooks/queries';
import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';

interface SkillFormState {
  description: string;
  body: string;
  visibility: 'private' | 'org';
  labels: string;
}

/**
 * Edit one skill's `SKILL.md`: description (what tells the model when to read
 * it), the markdown body, visibility, and labels. The slug is immutable
 * identity (directory name = frontmatter `name`) — renaming is create+delete
 * on purpose. Saving posts only the fields this form carries; the server
 * merges over the on-disk file, so frontmatter the editor doesn't know
 * (license, icon, recommended-packages, custom keys) survives untouched.
 * Read-only for viewers without edit rights (owner, or org-admin for org
 * skills — `canEdit` is computed server-side). Saving runs through the
 * settings header's global Save/Discard cluster; Delete stays local as a
 * dialog-confirmed destructive action.
 */
export function SkillEditor({
  organizationId,
  slug,
  onBack,
  onDeleted,
}: {
  organizationId: string;
  slug: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const skillQuery = useSkill(organizationId, slug);
  const assetsQuery = useSkillAssets(organizationId, slug);
  const saveSkill = useSaveSkill();
  const deleteSkill = useDeleteSkill();

  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 'SKILL.md' (the form) or a bundle asset shown read-only. */
  const [selectedPath, setSelectedPath] = useState('SKILL.md');

  const skill = skillQuery.data;

  const data = useMemo<SkillFormState | undefined>(() => {
    if (!skill) return undefined;
    return {
      description: skill.description,
      body: skill.body,
      visibility: skill.visibility,
      labels: (skill.labels ?? []).join(', '),
    };
  }, [skill]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. Delete stays a local, dialog-confirmed action and keeps its own
  // toasts.
  const save = useCallback(
    async (values: SkillFormState) => {
      const labels = values.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      try {
        await saveSkill.mutateAsync({
          organizationId,
          slug,
          description: values.description.trim(),
          body: values.body,
          visibility: values.visibility,
          labels,
        });
      } catch (error) {
        console.error('Failed to save skill', error);
        throw new Error(t('skills.editor.saveFailed'), { cause: error });
      }
    },
    [organizationId, saveSkill, slug, t],
  );

  const editor = useFormEditor<SkillFormState>({ data, save });
  useRegisterGroupedEditor(editor, {
    enabled: skill != null && skill.canEdit,
  });

  // A form reset parks the caret at the END of the value, so the first focus
  // would scroll the body to the document's tail. Rest the caret at the top
  // once the loaded value has actually reached the DOM (watching the field —
  // the reset lands a commit after `data` does). The parked-at-end check
  // keeps this from ever touching a caret the member has placed.
  const bodyValue = editor.form.watch('body');
  useEffect(() => {
    const el = document.getElementById('skill-body');
    if (
      el instanceof HTMLTextAreaElement &&
      document.activeElement !== el &&
      el.value.length > 0 &&
      el.selectionStart === el.value.length
    ) {
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    }
  }, [bodyValue]);

  if (skillQuery.isPending) {
    return (
      <Skeletonize loading>
        <SkeletonBox fullWidth>
          <div className="h-96 w-full rounded-lg" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (skillQuery.isError || skill == null) {
    return (
      <Stack gap={3}>
        <BackButton onBack={onBack} label={t('skills.backToList')} />
        <Alert
          variant="destructive"
          description={
            skillQuery.isError ? t('skills.listFailed') : t('skills.notFound')
          }
        />
      </Stack>
    );
  }

  const readOnly = !skill.canEdit;

  const confirmDelete = async () => {
    try {
      await deleteSkill.mutateAsync({ organizationId, slug });
      setDeleteOpen(false);
      toast({ title: t('skills.skillDeleted'), variant: 'success' });
      onDeleted();
    } catch (error) {
      console.error('Failed to delete skill', error);
      toast({ title: t('skills.skillDeleteFailed'), variant: 'destructive' });
    }
  };

  return (
    <Stack gap={5} className="min-h-0 flex-1">
      <Row gap={3} justify="between" align="center" className="shrink-0">
        <HStack gap={3} align="center" className="min-w-0">
          <BackButton onBack={onBack} label={t('skills.backToList')} />
          <SkillIcon icon={skill.icon} className="size-6" />
          <Text as="h3" className="truncate font-semibold">
            {slug}
          </Text>
          {skill.visibility === 'private' && (
            <Badge variant="outline">{t('skills.visibility.private')}</Badge>
          )}
        </HStack>
        {!readOnly && (
          <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="text-destructive mr-1 size-4" />
            {tCommon('actions.delete')}
          </Button>
        )}
      </Row>

      {readOnly && <Alert description={t('skills.readOnly')} />}

      {/* One bounded card, split like main's detail panel: the tree owns a
          fixed-width, internally-scrolling rail (hidden on small screens),
          and the right pane holds the SKILL.md form or the read-only viewer.
          The card takes EXACTLY the height the settings scroll area has left
          (fitToContainer threads flex-1 down from the page shell — no
          viewport math, so browser banners and zoom can't push it off
          screen); each side scrolls itself. */}
      <div className="border-border flex min-h-[20rem] flex-1 overflow-hidden rounded-lg border">
        <div className="hidden md:contents">
          <SkillBundleTreePanel
            assets={assetsQuery.data?.assets ?? []}
            slug={slug}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            {...(assetsQuery.data
              ? { fileCount: assetsQuery.data.assets.length + 1 }
              : {})}
            loading={assetsQuery.isPending}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {selectedPath === 'SKILL.md' ? (
            <SkillMdForm editor={editor} readOnly={readOnly} t={t} />
          ) : (
            <SkillAssetViewer
              organizationId={organizationId}
              skillSlug={slug}
              assetPath={selectedPath}
            />
          )}
        </div>
      </div>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('skills.deleteSkill')}
        description={t('skills.deleteConfirmation')}
        onDelete={() => void confirmDelete()}
        isDeleting={deleteSkill.isPending}
      />
    </Stack>
  );
}

/** The SKILL.md editing form, unchanged behaviour — split out so the two-pane
 * layout can swap it against the asset viewer without re-mounting the page. */
function SkillMdForm({
  editor,
  readOnly,
  t,
}: {
  editor: ReturnType<typeof useFormEditor<SkillFormState>>;
  readOnly: boolean;
  t: ReturnType<typeof useT>['t'];
}) {
  const { register, watch, setValue } = editor.form;
  const [bodyView, setBodyView] = useState<'edit' | 'preview'>('edit');
  const bodyValue = watch('body') ?? '';
  return (
    // The metadata sits compact in two columns; the body is the editor's
    // star — it takes the pane's full width and every remaining pixel of
    // height, scrolling internally (as the raw-markdown textarea or the
    // rendered preview). Only when the pane is too short for the metadata
    // plus the body's floor does the pane itself scroll.
    <form
      onSubmit={editor.submit}
      className="flex min-h-0 flex-1 flex-col gap-4 p-4"
    >
      <div className="grid max-w-4xl shrink-0 gap-x-6 gap-y-4 md:grid-cols-2">
        <Stack gap={4}>
          <Stack gap={1}>
            <label htmlFor="skill-description" className="text-sm font-medium">
              {t('skills.form.description')}
            </label>
            <Input
              id="skill-description"
              disabled={readOnly}
              aria-describedby="skill-description-help"
              {...register('description')}
            />
            <p
              id="skill-description-help"
              className="text-muted-foreground text-xs"
            >
              {t('skills.editor.descriptionHelp')}
            </p>
          </Stack>

          <Stack gap={1}>
            <label htmlFor="skill-labels" className="text-sm font-medium">
              {t('skills.editor.labels')}
            </label>
            <Input
              id="skill-labels"
              disabled={readOnly}
              placeholder={t('skills.editor.labelsPlaceholder')}
              aria-describedby="skill-labels-help"
              {...register('labels')}
            />
            <p id="skill-labels-help" className="text-muted-foreground text-xs">
              {t('skills.editor.labelsHelp')}
            </p>
          </Stack>
        </Stack>

        <Stack gap={1}>
          <span className="text-sm font-medium">
            {t('skills.visibility.label')}
          </span>
          <RadioGroup
            aria-label={t('skills.visibility.label')}
            value={watch('visibility') ?? 'org'}
            onValueChange={(visibility) => {
              if (visibility === 'private' || visibility === 'org') {
                setValue('visibility', visibility, { shouldDirty: true });
              }
            }}
            options={[
              {
                value: 'org',
                label: t('skills.visibility.org'),
                description: t('skills.visibility.orgHelp'),
              },
              {
                value: 'private',
                label: t('skills.visibility.private'),
                description: t('skills.visibility.privateHelp'),
              },
            ]}
            disabled={readOnly}
          />
        </Stack>
      </div>

      <Stack gap={1} className="min-h-[16rem] flex-1">
        <Row gap={2} justify="between" align="center" className="shrink-0">
          <label htmlFor="skill-body" className="text-sm font-medium">
            {t('skills.section.body')}
          </label>
          <HStack gap={1}>
            <Button
              type="button"
              size="sm"
              variant={bodyView === 'edit' ? 'secondary' : 'ghost'}
              aria-pressed={bodyView === 'edit'}
              onClick={() => setBodyView('edit')}
            >
              {t('skills.editor.viewEdit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={bodyView === 'preview' ? 'secondary' : 'ghost'}
              aria-pressed={bodyView === 'preview'}
              onClick={() => setBodyView('preview')}
              data-testid="skill-body-preview-toggle"
            >
              {t('skills.editor.viewPreview')}
            </Button>
          </HStack>
        </Row>
        <Textarea
          id="skill-body"
          disabled={readOnly}
          fillHeight
          className="font-mono text-sm"
          wrapperClassName={bodyView === 'preview' ? 'hidden' : undefined}
          aria-describedby="skill-body-help"
          {...register('body')}
        />
        {bodyView === 'preview' && (
          <div
            className={cn(
              'border-border min-h-0 flex-1 overflow-y-auto rounded-md border p-4',
              markdownWrapperStyles,
            )}
            data-testid="skill-body-preview"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {bodyValue}
            </ReactMarkdown>
          </div>
        )}
        <p
          id="skill-body-help"
          className="text-muted-foreground shrink-0 text-xs"
        >
          {t('skills.editor.bodyHelp')}
        </p>
      </Stack>
    </form>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon" onClick={onBack} title={label}>
      <ArrowLeft className="text-muted-foreground size-5" />
    </Button>
  );
}
