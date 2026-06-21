'use client';

/** `stream` — a chronological feed (the agent-run spine). `params.entryKind`
 * (message | tool_call | log) hints the dominant entry type; folds transcript /
 * tool-call-card / event-log into one kind. */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileText } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import {
  asRecord,
  pickArray,
  pickString,
  scalar,
} from '../../lib/output-helpers';
import type { RenderPart } from '../../types';
import { LiveAgentTimeline } from '../live-agent-timeline';
import { OutputFallback } from '../output-fallback';
import { MarkdownFilePreview, isMarkdownFile } from './markdown-file-preview';

/** Openable harvested output files (e.g. the mandated `summary.md`). Markdown
 * files open an in-place rendered preview; everything else opens raw in a new
 * tab. */
function FileLinks({ files }: { files: NonNullable<RenderPart['files']> }) {
  const { t } = useT('operator');
  return (
    <HStack gap={2} className="flex-wrap">
      {files.map((file) =>
        isMarkdownFile(file.name) ? (
          <MarkdownFilePreview key={file.name} file={file} />
        ) : (
          <Button key={file.name} asChild variant="secondary" size="sm">
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              <FileText className="size-4" />
              {t('action.openFile', {
                name: file.name,
                defaultValue: file.name,
              })}
            </a>
          </Button>
        ),
      )}
    </HStack>
  );
}

export function StreamPanel({ part }: { part: RenderPart }) {
  const out = asRecord(part.data);
  const entries = pickArray(out, 'entries', 'transcript', 'events', 'messages');
  const files = part.files;

  // The rich LIVE transcript (a running sandbox step) takes over the feed: the
  // agent's tool/reasoning/text activity, not a flat blob. A RUNNING step always
  // renders here — even with no parts yet (a fresh start, or the gap between a
  // durable run's segments while the agent idles, e.g. waiting on CI) it shows
  // the working state (Live badge + thinking), never the raw `{status:'running'}`
  // output envelope. A terminal step with a captured timeline also renders it.
  const liveParts = part.liveParts;
  const isLive = part.partState === 'running';
  if (isLive || (liveParts !== undefined && liveParts.length > 0)) {
    return (
      <VStack gap={2}>
        <LiveAgentTimeline parts={liveParts ?? []} active={isLive} />
        {files !== undefined && files.length > 0 && <FileLinks files={files} />}
      </VStack>
    );
  }

  // The agent-run handoff summary, when present, is the headline of the feed.
  const summary = pickString(out, 'summary');

  if (
    entries.length === 0 &&
    summary === undefined &&
    (files === undefined || files.length === 0)
  ) {
    return <OutputFallback part={part} />;
  }

  return (
    <VStack gap={2}>
      {summary !== undefined && (
        <Text as="div" className="whitespace-pre-wrap">
          {summary}
        </Text>
      )}
      {files !== undefined && files.length > 0 && <FileLinks files={files} />}
      {entries.slice(0, 100).map((raw, i) => {
        const entry = asRecord(raw);
        const kind =
          pickString(entry, 'type', 'kind', 'role') ??
          part.params?.entryKind ??
          'log';
        const text =
          pickString(entry, 'text', 'content', 'message', 'name') ??
          scalar(raw);
        return (
          <HStack key={i} gap={2} className="items-start">
            <Badge variant="slate">{kind}</Badge>
            <Text as="span" className="min-w-0 whitespace-pre-wrap">
              {text}
            </Text>
          </HStack>
        );
      })}
    </VStack>
  );
}
