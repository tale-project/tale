// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  useSettingsMenuGroups,
  type SettingsMenuScope,
} from './use-settings-menu-groups';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

function Probe({ scope }: { scope: SettingsMenuScope }) {
  const groups = useSettingsMenuGroups('org-1', scope);
  return (
    <ul>
      {groups
        .flatMap((group) => group.items)
        .map((item) => (
          <li key={item.key} data-key={item.key}>
            {item.description}
          </li>
        ))}
    </ul>
  );
}

describe('useSettingsMenuGroups', () => {
  // The description key is built from the entry's `key` at runtime, which
  // the catalog guard cannot enumerate — so a missing `menu.<key>.description`
  // used to reach the mobile overview as the raw key (SET-F2, `skills`).
  it.each<SettingsMenuScope>(['personal', 'workspace'])(
    'resolves a description for every %s entry',
    (scope) => {
      render(<Probe scope={scope} />);
      const items = screen.getAllByRole('listitem');
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.textContent, item.dataset['key']).not.toMatch(
          /^menu\.[a-z]+\.description$/i,
        );
        expect(item.textContent?.trim()).not.toBe('');
      }
    },
  );
});
