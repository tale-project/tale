'use client';

import { createContext } from 'react';

/**
 * The scheme of a stored file's reference (`s3:<org>/<id>`) — what a tool
 * answers a model with, and what a model sometimes writes back into its
 * reply as a Markdown image or link. Kept on links and images only where a
 * surface provides {@link MarkdownStoredFilesContext}.
 */
export const STORAGE_REF_PROTOCOLS: readonly string[] = ['s3'];

/** Whether an address in a Markdown text is a stored file's reference. */
export function isStorageRef(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('s3:') && url.length > 3;
}

/**
 * A reply's Markdown without the stored-file references its text names, for
 * a copy that leaves the chat: a picture of a stored file goes (the file
 * travels on its own), a link keeps its words. An address only Tale can read
 * means nothing where the text is pasted.
 */
export function withoutStorageRefs(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\(s3:[^)\s]*\)/g, '')
    .replace(/\[([^\]]*)\]\(s3:[^)\s]*\)/g, '$1');
}

/**
 * What a surface that owns stored files tells the Markdown it renders.
 *
 * `own` are the refs of the files the message itself carries: they are
 * drawn beside the text (a reply's pictures and cards under it), so the
 * text never draws them a second time. Any other ref names a file the
 * reader may or may not open: an image is drawn from its signed link when
 * the files door answers one, and a link opens the file through `open`.
 *
 * Absent — every surface but a chat reply — a stored file's reference in
 * the text renders as its words, never as a picture or a link that cannot
 * load.
 */
export interface MarkdownStoredFiles {
  readonly own: ReadonlySet<string>;
  /** Show the file a link names: its preview, which also downloads it. */
  readonly open: (file: { ref: string; name: string }) => void;
}

export const MarkdownStoredFilesContext = createContext<
  MarkdownStoredFiles | undefined
>(undefined);
