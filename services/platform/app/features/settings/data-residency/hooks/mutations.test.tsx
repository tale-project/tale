import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/tests/utils/render';

import {
  useTestOrgKnowledgeConnection,
  useTestOrgObjectStorageConnection,
} from './mutations';

const useBackendAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction,
}));

describe('connection probe failure ownership', () => {
  it.each([
    [
      useTestOrgKnowledgeConnection,
      'knowledge/actions:testKnowledgeConnection',
    ],
    [
      useTestOrgObjectStorageConnection,
      'object_storage/actions:testObjectStorageConnection',
    ],
  ] as const)(
    'keeps inline probe failures out of the default toast (%s)',
    (hook, action) => {
      renderHook(() => hook());
      expect(useBackendAction).toHaveBeenLastCalledWith(action, {
        errorToast: false,
      });
    },
  );
});
