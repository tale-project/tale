'use client';

import { CopyableField } from '@tale/ui/copyable-field';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Heading } from '@tale/ui/heading';
import { useT } from '@tale/ui/i18n/client';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { Pencil, X, type LucideIcon } from 'lucide-react';
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
  /** A short muted summary under the name */
  summary?: ReactNode;
  /** Status badges alongside the record name */
  badges?: ReactNode;
  /** An image that identifies the record (a product photo) … */
  media?: ReactNode;
  /** … or a small icon beside the name when the record has no image */
  icon?: LucideIcon;
  /**
   * The record's edit dialog. Adds an Edit button to the header that hands
   * the frame over to the form; cancelling returns to the details.
   * Omit it when the viewer may not edit this record.
   */
  edit?: EntityViewEdit;
  /** Further header shortcuts, after Edit — the row menu's other verbs */
  actions?: EntityViewAction[];
  /** Key facts in aligned metadata rows; long values use the full width */
  facts?: StatGridItem[];
  /** Primary reading content, before supporting metadata. */
  content?: ReactNode;
  /** Quiet copyable identifier, rendered after all record content. */
  identifier?: { label: string; value: string };
  /** Sections below the facts — wrap each in `EntityViewSection` */
  children?: ReactNode;
  /**
   * Stable element to restore focus to when the captured opener unmounts before
   * close (e.g. the row menu item that opened the details).
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Read-only details of one knowledge record — a product, contact, website, or
 * knowledge entry — in the layout every record shares: an identity block
 * (image or icon, name, summary, badges), the key facts, then any sections of
 * its own. Details use a comfortable reading width and grow with their content
 * instead of reserving the form's minimum height.
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
  identifier,
  content,
  children,
  restoreFocusRef,
}: EntityViewDialogProps) {
  const { t } = useT('common');
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

  const Icon = icon;

  return (
    <>
      <ViewDialog
        open={open && !editing}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        size="lg"
        className="gap-6 overflow-hidden"
        restoreFocusRef={restoreFocusRef}
        customHeader={
          <Row gap={3} align="start">
            {media}
            {!media && Icon ? (
              <Icon
                className="text-muted-foreground mt-1 size-5 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <Stack gap={2} className="min-w-0 flex-1">
              <Row gap={2} wrap>
                <Heading level={3} size="lg" className="min-w-0 wrap-anywhere">
                  {name}
                </Heading>
                {badges ? (
                  <Row gap={1} wrap>
                    {badges}
                  </Row>
                ) : null}
              </Row>
              {summary ? (
                <Text variant="muted" className="wrap-anywhere">
                  {summary}
                </Text>
              ) : null}
              {description ? <Text variant="muted">{description}</Text> : null}
            </Stack>
            <Row gap={1} className="-mt-1 -mr-1 shrink-0">
              {headerButtons.map((action) => (
                <IconButton
                  key={action.key}
                  icon={action.icon}
                  size="sm"
                  aria-label={action.label}
                  onClick={action.onClick}
                  disabled={action.disabled}
                />
              ))}
              <IconButton
                icon={X}
                size="sm"
                aria-label={t('aria.close')}
                onClick={() => onOpenChange(false)}
              />
            </Row>
          </Row>
        }
      >
        <Stack gap={6}>
          {content}

          {facts && facts.length > 0 ? (
            <StatGrid items={facts} layout="rows" />
          ) : null}

          {children}

          {identifier ? (
            <Row gap={3} className="pt-1" align="center">
              <Text variant="caption" className="shrink-0">
                {identifier.label}
              </Text>
              <CopyableField
                value={identifier.value}
                className="min-w-0 flex-1"
                inputClassName="border-0 bg-transparent px-1 py-1.5 [&>span]:text-xs"
              />
            </Row>
          ) : null}
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
      <Row gap={2} justify="between" wrap>
        <Heading id={headingId} level={3} size="sm">
          {title}
        </Heading>
        {meta ? <Text variant="caption">{meta}</Text> : null}
      </Row>
      {children}
    </Stack>
  );
}
