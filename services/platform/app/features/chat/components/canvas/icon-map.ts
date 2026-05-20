import {
  Code,
  FileText,
  GitBranch,
  Globe,
  Image as ImageIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { CanvasContentType } from './canvas-context';

/**
 * Canonical icon / label / extension / mime mappings for every
 * `CanvasContentType`. Consolidates what used to be three drift-prone
 * copies (canvas-pane, artifact-bar, message-bubble) plus the inline
 * `extensions` / `mimeTypes` literals in `canvas-pane.handleDownload`.
 *
 * Label keys point at `chat.canvas.typeLabel.<type>` — callers resolve
 * via `useT('chat')` so language is not baked into the map.
 */

export const CANVAS_TYPE_ICONS: Record<
  CanvasContentType,
  ComponentType<{ className?: string }>
> = {
  code: Code,
  html: Globe,
  mermaid: GitBranch,
  svg: ImageIcon,
  markdown: FileText,
  python_runnable: Code,
  node_runnable: Code,
};

export const CANVAS_TYPE_LABEL_KEYS: Record<CanvasContentType, string> = {
  code: 'canvas.typeLabel.code',
  html: 'canvas.typeLabel.html',
  mermaid: 'canvas.typeLabel.mermaid',
  svg: 'canvas.typeLabel.svg',
  markdown: 'canvas.typeLabel.markdown',
  python_runnable: 'canvas.typeLabel.python_runnable',
  node_runnable: 'canvas.typeLabel.node_runnable',
};

/**
 * Default file extensions for "Download as…". `code` is a placeholder
 * because the caller should prefer `artifact.language` when present and
 * fall back to this only if the language field is empty.
 */
export const CANVAS_TYPE_EXTENSIONS: Record<CanvasContentType, string> = {
  code: 'txt',
  html: 'html',
  mermaid: 'mmd',
  svg: 'svg',
  markdown: 'md',
  python_runnable: 'py',
  node_runnable: 'js',
};

export const CANVAS_TYPE_MIME_TYPES: Record<CanvasContentType, string> = {
  code: 'text/plain',
  html: 'text/html',
  mermaid: 'text/plain',
  svg: 'image/svg+xml',
  markdown: 'text/markdown',
  python_runnable: 'text/x-python',
  node_runnable: 'application/javascript',
};
