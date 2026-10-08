'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { SchemaTree } from '@tale/ui/schema-tree';
import { useId, type ReactNode } from 'react';

import type { NodeDef } from '@/lib/engine/core/types';
import { isUnknown, toTs } from '@/lib/engine/core/typing/shape';
import { useT } from '@/lib/i18n/client';
import type {
  TypesView,
  WireShape,
} from '@/lib/shared/schemas/automation-issues';

import { nodeTitle } from '../lib/node-face';

/** Where the check stands: shapes on screen may be from the last answer. */
export type ShapeStatus = 'pending' | 'checking' | 'ready' | 'failed';

/** A shape with its TypeScript behind "Show as TypeScript". */
export function ShapeBlock({
  title,
  shape,
  children,
}: {
  title: string;
  shape: WireShape;
  /** A line between the title and the fields: where the shape comes from. */
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1.5">
      <h4 id={titleId} className="text-foreground text-sm font-medium">
        {title}
      </h4>
      {children}
      <SchemaTree
        schema={shape}
        density="comfortable"
        aria-label={title}
        {...(!isUnknown(shape) && { typeScript: toTs(shape) })}
      />
    </section>
  );
}

/** The words for where a node's output shape comes from. */
function originText(
  node: NodeDef,
  shape: WireShape,
  t: ReturnType<typeof useT>['t'],
  words: { connector?: string; type: string },
): string {
  if (isUnknown(shape)) return t('editor.shape.origin.unknown');
  switch (shape['x-origin']) {
    case 'declared':
      return t('editor.shape.origin.declared');
    case 'signature':
      return t('editor.shape.origin.signature', {
        connector: words.connector ?? node.type,
      });
    case 'fixed':
      return t('editor.shape.origin.fixed', { type: words.type });
    case 'child':
      return t('editor.shape.origin.child', {
        automation:
          typeof node.automation === 'string'
            ? nodeTitle(node.automation.split('/').at(-1) ?? node.automation)
            : node.type,
      });
    default:
      return t('editor.shape.origin.inferred');
  }
}

/** A line saying the shapes on screen are being brought up to date, or
 *  could not be worked out. */
export function ShapeStatusLine({ status }: { status: ShapeStatus }) {
  const { t } = useT('automations');
  if (status === 'failed') {
    return (
      <p className="text-muted-foreground text-xs">
        {t('editor.shape.unavailable')}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs" role="status">
      {status === 'checking' || status === 'pending'
        ? t('editor.shape.checking')
        : null}
    </p>
  );
}

export interface NodeShapePanelProps {
  node: NodeDef;
  /** The draft check's shapes; null until it answered. */
  types: TypesView | null;
  status: ShapeStatus;
  /** The connector's name and the node type's word, for the origin line. */
  words: { connector?: string; type: string };
  /** The nodes that read this node's output, in run order. */
  readers: readonly string[];
  /** The automation's output reads this node. */
  readByOutput: boolean;
  /** Selects a node, or End, on the canvas. */
  onSelect?: (id: string) => void;
  /** End's id on the canvas. */
  endId: string;
}

/**
 * The Shape tab: what a node receives (each item too, under For each),
 * what it returns and where that shape comes from, and which nodes read
 * it — the draft check's inferred shapes, shown as fields with their
 * kinds and, behind a disclosure, as TypeScript.
 */
export function NodeShapePanel({
  node,
  types,
  status,
  words,
  readers,
  readByOutput,
  onSelect,
  endId,
}: NodeShapePanelProps) {
  const { t } = useT('automations');
  const readByTitleId = useId();
  const info =
    types !== null && Object.hasOwn(types.nodes, node.id)
      ? types.nodes[node.id]
      : undefined;
  const stale = status === 'checking' || status === 'pending';
  return (
    <div className="flex flex-col gap-4" {...(stale && { 'aria-busy': true })}>
      <ShapeStatusLine status={status} />
      <div
        className={cn(
          'flex flex-col gap-4 transition-opacity duration-[var(--duration-short)] motion-reduce:transition-none',
          stale && info !== undefined && 'opacity-60',
        )}
      >
        {info?.input !== undefined && (
          <ShapeBlock
            title={
              node.type === 'transform'
                ? t('editor.shape.receivesCode')
                : t('editor.shape.receives')
            }
            shape={info.input}
          />
        )}
        {info?.item !== undefined && typeof node.forEach === 'string' && (
          <ShapeBlock title={t('editor.shape.item')} shape={info.item} />
        )}
        {info !== undefined && (
          <ShapeBlock title={t('editor.shape.returns')} shape={info.output}>
            <p className="text-muted-foreground text-xs">
              {originText(node, info.output, t, words)}
            </p>
          </ShapeBlock>
        )}
      </div>
      <section aria-labelledby={readByTitleId} className="flex flex-col gap-1">
        <h4 id={readByTitleId} className="text-foreground text-sm font-medium">
          {t('editor.shape.readBy')}
        </h4>
        {readers.length === 0 && !readByOutput ? (
          <p className="text-muted-foreground text-xs">
            {t('editor.shape.notRead')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {readers.map((id) => (
              <li key={id}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={onSelect === undefined}
                  onClick={() => onSelect?.(id)}
                >
                  {nodeTitle(id)}
                </Button>
              </li>
            ))}
            {readByOutput && (
              <li>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={onSelect === undefined}
                  onClick={() => onSelect?.(endId)}
                >
                  {t('editor.shape.readByOutput')}
                </Button>
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
