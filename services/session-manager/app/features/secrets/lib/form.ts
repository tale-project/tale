// The secret form as plain data: its rows, what a kind of secret starts with,
// what counts as a change, what the server is sent. Kept free of React so the
// rules (they mirror `backend/domains/secrets/vault.ts`) are tested on their own.

import type {
  FieldSpec,
  Secret,
  SecretCreate,
  SecretField,
  SecretFieldIn,
  SecretKind,
  SecretKindInfo,
  SecretUpdate,
} from '@/lib/api/schemas';
import { isPrivateLabel } from '@/lib/private-label';
import {
  longerThan,
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '@/lib/secret-limits';

import { sessionIdOfScope } from './scope';

/** One value of the form with its label. */
export interface RowValues {
  /**
   * The starting row it came from (the server's English label for it), or
   * null for a row the person added. A starting row has a fixed label.
   */
  template: string | null;
  /** The value is text of several lines. */
  multiline: boolean;
  /**
   * The label sent with the value. A starting row's is fixed (the server's
   * own, or the one a stored secret has); an added row's is typed.
   */
  label: string;
  value: string;
  /**
   * Kept out of the lists, and masked in this form until shown, as the stored
   * secret has it or the kind has its starting row. A row the person added is
   * also hidden by a label that names something private (`isHiddenRow`).
   */
  hidden: boolean;
  /**
   * The value is the stored secret's, and so is `hidden`: it goes to the
   * server as it is. A new value the form shows plainly is hidden as the
   * server decides by the kind, the label and the value.
   */
  decided: boolean;
}

export interface FormValues {
  kind: SecretKind;
  title: string;
  /** `global`, or the id of the one session the secret is for. */
  scope: string;
  rows: RowValues[];
}

function startingRow(spec: FieldSpec): RowValues {
  return {
    template: spec.label,
    multiline: spec.multiline,
    label: spec.label,
    value: '',
    hidden: spec.hidden,
    decided: false,
  };
}

/** The rows a new secret of a kind starts with. */
export function startingRows(kind: SecretKindInfo): RowValues[] {
  return kind.fields.map(startingRow);
}

/** A row the person adds: a label to type and a value. */
export function customRow(overrides: Partial<RowValues> = {}): RowValues {
  return {
    template: null,
    multiline: false,
    label: '',
    value: '',
    hidden: false,
    decided: false,
    ...overrides,
  };
}

/**
 * The rows for a stored secret: the kind's starting rows (filled from the
 * field with the same label, whatever its case), then the other fields in the
 * order saved. A value that has several lines gets a text area, as an input
 * would flatten it.
 */
export function rowsFromSecret(
  kind: SecretKindInfo,
  fields: readonly SecretField[],
): RowValues[] {
  const rest = [...fields];
  const starting = kind.fields.map((spec): RowValues => {
    const at = rest.findIndex(
      (field) => field.label.trim().toLowerCase() === spec.label.toLowerCase(),
    );
    if (at < 0) return startingRow(spec);
    const [field] = rest.splice(at, 1);
    return {
      template: spec.label,
      multiline: spec.multiline || field.value.includes('\n'),
      label: field.label,
      value: field.value,
      hidden: field.hidden,
      decided: true,
    };
  });
  const added = rest.map((field) =>
    customRow({
      label: field.label,
      value: field.value,
      hidden: field.hidden,
      decided: true,
      multiline: field.value.includes('\n'),
    }),
  );
  return [...starting, ...added];
}

/** Something was typed in it: a value, or a label on a row the person added. */
function hasContent(row: RowValues): boolean {
  return row.value !== '' || (row.template === null && row.label.trim() !== '');
}

/**
 * The rows after the kind changed (only a new secret can): the new kind's
 * starting rows, with what was typed carried over. A value goes to the new
 * starting row of the same label, else it stays as a row of its own, so
 * nothing typed is lost; rows left empty are dropped.
 */
export function switchKind(
  rows: readonly RowValues[],
  kind: SecretKindInfo,
  displayLabel: (label: string) => string,
): RowValues[] {
  const starting = startingRows(kind);
  const carried: RowValues[] = [];
  for (const row of rows.filter(hasContent)) {
    const name = row.label.trim().toLowerCase();
    const at = starting.findIndex(
      (candidate) =>
        candidate.value === '' && candidate.label.toLowerCase() === name,
    );
    if (at >= 0) {
      const target = starting[at];
      starting[at] = {
        ...target,
        value: row.value,
        multiline: target.multiline || row.value.includes('\n'),
        hidden: row.hidden || target.hidden,
        decided: row.decided,
      };
    } else {
      carried.push({
        ...row,
        template: null,
        label: row.template === null ? row.label : displayLabel(row.template),
        multiline: row.multiline || row.value.includes('\n'),
      });
    }
  }
  return [...starting, ...carried];
}

/** What the person typed, as far as it can be lost by closing the form. */
function snapshot(values: FormValues) {
  return JSON.stringify({
    title: values.title.trim(),
    scope: values.scope,
    rows: values.rows
      .filter(hasContent)
      .map((row) => [row.label, row.value, row.hidden]),
  });
}

/**
 * Whether the form still holds what it opened with. Changing the kind of a
 * new secret, adding an empty row and leaving a starting row empty change
 * nothing; typing does.
 */
export function isPristine(values: FormValues, opened: FormValues): boolean {
  return snapshot(values) === snapshot(opened);
}

/**
 * Whether the value is kept hidden: a stored value as it was stored, a
 * starting row as its kind has it (a password, a card number), and a row the
 * person added when its label names something private (`isPrivateLabel`), as
 * the server decides too. A value that merely looks like a card number is
 * hidden by the server once it is saved, not masked while it is typed.
 */
export function isHiddenRow(
  row: Pick<RowValues, 'template' | 'label' | 'hidden' | 'decided'>,
): boolean {
  if (row.decided || row.template !== null) return row.hidden;
  return row.hidden || isPrivateLabel(row.label);
}

/** A row whose value is empty is dropped by the server, with its label. */
function present(rows: readonly RowValues[]): RowValues[] {
  return rows.filter((row) => row.value.trim() !== '');
}

/**
 * A stored value keeps its flag; a new one is hidden as the form shows it, and
 * one the form shows plainly is left to the server, which also hides a value
 * that looks like a card number.
 */
function hiddenToSend(row: RowValues): boolean | undefined {
  if (row.decided) return row.hidden;
  return isHiddenRow(row) ? true : undefined;
}

/** The fields the server is sent: the rows that have a value. */
export function fieldsToSend(rows: readonly RowValues[]): SecretFieldIn[] {
  return present(rows).map((row) => {
    const field: SecretFieldIn = { label: row.label.trim(), value: row.value };
    const hidden = hiddenToSend(row);
    if (hidden !== undefined) field.hidden = hidden;
    return field;
  });
}

export function toCreateBody(values: FormValues): SecretCreate {
  return {
    kind: values.kind,
    title: values.title.trim(),
    sessionId: sessionIdOfScope(values.scope),
    fields: fieldsToSend(values.rows),
  };
}

/**
 * Whether sending `sent` would leave the stored fields as they are. The order
 * does not count: the form lists the kind's starting rows first, so a secret
 * whose fields were stored in another order (an assistant wrote them) is not
 * changed by being opened and saved with a new title.
 */
function sameFields(
  sent: readonly SecretFieldIn[],
  stored: readonly SecretField[],
): boolean {
  const key = (label: string, value: string, hidden: boolean) =>
    JSON.stringify([label, value, hidden]);
  const sentKeys = sent
    .map((field) => {
      const hidden = field.hidden === true;
      // The server keeps a hidden value as typed and trims the others.
      return key(
        field.label,
        hidden ? field.value : field.value.trim(),
        hidden,
      );
    })
    .sort();
  const storedKeys = stored
    .map((field) => key(field.label, field.value, field.hidden))
    .sort();
  return (
    sentKeys.length === storedKeys.length &&
    sentKeys.every((entry, index) => entry === storedKeys[index])
  );
}

/**
 * What changed in a stored secret, and only that: the server keeps what it is
 * not sent. `sessionId: null` is a change too (the secret becomes one for
 * every session), so a missing key and a null one mean different things.
 */
export function toUpdateBody(values: FormValues, secret: Secret): SecretUpdate {
  const update: SecretUpdate = {};
  const title = values.title.trim();
  if (title !== secret.title) update.title = title;
  const sessionId = sessionIdOfScope(values.scope);
  if (sessionId !== (secret.session?.id ?? null)) update.sessionId = sessionId;
  const fields = fieldsToSend(values.rows);
  if (!sameFields(fields, secret.fields)) update.fields = fields;
  return update;
}

export type TitleProblem = 'titleRequired' | 'titleTooLong';
export type LabelProblem = 'labelRequired' | 'labelTooLong';
export type ValueProblem = 'valueTooLong';

export interface RowProblems {
  label?: LabelProblem;
  value?: ValueProblem;
}

export interface Problems {
  title?: TitleProblem;
  /** By row, in the order of the form. */
  rows: RowProblems[];
  /** Not a single row has a value. */
  noValues: boolean;
  /** More rows have a value than a secret can hold. */
  tooMany: boolean;
}

/**
 * What the server would refuse, found first: the rules of `cleanTitle` and
 * `cleanFields`. A row with no value is not checked, as the server drops it.
 */
export function problemsOf(values: FormValues): Problems {
  const title = values.title.trim();
  let filled = 0;
  const rows = values.rows.map((row): RowProblems => {
    if (row.value.trim() === '') return {};
    filled += 1;
    const found: RowProblems = {};
    const label = row.label.trim();
    if (label === '') found.label = 'labelRequired';
    else if (longerThan(label, MAX_LABEL)) found.label = 'labelTooLong';
    // A hidden value is kept as typed, the others are trimmed.
    const value = isHiddenRow(row) ? row.value : row.value.trim();
    if (longerThan(value, MAX_VALUE)) found.value = 'valueTooLong';
    return found;
  });
  const problems: Problems = {
    rows,
    noValues: filled === 0,
    tooMany: filled > MAX_FIELDS,
  };
  if (title === '') problems.title = 'titleRequired';
  else if (longerThan(title, MAX_TITLE)) problems.title = 'titleTooLong';
  return problems;
}
