// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { IntegrationDetails } from '../integration-details';

// Mock next-intl used by useT
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// Mock toast
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(cleanup);

// Minimal integration fixture matching Doc<'integrations'> shape
function makeIntegration(
  overrides: Record<string, unknown> = {},
): Parameters<typeof IntegrationDetails>[0]['integration'] {
  return {
    _id: 'test-id' as never,
    _creationTime: 0,
    organizationId: 'org-1',
    name: 'test-integration',
    title: 'Test Integration',
    status: 'active' as const,
    isActive: true,
    authMethod: 'api_key' as const,
    ...overrides,
  } as Parameters<typeof IntegrationDetails>[0]['integration'];
}

describe('IntegrationDetails', () => {
  it('renders nothing when no operations or connector details exist', () => {
    const { container } = render(
      <IntegrationDetails integration={makeIntegration()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders REST operations with names and titles', () => {
    const integration = makeIntegration({
      connector: {
        code: 'const connector = {};',
        version: 1,
        operations: [
          { name: 'list_items', title: 'List items' },
          {
            name: 'get_item',
            title: 'Get item',
            description: 'Fetch a single item',
          },
        ],
        secretBindings: ['apiKey'],
        allowedHosts: [],
      },
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('list_items')).toBeInTheDocument();
    expect(screen.getByText('— List items')).toBeInTheDocument();
    expect(screen.getByText('get_item')).toBeInTheDocument();
    expect(screen.getByText('— Get item')).toBeInTheDocument();
    expect(screen.getByText('Fetch a single item')).toBeInTheDocument();
  });

  it('renders SQL operations with queries', () => {
    const integration = makeIntegration({
      type: 'sql',
      sqlOperations: [
        {
          name: 'get_users',
          title: 'Get users',
          query: 'SELECT * FROM users',
          operationType: 'read',
        },
        {
          name: 'insert_user',
          title: 'Insert user',
          query: 'INSERT INTO users (name) VALUES (@name)',
          operationType: 'write',
          requiresApproval: true,
        },
      ],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('get_users')).toBeInTheDocument();
    expect(screen.getByText('insert_user')).toBeInTheDocument();
    expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument();
    expect(
      screen.getByText('INSERT INTO users (name) VALUES (@name)'),
    ).toBeInTheDocument();
  });

  it('renders allowed hosts as badges', () => {
    const integration = makeIntegration({
      connector: {
        code: 'const connector = {};',
        version: 1,
        operations: [{ name: 'op1' }],
        secretBindings: [],
        allowedHosts: ['example.com', 'api.test.io'],
      },
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('api.test.io')).toBeInTheDocument();
  });

  it('renders connector code for REST type', () => {
    const code = 'const connector = { test: true };';
    const integration = makeIntegration({
      connector: {
        code,
        version: 1,
        operations: [{ name: 'op1' }],
        secretBindings: [],
      },
    });

    const { container } = render(
      <IntegrationDetails integration={integration} />,
    );

    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toContain(code);
  });

  it('does not render connector code for SQL type', () => {
    const integration = makeIntegration({
      type: 'sql',
      connector: {
        code: 'some code',
        version: 1,
        operations: [],
        secretBindings: [],
      },
      sqlOperations: [{ name: 'query1', query: 'SELECT 1' }],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.queryByText('some code')).not.toBeInTheDocument();
  });

  it('renders SQL config when active', () => {
    const integration = makeIntegration({
      type: 'sql',
      isActive: true,
      sqlConnectionConfig: {
        engine: 'postgres',
        port: 5432,
        readOnly: true,
        security: {
          maxResultRows: 1000,
          queryTimeoutMs: 30000,
        },
      },
      sqlOperations: [{ name: 'query1', query: 'SELECT 1' }],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('postgres')).toBeInTheDocument();
    expect(screen.getByText('5432')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    expect(screen.getByText('30000')).toBeInTheDocument();
  });

  it('does not render SQL config when inactive', () => {
    const integration = makeIntegration({
      type: 'sql',
      isActive: false,
      sqlConnectionConfig: {
        engine: 'mssql',
        port: 1433,
      },
      sqlOperations: [{ name: 'query1', query: 'SELECT 1' }],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('query1')).toBeInTheDocument();
    expect(screen.queryByText('mssql')).not.toBeInTheDocument();
  });

  it('renders parametersSchema for SQL operations', () => {
    const integration = makeIntegration({
      type: 'sql',
      sqlOperations: [
        {
          name: 'get_room',
          title: 'Get Room',
          query: 'SELECT * FROM rooms WHERE id = @roomId',
          parametersSchema: {
            type: 'object',
            properties: {
              roomId: {
                type: 'number',
                description: 'Room ID',
                required: true,
              },
            },
          },
        },
      ],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('roomId')).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getByText('Room ID')).toBeInTheDocument();
  });

  it('renders parametersSchema for REST operations', () => {
    const integration = makeIntegration({
      connector: {
        code: 'const c = {};',
        version: 1,
        operations: [
          {
            name: 'search',
            title: 'Search',
            parametersSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search term',
                  required: false,
                },
                limit: {
                  type: 'number',
                  description: 'Max results',
                  required: true,
                },
              },
            },
          },
        ],
        secretBindings: [],
      },
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('query')).toBeInTheDocument();
    expect(screen.getByText('Search term')).toBeInTheDocument();
    expect(screen.getByText('limit')).toBeInTheDocument();
    expect(screen.getByText('Max results')).toBeInTheDocument();
  });

  it('does not render parameters when no parametersSchema exists', () => {
    const integration = makeIntegration({
      type: 'sql',
      sqlOperations: [
        {
          name: 'list_all',
          query: 'SELECT * FROM items',
        },
      ],
    });

    render(<IntegrationDetails integration={integration} />);

    expect(screen.getByText('list_all')).toBeInTheDocument();
    expect(
      screen.queryByText('integrations.manageDialog.parameters'),
    ).not.toBeInTheDocument();
  });

  it('renders correct number of operation items', () => {
    const integration = makeIntegration({
      connector: {
        code: '',
        version: 1,
        operations: [{ name: 'op1' }, { name: 'op2' }, { name: 'op3' }],
        secretBindings: [],
      },
    });

    render(<IntegrationDetails integration={integration} />);

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });
});
