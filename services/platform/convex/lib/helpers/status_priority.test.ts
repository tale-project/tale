import { describe, expect, it } from 'vitest';

import { STATUS_PRIORITY } from './status_priority';

describe('STATUS_PRIORITY', () => {
  it('defines priority for active, draft, and archived', () => {
    expect(STATUS_PRIORITY).toHaveProperty('active');
    expect(STATUS_PRIORITY).toHaveProperty('draft');
    expect(STATUS_PRIORITY).toHaveProperty('archived');
  });

  it('ranks active > draft > archived', () => {
    expect(STATUS_PRIORITY['active']).toBeGreaterThan(STATUS_PRIORITY['draft']);
    expect(STATUS_PRIORITY['draft']).toBeGreaterThan(
      STATUS_PRIORITY['archived'],
    );
  });

  it('returns undefined for unknown status values', () => {
    expect(STATUS_PRIORITY['unknown']).toBeUndefined();
    expect(STATUS_PRIORITY['']).toBeUndefined();
  });
});
