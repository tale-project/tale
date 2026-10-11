/**
 * The Source view's text is the engine's one YAML rendering of a document
 * (`documentYaml`): every key in the order it is stored, `ui` and `tests`
 * included, multi-line code and prompts as literal blocks, no line ever
 * folded. The same document always gives the same text, so a problem's
 * pointer is found in it (`locateYamlPointer`) at the same place on every
 * render, the text parses back to the document, and a version compare's YAML
 * lines are the Source view's lines.
 */

import { automationSlugToParam } from '@/lib/automations/slug';

/** The document as the Source view shows it. */
export { documentYaml as yamlSource } from '@/lib/engine/api/document-yaml';

/**
 * Where "go to" lands in the Source view. Apart from the inspector's
 * anchors (document pointers, `/nodes/2/prompt`) so a problem in a field
 * never goes to the Source view's text instead of the field's control.
 */
export const SOURCE_ISSUE_ANCHOR = '#source';

/**
 * The name a downloaded Source gets: the automation's name with its folders
 * joined by `__` (as in its address), the version, and `-draft` when the
 * text holds unsaved edits.
 */
export function sourceFileName(
  automationSlug: string,
  version: number | undefined,
  isDraft: boolean,
): string {
  const base = automationSlugToParam(automationSlug);
  const versioned = version === undefined ? base : `${base}-v${version}`;
  return `${versioned}${isDraft ? '-draft' : ''}.yml`;
}

/** Saves the text as a YAML file under `name`. */
export function downloadYaml(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
