import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  budgetTake,
  chargeReadBudget,
  MAX_WEBDAV_BULK_NODES,
  newReadBudget,
} from './bulk_budget';

describe('webdav bulk read budget', () => {
  it('defaults to MAX_WEBDAV_BULK_NODES', () => {
    expect(newReadBudget().remaining).toBe(MAX_WEBDAV_BULK_NODES);
  });

  it('budgetTake returns remaining + 1 so a full-budget query reveals overflow', () => {
    expect(budgetTake(newReadBudget(10))).toBe(11);
  });

  it('charges rows and allows consuming exactly the budget', () => {
    const b = newReadBudget(10);
    chargeReadBudget(b, 4);
    expect(b.remaining).toBe(6);
    chargeReadBudget(b, 6);
    expect(b.remaining).toBe(0);
  });

  it('throws SUBTREE_TOO_LARGE once a charge exceeds the budget', () => {
    expect(() => chargeReadBudget(newReadBudget(5), 6)).toThrow(AppError);
    try {
      chargeReadBudget(newReadBudget(5), 6);
      throw new Error('should have thrown');
    } catch (err) {
      const data = (err as AppError<{ code: string }>).data;
      expect(data.code).toBe('SUBTREE_TOO_LARGE');
    }
  });

  it('a single folder larger than the remaining budget trips the guard', () => {
    // .take(budgetTake(b)) returns remaining+1 rows for an over-budget folder;
    // charging that count must throw rather than silently truncate the walk.
    const b = newReadBudget(3);
    const rowsRead = budgetTake(b); // 4 > 3
    expect(() => chargeReadBudget(b, rowsRead)).toThrow(/SUBTREE_TOO_LARGE/);
  });
});
