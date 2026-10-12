'use client';

/**
 * The files a reply produced — what the assistant made with its tools: a
 * document from the light sandbox, a file it wrote out, a generated image.
 *
 * They are the deliverable, so they render below the answer as soon as they
 * exist, not behind the tool steps: images as pictures that open in the
 * gallery, every other file as a card that opens the in-app preview (a PDF,
 * a Word document, a spreadsheet render in place) with a Download beside it
 * that saves the file under its own name. A file whose bytes are gone keeps
 * its card; its preview says so.
 */

import { DocumentIcon } from '@tale/ui/document-icon';
import { formatFileSize, middleEllipsis } from '@tale/ui/format';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Download } from 'lucide-react';
import { useState } from 'react';

import {
  DocumentPreviewDialog,
  warmDocumentPreviewDialog,
} from '@/app/features/documents/components/document-preview-dialog-lazy';
import { useFileUrls } from '@/app/features/shared/files/use-file-url';
import { ImagePreviewDialog } from '@/app/features/shared/markdown/image-preview-dialog';
import { backendUrl } from '@/app/lib/backend/api-client';
import { useT } from '@/lib/i18n/client';

import type { MessagePart } from '../types';

type ArtifactPart = Extract<MessagePart, { type: 'artifact' }>;

const FILE_NAME_MAX = 40;

/** The produced files of a reply, in the order they were made. */
export function artifactsOf(parts: readonly MessagePart[]): ArtifactPart[] {
  const seen = new Set<string>();
  const artifacts: ArtifactPart[] = [];
  for (const part of parts) {
    if (part.type !== 'artifact' || seen.has(part.fileId)) continue;
    seen.add(part.fileId);
    artifacts.push(part);
  }
  return artifacts;
}

/** A link that saves the file under its own name: the files door answers
 * it with a short-lived signed URL whose disposition carries the name. */
function downloadHref(artifact: ArtifactPart, organizationId: string): string {
  return backendUrl(
    `/files/serve?ref=${encodeURIComponent(artifact.fileId)}&filename=${encodeURIComponent(artifact.name)}`,
    organizationId,
  );
}

/** The type a person recognizes: the extension, upper-cased. */
function typeLabel(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toUpperCase();
}

function ArtifactCard({
  artifact,
  organizationId,
}: {
  artifact: ArtifactPart;
  organizationId: string;
}) {
  const { t } = useT('chat');
  const [previewOpen, setPreviewOpen] = useState(false);
  const type = typeLabel(artifact.name);
  const detail = [type, formatFileSize(artifact.sizeBytes)]
    .filter((piece) => piece !== undefined && piece !== '')
    .join(' · ');
  return (
    <li className="flex max-w-full min-w-0">
      <Row
        gap={2}
        className="border-border bg-background hover:bg-muted/50 w-80 max-w-full min-w-0 rounded-lg border py-1.5 pr-1.5 pl-2 transition-colors"
      >
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          onPointerEnter={warmDocumentPreviewDialog}
          onFocus={warmDocumentPreviewDialog}
          aria-label={t('artifacts.open', { name: artifact.name })}
          className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border-none bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <DocumentIcon fileName={artifact.name} className="size-8 shrink-0" />
          <Stack gap={0} className="min-w-0">
            <Text as="span" variant="label" title={artifact.name}>
              {middleEllipsis(artifact.name, FILE_NAME_MAX)}
            </Text>
            <Text as="span" variant="caption">
              {detail}
            </Text>
          </Stack>
        </button>
        <IconButton
          icon={Download}
          size="sm"
          aria-label={t('artifacts.download', { name: artifact.name })}
          asChild
          slotChild={
            <a
              href={downloadHref(artifact, organizationId)}
              download
              aria-label={t('artifacts.download', { name: artifact.name })}
            />
          }
        />
      </Row>
      {previewOpen && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewOpen(false);
          }}
          fileId={artifact.fileId}
          fileName={artifact.name}
        />
      )}
    </li>
  );
}

function ArtifactImages({ images }: { images: readonly ArtifactPart[] }) {
  const { t } = useT('chat');
  const urls = useFileUrls(images.map((image) => image.fileId));
  const urlByFileId = new Map(
    (urls.data ?? []).map((row) => [row.fileId, row.url] as const),
  );
  const gallery = images.flatMap((image) => {
    const src = urlByFileId.get(image.fileId);
    return typeof src === 'string' && src.length > 0
      ? [{ src, alt: image.name }]
      : [];
  });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  return (
    <>
      <ul className="flex flex-wrap items-start gap-2">
        {images.map((image) => {
          const src = urlByFileId.get(image.fileId);
          if (src === undefined && urls.data === undefined) {
            return (
              <li key={image.fileId}>
                <Skeletonize loading>
                  <SkeletonBox>
                    <div className="size-40 rounded-lg" />
                  </SkeletonBox>
                </Skeletonize>
              </li>
            );
          }
          if (typeof src !== 'string' || src.length === 0) {
            // The bytes cannot be shown (gone, or not this reader's): the
            // image still has its name.
            return (
              <li key={image.fileId}>
                <Text variant="caption">{image.name}</Text>
              </li>
            );
          }
          const index = gallery.findIndex((entry) => entry.src === src);
          return (
            <li key={image.fileId}>
              <button
                type="button"
                onClick={() => setPreviewIndex(Math.max(index, 0))}
                aria-label={t('artifacts.viewImage', { name: image.name })}
                className="ring-border focus-visible:ring-ring block cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
              >
                <img
                  src={src}
                  alt={image.name}
                  className="max-h-64 w-auto max-w-[16rem] object-contain"
                />
              </button>
            </li>
          );
        })}
      </ul>
      {previewIndex !== null && gallery.length > 0 && (
        <ImagePreviewDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreviewIndex(null);
          }}
          src={gallery[previewIndex]?.src ?? ''}
          alt={gallery[previewIndex]?.alt ?? ''}
          images={gallery}
          activeIndex={Math.min(previewIndex, gallery.length - 1)}
          onActiveIndexChange={setPreviewIndex}
        />
      )}
    </>
  );
}

export function MessageArtifacts({
  parts,
  organizationId,
}: {
  parts: readonly MessagePart[];
  organizationId?: string;
}) {
  const { t } = useT('chat');
  const artifacts = artifactsOf(parts);
  if (artifacts.length === 0) return null;
  const images = artifacts.filter((artifact) =>
    artifact.mediaType.startsWith('image/'),
  );
  const files = artifacts.filter(
    (artifact) => !artifact.mediaType.startsWith('image/'),
  );
  return (
    <section aria-label={t('artifacts.label')} className="mt-2 min-w-0">
      <Stack gap={2}>
        {images.length > 0 && <ArtifactImages images={images} />}
        {files.length > 0 && organizationId !== undefined && (
          <ul className="flex min-w-0 flex-col items-start gap-1.5">
            {files.map((artifact) => (
              <ArtifactCard
                key={artifact.fileId}
                artifact={artifact}
                organizationId={organizationId}
              />
            ))}
          </ul>
        )}
      </Stack>
    </section>
  );
}
