// @vitest-environment jsdom
/**
 * The skill form learns whether the viewer may share with the whole
 * organization from the skills listing, which an admin can outdate by
 * tightening the policy or revoking a grant. A refused organization-wide
 * write therefore names its reason in the viewer's language and refreshes
 * the listing, so the form stops offering the Organization audience; any
 * other failure keeps the generic feedback and leaves the listing alone.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateQueries, useBackendAction } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  useBackendAction: vi.fn((_name: string, options: unknown) => options),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({ useBackendAction }));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: vi.fn(),
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: (namespace: string) => ({
    t: (key: string) => `${namespace}:${key}`,
  }),
}));

import { configKeys } from '@/app/hooks/config-query-keys';

import {
  isSkillPublishRefusal,
  useSaveSkill,
  useUploadSkillBundle,
} from './mutations';

interface CapturedOptions {
  errorToast?: {
    title: string;
    description?: (error: Error) => string | undefined;
  };
  onError?: (error: Error) => void;
}

function refusal(code: string): Error {
  return Object.assign(new Error(code), { data: { code, message: code } });
}

function optionsOf(hook: () => unknown): CapturedOptions {
  renderHook(hook);
  const options: unknown = useBackendAction.mock.lastCall?.[1];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mock returns the options it was handed
  return options as CapturedOptions;
}

beforeEach(() => {
  invalidateQueries.mockClear();
  useBackendAction.mockClear();
});

describe('isSkillPublishRefusal', () => {
  it('recognizes only the organization-wide audience refusal', () => {
    expect(isSkillPublishRefusal(refusal('SKILL_PUBLISH_FORBIDDEN'))).toBe(
      true,
    );
    expect(isSkillPublishRefusal(refusal('SKILL_FORBIDDEN'))).toBe(false);
    expect(isSkillPublishRefusal(new Error('offline'))).toBe(false);
  });
});

describe('useSaveSkill', () => {
  it('names the reason and refreshes the listing when the audience is refused', () => {
    const options = optionsOf(() => useSaveSkill());
    const error = refusal('SKILL_PUBLISH_FORBIDDEN');

    expect(options.errorToast?.title).toBe('toast:error.generic.title');
    expect(options.errorToast?.description?.(error)).toBe(
      'skills:publishing.refused',
    );
    options.onError?.(error);
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: configKeys.type('skills'),
    });
  });

  it('keeps the generic feedback for any other failure', () => {
    const options = optionsOf(() => useSaveSkill());
    const error = refusal('SKILL_STALE');

    expect(options.errorToast?.description?.(error)).toBeUndefined();
    options.onError?.(error);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('useUploadSkillBundle', () => {
  it('refreshes the listing on a refused audience and leaves the reason to the pane', () => {
    const options = optionsOf(() => useUploadSkillBundle());

    expect(options.errorToast).toBeUndefined();
    options.onError?.(refusal('SKILL_PUBLISH_FORBIDDEN'));
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: configKeys.type('skills'),
    });
  });
});
