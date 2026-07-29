'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteSkill, useSaveSkill } from '../hooks/mutations';
import { useSkill } from '../hooks/queries';
import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';
import {
  parseLabelsInput,
  SkillMetadataFields,
  type SkillMetadataValues,
} from './skill-metadata-fields';
import type { SkillSharingValue } from './skill-visibility-field';

interface SkillFormState {
  readonly metadata: SkillMetadataValues;
  readonly body: string;
}

/**
 * One skill inside the library dialog: the bundle's file tree on the left,
 * and on the right either the metadata + body editor (`SKILL.md` selected)
 * or the asset viewer. Members who cannot edit get the same view read-only.
 * Plain local form state with explicit Save/Discard — the dialog is its own
 * surface, not part of a settings page's save cluster.
 */
export function SkillDetailPane({
  organizationId,
  slug,
  onDeleted,
  onClose,
}: {
  organizationId: string;
  slug: string;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { t } = useT('skills');
  const { t: tCommon } = useT('common');

  const skillQuery = useSkill(organizationId, slug);
  const skill = skillQuery.data ?? null;
  const saveSkill = useSaveSkill(organizationId);
  const deleteSkill = useDeleteSkill(organizationId);

  const [selectedPath, setSelectedPath] = useState('SKILL.md');
  const [form, setForm] = useState<SkillFormState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const savedForm = useMemo<SkillFormState | null>(() => {
    if (!skill) return null;
    return {
      metadata: {
        description: skill.description,
        icon: skill.icon,
        labels: (skill.labels ?? []).join(', '),
        sharing: {
          visibility: skill.visibility,
          teams: skill.teams ?? [],
        },
        usageMode: skill.usageMode ?? 'all',
      },
      body: skill.body,
    };
  }, [skill]);

  // Seed the form when the document (or the slug) changes; edits in flight
  // survive unrelated refetches because the seed only fires from null.
  useEffect(() => {
    setForm((current) => current ?? savedForm);
  }, [savedForm]);
  useEffect(() => {
    setForm(null);
    setSelectedPath('SKILL.md');
  }, [slug]);

  const dirty =
    form !== null &&
    savedForm !== null &&
    JSON.stringify(form) !== JSON.stringify(savedForm);
  const canEdit = skill?.canEdit ?? false;
  const teamsMissing =
    form !== null &&
    form.metadata.sharing.visibility === 'team' &&
    form.metadata.sharing.teams.length === 0;

  const files = skill?.files ?? [];
  const assets = files.filter((file) => file.path !== 'SKILL.md');

  const save = async () => {
    if (!form || !skill || !canEdit || teamsMissing) return;
    try {
      await saveSkill.mutateAsync({
        organizationId,
        slug,
        description: form.metadata.description.trim(),
        body: form.body,
        visibility: form.metadata.sharing.visibility,
        ...(form.metadata.sharing.visibility === 'team'
          ? { teams: [...form.metadata.sharing.teams] }
          : {}),
        usageMode: form.metadata.usageMode,
        ...(form.metadata.icon !== undefined
          ? { icon: form.metadata.icon }
          : {}),
        labels: parseLabelsInput(form.metadata.labels),
      });
      setForm(null); // Re-seed from the fresh document.
      toast({ title: t('editor.saved'), variant: 'success' });
    } catch (error) {
      console.error('Failed to save skill', error);
      toast({ title: t('editor.saveFailed'), variant: 'destructive' });
    }
  };

  const remove = async () => {
    try {
      await deleteSkill.mutateAsync({ organizationId, slug });
      toast({ title: t('skillDeleted'), variant: 'success' });
      onDeleted();
    } catch (error) {
      console.error('Failed to delete skill', error);
      toast({ title: t('skillDeleteFailed'), variant: 'destructive' });
    }
  };

  if (skillQuery.isPending) {
    return (
      <Skeletonize loading>
        <Stack gap={3}>
          <SkeletonBox fullWidth>
            <div className="h-8" />
          </SkeletonBox>
          <SkeletonBox fullWidth>
            <div className="h-40" />
          </SkeletonBox>
        </Stack>
      </Skeletonize>
    );
  }
  if (!skill) {
    return <Alert variant="destructive" description={t('notFound')} />;
  }

  const savedSharing: SkillSharingValue | undefined = savedForm
    ? savedForm.metadata.sharing
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-[16rem_1fr]">
        <div className="min-h-0 overflow-y-auto">
          <SkillBundleTreePanel
            assets={assets}
            slug={slug}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            fileCount={files.length}
          />
        </div>

        <div className="min-h-0 overflow-y-auto pr-2">
          {selectedPath === 'SKILL.md' ? (
            <Stack gap={4}>
              {!canEdit && <Alert variant="info" description={t('readOnly')} />}
              {form && (
                <SettingsFieldList className="w-full max-w-3xl">
                  <SkillMetadataFields
                    values={form.metadata}
                    savedSharing={savedSharing}
                    onChange={(metadata) => setForm({ ...form, metadata })}
                    disabled={!canEdit}
                  />
                  <SettingsFieldRow
                    label={t('section.body')}
                    description={t('editor.bodyHelp')}
                    wideControl
                  >
                    <Textarea
                      aria-label={t('section.body')}
                      value={form.body}
                      onChange={(e) =>
                        setForm({ ...form, body: e.target.value })
                      }
                      rows={12}
                      className="font-mono text-sm"
                      disabled={!canEdit}
                    />
                  </SettingsFieldRow>
                </SettingsFieldList>
              )}
            </Stack>
          ) : (
            <SkillAssetViewer
              organizationId={organizationId}
              skillSlug={slug}
              assetPath={selectedPath}
            />
          )}
        </div>
      </div>

      <Row gap={2} justify="between" className="shrink-0">
        <div>
          {canEdit && (
            <Button
              variant="secondary"
              className="text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1 size-4" />
              {t('deleteSkill')}
            </Button>
          )}
        </div>
        <Row gap={2}>
          <Button variant="secondary" onClick={onClose}>
            {canEdit ? tCommon('actions.cancel') : tCommon('actions.close')}
          </Button>
          {canEdit && (
            <Button
              onClick={() => void save()}
              disabled={!dirty || teamsMissing || saveSkill.isPending}
            >
              {saveSkill.isPending
                ? tCommon('actions.saving')
                : tCommon('actions.save')}
            </Button>
          )}
        </Row>
      </Row>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteSkill')}
        description={t('deleteConfirmation', { slug })}
        onDelete={() => void remove()}
      />
    </div>
  );
}
