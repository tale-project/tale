'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Copy, RotateCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useDuplicateSkill } from '@/app/features/skills/hooks/mutations';
import {
  useGetSkillAuditHistory,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';

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
   * Hides the management actions (Replace / Duplicate / Delete) and routes
   * users to the canonical Skills settings page via `manageLink` instead.
   */
  readOnly?: boolean;
  /** Routing target for the "Manage in Skills settings" header link. */
  manageLink?: ManageLink;
}

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // File selection in the bundle tree. Lives in component state — no URL
  // mirror, since the panel itself has no route.
  const [selectedFile, setSelectedFile] = useState('SKILL.md');

  const skill = data?.ok ? data : null;
  const hash = skill?.hash;

  // Reset selected file whenever the panel is re-pointed at a different
  // skill — otherwise switching from skill-A?file=scripts/x.py to skill-B
  // would render skill-B through the asset viewer with skill-A's path.
  useEffect(() => {
    setSelectedFile('SKILL.md');
  }, [slug]);

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

  const skillDisplayName = skill?.meta.name ?? slug;
  const errorMessage = data && !data.ok ? data.message : undefined;
  const description = skill?.meta.description ?? '';
  const body = skill?.body ?? '';

  // While loading, `skill` is null. Render the real detail tree with
  // placeholder values masked in place rather than swapping in a separate
  // skeleton component. A genuine not-found state (loaded but no skill) keeps
  // its own real alternate UI below.
  const notFound = !isLoading && !skill;
  const assets = skill?.assets ?? [];
  const placeholderAssets: Array<{ path: string; size: number }> = isLoading
    ? Array.from({ length: 5 }, (_, idx) => ({
        path: `placeholder/file-${idx}.txt`,
        size: 0,
      }))
    : assets;

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
            {skill && !readOnly ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCw}
                  onClick={() => setReplaceDialogOpen(true)}
                  disabled={isDuplicating}
                >
                  {t('skills.actions.replaceBundle', {
                    defaultValue: 'Replace bundle',
                  })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  onClick={() => void handleDuplicate()}
                  isLoading={isDuplicating}
                  disabled={isDuplicating}
                >
                  {t('skills.actions.duplicate', { defaultValue: 'Duplicate' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isDuplicating}
                >
                  {tCommon('actions.delete')}
                </Button>
              </>
            ) : null}
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

        {notFound ? (
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
            <div className="hidden md:contents">
              <SkillBundleTreePanel
                assets={placeholderAssets}
                slug={slug}
                selectedPath={selectedFile}
                onSelectPath={setSelectedFile}
                loading={isLoading}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {!isLoading && selectedFile !== 'SKILL.md' ? (
                <SkillAssetViewer
                  organizationId={organizationId}
                  skillSlug={slug}
                  assetPath={selectedFile}
                />
              ) : (
                <Skeletonize loading={isLoading} className="contents">
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
                          <SkeletonBox>{assets.length}</SkeletonBox>
                        </Text>
                      </Stack>
                      {isLoading || skill?.meta.license ? (
                        <Stack gap={0}>
                          <Text variant="caption">
                            {t('skills.metadata.license', {
                              defaultValue: 'License',
                            })}
                          </Text>
                          <Text variant="label">
                            <SkeletonBox>
                              {skill?.meta.license ?? 'MIT'}
                            </SkeletonBox>
                          </Text>
                        </Stack>
                      ) : null}
                    </HStack>

                    <FormSection
                      label={t('skills.section.overview', {
                        defaultValue: 'Overview',
                      })}
                    >
                      <Stack gap={3}>
                        <Stack gap={1}>
                          <Text variant="caption">
                            {t('skills.form.slug', { defaultValue: 'Slug' })}
                          </Text>
                          <Text as="span" variant="code">
                            <SkeletonBox>
                              {skill?.meta.name ?? slug}
                            </SkeletonBox>
                          </Text>
                        </Stack>
                        <Stack gap={1}>
                          <Text variant="caption">
                            {t('skills.form.description', {
                              defaultValue: 'Description',
                            })}
                          </Text>
                          <Text variant="body" className="whitespace-pre-wrap">
                            {isLoading ? (
                              <SkeletonText lines={2} />
                            ) : description ? (
                              description
                            ) : (
                              <Text as="span" variant="muted">
                                {t('skills.detail.descriptionEmpty', {
                                  defaultValue: '(no description)',
                                })}
                              </Text>
                            )}
                          </Text>
                        </Stack>
                      </Stack>
                    </FormSection>

                    <FormSection
                      label={t('skills.section.body', {
                        defaultValue: 'Instructions (body)',
                      })}
                    >
                      <div
                        className={
                          markdownWrapperStyles +
                          ' border-border bg-background rounded-md border p-4'
                        }
                      >
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
                    </FormSection>

                    <FormSection
                      label={t('skills.section.bundle', {
                        defaultValue: 'Bundle files',
                      })}
                    >
                      <SkillBundleAssetsList assets={placeholderAssets} />
                    </FormSection>

                    <FormSection
                      label={t('skills.section.auditHistory', {
                        defaultValue: 'Recent changes',
                      })}
                    >
                      {Array.isArray(auditRows) && auditRows.length === 0 ? (
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
                                className="border-border rounded-md border px-3 py-2"
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
                    </FormSection>
                  </Stack>
                </Skeletonize>
              )}
            </div>
          </div>
        )}
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

function SkillBundleAssetsList({
  assets,
}: {
  assets: Array<{ path: string; size: number }>;
}) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  if (assets.length === 0) {
    return (
      <Text variant="muted">
        {t('skills.bundle.empty', { defaultValue: 'No bundle files yet.' })}
      </Text>
    );
  }
  return (
    <Stack gap={1} className="border-border rounded-md border p-2">
      {assets.map((f) => (
        <HStack
          key={f.path}
          gap={2}
          align="center"
          justify="between"
          className="px-2 py-1.5"
        >
          <Text as="span" variant="body" className="font-mono text-sm">
            <SkeletonBox>{f.path}</SkeletonBox>
          </Text>
          <Text as="span" variant="caption">
            <SkeletonBox>{formatBytes(f.size, locale)}</SkeletonBox>
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}
