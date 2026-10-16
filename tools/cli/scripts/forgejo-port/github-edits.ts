/**
 * What GitHub's own copies of the workflows that stay need once Forgejo is the source.
 *
 * The release lane stays on GitHub, and a few of its workflows do something that
 * Forgejo's push mirror would undo: the mirror makes GitHub's refs exactly Forgejo's,
 * so a branch or a tag that only GitHub made is deleted at the next sync. Each edit
 * here is a text change anchored on the exact lines it expects, applied by the
 * cut-over and by nothing before it; before that the files are not touched.
 */

import type { GithubEdit, Manifest } from './manifest';
import type { Problem } from './validate';

export type EditState = 'pending' | 'applied';

export interface EditOutcome {
  readonly path: string;
  readonly edit: GithubEdit;
  readonly state: EditState;
  /** The file once the edit is made; unchanged when it already is. */
  readonly text: string;
}

const WORKFLOWS = '.github/workflows';

/** Each edit against the file it names: pending, already made, or impossible. */
export function planGithubEdits(
  workflows: ReadonlyMap<string, string>,
  manifest: Pick<Manifest, 'githubEdits'>,
): { outcomes: EditOutcome[]; problems: Problem[] } {
  const outcomes: EditOutcome[] = [];
  const problems: Problem[] = [];
  const current = new Map(workflows);
  for (const edit of manifest.githubEdits) {
    const path = `${WORKFLOWS}/${edit.file}`;
    const text = current.get(edit.file);
    if (text === undefined) {
      problems.push({ file: path, at: '', message: 'does not exist' });
      continue;
    }
    if (text.includes(edit.replace)) {
      outcomes.push({ path, edit, state: 'applied', text });
      continue;
    }
    const found = text.split(edit.find).length - 1;
    if (found !== 1) {
      problems.push({
        file: path,
        at: '',
        message: `holds the lines of the edit ${found === 0 ? 'nowhere' : `${found} times`}: ${edit.why}`,
      });
      continue;
    }
    const edited = text.replace(edit.find, () => edit.replace);
    current.set(edit.file, edited);
    outcomes.push({ path, edit, state: 'pending', text: edited });
  }
  return { outcomes, problems };
}
