import { describe, expect, it, vi } from 'vitest';

import { replaceDashboardPath } from './switching';

describe('organization switching history', () => {
  it('replaces subpath destinations instead of pushing them', () => {
    const replace = vi.fn();
    replaceDashboardPath({ replace }, '/dashboard/org-b/projects');
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith('/dashboard/org-b/projects');
  });
});
