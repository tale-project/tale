import type { SearchableSelectOption } from '@tale/ui/searchable-select';
import { useCallback, useMemo, useState } from 'react';

import {
  type ProjectChoice,
  useNamedProjects,
  useProjectChoices,
} from './queries';

const NO_LEADING_OPTIONS: readonly SearchableSelectOption[] = [];
const NO_PROJECT_IDS: readonly string[] = [];

/** A project as a field offers it: by its name. */
export function projectOption(project: ProjectChoice): SearchableSelectOption {
  return { value: project._id, label: project.name };
}

/**
 * How a field's value stands when the offer lacks it:
 * - `named`: the field names it (or the value is no project);
 * - `reading`: the project is still being read by id;
 * - `unavailable`: its read failed, which proves it gone no more than it
 *   names it (#4605);
 * - `gone`: its read answered that no project the caller can read has it.
 */
export type ProjectValueStatus = 'named' | 'reading' | 'unavailable' | 'gone';

export interface ProjectSelectArgs {
  organizationId: string;
  /** The picked project's id, or the value of a leading option. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** What the field offers above the projects, such as the organization. */
  leadingOptions?: readonly SearchableSelectOption[];
  /** How a project reads as an option — one function for the field's
   * lifetime. Defaults to {@link projectOption}. */
  toOption?: (project: ProjectChoice) => SearchableSelectOption;
}

/**
 * What a field that picks one project offers: Home's page of projects and,
 * for what is typed, the server's name search past it
 * ({@link useProjectChoices}), never every project (#5204, #5205). The
 * project picked stays named once the search moves on, and a value the offer
 * lacks (a project past the page) is read by id. Hand `onSearchChange` and
 * `onValueChange` to the field; `choices` is what the page answered,
 * `valueStatus` how a value past it stands, and `read` how both read.
 */
export function useProjectSelect({
  organizationId,
  value,
  onValueChange,
  leadingOptions = NO_LEADING_OPTIONS,
  toOption = projectOption,
}: ProjectSelectArgs) {
  const [query, setQuery] = useState('');
  const choices = useProjectChoices(organizationId, query);
  const { projects } = choices;
  // A search hit leaves the offer when the search box resets on close.
  const [picked, setPicked] = useState<ProjectChoice | null>(null);
  const projectId =
    value !== null && !leadingOptions.some((option) => option.value === value)
      ? value
      : null;
  const offered =
    projectId !== null && projects.some((project) => project._id === projectId);
  const pickedHere = picked !== null && picked._id === projectId;
  const named = useNamedProjects(
    organizationId,
    projectId === null || offered || pickedHere ? NO_PROJECT_IDS : [projectId],
  );
  const kept =
    projectId === null || offered
      ? undefined
      : pickedHere
        ? picked
        : named.projects.get(projectId);
  const options = useMemo(
    () => [
      ...leadingOptions,
      ...projects.map((project) => toOption(project)),
      ...(kept === undefined ? [] : [toOption(kept)]),
    ],
    [leadingOptions, projects, kept, toOption],
  );
  const pick = useCallback(
    (next: string) => {
      setPicked(
        projects.find((project) => project._id === next) ??
          (kept?._id === next ? kept : null),
      );
      onValueChange(next);
    },
    [projects, kept, onValueChange],
  );
  let valueStatus: ProjectValueStatus = 'named';
  if (projectId !== null && !offered && kept === undefined) {
    if (named.unread.has(projectId)) valueStatus = 'unavailable';
    else valueStatus = named.isPending ? 'reading' : 'gone';
  }
  const { retry: retryPage } = choices;
  const { retry: retryValue } = named;
  const retry = useCallback(() => {
    retryPage();
    retryValue();
  }, [retryPage, retryValue]);
  return {
    options,
    onSearchChange: setQuery,
    onValueChange: pick,
    choices,
    valueStatus,
    /** How what the field shows reads — the page, and the value read past
     * it (`readStateOf`) — and how to read what failed again. */
    read: {
      unavailable: choices.unavailable || named.read.unavailable,
      retrying: choices.retrying || named.read.retrying,
      failureCount: choices.failureCount + named.read.failureCount,
      retry,
    },
  };
}
