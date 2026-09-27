'use client';

import { EditorActions, useActiveEditor } from '@tale/ui/editor';

/**
 * An automation page's Save/Discard cluster.
 *
 * It reads the ACTIVE editor from the shell's registry instead of taking the
 * controller as a prop, so the shell that mounts `ActiveEditorProvider` owns
 * the one cluster on screen: the automation detail shell mounts a provider
 * around every tab and renders no cluster of its own, so exactly one — this
 * one, portaled into the tab strip by the open tab — is ever on screen.
 */
export function AutomationEditorActions() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="automation" />;
}
