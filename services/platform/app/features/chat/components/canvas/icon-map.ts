import {
  Code,
  FileText,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Terminal,
  TerminalSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { CanvasContentType } from './canvas-context';

/**
 * Type guard for runnable artifact types. Centralized here (over inline
 * `t === 'script_runnable' || ...'`) so the runnable set has one source
 * of truth — adding `ruby_runnable` would touch this guard, the
 * language switch below, and nothing else.
 */
export function isRunnableArtifactType(
  type: CanvasContentType,
): type is 'script_runnable' | 'python_runnable' | 'node_runnable' {
  return (
    type === 'script_runnable' ||
    type === 'python_runnable' ||
    type === 'node_runnable'
  );
}

/**
 * Returns the highlighter / extension language for a runnable type, or
 * undefined for non-runnable types. Mirrors the agent-tool side helper
 * in `convex/agent_tools/artifacts/shared.ts:runnableLanguage` so the
 * client and the server agree on the python/node mapping.
 *
 * `script_runnable` is polyglot — the entry file extension is the
 * authoritative source per file, so this helper returns undefined and
 * callers should fall back to inferring from the active file path.
 */
export function runnableLanguage(
  type: CanvasContentType,
): 'python' | 'javascript' | undefined {
  if (type === 'python_runnable') return 'python';
  if (type === 'node_runnable') return 'javascript';
  return undefined;
}

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
  // Runnable types get terminal-flavored icons so the chat list and the
  // canvas tabs distinguish at-a-glance between static `code` snippets
  // (Code icon) and an executable sandbox artifact (Terminal icons).
  // Polyglot `script_runnable` shares the Python icon since the entry
  // default is `main.py`; per-file shading (.js shows the Node icon)
  // is handled by the file-tree, not this top-level type icon.
  script_runnable: TerminalSquare,
  python_runnable: TerminalSquare,
  node_runnable: Terminal,
};

export const CANVAS_TYPE_LABEL_KEYS: Record<CanvasContentType, string> = {
  code: 'canvas.typeLabel.code',
  html: 'canvas.typeLabel.html',
  mermaid: 'canvas.typeLabel.mermaid',
  svg: 'canvas.typeLabel.svg',
  markdown: 'canvas.typeLabel.markdown',
  script_runnable: 'canvas.typeLabel.script_runnable',
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
  // `script_runnable` defaults to .py — callers should prefer the active
  // file's actual extension via the per-file API when available.
  script_runnable: 'py',
  python_runnable: 'py',
  node_runnable: 'js',
};

export const CANVAS_TYPE_MIME_TYPES: Record<CanvasContentType, string> = {
  code: 'text/plain',
  html: 'text/html',
  mermaid: 'text/plain',
  svg: 'image/svg+xml',
  markdown: 'text/markdown',
  script_runnable: 'text/x-python',
  python_runnable: 'text/x-python',
  node_runnable: 'application/javascript',
};
