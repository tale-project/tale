// @vitest-environment node

/**
 * Every action of the shipped connector catalog documents its output in a
 * form the analysis reads: the typing layer turns the signature into the
 * shape an automation's references are checked against, and a signature it
 * cannot read silently leaves that action's output unknown.
 *
 * The signature is also all a call hands back: the dispatcher leaves out
 * every member it does not declare (`CONN-R36`). So each place a signature
 * leaves open carries its reason here, and every member a mock or a scenario
 * answers is one the signature declares.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openPlacesOf, projectOntoShape } from '../engine/core/typing/project';
import {
  actionOutputShape,
  parseSignature,
} from '../engine/core/typing/signature';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { isRecord } from '../utils/type-utils';
import { loadConnectorDefinitions } from './catalog';

const SYSTEM_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system',
);

/** An import record (`externalIssue`): Tale's own record of an outside item,
 * which the task keeps and the next import compares against. */
const IMPORT_RECORD =
  'Tale’s own record of the imported item, built member by member by the importer; the task keeps it whole and the next import compares against it';

/** A part of a MIME message (`payload.parts`): it has the payload's own
 * members, and its parts nest to any depth a signature cannot list. */
const MIME_PART =
  'a part of the message, with the members of its payload and parts of its own to any depth, which a signature cannot list; the mail sync reads their headers, bodies and attachments';

/**
 * The places of an output signature that hand their value on whole
 * (`object`, `unknown`, `any`), keyed `<connector>.<action> <path>`, each with
 * the reason it stays open. Any other place hands on only the members it
 * lists, so a new open place fails below until it is listed with its reason.
 */
const OPEN_PLACES: Readonly<Record<string, string>> = {
  'automation.read_position $.value':
    'the value the automation itself stored with save_position, handed back as it stored it',
  'conversation.list_mailbox_messages $.messages[]{}':
    'a row of the mail connector’s own listing, already cut to what that connector’s action declares, with the mailbox it came from',
  'forgejo.get_import_issue $.externalIssue': IMPORT_RECORD,
  'forgejo.list_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'forgejo.refresh_import_issues $[].externalIssue': IMPORT_RECORD,
  'forgejo.refresh_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'github.get_import_alert $.externalIssue': IMPORT_RECORD,
  'github.get_import_issue $.externalIssue': IMPORT_RECORD,
  'github.list_import_alerts $.issues[].externalIssue': IMPORT_RECORD,
  'github.list_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'github.refresh_import_alerts $[].externalIssue': IMPORT_RECORD,
  'github.refresh_import_alerts $.issues[].externalIssue': IMPORT_RECORD,
  'github.refresh_import_issues $[].externalIssue': IMPORT_RECORD,
  'github.refresh_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'glitchtip.get_import_issue $.externalIssue': IMPORT_RECORD,
  'glitchtip.list_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'glitchtip.refresh_import_issues $[].externalIssue': IMPORT_RECORD,
  'glitchtip.refresh_import_issues $.issues[].externalIssue': IMPORT_RECORD,
  'gmail.get_message $.message.payload.parts[]': MIME_PART,
  'gmail.get_thread $.thread.messages[].payload.parts[]': MIME_PART,
  'http.get $.body':
    'the answer of the endpoint the caller named, which it asked for whole; the credential’s values are redacted from it (CONN-R17)',
  'http.send $.body':
    'the answer of the endpoint the caller named, which it asked for whole; the credential’s values are redacted from it (CONN-R17)',
  'jev.decide $.answers{}{}':
    'one answer of the decision service per question, whose members follow the question’s type',
  'sandbox.run_script $.result':
    'the result file the organization’s own script wrote, parsed',
  'task.list_external_issues $.issues[].externalIssue': IMPORT_RECORD,
};

const actions = loadConnectorDefinitions({ root: SYSTEM_ROOT }).flatMap((c) =>
  c.actions.map((a) => ({ type: `${c.name}.${a.name}`, action: a })),
);

/** The members of `value` its projection left out, as paths from `$`. */
function droppedMembers(
  value: unknown,
  projected: unknown,
  at = '$',
): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    const items = Array.isArray(projected) ? projected : [];
    return value.flatMap((item, i) =>
      droppedMembers(item, items[i], `${at}[]`),
    );
  }
  return Object.entries(value).flatMap(([key, member]) =>
    isRecord(projected) && Object.hasOwn(projected, key)
      ? droppedMembers(member, projected[key], `${at}.${key}`)
      : [`${at}.${key}`],
  );
}

describe('connector output signatures', () => {
  it('covers the whole catalog', () => {
    expect(actions.length).toBeGreaterThan(100);
  });

  it('reads every one of them', () => {
    const unreadable = actions.flatMap(({ type, action: { output } }) => {
      const parsed = parseSignature(output);
      return 'error' in parsed
        ? [
            `${type}: ${parsed.error.message} at ${parsed.error.offset} in ${JSON.stringify(output)}`,
          ]
        : [];
    });
    expect(unreadable).toEqual([]);
  });
});

describe('a connector call hands back only what its output declares [CONN-R36]', () => {
  it('gives every place an output leaves open its reason', () => {
    const open = actions.flatMap(({ type, action }) =>
      openPlacesOf(actionOutputShape(action)).map((at) => `${type} ${at}`),
    );
    const listed = Object.keys(OPEN_PLACES);
    expect(
      open.filter((place) => !Object.hasOwn(OPEN_PLACES, place)),
      'open places with no reason: list them in OPEN_PLACES, or declare their members',
    ).toEqual([]);
    expect(
      listed.filter((place) => !open.includes(place)),
      'OPEN_PLACES entries that are no longer open',
    ).toEqual([]);
  });

  it('declares every member a mock answers', async () => {
    const runner = nodeVmRunner();
    const dropped: string[] = [];
    for (const { type, action } of actions) {
      const output = await runner.runBody(
        action.mock,
        { input: action.exampleInput ?? {} },
        { timeoutMs: 2000 },
      );
      const projected = projectOntoShape(output, actionOutputShape(action));
      for (const at of new Set(droppedMembers(output, projected))) {
        dropped.push(`${type} mock: ${at}`);
      }
    }
    expect(dropped, 'members the output signature leaves out').toEqual([]);
  });

  it('declares every member a scenario answers', () => {
    const dropped: string[] = [];
    for (const { type, action } of actions) {
      for (const scenario of action.scenarios ?? []) {
        if (scenario.output === undefined) continue;
        const projected = projectOntoShape(
          scenario.output,
          actionOutputShape(action),
        );
        for (const at of new Set(droppedMembers(scenario.output, projected))) {
          dropped.push(`${type}/${scenario.name}: ${at}`);
        }
      }
    }
    expect(dropped, 'members the output signature leaves out').toEqual([]);
  });
});
