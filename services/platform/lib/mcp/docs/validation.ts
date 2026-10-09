import { validationResultsReference } from '../../engine/api/docs';
import {
  CODE_META,
  CODES,
  type IssueCode,
  type IssueFamily,
} from '../../engine/core/errors';

/**
 * The validation reference (`get_docs {topic: "validation"}`,
 * `tale://docs/validation`): how to read what `validate_automation` answers
 * — the same section the authoring reference carries — followed by every
 * issue code the engine can raise, by family, with its level and the rule
 * it protects. Built from the engine's own catalog (`CODES`, `CODE_META`),
 * so a new code is listed the day it can be raised.
 */

/** The families in the order a document is checked, each with its heading. */
const FAMILY_HEADINGS: ReadonlyArray<readonly [IssueFamily, string]> = [
  ['document', 'The document'],
  ['node', 'Nodes'],
  ['syntax', 'Templates and code'],
  ['reference', 'References'],
  ['type', 'Types'],
  ['flow', 'Flow'],
  ['contract', 'What the organization and the host have'],
  ['test', 'Tests'],
  ['quality', 'Quality'],
];

const LEVEL_WORDS: Readonly<Record<'error' | 'warning' | 'varies', string>> = {
  error: 'error',
  warning: 'warning',
  varies: 'error or warning',
};

function isIssueCode(code: string): code is IssueCode {
  return Object.hasOwn(CODES, code);
}

function codeLines(family: IssueFamily): string[] {
  return Object.keys(CODE_META)
    .filter(isIssueCode)
    .filter((code) => CODE_META[code].family === family)
    .map(
      (code) =>
        `- ${code} (${LEVEL_WORDS[CODE_META[code].level]}): ${CODES[code]}`,
    );
}

export function validationReference(): string {
  const families: string[] = [];
  for (const [family, heading] of FAMILY_HEADINGS) {
    const lines = codeLines(family);
    if (lines.length > 0) families.push(`### ${heading}`, ...lines, '');
  }
  return [
    '# Validation reference',
    '',
    validationResultsReference(),
    '',
    '## Every issue code',
    'Each code is listed with the level it is raised at and the rule it protects. An error refuses a save and a deploy; a warning never does. Branch on the code; the message, the hint and params say what to change.',
    '',
    ...families,
  ]
    .join('\n')
    .trimEnd();
}
