'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import {
  SectionRow,
  SectionRowBody,
  SectionRowGroup,
} from '@tale/ui/section-row';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowUpRight,
  Copy,
  AlertTriangle,
  Download,
  Pencil,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import {
  useDuplicateSkill,
  useExportSkill,
  useUpdateSkillMd,
} from '@/app/features/skills/hooks/mutations';
import {
  useGetSkillAuditHistory,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { downloadBase64File } from '@/lib/utils/download';

import {
  resolveSkillLoadErrorPresentation,
  skillLoadErrorDetailTitleKey,
} from '../utils/skill-load-error';
import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';
import { SkillDeleteDialog } from './skill-delete-dialog';
import { SkillUploadDialog } from './skill-upload/skill-upload-dialog';

interface ManageLink {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

interface SkillDetailPanelProps {
  organizationId: string;
  slug: string;
  onOpenChange: (open: boolean) => void;
  /** Re-point the panel at a different skill (used after duplicate). */
  onSwitchSlug: (slug: string) => void;
  /**
   * Hides the management actions (Edit / Replace / Duplicate / Export / Delete)
   * and routes users to the canonical Skills settings page via `manageLink`.
   */
  readOnly?: boolean;
  /** Routing target for the "Manage in Skills settings" header link. */
  manageLink?: ManageLink;
}

const SKILL_MD = 'SKILL.md';

/**
 * Placeholder audit rows rendered (masked) while the real audit history is
 * still loading — each becomes a masked leaf inside the real row structure.
 */
const AUDIT_PLACEHOLDER_ROWS = Array.from({ length: 3 }, (_, idx) => ({
  _id: `placeholder-${idx}`,
  timestamp: 0,
  action: 'upload_skill',
  status: 'success',
  actorId: 'placeholder@example.com',
  actorEmail: 'placeholder@example.com',
  actorRole: 'admin',
  errorMessage: undefined,
}));

export function SkillDetailPanel({
  organizationId,
  slug,
  onOpenChange,
  onSwitchSlug,
  readOnly,
  manageLink,
}: SkillDetailPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();
  const { locale } = useLocale();

  const { data, isLoading } = useReadSkill(organizationId, slug);
  const { data: auditRows } = useGetSkillAuditHistory(organizationId, slug);
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const { mutateAsync: updateSkillMd } = useUpdateSkillMd();
  const { mutateAsync: exportSkill } = useExportSkill();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // File selection in the bundle tree. SKILL.md is the root file, so it opens
  // selected (the overview IS its rendering); an asset path shows that file.
  // Lives in component state — no URL mirror, since the panel has no route.
  const [selectedFile, setSelectedFile] = useState(SKILL_MD);

  // SKILL.md editor (item 13): edits the frontmatter description + markdown
  // body in place. Only meaningful on the overview; selecting an asset exits it.
  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editBody, setEditBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Collapsed section keys — default empty, so overview sections start expanded.
  const [collapsedSections, setCollapsedSections] = useState(new Set<string>());

  const skill = data?.ok ? data : null;
  const hash = skill?.hash;
  const errorMessage = data && !data.ok ? data.message : undefined;
  const description = skill?.meta.description ?? '';
  const body = skill?.body ?? '';
  const license = skill?.meta.license;

  // While loading, `skill` is null. Render the real detail tree with
  // placeholder values masked in place rather than swapping in a separate
  // skeleton component. A genuine not-found state keeps its own alternate UI.
  const notFound = !isLoading && !skill;
  const assets = skill?.assets ?? [];
  const placeholderAssets: Array<{ path: string; size: number }> = isLoading
    ? Array.from({ length: 5 }, (_, idx) => ({
        path: `placeholder/file-${idx}.txt`,
        size: 0,
      }))
    : assets;
  // Files in the bundle = SKILL.md + every asset (undefined while loading).
  const fileCount = skill ? assets.length + 1 : undefined;

  // The overview (description + instructions) stands in for SKILL.md itself;
  // a real asset path shows the read-only viewer.
  const showOverview = selectedFile === SKILL_MD;

  // Reset selection + editor whenever the panel is re-pointed at a different
  // skill — otherwise switching skills would carry over the wrong file/edit.
  useEffect(() => {
    setSelectedFile(SKILL_MD);
    setIsEditing(false);
  }, [slug]);

  const handleSelectPath = useCallback((path: string) => {
    setSelectedFile(path);
    // Leaving the overview cancels any in-progress edit.
    setIsEditing(false);
  }, []);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleDuplicate = useCallback(async () => {
    if (!skill || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({ organizationId, slug });
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

  const skillDisplayName = skill?.meta.name ?? slug;
  const loadError = !isLoading && data && !data.ok ? data : null;
  const errorPresentation = loadError
    ? resolveSkillLoadErrorPresentation(loadError.error, loadError.message)
    : null;
  // A load failure (missing or corrupt SKILL.md) keeps its own error UI below;
  // `errorMessage`, `description`, `body`, `assets`, and `placeholderAssets`
  // are already derived above.
  const showLoadError = Boolean(loadError);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportSkill({ organizationId, slug });
      downloadBase64File(result.filename, result.dataBase64, 'application/zip');
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.export.failed', {
          defaultValue: 'Failed to export skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, exportSkill, organizationId, slug, t]);

  const startEditing = useCallback(() => {
    setEditDescription(description);
    setEditBody(body);
    setIsEditing(true);
  }, [description, body]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateSkillMd({
        organizationId,
        slug,
        description: editDescription,
        body: editBody,
        ...(hash ? { expectedHash: hash } : {}),
      });
      toast({
        title: t('skills.editor.saveSuccess', { defaultValue: 'Skill saved' }),
        variant: 'success',
      });
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.editor.saveFailed', {
          defaultValue: 'Failed to save skill',
        }),
        description: extractErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    isSaving,
    updateSkillMd,
    organizationId,
    slug,
    editDescription,
    editBody,
    hash,
    t,
  ]);

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
        resize={{
          defaultWidthPx: 768,
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
            {readOnly && manageLink ? (
              <Link
                to={manageLink.to}
                params={manageLink.params}
                search={manageLink.search}
                className="text-foreground hover:bg-muted inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium"
              >
                <ArrowUpRight className="size-4" aria-hidden="true" />
                {t('skills.manageInSettings', {
                  defaultValue: 'Manage in Skills settings',
                })}
              </Link>
            ) : null}
            <IconButton
              icon={X}
              aria-label={tCommon('aria.close')}
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          </HStack>
        </HStack>

        {showLoadError && errorPresentation ? (
          <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
            <Stack gap={4}>
              <HStack gap={3} align="start">
                <AlertTriangle
                  className="text-destructive mt-0.5 size-5 shrink-0"
                  aria-hidden="true"
                />
                <Stack gap={2} className="min-w-0 flex-1">
                  <Heading level={2}>
                    {t(skillLoadErrorDetailTitleKey(errorPresentation), {
                      defaultValue: 'Failed to read SKILL.md',
                    })}
                  </Heading>
                  <Text variant="muted">
                    {t('skills.loadErrorDetail.fixHint', {
                      defaultValue:
                        'Replace the bundle with a valid zip, or delete this skill.',
                    })}
                  </Text>
                </Stack>
              </HStack>
              {errorMessage ? (
                <Stack gap={2}>
                  <Text variant="caption">
                    {t('skills.loadErrorDetail.technicalDetails', {
                      defaultValue: 'Technical details',
                    })}
                  </Text>
                  <CodeBlock className="max-h-48 overflow-auto whitespace-pre-wrap">
                    {errorMessage}
                  </CodeBlock>
                </Stack>
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
            <div className="hidden md:contents">
              <SkillBundleTreePanel
                assets={placeholderAssets}
                slug={slug}
                selectedPath={selectedFile}
                onSelectPath={handleSelectPath}
                fileCount={fileCount}
                loading={isLoading}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {!showOverview ? (
                <SkillAssetViewer
                  organizationId={organizationId}
                  skillSlug={slug}
                  assetPath={selectedFile}
                />
              ) : isEditing ? (
                <Stack gap={4} className="p-4">
                  <Stack gap={1}>
                    <Text variant="caption">
                      {t('skills.form.description', {
                        defaultValue: 'Description',
                      })}
                    </Text>
                    <Textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      disabled={isSaving}
                    />
                  </Stack>
                  <Stack gap={1}>
                    <Text variant="caption">
                      {t('skills.section.body', {
                        defaultValue: 'Instructions (body)',
                      })}
                    </Text>
                    <Textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={18}
                      disabled={isSaving}
                      className="font-mono text-base md:text-sm"
                    />
                  </Stack>
                </Stack>
              ) : (
                <Skeletonize loading={isLoading} className="contents">
                  <Stack gap={6} className="p-4">
                    {!readOnly ? (
                      <HStack justify="end">
                        <Button
                          variant="ghost"
                          icon={Pencil}
                          onClick={startEditing}
                          disabled={!skill}
                        >
                          {tCommon('actions.edit')}
                        </Button>
                      </HStack>
                    ) : null}

                    <Stack gap={2}>
                      {isLoading ? (
                        <SkeletonText lines={2} />
                      ) : description ? (
                        <Text
                          variant="body"
                          className="leading-relaxed whitespace-pre-wrap"
                        >
                          {description}
                        </Text>
                      ) : (
                        <Text variant="muted">
                          {t('skills.detail.descriptionEmpty', {
                            defaultValue: '(no description)',
                          })}
                        </Text>
                      )}
                      {license ? (
                        <HStack gap={2} align="center">
                          <Text variant="caption">
                            {t('skills.metadata.license', {
                              defaultValue: 'License',
                            })}
                          </Text>
                          <Text as="span" variant="label">
                            {license}
                          </Text>
                        </HStack>
                      ) : null}
                    </Stack>

                    <SectionRowGroup>
                      <SectionRow
                        label={t('skills.section.body', {
                          defaultValue: 'Instructions (body)',
                        })}
                        expanded={!collapsedSections.has('body')}
                        onToggle={() => toggleSection('body')}
                      >
                        <SectionRowBody>
                          <div className={markdownWrapperStyles}>
                            {isLoading ? (
                              <SkeletonText lines={6} />
                            ) : body.trim().length === 0 ? (
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
                        </SectionRowBody>
                      </SectionRow>

                      <SectionRow
                        label={t('skills.section.auditHistory', {
                          defaultValue: 'Recent changes',
                        })}
                        expanded={!collapsedSections.has('audit')}
                        onToggle={() => toggleSection('audit')}
                        isLast
                      >
                        <SectionRowBody>
                          {Array.isArray(auditRows) &&
                          auditRows.length === 0 ? (
                            <Text variant="muted">
                              {t('skills.auditHistory.empty', {
                                defaultValue:
                                  'No audit entries yet for this skill.',
                              })}
                            </Text>
                          ) : (
                            <Skeletonize
                              loading={!Array.isArray(auditRows)}
                              className="contents"
                            >
                              <Stack gap={2}>
                                {(Array.isArray(auditRows)
                                  ? auditRows
                                  : AUDIT_PLACEHOLDER_ROWS
                                ).map((row) => (
                                  <HStack
                                    key={row._id}
                                    gap={3}
                                    align="center"
                                    className="border-border bg-background rounded-md border px-3 py-2"
                                  >
                                    <Badge
                                      variant={
                                        row.status === 'failure'
                                          ? 'destructive'
                                          : 'outline'
                                      }
                                    >
                                      <SkeletonBox>
                                        {t(
                                          `skills.auditHistory.action.${row.action}`,
                                          { defaultValue: row.action },
                                        )}
                                      </SkeletonBox>
                                    </Badge>
                                    <Stack gap={0} className="flex-1">
                                      <Text
                                        variant="body"
                                        className="font-mono text-xs"
                                      >
                                        <SkeletonBox>
                                          {new Intl.DateTimeFormat(locale, {
                                            dateStyle: 'medium',
                                            timeStyle: 'short',
                                          }).format(new Date(row.timestamp))}
                                        </SkeletonBox>
                                      </Text>
                                      <Text variant="muted" className="text-xs">
                                        <SkeletonBox>
                                          {row.actorEmail ?? row.actorId}
                                          {row.actorRole
                                            ? ` · ${row.actorRole}`
                                            : ''}
                                          {row.status === 'failure' &&
                                          row.errorMessage
                                            ? ` · ${row.errorMessage}`
                                            : ''}
                                        </SkeletonBox>
                                      </Text>
                                    </Stack>
                                  </HStack>
                                ))}
                              </Stack>
                            </Skeletonize>
                          )}
                        </SectionRowBody>
                      </SectionRow>
                    </SectionRowGroup>
                  </Stack>
                </Skeletonize>
              )}
            </div>
          </div>
        )}

        {!readOnly && !notFound ? (
          <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
            {isEditing ? (
              <HStack justify="end" align="center" gap={2}>
                <Button
                  variant="secondary"
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                >
                  {tCommon('actions.cancel')}
                </Button>
                <Button
                  onClick={() => void handleSave()}
                  isLoading={isSaving}
                  disabled={isSaving}
                >
                  {tCommon('actions.save')}
                </Button>
              </HStack>
            ) : (
              <HStack justify="between" align="center" gap={2}>
                <HStack gap={1} align="center">
                  <Button
                    variant="ghost"
                    icon={RotateCw}
                    onClick={() => setReplaceDialogOpen(true)}
                    disabled={isDuplicating || isExporting}
                  >
                    {t('skills.actions.replaceBundle', {
                      defaultValue: 'Replace bundle',
                    })}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={Copy}
                    onClick={() => void handleDuplicate()}
                    isLoading={isDuplicating}
                    disabled={isDuplicating || !skill}
                  >
                    {tCommon('actions.duplicate')}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={Download}
                    onClick={() => void handleExport()}
                    isLoading={isExporting}
                    disabled={isExporting || !skill}
                  >
                    {tCommon('actions.export')}
                  </Button>
                </HStack>
                <Button
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isDuplicating || isExporting}
                >
                  {tCommon('actions.delete')}
                </Button>
              </HStack>
            )}
          </div>
        ) : null}
      </Sheet>

      {!readOnly && (
        <>
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

          <SkillUploadDialog
            open={replaceDialogOpen}
            onOpenChange={setReplaceDialogOpen}
            organizationId={organizationId}
            onUploaded={() => {
              setReplaceDialogOpen(false);
            }}
          />
        </>
      )}
    </>
  );
}

function extractErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return undefined;
}
