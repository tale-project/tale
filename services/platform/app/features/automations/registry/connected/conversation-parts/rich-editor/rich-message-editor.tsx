'use client';

/**
 * The rich (Milkdown Crepe) message editor — the presentation half of the old
 * inbox `MessageEditor`, decoupled from any send path. No Convex imports
 * here: submitting, improving and attachments belong to the parent, wired in
 * through `onSubmit` and the `actions`/`attachments` slots.
 *
 * The editor is UNCONTROLLED after mount: `defaultValue` seeds the document
 * and every change reports the current markdown through `onChange`. A parent
 * that must replace the content programmatically (draft switch, improve,
 * undo, clear-on-send) remounts it with a new `key` — the same mechanics the
 * old editor used (`editorKey` remount + recreating Crepe on programmatic
 * content), just owned by the caller. `placeholder` and `defaultValue` are
 * read once per mount for the same reason.
 *
 * Milkdown is browser-only (Crepe theme CSS + ProseMirror) — render this
 * through `lazyComponent()` like the old inbox did, never in a server pass.
 */

import { Crepe } from '@milkdown/crepe';
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from '@milkdown/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { cn } from '@/lib/utils/cn';

export interface RichMessageEditorProps {
  /** Markdown that seeds the document on mount (uncontrolled afterwards). */
  defaultValue?: string;
  /** Reports the whole document as markdown on every change. */
  onChange: (markdown: string) => void;
  /** Crepe's in-document placeholder text. */
  placeholder?: string;
  /** Accessible name for the editable surface (falls back to `placeholder`). */
  ariaLabel?: string;
  /** Dims the surface and puts the editor in readonly mode. */
  disabled?: boolean;
  /** Fired on Cmd/Ctrl+Enter inside the editor. */
  onSubmit?: () => void;
  /** Slot between the editor and the action bar, e.g. an attachment list. */
  attachments?: ReactNode;
  /** Bottom action-bar slot — the parent owns its buttons (send, improve…). */
  actions?: ReactNode;
}

function RichMessageEditorInner({
  defaultValue = '',
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  onSubmit,
  attachments,
  actions,
}: RichMessageEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [hasContent, setHasContent] = useState(defaultValue.trim().length > 0);

  // Latest-callback refs so the mount-once Crepe wiring never goes stale.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Cmd/Ctrl+Enter submit — ProseMirror owns the contenteditable (its DOM is
  // not React-rendered), so listen natively on the editor area instead of a
  // JSX key handler on a non-interactive element.
  useEffect(() => {
    const node = editorAreaRef.current;
    if (!node) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSubmitRef.current?.();
      }
    };
    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEditor((root) => {
    const editor = new Crepe({
      root,
      defaultValue,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder ?? '',
        },
      },
    });

    crepeRef.current = editor;

    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        setHasContent(markdown.trim().length > 0);
        onChangeRef.current(markdown);
      });
      listener.focus(() => setIsFocused(true));
      listener.blur(() => setIsFocused(false));
    });

    return editor;
  }, []);

  const [isLoading] = useInstance();

  useEffect(() => {
    crepeRef.current?.setReadonly(disabled);
  }, [disabled, isLoading]);

  // ProseMirror's contenteditable surface is not React-rendered, so its
  // accessible name is stamped on after the editor instance exists.
  useEffect(() => {
    if (isLoading) return;
    const surface = rootRef.current?.querySelector('.ProseMirror');
    if (!surface) return;
    surface.setAttribute('role', 'textbox');
    surface.setAttribute('aria-multiline', 'true');
    const name = ariaLabel ?? placeholder;
    if (name) surface.setAttribute('aria-label', name);
  }, [isLoading, ariaLabel, placeholder]);

  const getHeightClass = () => {
    if (isFocused) return 'h-[20rem]';
    return hasContent ? 'h-[7rem]' : 'h-[5rem]';
  };

  return (
    <div
      ref={rootRef}
      className="bg-background border-border relative rounded-xl border px-3.5 pt-2.5 pb-1 shadow-sm"
    >
      <div
        ref={editorAreaRef}
        className={cn(
          'transition-all duration-300 ease-in-out overflow-y-auto',
          getHeightClass(),
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <style>{`
          .milkdown {
            .milkdown-block-handle {
              display: none !important;
            }
            .ProseMirror {
              h1:first-of-type {
                margin-top: 1rem;
              }
              h1 {
                margin-bottom: 0.5rem;
                font-size: 1.5rem;
                line-height: 1.2;
              }
              p {
                font-size: 0.875rem;
                line-height: 1.5;
              }
            }
            height: 100%;
            display: flex;
            flex-direction: column;
            --crepe-color-background: transparent;
            --crepe-color-on-background: hsl(var(--foreground));
            --crepe-color-surface: hsl(var(--background));
            --crepe-color-surface-low: hsl(var(--secondary));
            --crepe-color-on-surface: hsl(var(--foreground));
            --crepe-color-on-surface-variant: hsl(
              var(--secondary-foreground)
            );
            --crepe-color-outline: hsl(var(--border));
            --crepe-color-primary: hsl(var(--primary));
            --crepe-color-secondary: hsl(var(--secondary));
            --crepe-color-on-secondary: hsl(var(--foreground));
            --crepe-color-inverse: hsl(var(--background));
            --crepe-color-on-inverse: hsl(var(--foreground));
            --crepe-color-inline-code: hsl(var(--destructive));
            --crepe-color-error: hsl(var(--destructive));
            --crepe-color-hover: hsl(var(--muted));
            --crepe-color-selected: hsl(var(--accent));
            --crepe-color-inline-area: hsl(var(--muted));
            --crepe-font-title: var(--font-inter);
            --crepe-font-default: var(--font-inter);
          }
          .milkdown .editor {
            flex: 1;
            overflow-y: auto;
            padding: 0.5rem;
          }
          .milkdown .ProseMirror {
            height: 100%;
            outline: none;
          }
          .milkdown .ProseMirror p {
            margin: 0;
            min-height: 1rem;
          }
        `}</style>
        <Milkdown />
      </div>

      {attachments}

      {actions && <div className="pt-1">{actions}</div>}
    </div>
  );
}

export function RichMessageEditor(props: RichMessageEditorProps) {
  return (
    <MilkdownProvider>
      <RichMessageEditorInner {...props} />
    </MilkdownProvider>
  );
}
