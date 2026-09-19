'use client';

import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { Pencil, type LucideIcon } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useState,
} from 'react';

export interface EntityViewAction {
  /** Unique key for the action */
  key: string;
  /** Accessible name, also shown as the button's tooltip */
  label: string;
  /** Icon to display */
  icon: LucideIcon;
  /** Click handler */
  onClick: () => void;
  /** Whether to show this action */
  visible?: boolean;
  /** Whether the action is disabled */
  disabled?: boolean;
}

export interface EntityViewEdit {
  /** Accessible name of the header's edit button */
  label: string;
  /**
   * Renders the record's edit dialog, open. Wire its cancel to `onBack`, which
   * brings the details back, and a successful save to `onDone`, which closes
   * the details as well.
   */
  render: (handlers: { onBack: () => void; onDone: () => void }) => ReactNode;
}

export interface EntityViewDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Product details" */
  title: string;
  /** Optional description below the title */
  description?: ReactNode;
  /** The record's name — the heading of its identity block */
  name: ReactNode;
  /** A short muted summary under the name, clamped to two lines */
  summary?: ReactNode;
  /** Status badges under the summary */
  badges?: ReactNode;
  /** An image that identifies the record (a product photo) … */
  media?: ReactNode;
  /** … or an icon drawn in the shared tile when the record has no image */
  icon?: LucideIcon;
  /**
   * The record's edit dialog. Adds an Edit button to the header that hands
   * the frame over to the form; cancelling returns to the details.
   * Omit it when the viewer may not edit this record.
   */
  edit?: EntityViewEdit;
  /** Further header shortcuts, after Edit — the row menu's other verbs */
  actions?: EntityViewAction[];
  /** Key facts in the two-column grid; long values span both columns */
  facts?: StatGridItem[];
  /** Sections below the facts — wrap each in `EntityViewSection` */
  children?: ReactNode;
  /**
   * Stable element to restore focus to when the captured opener unmounts before
   * close (e.g. the row menu item that opened the details).
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** The square tile that stands in for a record image. */
function EntityViewIconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Row
      gap={0}
      justify="center"
      className="bg-muted size-16 shrink-0 rounded-lg"
    >
      <Icon className="text-muted-foreground size-6" aria-hidden="true" />
    </Row>
  );
}

/**
 * Read-only details of one knowledge record — a product, contact, website, or
 * knowledge entry — in the layout every record shares: an identity block
 * (image or icon, name, summary, badges), the key facts, then any sections of
 * its own. The dialog uses the `entity` measure, the same frame as the
 * record's create and edit dialogs.
 *
 * @example
 * ```tsx
 * <EntityViewDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Product details"
 *   name={product.name}
 *   summary={product.description}
 *   badges={<Badge>Active</Badge>}
 *   media={<ProductImage product={product} />}
 *   edit={{
 *     label: 'Edit',
 *     render: ({ onBack, onDone }) => (
 *       <ProductEditDialog
 *         isOpen
 *         onClose={onBack}
 *         onSaved={onDone}
 *         product={product}
 *       />
 *     ),
 *   }}
 *   facts={[{ label: 'Price', value: 'CHF 89.90' }]}
 * />
 * ```
 */
export function EntityViewDialog({
  open,
  onOpenChange,
  title,
  description,
  name,
  summary,
  badges,
  media,
  icon,
  edit,
  actions,
  facts,
  children,
  restoreFocusRef,
}: EntityViewDialogProps) {
  // While the edit dialog is up the details step aside rather than stacking
  // two modals. Cancelling the edit brings them back; saving closes both, so
  // the details never reopen on values the save has just made stale — some
  // records are replaced by a new version when saved.
  const [isEditing, setIsEditing] = useState(false);
  // Editing only while there is still an edit dialog to show: if the viewer
  // loses the right to edit mid-edit, the details come back instead of both
  // dialogs vanishing.
  const editing = isEditing && edit !== undefined;

  useEffect(() => {
    if (!open) setIsEditing(false);
  }, [open]);

  const headerButtons: EntityViewAction[] = [
    ...(edit
      ? [
          {
            key: 'edit',
            label: edit.label,
            icon: Pencil,
            onClick: () => setIsEditing(true),
          },
        ]
      : []),
    ...(actions ?? []).filter((action) => action.visible !== false),
  ];

  const identityMedia =
    media ?? (icon ? <EntityViewIconTile icon={icon} /> : null);

  return (
    <>
      <ViewDialog
        open={open && !editing}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        size="entity"
        restoreFocusRef={restoreFocusRef}
        headerActions={
          headerButtons.length > 0 ? (
            <Row gap={1}>
              {headerButtons.map((action) => (
                <IconButton
                  key={action.key}
                  icon={action.icon}
                  aria-label={action.label}
                  onClick={action.onClick}
                  disabled={action.disabled}
                />
              ))}
            </Row>
          ) : undefined
        }
      >
        <Stack gap={4}>
          <Row gap={4} align="start">
            {identityMedia}
            <Stack gap={1} className="min-w-0 flex-1">
              <Heading level={3} className="wrap-anywhere">
                {name}
              </Heading>
              {summary ? (
                <Text variant="muted" className="line-clamp-2">
                  {summary}
                </Text>
              ) : null}
              {badges ? (
                <Row gap={2} wrap className="mt-1">
                  {badges}
                </Row>
              ) : null}
            </Stack>
          </Row>

          {facts && facts.length > 0 ? (
            <>
              <Separator />
              <StatGrid items={facts} />
            </>
          ) : null}

          {children}
        </Stack>
      </ViewDialog>

      {open && editing
        ? edit.render({
            onBack: () => setIsEditing(false),
            onDone: () => {
              setIsEditing(false);
              onOpenChange(false);
            },
          })
        : null}
    </>
  );
}

interface EntityViewSectionProps {
  /** Section heading */
  title: string;
  /** Right-aligned caption next to the heading, e.g. a count */
  meta?: ReactNode;
  children: ReactNode;
}

/**
 * A titled section inside `EntityViewDialog`, below the key facts — a
 * website's crawled pages, a knowledge entry's version history.
 */
export function EntityViewSection({
  title,
  meta,
  children,
}: EntityViewSectionProps) {
  const headingId = useId();

  return (
    <Stack as="section" gap={3} aria-labelledby={headingId}>
      <Separator />
      <Row gap={2} justify="between">
        <Heading id={headingId} level={3} size="sm">
          {title}
        </Heading>
        {meta ? <Text variant="caption">{meta}</Text> : null}
      </Row>
      {children}
    </Stack>
  );
}
