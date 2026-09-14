import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { FormSection } from '@tale/ui/form-section';
import { Row, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import {
  FolderPlus,
  FolderUp,
  MessageSquare,
  Plus,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

/** Shared frames keep the chunk fallback's header and body inset in step. */
export function ProjectFilesFrame({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT('projects');
  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('files.title')}
        description={t('files.emptyDescription')}
        action={action}
      />
      {children}
    </ContentArea>
  );
}

export function ProjectAgentsFrame({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT('projects');
  return (
    <ContentArea variant="narrow" gap={6} className="min-h-0 flex-1">
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
        action={action}
      />
      {children}
    </ContentArea>
  );
}

export function ProjectFilesTreeSkeleton({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  return (
    <Skeletonize loading>
      <Stack gap={0} className="rounded-lg border p-2">
        {[0, 1, 2, 3].map((index) => (
          <Row
            key={index}
            gap={1}
            className={canEdit ? (index === 0 ? 'h-8' : 'h-9') : 'h-6'}
          >
            <Row gap={0} className="min-w-0 flex-1 gap-1.5 px-2 py-1 text-xs">
              <SkeletonBox asChild>
                <span className="size-3.5 shrink-0 rounded-sm" />
              </SkeletonBox>
              <div className="min-w-0 flex-1">
                <SkeletonText seed={index} />
              </div>
            </Row>
            {canEdit && (
              <SkeletonBox asChild>
                <span
                  className={
                    index === 0
                      ? 'size-8 shrink-0 rounded-lg'
                      : 'size-9 shrink-0 rounded-lg'
                  }
                />
              </SkeletonBox>
            )}
          </Row>
        ))}
      </Stack>
    </Skeletonize>
  );
}

export function ProjectFilesSkeleton({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  const { t } = useT('projects');
  const { t: tDocuments } = useT('documents');
  return (
    <ProjectFilesFrame
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" className="gap-2" disabled>
            <FolderPlus className="size-4" aria-hidden />
            {tDocuments('folder.newFolder')}
          </Button>
        ) : undefined
      }
    >
      <FormSection>
        <ProjectFilesTreeSkeleton canEdit={canEdit} />
        {canEdit && (
          <div>
            <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6">
              <Upload className="text-muted-foreground size-6" aria-hidden />
              <Text as="span" variant="muted">
                {t('files.addButton')}
              </Text>
            </div>
            <div className="mt-2 flex justify-center">
              <Button variant="secondary" size="sm" disabled>
                <FolderUp className="size-4" aria-hidden />
                {t('files.addFolderButton')}
              </Button>
            </div>
          </div>
        )}
      </FormSection>
    </ProjectFilesFrame>
  );
}

export function ProjectAgentRowsSkeleton({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  return (
    <Skeletonize loading>
      <Stack as="ul" gap={2}>
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <Row justify="between" gap={3} className="rounded-md border p-3">
              <Row gap={3} className="min-w-0 flex-1">
                <SkeletonBox asChild>
                  <span className="size-6 shrink-0 rounded-sm" />
                </SkeletonBox>
                <Stack gap={1} className="min-w-0 flex-1">
                  <Text className="font-medium">
                    <SkeletonText seed={index} />
                  </Text>
                  <Text variant="caption">
                    <SkeletonText seed={index + 3} />
                  </Text>
                </Stack>
              </Row>
              {canEdit && (
                <Row gap={1} className="shrink-0">
                  {[0, 1].map((action) => (
                    <SkeletonBox key={action} asChild>
                      <span className="size-9 rounded-lg" />
                    </SkeletonBox>
                  ))}
                </Row>
              )}
            </Row>
          </li>
        ))}
      </Stack>
    </Skeletonize>
  );
}

export function ProjectAgentsSkeleton({
  canEdit = true,
}: {
  canEdit?: boolean;
}) {
  const { t } = useT('projects');
  return (
    <ProjectAgentsFrame
      action={
        canEdit ? (
          <Button size="sm" disabled>
            <Plus aria-hidden className="size-4" />
            {t('agents.newAgent')}
          </Button>
        ) : undefined
      }
    >
      <ProjectAgentRowsSkeleton canEdit={canEdit} />
    </ProjectAgentsFrame>
  );
}

function ProjectThreadRowsSkeleton({ shared = false }: { shared?: boolean }) {
  const { t } = useT('projects');
  return (
    <Skeletonize loading>
      <div className="divide-y rounded-lg border">
        {[0, 1, 2].map((index) => (
          <Row key={index} gap={3} className="px-4 py-3">
            <MessageSquare
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0 flex-1 text-sm">
              <SkeletonText seed={index} />
            </div>
            {shared ? (
              <Text variant="caption" className="w-20">
                <SkeletonText />
              </Text>
            ) : (
              <Switch disabled label={t('threads.shareToggle')} />
            )}
          </Row>
        ))}
      </div>
    </Skeletonize>
  );
}

export function ProjectThreadsSkeleton() {
  const { t } = useT('projects');
  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('threads.yourChats')}
        description={t('threads.subtitle')}
        action={<Button disabled>{t('overview.newChatCta')}</Button>}
      />
      <FormSection>
        <Text variant="muted" className="text-sm">
          {t('threads.shareToggleDisclosure')}
        </Text>
        <ProjectThreadRowsSkeleton />
      </FormSection>
      <PageSection
        title={t('threads.sharedWithProject')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        <ProjectThreadRowsSkeleton shared />
      </PageSection>
    </ContentArea>
  );
}
