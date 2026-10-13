import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { AgentConnection } from '../types';
import {
  AgentAccessCell,
  AgentCell,
  AgentPersonCell,
} from './agent-connection-cells';

function connection(overrides: Partial<AgentConnection> = {}): AgentConnection {
  return {
    id: 'conn-1',
    userId: 'ada',
    clientName: 'Claude Code',
    provenance: 'metadata_document',
    clientHost: 'claude.ai',
    scopes: ['tale:mcp'],
    createdAt: Date.UTC(2026, 9, 1, 12),
    lastUsedAt: null,
    revokedAt: null,
    revokeReason: null,
    personName: 'Ada Lovelace',
    personEmail: 'ada@example.test',
    ...overrides,
  };
}

/** The agent a row is about: its name, and where Tale knows it from. */
describe('AgentCell [AGCONN-R24]', () => {
  it('names the app and the domain it proved', () => {
    render(<AgentCell connection={connection()} />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });

  it('says plainly that an app that only registered itself is unverified', () => {
    render(
      <AgentCell
        connection={connection({
          provenance: 'registered',
          clientHost: null,
          clientName: 'Totally Claude',
        })}
      />,
    );
    expect(screen.getByText('Totally Claude')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('does not take a host for proof when the app did not prove one', () => {
    // A registered app has no verified host, whatever else the row holds.
    render(
      <AgentCell
        connection={connection({
          provenance: 'registered',
          clientHost: 'claude.ai',
        })}
      />,
    );
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByText('claude.ai')).not.toBeInTheDocument();
  });

  it.each([
    ['user', 'by the person who connected it'],
    ['admin', 'by an Admin'],
    ['membership_ended', 'membership ended'],
    ['account_security', 'account security change'],
    ['refresh_reuse', 'an old sign-in was reused'],
    ['client_removed', 'app removed'],
  ] as const)('says when and why a connection ended: %s', (reason, words) => {
    render(
      <AgentCell
        connection={connection({
          revokedAt: Date.UTC(2026, 9, 12, 12),
          revokeReason: reason,
        })}
      />,
    );
    expect(screen.getByText(/^Disconnected /)).toHaveTextContent(
      new RegExp(`^Disconnected .*2026.* · ${words}$`),
    );
    // The domain gives way to the ending.
    expect(screen.queryByText('claude.ai')).not.toBeInTheDocument();
  });

  it.each([null, 'a_reason_a_newer_version_adds' as never])(
    'says only when a connection ended for a reason this version does not know (%s)',
    (reason) => {
      render(
        <AgentCell
          connection={connection({
            revokedAt: Date.UTC(2026, 9, 12, 12),
            revokeReason: reason,
          })}
        />,
      );
      const caption = screen.getByText(/^Disconnected /);
      expect(caption).not.toHaveTextContent('·');
    },
  );

  it('passes an accessibility audit, verified or not', async () => {
    const { container } = render(
      <div>
        <AgentCell connection={connection()} />
        <AgentCell
          connection={connection({
            provenance: 'registered',
            clientHost: null,
          })}
        />
      </div>,
    );
    await checkAccessibility(container);
  });
});

/** What a phone still has to tell, under the agent's name. */
describe('AgentCell where the table has no column for it [AGCONN-R24]', () => {
  const HOUR = 60 * 60 * 1000;

  it('carries what the agent may do and when it last called', () => {
    render(
      <AgentCell
        connection={connection({
          scopes: ['tale:mcp', 'tale:automations.write', 'tale:settings.write'],
          lastUsedAt: Date.now() - 3 * HOUR,
        })}
        carries={{ access: true }}
      />,
    );
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Edit automations')).toBeInTheDocument();
    expect(screen.getByText('Change settings')).toBeInTheDocument();
    expect(screen.getByText('Last used 3 hours ago')).toBeInTheDocument();
  });

  it('says so when the agent has never called', () => {
    render(
      <AgentCell
        connection={connection({ lastUsedAt: null })}
        carries={{ access: true }}
      />,
    );
    expect(screen.getByText('Never used')).toBeInTheDocument();
    expect(screen.queryByText(/^Last used/)).not.toBeInTheDocument();
  });

  it('says whose agent it is when the person has no column either', () => {
    const { unmount } = render(
      <AgentCell
        connection={connection()}
        viewerUserId="olav"
        carries={{ person: true }}
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    // Asked for only the person, it adds nothing about access.
    expect(screen.queryByText('Read and test')).not.toBeInTheDocument();
    expect(screen.queryByText('Never used')).not.toBeInTheDocument();
    unmount();

    render(
      <AgentCell
        connection={connection()}
        viewerUserId="ada"
        carries={{ person: true }}
      />,
    );
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('adds nothing where the table has the columns itself', () => {
    render(
      <AgentCell
        connection={connection({ lastUsedAt: Date.now() - HOUR })}
        carries={{ person: false, access: false }}
      />,
    );
    expect(screen.queryByText('Read and test')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last used|Never used/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('keeps an ended connection’s ending beside what it held', () => {
    render(
      <AgentCell
        connection={connection({
          revokedAt: Date.UTC(2026, 9, 12, 12),
          revokeReason: 'admin',
          scopes: ['tale:mcp', 'tale:automations.write'],
        })}
        carries={{ access: true }}
      />,
    );
    expect(screen.getByText(/^Disconnected /)).toHaveTextContent('by an Admin');
    expect(screen.getByText('Edit automations')).toBeInTheDocument();
  });

  it('passes an accessibility audit with everything carried', async () => {
    const { container } = render(
      <AgentCell
        connection={connection({
          scopes: ['tale:mcp', 'tale:automations.write', 'tale:settings.write'],
          lastUsedAt: Date.now() - HOUR,
        })}
        viewerUserId="olav"
        carries={{ person: true, access: true }}
      />,
    );
    await checkAccessibility(container);
  });
});

/** Whose agent it is. */
describe('AgentPersonCell [AGCONN-R24]', () => {
  it('names the person and, under their name, their address', () => {
    render(<AgentPersonCell connection={connection()} viewerUserId="olav" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
  });

  it('reads the viewer’s own agent as theirs', () => {
    render(<AgentPersonCell connection={connection()} viewerUserId="ada" />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('falls back to the address, then to an unknown person', () => {
    const { unmount } = render(
      <AgentPersonCell
        connection={connection({ personName: null })}
        viewerUserId="olav"
      />,
    );
    // The address alone is the name; it is not repeated beneath.
    expect(screen.getAllByText('ada@example.test')).toHaveLength(1);
    unmount();

    render(
      <AgentPersonCell
        connection={connection({ personName: '', personEmail: null })}
        viewerUserId="olav"
      />,
    );
    expect(screen.getByText('Unknown person')).toBeInTheDocument();
  });
});

/** What the agent may do, in the words it was chosen with. */
describe('AgentAccessCell [AGCONN-R24]', () => {
  it('says the level the agent holds', () => {
    const { unmount } = render(<AgentAccessCell scopes={['tale:mcp']} />);
    expect(screen.getByText('Read and test')).toBeInTheDocument();
    unmount();

    const edit = render(
      <AgentAccessCell scopes={['tale:mcp', 'tale:automations.write']} />,
    );
    expect(screen.getByText('Edit automations')).toBeInTheDocument();
    expect(screen.queryByText('Read and test')).not.toBeInTheDocument();
    edit.unmount();

    render(
      <AgentAccessCell
        scopes={[
          'tale:mcp',
          'tale:automations.write',
          'tale:automations.deploy',
        ]}
      />,
    );
    expect(screen.getByText('Edit and deploy')).toBeInTheDocument();
    expect(screen.queryByText('Edit automations')).not.toBeInTheDocument();
  });

  it('adds what it may do beside the level', () => {
    render(
      <AgentAccessCell
        scopes={[
          'tale:mcp',
          'tale:settings.read',
          'tale:settings.write',
          'tale:subscriptions.connect',
        ]}
      />,
    );
    expect(screen.getByText('Read and test')).toBeInTheDocument();
    // Changing settings reads them too: one badge says both.
    expect(screen.getByText('Change settings')).toBeInTheDocument();
    expect(screen.queryByText('Read settings')).not.toBeInTheDocument();
    expect(screen.getByText('Connect AI subscriptions')).toBeInTheDocument();
  });

  it('says what it can of access that leaves out reading and testing', () => {
    render(<AgentAccessCell scopes={['tale:settings.read']} />);
    expect(screen.getByText('Read settings')).toBeInTheDocument();
    expect(screen.queryByText('Read and test')).not.toBeInTheDocument();
  });

  it('passes an accessibility audit', async () => {
    const { container } = render(
      <AgentAccessCell
        scopes={[
          'tale:mcp',
          'tale:automations.write',
          'tale:automations.deploy',
          'tale:settings.write',
          'tale:subscriptions.connect',
        ]}
      />,
    );
    await checkAccessibility(container);
  });
});
