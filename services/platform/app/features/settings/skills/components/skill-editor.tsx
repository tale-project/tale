'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDeleteSkill } from '../hooks/mutations';
import { useSkill, useSkillAssets } from '../hooks/queries';
import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';

/**
 * One skill, read-only: the bundle's file tree beside the rendered document.
 *
 * The library is a BROWSING surface — a bundle changes only through a package
 * upload (whole-bundle replace with a history trail), never through in-place
 * edits, so `SKILL.md` renders the way a reader sees it and the metadata
 * (description, visibility, labels) shows as facts rather than fields. The
 * one mutation that stays local is Delete, gated on the same `canEdit` the
 * server computes (owner, or org admin for shared skills).
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
  const deleteSkill = useDeleteSkill();

  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 'SKILL.md' (the rendered document) or a bundle asset. */
  const [selectedPath, setSelectedPath] = useState('SKILL.md');

  const skill = skillQuery.data;

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
        {skill.canEdit && (
          <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="text-destructive mr-1 size-4" />
            {tCommon('actions.delete')}
          </Button>
        )}
      </Row>

      {/* One bounded card, split like main's detail panel: the tree owns a
          fixed-width, internally-scrolling rail (hidden on small screens),
          and the right pane renders the selected file read-only. The card
          takes EXACTLY the height the settings scroll area has left
          (fitToContainer threads flex-1 down from the page shell — no
          viewport math); each side scrolls itself. */}
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
            <SkillDocument
              description={skill.description}
              visibility={skill.visibility}
              labels={skill.labels ?? []}
              body={skill.body}
              t={t}
            />
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

/**
 * The rendered `SKILL.md`: the frontmatter facts a reader needs (description,
 * visibility, labels), then the body exactly as a model or teammate reads it.
 */
function SkillDocument({
  description,
  visibility,
  labels,
  body,
  t,
}: {
  description: string;
  visibility: 'private' | 'org';
  labels: string[];
  body: string;
  t: ReturnType<typeof useT>['t'];
}) {
  return (
    <div className="flex min-h-full flex-col">
      <Stack
        gap={2}
        className="border-border bg-muted/30 shrink-0 border-b px-4 py-3"
        data-testid="skill-document-meta"
      >
        <Text as="p" variant="muted" className="text-sm">
          {description}
        </Text>
        <HStack gap={2} align="center" className="flex-wrap">
          <Badge variant="outline">
            {visibility === 'private'
              ? t('skills.visibility.private')
              : t('skills.visibility.org')}
          </Badge>
          {labels.map((label) => (
            <Badge key={label} variant="slate">
              {label}
            </Badge>
          ))}
        </HStack>
      </Stack>
      <div
        className={cn('min-h-0 flex-1 p-4', markdownWrapperStyles)}
        data-testid="skill-document-body"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon" onClick={onBack} title={label}>
      <ArrowLeft className="text-muted-foreground size-5" />
    </Button>
  );
}
