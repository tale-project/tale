import type { Sql, TransactionSql } from 'postgres';

/**
 * A stand-in for postgres.js that records what the database would be asked.
 * A tagged template nested in another — a fragment, such as a condition that
 * is only sometimes there — is inlined into the statement that holds it and
 * is not a statement of its own, so a test reads the SQL a query really sends
 * and the values in order.
 */

export interface RecordedStatement {
  text: string;
  values: unknown[];
}

export function recordingSql(
  /** The rows a statement answers; none by default. */
  answer: (statement: RecordedStatement) => unknown[] | undefined = () =>
    undefined,
): { sql: Sql; tx: TransactionSql; statements: RecordedStatement[] } {
  const statements: RecordedStatement[] = [];
  /** What each answer to a tagged template says it asked, so a template
   * nested in another is found again. */
  const asked = new WeakMap<object, RecordedStatement>();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? '';
    const bound: unknown[] = [];
    for (const [index, value] of values.entries()) {
      const nested =
        typeof value === 'object' && value !== null
          ? asked.get(value)
          : undefined;
      if (nested === undefined) {
        text += '?';
        bound.push(value);
      } else {
        text += nested.text;
        bound.push(...nested.values);
        statements.splice(statements.indexOf(nested), 1);
      }
      text += strings[index + 1] ?? '';
    }
    const statement = {
      text: text.replaceAll(/\s+/g, ' ').trim(),
      values: bound,
    };
    statements.push(statement);
    const result = Promise.resolve(answer(statement) ?? []);
    asked.set(result, statement);
    return result;
  };
  const sql = Object.assign(tag, {
    begin: (work: (transaction: unknown) => Promise<unknown>) => work(sql),
    savepoint: (work: (transaction: unknown) => Promise<unknown>) => work(sql),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
    sql: sql as unknown as Sql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
    tx: sql as unknown as TransactionSql,
    statements,
  };
}
