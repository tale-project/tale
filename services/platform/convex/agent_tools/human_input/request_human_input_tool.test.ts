import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { requestHumanInputArgs } from './request_human_input_tool';

describe('requestHumanInputArgs coercion', () => {
  it('accepts well-formed input unchanged', () => {
    const result = requestHumanInputArgs.parse({
      question: 'Please confirm',
      fields: [{ label: 'Proceed?', type: 'yes_no', required: true }],
    });
    expect(result.fields).toEqual([
      { label: 'Proceed?', type: 'yes_no', required: true },
    ]);
  });

  it('parses field elements sent as JSON strings (observed model failure)', () => {
    // Verbatim failure shape from production: gpt-5.5 emitted each fields[]
    // element as a JSON-encoded string, which failed validation before the
    // tool executed — the turn halted with no card on screen.
    const result = requestHumanInputArgs.parse({
      question: '我已经拟定了对比亚迪的调研计划，您是否同意按此计划继续？',
      fields: [
        '{"label":"继续按计划调研 (Proceed with plan)","type":"yes_no"}',
        '{"label":"需要调整的重点 / 补充要求 (Adjustments/Additions)","type":"textarea"}',
      ],
    });
    expect(result.fields).toEqual([
      { label: '继续按计划调研 (Proceed with plan)', type: 'yes_no' },
      {
        label: '需要调整的重点 / 补充要求 (Adjustments/Additions)',
        type: 'textarea',
      },
    ]);
  });

  it('parses the whole fields array sent as one JSON string', () => {
    const result = requestHumanInputArgs.parse({
      question: 'Pick one',
      fields: '[{"label":"Choice","type":"text"}]',
    });
    expect(result.fields).toEqual([{ label: 'Choice', type: 'text' }]);
  });

  it('parses select options sent as JSON strings', () => {
    const result = requestHumanInputArgs.parse({
      question: 'Which meal?',
      fields: [
        {
          label: 'Meal',
          type: 'single_select',
          options: ['{"label":"Pasta"}', '{"label":"Curry"}'],
        },
      ],
    });
    expect(result.fields[0]).toMatchObject({
      type: 'single_select',
      options: [{ label: 'Pasta' }, { label: 'Curry' }],
    });
  });

  it('still rejects genuinely malformed input with a zod error', () => {
    expect(() =>
      requestHumanInputArgs.parse({
        question: 'Broken',
        fields: ['not json at all'],
      }),
    ).toThrow();
    expect(() =>
      requestHumanInputArgs.parse({
        question: 'Broken',
        fields: ['"a json string, not an object"'],
      }),
    ).toThrow();
  });

  it('keeps the model-facing JSON schema fully described (no degradation)', () => {
    // The AI SDK advertises tools via toJSONSchema(..., { io: 'input' }).
    // z.preprocess must stay transparent there — if this regresses, the model
    // sees `fields` as unconstrained and loses all field-shape guidance.
    const jsonSchema = z.toJSONSchema(requestHumanInputArgs, {
      target: 'draft-7',
      io: 'input',
    });
    const fields = (
      jsonSchema as unknown as {
        properties: { fields: { type?: string; items: { oneOf?: unknown[] } } };
      }
    ).properties.fields;
    expect(fields.type).toBe('array');
    expect(fields.items.oneOf).toBeDefined();
    expect(JSON.stringify(fields.items)).toContain('yes_no');
    expect(JSON.stringify(fields.items)).toContain('single_select');
  });
});
