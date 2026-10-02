// @vitest-environment node

import type { Fragment, Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { taskHoldsBlobRef } from './blob-holders.ts';

/**
 * The one predicate every blob-liveness lane asks about tasks, as the
 * statement states it: a task's attachments and outputs are JSON lists of
 * `{fileId}` with no row of their own, so the check is JSONB containment
 * over both columns, NULL read as the empty list, for any task of the org.
 */

interface Rendered {
  text: string;
  values: unknown[];
}

const RENDERED = Symbol('rendered');

function isRendered(value: unknown): value is Rendered & { [RENDERED]: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [RENDERED]?: true })[RENDERED] === true
  );
}

/** A tag double that renders nested fragments the way postgres.js does. */
function tag(): Sql {
  const render = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isRendered(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    return {
      [RENDERED]: true,
      text: text.replace(/\s+/g, ' ').trim(),
      values: flat,
    };
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return render as unknown as Sql;
}

function rendered(fragment: Fragment): Rendered {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the double answers rendered text, not a query
  return fragment as unknown as Rendered;
}

describe('taskHoldsBlobRef', () => {
  it('asks whether any task of the org lists the ref among its attachments or outputs', () => {
    const sql = tag();
    const held = rendered(taskHoldsBlobRef(sql, 'org_1', sql`r.ref`));
    expect(held.text).toBe(
      "EXISTS ( SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', r.ref::text)) )",
    );
    expect(held.values).toEqual(['org_1']);
  });

  it('takes the ref as a parameter as well as a column, typed for jsonb_build_object', () => {
    const sql = tag();
    const held = rendered(
      taskHoldsBlobRef(sql, 'org_1', sql`${'s3:acme/brief.pdf'}`),
    );
    // Without the cast real Postgres answers "could not determine data type
    // of parameter" — the file delete lane found it.
    expect(held.text).toContain("jsonb_build_object('fileId', ?::text)) )");
    expect(held.values).toEqual(['org_1', 's3:acme/brief.pdf']);
  });
});
