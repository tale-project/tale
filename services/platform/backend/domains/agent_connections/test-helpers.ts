import type { Sql, TransactionSql } from 'postgres';

/**
 * A stand-in for postgres.js that records what the database would be asked.
 * Every tagged template is a fragment until something awaits it; awaited, it
 * is a statement, recorded with the fragments nested in it inlined, so a
 * test reads the SQL a query really sends and the values in order.
 */

export interface RecordedStatement {
  text: string;
  values: unknown[];
}

interface Fragment extends RecordedStatement {
  fragment: true;
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fragment' in value &&
    value.fragment === true
  );
}

function render(
  strings: TemplateStringsArray,
  values: unknown[],
): RecordedStatement {
  let text = strings[0] ?? '';
  const out: unknown[] = [];
  for (const [index, value] of values.entries()) {
    if (isFragment(value)) {
      text += value.text;
      out.push(...value.values);
    } else {
      text += '?';
      out.push(value);
    }
    text += strings[index + 1] ?? '';
  }
  return { text: text.replaceAll(/\s+/g, ' ').trim(), values: out };
}

export function recordingSql(
  /** The rows a statement answers, by its text; none by default. */
  answer: (statement: RecordedStatement) => unknown[] | undefined = () =>
    undefined,
): { sql: Sql; tx: TransactionSql; statements: RecordedStatement[] } {
  const statements: RecordedStatement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const rendered = render(strings, values);
    const fragment: Fragment = {
      fragment: true,
      ...rendered,
    };
    return Object.assign(fragment, {
      then: (
        resolve: (rows: unknown[]) => unknown,
        reject: (error: unknown) => unknown,
      ) => {
        statements.push(rendered);
        return Promise.resolve(answer(rendered) ?? []).then(resolve, reject);
      },
    });
  };
  const sql = Object.assign(tag, {
    begin: (work: (transaction: unknown) => Promise<unknown>) => work(sql),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
    sql: sql as unknown as Sql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
    tx: sql as unknown as TransactionSql,
    statements,
  };
}
