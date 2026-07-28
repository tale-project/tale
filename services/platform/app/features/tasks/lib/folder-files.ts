/**
 * Splitting a bound folder's files into the deliverables and everything else.
 *
 * An automation-owned task bound to a folder reads its input from that folder
 * AND writes into it (`document.create`), so the folder holds the operator's
 * uploads, the run's working material and the run's deliverables side by side.
 * One flat list is what made a quarter with three deliverables read as 27 input
 * files.
 *
 * ONE rule splits it: the promoted set is the Outcome, the rest is Files.
 * What gets promoted is the automation's call, never the platform's —
 * `contract.outcome.files` names the deliverables, because only the pack knows
 * which of its written files are the point. A contract that names none falls
 * back to provenance (`sourceProvider: 'agent'`, stamped by the workflow
 * document store on everything a run files), so an automation that declares
 * nothing still gets an Outcome instead of a silent hole.
 */

import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

/** Provenance stamped by the workflow document store on every filed artifact. */
const RUN_SOURCE_PROVIDER = 'agent';

export interface FolderFileLike {
  title?: string;
  folderId?: string;
  sourceProvider?: string;
}

/** A run filed this file — it is output of the automation, not input to it. */
export function isProducedByRun(file: FolderFileLike): boolean {
  return file.sourceProvider === RUN_SOURCE_PROVIDER;
}

/**
 * Does a declared deliverable name this file? Exact match unless the pattern
 * carries `*`/`?`, so a name whose run derives it (`return-2026Q1.xml`) can be
 * declared as `return-*.xml`. Everything else in the pattern is literal — a
 * dot in a file name must not read as "any character".
 */
export function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return name === pattern;
  const source = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(name);
}

/** One promised deliverable: the declared entry, and the file if it exists. */
export interface OutcomeSlot<T> {
  /** The declared pattern — the promised row's label before a file lands. */
  label: string;
  file: T | null;
}

/**
 * The bound folder's files, split into the deliverables and the rest.
 *
 * `outcome` follows the contract's declared ORDER (the author's reading order,
 * stable across runs) and keeps a slot for a deliverable no run has filed yet,
 * so the zone can promise what is coming. Without a declaration the produced
 * files stand in, newest first — a run writes its working material before its
 * deliverables, so the newest rows are the ones the review is about.
 */
export function splitFolderFiles<
  T extends FolderFileLike & { _creationTime: number },
>(
  files: readonly T[],
  folderId: string,
  contract: Pick<TaskSubjectContract, 'outcome'> | null,
): { outcome: OutcomeSlot<T>[]; rest: T[] } {
  const inFolder = files.filter((file) => file.folderId === folderId);
  const declared = contract?.outcome?.files;

  if (declared === undefined) {
    const produced = inFolder
      .filter(isProducedByRun)
      .sort((a, b) => b._creationTime - a._creationTime);
    const promoted = new Set(produced);
    return {
      outcome: produced.map((file) => ({ label: file.title ?? '', file })),
      rest: inFolder.filter((file) => !promoted.has(file)),
    };
  }

  const promoted = new Set<T>();
  const outcome = declared.map((pattern) => {
    // Newest wins when several files answer one pattern: `document.create`
    // refreshes a same-named row in place, so a second match is a genuinely
    // different file and the latest one is the current deliverable.
    const match =
      inFolder
        .filter(
          (file) =>
            file.title !== undefined && matchesPattern(file.title, pattern),
        )
        .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
    if (match !== null) promoted.add(match);
    return { label: match?.title ?? pattern, file: match };
  });
  return { outcome, rest: inFolder.filter((file) => !promoted.has(file)) };
}
