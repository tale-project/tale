import type { DocsNavGroup } from '../docs-nav';

/** A small documentation tree with the shapes a real site has: a section of
 *  plain rows, and a section whose groups nest one level deep. */
export const SECTIONS: readonly DocsNavGroup[] = [
  {
    label: 'Start here',
    items: [
      { href: '/', label: 'Tale documentation' },
      { href: '/get-started/quickstart', label: 'Send your first message' },
    ],
  },
  {
    label: 'Self-hosted',
    items: [
      { href: '/self-hosted', label: 'Run Tale on your infrastructure' },
      {
        label: 'Install',
        items: [
          {
            href: '/self-hosted/install/quickstart',
            label: 'Run your first self-hosted instance',
          },
          {
            href: '/self-hosted/install/cli-install',
            label: 'Deploy with the CLI',
          },
        ],
      },
      {
        label: 'Configuration',
        items: [
          {
            href: '/self-hosted/configuration/providers',
            label: 'Connect a model provider',
          },
        ],
      },
    ],
  },
];

export const ACTIVE_HREF = '/self-hosted/install/quickstart';
