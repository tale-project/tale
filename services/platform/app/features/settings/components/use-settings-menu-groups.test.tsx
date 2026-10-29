// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  useSettingsMenuGroups,
  type SettingsMenuScope,
} from './use-settings-menu-groups';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

const NOTHING_UNDECIDED = { apiKeys: false, modelApi: false, agents: false };
const DEVELOPER = {
  developer: true,
  apiKeys: true,
  modelApi: true,
  agents: false,
  undecided: NOTHING_UNDECIDED,
  loading: false,
};
const apiAccess = vi.hoisted(() => ({ current: {} }));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => apiAccess.current,
  }),
);

beforeEach(() => {
  apiAccess.current = DEVELOPER;
});

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

  // #4767: a failed access read used to drop the entry, so a member who may
  // use the API could not reach the page that says so.
  it('keeps the API entry for a member while a read that decides an API tab has failed', () => {
    apiAccess.current = {
      ...DEVELOPER,
      developer: false,
      apiKeys: false,
      modelApi: false,
      undecided: { apiKeys: true, modelApi: true, agents: false },
    };
    const { container } = render(<Probe scope="workspace" />);
    expect(container.querySelector('[data-key="api"]')).not.toBeNull();
  });

  it('leaves the API entry out for a member whose reads open no API tab', () => {
    apiAccess.current = {
      ...DEVELOPER,
      developer: false,
      apiKeys: false,
      modelApi: false,
    };
    const { container } = render(<Probe scope="workspace" />);
    expect(container.querySelector('[data-key="api"]')).toBeNull();
  });
});
