import { describe, expect, it } from 'vitest';

import { settingsFieldSchema } from './automation-settings';
import {
  externalStatusActionSchema,
  externalStatusDecisionSchema,
  externalStatusFieldSchema,
  externalStatusRequestBodySchema,
  externalStatusRequestValues,
  externalStatusWorkflowSchema,
} from './task-external-status';

const action = externalStatusActionSchema.parse({
  id: 'verify',
  title: 'Verify result',
  status: 'in_review',
  fields: [
    {
      key: 'note',
      label: 'Result',
      type: 'text',
      required: true,
      multiline: true,
      pattern: '^[\\s\\S]{1,2000}$',
    },
    { key: 'successful', label: 'Successful', type: 'boolean', required: true },
    {
      key: 'owner',
      label: 'Owner',
      type: 'select',
      options: [{ value: 'staff-1', label: 'Alex' }],
    },
  ],
});

describe('source-declared native transition boundary', () => {
  it('converts only declared input and preserves a same-column business action', () => {
    expect(
      externalStatusRequestValues(action, {
        note: ' Verified\nwith evidence ',
        successful: 'false',
        owner: 'staff-1',
      }),
    ).toEqual({
      move: 'verify',
      note: 'Verified\nwith evidence',
      successful: false,
      owner: 'staff-1',
    });
    expect(action.status).toBe('in_review');
  });
  it.each<Record<string, string>>([
    { note: '', successful: 'true' },
    { note: 'x'.repeat(2001), successful: 'true' },
    { note: 'OK', successful: 'yes' },
    { note: 'OK', successful: 'true', owner: 'foreign' },
    { note: 'OK', successful: 'true', actorId: 'someone' },
  ])('rejects incomplete, invalid and injected source input %j', (values) => {
    expect(() => externalStatusRequestValues(action, values)).toThrow();
  });
  it('keeps automation limits while allowing bounded external business notes and staff choices', () => {
    const options = Array.from({ length: 1000 }, (_, index) => ({
      value: `staff-${index}`,
      label: `Staff ${index}`,
    }));
    const field = { key: 'owner', label: 'Owner', type: 'select', options };
    expect(externalStatusFieldSchema.safeParse(field).success).toBe(true);
    expect(settingsFieldSchema.safeParse(field).success).toBe(false);
    expect(
      externalStatusFieldSchema.safeParse({
        ...field,
        options: [...options, { value: 'extra', label: 'Extra' }],
      }).success,
    ).toBe(false);
    const note = {
      key: 'note',
      label: 'Note',
      type: 'text',
      default: 'x'.repeat(4000),
      multiline: true,
    };
    expect(externalStatusFieldSchema.safeParse(note).success).toBe(true);
    expect(settingsFieldSchema.safeParse(note).success).toBe(false);
    expect(
      externalStatusFieldSchema.safeParse({ ...note, type: 'number' }).success,
    ).toBe(false);
  });
  it('rejects duplicate actions, reserved or duplicate fields and unsafe patterns', () => {
    expect(
      externalStatusWorkflowSchema.safeParse({ actions: [action, action] })
        .success,
    ).toBe(false);
    for (const fields of [
      [{ ...action.fields[0], key: 'move' }],
      [action.fields[0], action.fields[0]],
      [{ ...action.fields[0], pattern: '^(a+)+$' }],
    ]) {
      expect(
        externalStatusActionSchema.safeParse({ ...action, fields }).success,
      ).toBe(false);
    }
  });
  it('bounds the entire workflow, not just each repeated staff list', () => {
    const options = Array.from({ length: 1000 }, (_, index) => ({
      value: `staff-${index}`,
      label: 'x'.repeat(200),
    }));
    expect(
      externalStatusWorkflowSchema.safeParse({
        actions: [
          {
            ...action,
            fields: [
              { key: 'owner', label: 'Owner', type: 'select', options },
              { key: 'reviewer', label: 'Reviewer', type: 'select', options },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('native submissions cannot select their actor or impersonate a source decision', () => {
    const body = {
      requestId: '1c444602-258d-4322-8bfe-2d4a313096ad',
      expectedRevision: '41',
      expectedSourceRevision: 'source:1',
      actionId: 'verify',
      values: { note: 'OK' },
    };
    expect(externalStatusRequestBodySchema.safeParse(body).success).toBe(true);
    expect(
      externalStatusRequestBodySchema.safeParse({
        ...body,
        actor: { userId: 'other' },
      }).success,
    ).toBe(false);
    expect(
      externalStatusRequestBodySchema.safeParse({
        ...body,
        decision: { accepted: true },
      }).success,
    ).toBe(false);
    expect(
      externalStatusRequestBodySchema.safeParse({
        ...body,
        values: { note: 'x'.repeat(4001) },
      }).success,
    ).toBe(false);
    expect(
      externalStatusDecisionSchema.safeParse({ accepted: false }).success,
    ).toBe(false);
    expect(
      externalStatusDecisionSchema.safeParse({
        accepted: false,
        reason: 'Required source evidence is missing.',
      }).success,
    ).toBe(true);
  });
});
