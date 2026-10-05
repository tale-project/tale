import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'home-rows.tsx'), 'utf8');
const ageClass = /^const HOME_ROW_AGE_CLASS =\s+'([^']+)'/m.exec(source)?.[1];

describe('Home row age styling', () => {
  it('uses the full muted foreground token for AA contrast', () => {
    expect(ageClass).toBeDefined();
    expect(ageClass).toContain('text-muted-foreground');
    expect(ageClass).not.toMatch(/text-muted-foreground\/\d+/);
    expect(ageClass).toContain('text-[11px]');
  });
});
