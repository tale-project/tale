'use client';

import { useQuery } from 'convex/react';
import {
  Code,
  FileText,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { memo, useEffect, useRef, type ComponentType } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Button } from '@/app/components/ui/primitives/button';
import { api } from '@/convex/_generated/api';
import type { ArtifactListItem } from '@/convex/artifacts/queries';
import { useT } from '@/lib/i18n/client';

import { useCanvas, type CanvasContentType } from './canvas-context';

const TYPE_ICONS: Record<
  CanvasContentType,
  ComponentType<{ className?: string }>
> = {
  code: Code,
  html: Globe,
  mermaid: GitBranch,
  svg: ImageIcon,
  markdown: FileText,
};

interface ArtifactBarProps {
  organizationId: string;
  threadId: string;
}

function ArtifactBarComponent({ organizationId, threadId }: ArtifactBarProps) {
  const { t } = useT('chat');
  const artifacts = useQuery(api.artifacts.queries.listByThread, {
    organizationId,
    threadId,
  });
  const { openCanvas, artifactId: openArtifactId } = useCanvas();

  // Pull focus to each newly-created artifact exactly once. If the AI calls
  // artifact_create multiple times in a turn, we follow whichever one
  // appeared most recently — ChatGPT-Canvas behaviour. We key off
  // `createdAt` (immutable) so an artifact_edit revision does not
  // re-trigger the switch; the existing `useQuery` subscription updates
  // the open canvas in place.
  const autoOpenedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!artifacts || artifacts.length === 0) return;
    const newest = artifacts.reduce<ArtifactListItem | undefined>((acc, a) => {
      if (!acc) return a;
      return a.createdAt > acc.createdAt ? a : acc;
    }, undefined);
    if (!newest) return;
    if (autoOpenedRef.current.has(newest._id)) return;
    autoOpenedRef.current.add(newest._id);
    openCanvas(newest._id);
  }, [artifacts, openCanvas]);

  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div
      className="border-border bg-background/50 flex shrink-0 items-center gap-2 overflow-x-auto border-b px-4 py-2"
      role="region"
      aria-label={t('artifacts.barLabel')}
    >
      <span className="text-muted-foreground shrink-0 text-xs">
        {t('artifacts.barTitle')}
      </span>
      {artifacts.map((artifact) => {
        const Icon = TYPE_ICONS[artifact.type];
        const isStreaming = artifact.liveStreamMode !== undefined;
        const isOpen = openArtifactId === artifact._id;
        return (
          <Button
            key={artifact._id}
            variant={isOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
            onClick={() => openCanvas(artifact._id)}
            aria-label={t('artifacts.openCard', { title: artifact.title })}
          >
            {isStreaming ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="size-3.5" aria-hidden="true" />
            )}
            <span className="max-w-[14rem] truncate">{artifact.title}</span>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              v{artifact.revision}
            </Badge>
          </Button>
        );
      })}
    </div>
  );
}

export const ArtifactBar = memo(ArtifactBarComponent);
