// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const localeMock = vi.fn(() => ({ locale: 'en' }));
vi.mock('@tale/ui/i18n/locale-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/locale-provider')>()),
  useLocale: () => localeMock(),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({ data: { slug: 'default' } }),
}));

vi.mock('../../hooks/mutations', () => ({
  useDeleteProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveProviderSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProviderSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../provider-add-panel', () => ({
  ProviderAddPanel: () => null,
}));

vi.mock('../provider-edit-panel', () => ({
  ProviderEditPanel: () => null,
}));

vi.mock('../test-connection-sheet', () => ({
  TestConnectionSheet: () => null,
}));

vi.mock('../../hooks/use-providers-table-config', () => ({
  useProvidersTableConfig: () => ({
    columns: [],
    stickyLayout: undefined,
    pageSize: 10,
  }),
}));

const listProvidersMock = vi.fn();
vi.mock('../../hooks/queries', () => ({
  useListProviders: () => listProvidersMock(),
}));

let capturedRows: Array<{ name: string; description?: string }> = [];

vi.mock('@/app/components/ui/data-table/data-table', () => ({
  DataTable: ({
    rows,
  }: {
    rows: Array<{ name: string; description?: string }>;
  }) => {
    capturedRows = rows;
    return <div data-testid="data-table" />;
  },
}));

vi.mock('@/app/hooks/use-list-page', () => ({
  useListPage: <T,>({ dataSource }: { dataSource: { data?: T[] } }) => ({
    tableProps: { rows: dataSource.data ?? [] },
  }),
}));

import { ProvidersTable } from '../providers-table';

const providerWithI18n = {
  name: 'openrouter',
  displayName: 'OpenRouter',
  description: 'Multi-model AI gateway with access to leading LLM providers',
  baseUrl: 'https://openrouter.ai/api/v1',
  modelCount: 1,
  models: [],
  i18n: {
    de: {
      description:
        'Multi-Modell-KI-Gateway mit Zugang zu führenden LLM-Anbietern',
    },
  },
};

describe('ProvidersTable', () => {
  beforeEach(() => {
    capturedRows = [];
    listProvidersMock.mockReturnValue({
      providers: [providerWithI18n],
      isLoading: false,
    });
  });

  it('shows the German description when locale is de', () => {
    localeMock.mockReturnValue({ locale: 'de' });
    render(<ProvidersTable organizationId="test-org-id" />);
    expect(capturedRows).toHaveLength(1);
    expect(capturedRows[0].name).toBe('openrouter');
    expect(capturedRows[0].description).toBe(
      'Multi-Modell-KI-Gateway mit Zugang zu führenden LLM-Anbietern',
    );
  });

  it('falls back to the top-level English description when locale has no override', () => {
    localeMock.mockReturnValue({ locale: 'fr' });
    render(<ProvidersTable organizationId="test-org-id" />);
    expect(capturedRows[0].description).toBe(
      'Multi-model AI gateway with access to leading LLM providers',
    );
  });

  it('narrows de-CH to de.description', () => {
    localeMock.mockReturnValue({ locale: 'de-CH' });
    render(<ProvidersTable organizationId="test-org-id" />);
    expect(capturedRows[0].description).toBe(
      'Multi-Modell-KI-Gateway mit Zugang zu führenden LLM-Anbietern',
    );
  });
});
