'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import type { ReviewNote } from '../lib/document';

/**
 * What a conversion could not re-express, said plainly.
 *
 * An automation carried over from the step runner is not finished until a
 * person has read these. Each note names the node it concerns and the reason
 * the conversion refused to guess — a per-item branch it could not flatten, a
 * capability with no node type, a model it had to choose. The panel is loud on
 * purpose and sits above the canvas: a converted automation that looks finished
 * is the failure this exists to prevent.
 */
export function NeedsReviewPanel({
  notes,
  onSelectNode,
}: {
  notes: readonly ReviewNote[];
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useT('automations');
  if (notes.length === 0) return null;

  return (
    <Alert
      variant="warning"
      icon={AlertTriangle}
      description={
        <>
          {/* The count line is a paragraph rather than the Alert's `title`
              slot: the slot renders a fixed heading level, which would skip a
              level under the page's own headings. The alert still announces. */}
          <p className="text-foreground font-medium">
            {t('review.title', { count: notes.length })}
          </p>
          <p className="mt-1">{t('review.description')}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {notes.map((note) => (
              <li
                key={`${note.node}-${note.reason}`}
                className="flex flex-wrap items-baseline gap-2"
              >
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    onSelectNode(note.node);
                  }}
                >
                  {note.node}
                </Button>
                <span className="text-foreground">{note.reason}</span>
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}
