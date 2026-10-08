'use client';

/**
 * One message of a conversation — a chat turn, a task comment, an agent's
 * report — in one of two shapes:
 *
 * - `own`: what the viewer wrote, a right-aligned muted bubble with its
 *   time, `(edited)` and actions on a row under it;
 * - `other`: everyone else (teammates, agents, the assistant), flat prose
 *   under an identity row — avatar, name, a role badge, clock time — with
 *   the body indented to the name.
 *
 * A `continuation` (the same author again, minutes later, nothing between)
 * drops the identity row and closes up to the previous message. `header={null}`
 * hides the identity row altogether, as the chat does for the assistant.
 *
 * Actions stay out of the way until they are wanted: they show on hover, on
 * keyboard focus anywhere in the message, while one of their menus is open,
 * and always on a touch screen, which has no hover.
 *
 * Everything else — who may edit, what the body renders, how a name opens a
 * profile — is the host's: the slots take finished nodes. The root forwards
 * `className`, `ref` and any `data-*` / `aria-*` attribute, so a list can
 * hang its anchors, windowing indexes and `content-visibility` on the row.
 */

import { ReadMore } from '@tale/ui/read-more';
import {
  useCallback,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

import { cn } from '../../lib/cn';
import {
  THREAD_OWN_BUBBLE_CLASS,
  THREAD_OWN_BUBBLE_SURFACE_CLASS,
  THREAD_OWN_BUBBLE_WIDTH_CLASS,
} from './layout';

/** Shown on hover, keyboard focus, an open menu, and always on touch. */
export const THREAD_REVEAL_CLASS =
  'opacity-0 transition-opacity group-hover/thread-message:opacity-100 group-focus-within/thread-message:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none';

type ThreadMessageElement = 'div' | 'li' | 'article';

export interface ThreadMessageProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  /** `own` for the viewer's words, `other` for everyone else. */
  variant?: 'own' | 'other';
  /** The root element; `li` inside a thread list. @default 'div' */
  as?: ThreadMessageElement;
  /** The author's avatar, 24px (`<Avatar size="sm" />`). */
  avatar?: ReactNode;
  /** The author's name, or a control that opens their profile. */
  author?: ReactNode;
  /** A quiet role marker after the name, such as an "Agent" badge. */
  badge?: ReactNode;
  /** When it was written — usually `<ThreadTime />`. */
  time?: ReactNode;
  /** More quiet facts after the time, such as "(edited)". */
  meta?: ReactNode;
  /** Icon buttons for the message (size-7, ghost). */
  actions?: ReactNode;
  /**
   * Replace the identity row of an `other` message; `null` hides it and
   * lets the body use the full width.
   */
  header?: ReactNode;
  /** The same author again: no identity row, a tighter gap. */
  continuation?: boolean;
  /**
   * Clamp a long body behind "Read more" at this height in pixels
   * (`ReadMore`). Off by default.
   */
  clampHeight?: number;
  headerClassName?: string;
  bodyClassName?: string;
  actionsClassName?: string;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function ThreadMessage({
  variant = 'other',
  as: Tag = 'div',
  avatar,
  author,
  badge,
  time,
  meta,
  actions,
  header,
  continuation = false,
  clampHeight,
  headerClassName,
  bodyClassName,
  actionsClassName,
  className,
  children,
  ref,
  ...props
}: ThreadMessageProps) {
  // A polymorphic root takes a callback ref: a ref object typed for one
  // element would not fit the others.
  const setRoot = useCallback(
    (node: HTMLElement | null) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const own = variant === 'own';
  const hasIdentity = !own && header !== null;
  const showIdentity = hasIdentity && !continuation;

  const facts = (time !== undefined || meta !== undefined) && (
    <>
      {time !== undefined && (
        <span className="text-muted-foreground shrink-0 text-xs">{time}</span>
      )}
      {meta !== undefined && (
        <span className="text-muted-foreground text-xs">{meta}</span>
      )}
    </>
  );

  const actionCluster = actions !== undefined && (
    <div
      data-slot="thread-message-actions"
      className={cn(
        THREAD_REVEAL_CLASS,
        'flex shrink-0 items-center gap-0.5',
        actionsClassName,
      )}
    >
      {actions}
    </div>
  );

  const body = (() => {
    if (own) {
      if (clampHeight === undefined) {
        return (
          <div
            data-slot="thread-message-body"
            className={cn(THREAD_OWN_BUBBLE_CLASS, bodyClassName)}
          >
            {children}
          </div>
        );
      }
      return (
        <ReadMore
          maxHeight={clampHeight}
          align="end"
          fadeClassName="from-muted"
          className={THREAD_OWN_BUBBLE_WIDTH_CLASS}
          contentClassName={cn(THREAD_OWN_BUBBLE_SURFACE_CLASS, bodyClassName)}
        >
          {children}
        </ReadMore>
      );
    }
    const bodyClass = cn(
      'min-w-0 text-sm leading-6 break-words',
      hasIdentity && 'pl-8',
      bodyClassName,
    );
    if (clampHeight === undefined) {
      return (
        <div data-slot="thread-message-body" className={bodyClass}>
          {children}
        </div>
      );
    }
    return (
      <ReadMore
        maxHeight={clampHeight}
        className={hasIdentity ? 'pl-8' : undefined}
        contentClassName={cn(
          'min-w-0 text-sm leading-6 break-words',
          bodyClassName,
        )}
      >
        {children}
      </ReadMore>
    );
  })();

  return (
    <Tag
      ref={setRoot}
      {...props}
      data-variant={variant}
      {...(continuation ? { 'data-continuation': '' } : {})}
      className={cn(
        'group/thread-message relative flex min-w-0 flex-col',
        own ? 'items-end gap-1' : 'gap-1',
        // The list spaces messages 24px apart; a continuation sits 8px under
        // the one before it.
        continuation && '-mt-4',
        className,
      )}
    >
      {showIdentity && (
        <div
          data-slot="thread-message-header"
          className={cn(
            'flex min-h-6 min-w-0 items-center gap-2',
            headerClassName,
          )}
        >
          {header !== undefined ? (
            header
          ) : (
            <>
              {avatar !== undefined && (
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {avatar}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                {author !== undefined && (
                  <span className="text-foreground min-w-0 truncate text-sm font-medium">
                    {author}
                  </span>
                )}
                {badge}
                {facts}
              </div>
            </>
          )}
          {actionCluster}
        </div>
      )}

      {body}

      {own && (facts !== false || actionCluster !== false) && (
        <div
          data-slot="thread-message-footer"
          className={cn(
            'flex items-center justify-end gap-1.5',
            THREAD_REVEAL_CLASS,
          )}
        >
          {facts}
          {actions}
        </div>
      )}

      {/* With no identity row of its own, an `other` message keeps its time
          and actions in a cluster that appears over its top end. */}
      {!own &&
        hasIdentity &&
        continuation &&
        (facts !== false || actions !== undefined) && (
          <div
            data-slot="thread-message-actions"
            className={cn(
              THREAD_REVEAL_CLASS,
              'bg-background absolute top-0 right-0 flex items-center gap-1.5 rounded-md pl-1.5',
              actionsClassName,
            )}
          >
            {facts}
            {actions}
          </div>
        )}

      {!own && !hasIdentity && actionCluster}
    </Tag>
  );
}
