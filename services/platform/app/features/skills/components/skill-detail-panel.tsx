'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Code, Copy, FileText, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import {
  useDuplicateSkill,
  useUpdateSkill,
} from '@/app/features/skills/hooks/mutations';
import {
  useGetSkillAuditHistory,
  useListSkillFiles,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { groupAssetsByDir } from '@/lib/skills/group-assets-by-dir';
import { isRecord } from '@/lib/utils/type-guards';

import { SkillAssetEditorDialog } from './skill-asset-editor-dialog';
import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillAssetsSection } from './skill-assets-section';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';
import { SkillDeleteDialog } from './skill-delete-dialog';

interface SkillDetailPanelProps {
  organizationId: string;
  slug: string;
  onOpenChange: (open: boolean) => void;
  /** Re-point the panel at a different skill (used after duplicate). */
  onSwitchSlug: (slug: string) => void;
}

export function SkillDetailPanel({
  organizationId,
  slug,
  onOpenChange,
  onSwitchSlug,
}: SkillDetailPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();
  const { locale } = useLocale();

  const { data, isLoading, refetch } = useReadSkill(organizationId, slug);
  const { data: filesData } = useListSkillFiles(organizationId, slug);
  const { mutateAsync: updateSkill } = useUpdateSkill();

  const [loadedDescription, setLoadedDescription] = useState('');
  const [loadedBody, setLoadedBody] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [bodyView, setBodyView] = useState<'edit' | 'preview'>('edit');

  const { data: auditRows } = useGetSkillAuditHistory(organizationId, slug);
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // File selection in the bundle tree. Lives in component state — no URL
  // mirror, since the panel itself has no route.
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [editDialogPath, setEditDialogPath] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const skill = data?.ok ? data : null;
  const isDirty = description !== loadedDescription || body !== loadedBody;

  // Reset selected file (and any in-flight load state) whenever the panel
  // is re-pointed at a different skill — otherwise switching from
  // skill-A?file=scripts/x.py to skill-B would render skill-B through the
  // asset viewer with skill-A's path.
  useEffect(() => {
    setSelectedFile('SKILL.md');
    setHash(undefined);
    setLoadedDescription('');
    setLoadedBody('');
    setDescription('');
    setBody('');
  }, [slug]);

  const groupedAssets = useMemo(
    () => groupAssetsByDir(filesData?.assets ?? skill?.assets ?? []),
    [filesData, skill],
  );

  const handleDuplicate = useCallback(async () => {
    if (!skill || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({
        organizationId,
        slug,
      });
      toast({
        title: t('skills.skillDuplicated', {
          defaultValue: 'Skill duplicated as {slug}',
          slug: newSlug,
        }),
        variant: 'success',
      });
      onSwitchSlug(newSlug);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.skillDuplicateFailed', {
          defaultValue: 'Failed to duplicate skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [
    skill,
    isDuplicating,
    duplicateSkill,
    organizationId,
    slug,
    onSwitchSlug,
    t,
  ]);

  // Sync local form state with the loaded skill ONLY on first load or after
  // an explicit reload — never while the user has dirty edits, otherwise
  // a background refetch would clobber active typing.
  useEffect(() => {
    if (!skill) return;
    if (skill.hash === hash) return;
    if (isDirty) return;
    setDescription(skill.meta.description);
    setBody(skill.body);
    setLoadedDescription(skill.meta.description);
    setLoadedBody(skill.body);
    setHash(skill.hash);
  }, [skill, hash, isDirty]);

  const handleDiscard = useCallback(() => {
    if (!skill) return;
    setDescription(loadedDescription);
    setBody(loadedBody);
  }, [skill, loadedDescription, loadedBody]);

  const handleSave = useCallback(async () => {
    if (!skill || isSaving || !isDirty) return;
    setIsSaving(true);
    try {
      const result = await updateSkill({
        organizationId,
        slug,
        meta: {
          ...skill.meta,
          description,
        },
        body,
        expectedHash: hash,
      });
      setHash(result.hash);
      setLoadedDescription(description);
      setLoadedBody(body);
      toast({
        title: t('skills.skillSaved', { defaultValue: 'Skill saved' }),
        variant: 'success',
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, slug],
      });
    } catch (error) {
      // Shape-based ConvexError narrowing — `instanceof ConvexError` is
      // unreliable across HMR / route code-split boundaries, so we read
      // the structured `data.code` directly via `isRecord`.
      let errData: Record<string, unknown> | undefined;
      if (error && typeof error === 'object' && 'data' in error) {
        const rawData = (error as { data?: unknown }).data;
        if (isRecord(rawData)) errData = rawData;
      }
      const code = typeof errData?.code === 'string' ? errData.code : undefined;
      const message =
        typeof errData?.message === 'string' ? errData.message : undefined;
      if (code === 'CONFLICT') {
        toast({
          title: t('skills.conflict', {
            defaultValue:
              'This skill was edited elsewhere. Reload to see the latest version.',
          }),
          variant: 'destructive',
        });
        setHash(undefined);
        void refetch();
        return;
      }
      if (code === 'INVALID_FRONTMATTER' || code === 'TOO_LARGE') {
        toast({
          title:
            message ??
            t('skills.validationError', {
              defaultValue: 'Invalid skill configuration',
            }),
          variant: 'destructive',
        });
        return;
      }
      console.error(error);
      toast({
        title: t('skills.skillSaveFailed', {
          defaultValue: 'Failed to save skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    skill,
    isSaving,
    isDirty,
    updateSkill,
    organizationId,
    slug,
    description,
    body,
    hash,
    t,
    refetch,
    queryClient,
  ]);

  // Intercept close attempts when the form is dirty — the equivalent of
  // useBlocker on the standalone page. The Sheet's overlay click and the
  // close button both funnel through here.
  const requestClose = useCallback(() => {
    if (isDirty && !isSaving) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, isSaving, onOpenChange]);

  const skillDisplayName = skill?.meta.name ?? slug;
  const errorMessage = data && !data.ok ? data.message : undefined;

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        resize={{
          defaultWidthPx: 768, // 48rem — fits bundle tree + form comfortably
          minWidthPx: 480,
          maxWidthPx: 1400,
          storageKey: 'skill-detail-panel-width',
        }}
        hideClose
        title={skillDisplayName}
        className="flex flex-col gap-0 p-0"
      >
        <HStack
          justify="between"
          align="center"
          gap={2}
          className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
        >
          <Heading
            level={1}
            className="min-w-0 truncate text-base font-semibold"
          >
            {skillDisplayName}
          </Heading>
          <HStack gap={1} align="center" className="shrink-0">
            {skill ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  onClick={() => void handleDuplicate()}
                  isLoading={isDuplicating}
                  disabled={isSaving || isDuplicating}
                >
                  {t('skills.actions.duplicate', { defaultValue: 'Duplicate' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isSaving || isDuplicating}
                >
                  {tCommon('actions.delete')}
                </Button>
              </>
            ) : null}
            <IconButton
              icon={X}
              aria-label={tCommon('aria.close')}
              variant="ghost"
              onClick={requestClose}
            />
          </HStack>
        </HStack>

        {isLoading ? (
          <PanelLoadingSkeleton />
        ) : !skill ? (
          <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
            <Stack gap={4}>
              <Heading level={2}>
                {t('skills.notFound', { defaultValue: 'Skill not found' })}
              </Heading>
              {errorMessage ? (
                <Text variant="muted">{errorMessage}</Text>
              ) : null}
              <div>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {t('skills.backToList', { defaultValue: 'Back to skills' })}
                </Button>
              </div>
            </Stack>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <div className="hidden md:block">
              <SkillBundleTreePanel
                assets={filesData?.assets ?? skill.assets ?? []}
                totalBytes={filesData?.totalBytes ?? skill.totalBytes ?? 0}
                maxTotalBytes={filesData?.maxTotalBytes ?? 1024 * 1024}
                maxAssets={filesData?.maxAssets ?? 32}
                selectedPath={selectedFile}
                onSelectPath={setSelectedFile}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {selectedFile !== 'SKILL.md' ? (
                <SkillAssetViewer
                  organizationId={organizationId}
                  skillSlug={slug}
                  assetPath={selectedFile}
                  onEdit={() => setEditDialogPath(selectedFile)}
                />
              ) : (
                <Stack gap={6} className="p-4">
                  <HStack
                    gap={4}
                    align="center"
                    className="border-border bg-muted/30 rounded-md border px-4 py-2"
                  >
                    <Stack gap={0}>
                      <Text variant="caption">
                        {t('skills.metadata.bundleFiles', {
                          defaultValue: 'Bundle files',
                        })}
                      </Text>
                      <Text variant="label">
                        {filesData?.assets?.length ?? skill.assets?.length ?? 0}
                      </Text>
                    </Stack>
                    {skill.meta.license ? (
                      <Stack gap={0}>
                        <Text variant="caption">
                          {t('skills.metadata.license', {
                            defaultValue: 'License',
                          })}
                        </Text>
                        <Text variant="label">{skill.meta.license}</Text>
                      </Stack>
                    ) : null}
                  </HStack>

                  <FormSection
                    label={t('skills.section.overview', {
                      defaultValue: 'Overview',
                    })}
                  >
                    <Stack gap={4}>
                      <Input
                        id="slug"
                        label={t('skills.form.slug', { defaultValue: 'Slug' })}
                        value={skill.meta.name}
                        readOnly
                      />
                      <Textarea
                        id="description"
                        label={t('skills.form.description', {
                          defaultValue: 'Description',
                        })}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                      />
                      <Text variant="caption">
                        {t('skills.form.descriptionHelp', {
                          defaultValue:
                            'Lead with "Use when…". The agent reads this to decide whether to expand the skill.',
                        })}
                      </Text>
                    </Stack>
                  </FormSection>

                  <FormSection
                    label={t('skills.section.body', {
                      defaultValue: 'Instructions (body)',
                    })}
                  >
                    <Stack gap={2}>
                      <div
                        role="group"
                        aria-label={t('skills.body.viewToggle', {
                          defaultValue: 'Body view mode',
                        })}
                        className="flex justify-end gap-1"
                      >
                        <Button
                          size="sm"
                          variant={bodyView === 'edit' ? 'secondary' : 'ghost'}
                          icon={Code}
                          onClick={() => setBodyView('edit')}
                          aria-pressed={bodyView === 'edit'}
                        >
                          {t('skills.body.viewEdit', {
                            defaultValue: 'Edit',
                          })}
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            bodyView === 'preview' ? 'secondary' : 'ghost'
                          }
                          icon={FileText}
                          onClick={() => setBodyView('preview')}
                          aria-pressed={bodyView === 'preview'}
                        >
                          {t('skills.body.viewPreview', {
                            defaultValue: 'Preview',
                          })}
                        </Button>
                      </div>
                      {bodyView === 'edit' ? (
                        <Textarea
                          id="body"
                          label={t('skills.form.body', {
                            defaultValue: 'Body markdown',
                          })}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          rows={18}
                          className="font-mono text-sm"
                        />
                      ) : (
                        <div
                          className={
                            markdownWrapperStyles +
                            ' border-border bg-background rounded-md border p-4'
                          }
                        >
                          {body.trim().length === 0 ? (
                            <Text variant="muted">
                              {t('skills.body.previewEmpty', {
                                defaultValue: '(Body is empty)',
                              })}
                            </Text>
                          ) : (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {body}
                            </ReactMarkdown>
                          )}
                        </div>
                      )}
                      <Text variant="caption">
                        {t('skills.form.bodyHelp', {
                          defaultValue:
                            'Loaded into the agent context when it calls expand_skill. Plain markdown.',
                        })}
                      </Text>
                    </Stack>
                  </FormSection>

                  <FormSection
                    label={t('skills.section.bundle', {
                      defaultValue: 'Bundle files',
                    })}
                  >
                    <Stack gap={4}>
                      {groupedAssets.length > 0 ? (
                        <Stack gap={3}>
                          {groupedAssets.map(({ dir, files }) => (
                            <Stack key={dir} gap={1}>
                              <Text variant="caption" className="font-mono">
                                {dir === '.'
                                  ? t('skills.bundle.dirRoot', {
                                      defaultValue: '(root)',
                                    })
                                  : `${dir}/`}
                              </Text>
                              <Stack gap={0} className="ml-3">
                                {files.map((f) => {
                                  const leaf =
                                    dir === '.'
                                      ? f.path
                                      : f.path.slice(dir.length + 1);
                                  return (
                                    <Text
                                      key={f.path}
                                      variant="muted"
                                      className="font-mono text-xs"
                                    >
                                      {leaf}
                                    </Text>
                                  );
                                })}
                              </Stack>
                            </Stack>
                          ))}
                        </Stack>
                      ) : null}
                      <SkillAssetsSection
                        organizationId={organizationId}
                        skillSlug={slug}
                        assets={filesData?.assets ?? skill.assets ?? []}
                        totalBytes={
                          filesData?.totalBytes ?? skill.totalBytes ?? 0
                        }
                        maxTotalBytes={filesData?.maxTotalBytes ?? 1024 * 1024}
                        maxAssets={filesData?.maxAssets ?? 32}
                      />
                    </Stack>
                  </FormSection>

                  <FormSection
                    label={t('skills.section.auditHistory', {
                      defaultValue: 'Recent changes',
                    })}
                  >
                    <Stack gap={2}>
                      {!Array.isArray(auditRows) ? (
                        <Stack gap={2}>
                          {Array.from({ length: 3 }).map((_, idx) => (
                            <HStack
                              key={idx}
                              gap={3}
                              align="center"
                              className="border-border rounded-md border px-3 py-2"
                            >
                              <Skeleton className="h-5 w-16 rounded-md" />
                              <Stack gap={1} className="flex-1">
                                <Skeleton className="h-3 w-40" />
                                <Skeleton className="h-3 w-56" />
                              </Stack>
                            </HStack>
                          ))}
                        </Stack>
                      ) : auditRows.length === 0 ? (
                        <Text variant="muted">
                          {t('skills.auditHistory.empty', {
                            defaultValue:
                              'No audit entries yet for this skill.',
                          })}
                        </Text>
                      ) : (
                        <Stack gap={2}>
                          {auditRows.map((row) => (
                            <HStack
                              key={row._id}
                              gap={3}
                              align="center"
                              className="border-border rounded-md border px-3 py-2"
                            >
                              <Badge
                                variant={
                                  row.status === 'failure'
                                    ? 'destructive'
                                    : 'outline'
                                }
                              >
                                {t(`skills.auditHistory.action.${row.action}`, {
                                  defaultValue: row.action,
                                })}
                              </Badge>
                              <Stack gap={0} className="flex-1">
                                <Text
                                  variant="body"
                                  className="font-mono text-xs"
                                >
                                  {new Intl.DateTimeFormat(locale, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }).format(new Date(row.timestamp))}
                                </Text>
                                <Text variant="muted" className="text-xs">
                                  {row.actorEmail ?? row.actorId}
                                  {row.actorRole ? ` · ${row.actorRole}` : ''}
                                  {row.status === 'failure' && row.errorMessage
                                    ? ` · ${row.errorMessage}`
                                    : ''}
                                </Text>
                              </Stack>
                            </HStack>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </FormSection>

                  <HStack gap={2} justify="end">
                    <Button
                      variant="ghost"
                      onClick={handleDiscard}
                      disabled={!isDirty || isSaving}
                    >
                      {tCommon('actions.discard')}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void handleSave()}
                      isLoading={isSaving}
                      disabled={!isDirty || isSaving}
                    >
                      {tCommon('actions.save')}
                    </Button>
                  </HStack>
                </Stack>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <SkillAssetEditorDialog
        open={editDialogPath !== null}
        onOpenChange={(open) => {
          if (!open) setEditDialogPath(null);
        }}
        organizationId={organizationId}
        skillSlug={slug}
        assetPath={editDialogPath}
      />
      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={t('skills.unsavedChanges.title', {
          defaultValue: 'Discard unsaved changes?',
        })}
        description={t('skills.unsavedChanges.description', {
          defaultValue:
            'You have unsaved edits on this skill. Leaving now will discard them.',
        })}
        confirmText={t('skills.unsavedChanges.leave', {
          defaultValue: 'Discard and leave',
        })}
        cancelText={t('skills.unsavedChanges.stay', {
          defaultValue: 'Keep editing',
        })}
        variant="destructive"
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          onOpenChange(false);
        }}
      />
      <SkillDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        organizationId={organizationId}
        skillSlug={slug}
        expectedHash={hash}
        onDeleted={() => {
          setDeleteDialogOpen(false);
          onOpenChange(false);
          void queryClient.invalidateQueries({
            queryKey: ['config', 'skills'],
          });
        }}
      />
    </>
  );
}

function PanelLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className="border-border hidden w-72 shrink-0 overflow-y-auto border-r p-3 md:block">
        <Skeleton className="mb-2 ml-1 h-3 w-16" />
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
          >
            <Skeleton className="size-3.5 shrink-0 rounded" />
            <Skeleton
              className="h-3.5"
              style={{ width: `${55 + ((idx * 13) % 35)}%` }}
            />
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Stack gap={6} className="p-4">
          <Skeleton className="h-14 w-full rounded-md" />
          {Array.from({ length: 4 }).map((_, idx) => (
            <Stack key={idx} gap={3}>
              <Skeleton className="h-4 w-32" />
              <Skeleton
                className="w-full"
                style={{ height: idx === 1 ? '18rem' : '5rem' }}
              />
            </Stack>
          ))}
          <HStack gap={2} justify="end">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </HStack>
        </Stack>
      </div>
    </div>
  );
}
