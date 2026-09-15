import type { SearchDoc } from '../build-index';

/** Compact fixture covering the realistic shape of docs content:
 *  - title-only matches, heading-only matches, body-only matches;
 *  - long-form pages with multiple sections;
 *  - co-located vs spread-out multi-token bodies (for proximity tests);
 *  - a short page that exercises the truncate path;
 *  - distinct sections so grouping logic has something to do. */
export const SAMPLE_DOCS: readonly SearchDoc[] = [
  {
    id: 'en:platform/configuration',
    title: 'Configuration',
    headings: 'Environment variables Database setup Authentication',
    body:
      'Configuration is loaded from environment variables. ' +
      'You can configure the database connection, authentication providers, ' +
      'and feature flags through a single config file. ' +
      'The configuration is validated at startup. ' +
      'See the env reference for every supported variable.',
    url: '/platform/configuration',
    section: 'platform',
    locale: 'en',
  },
  {
    id: 'en:platform/rag',
    title: 'RAG service',
    headings: 'Configure RAG Embeddings Vector store',
    body:
      'The RAG service handles retrieval-augmented generation. ' +
      'To configure the RAG service, set the EMBEDDING_MODEL env var and ' +
      'point VECTOR_STORE_URL at a running instance. ' +
      'Tune chunk size and overlap for your corpus. ' +
      'The retrieval pipeline runs nearest-neighbour search over embedded chunks.',
    url: '/platform/rag',
    section: 'platform',
    locale: 'en',
  },
  {
    id: 'en:cli/install',
    title: 'Install the CLI',
    headings: 'macOS Linux Windows',
    body:
      'Install the Tale CLI with one command. ' +
      'On macOS use brew install tale. ' +
      'On Linux pull the released binary or build from source. ' +
      'Windows support is experimental — use WSL2 for the smoothest experience.',
    url: '/cli/install',
    section: 'cli',
    locale: 'en',
  },
  {
    id: 'en:cli/commands',
    title: 'Commands reference',
    headings: 'tale run tale deploy tale config tale doctor',
    body:
      'The tale command exposes subcommands for the full lifecycle. ' +
      'Use tale config to view and edit the local configuration. ' +
      'tale run executes a workflow locally. ' +
      'tale deploy ships the current branch to your target environment.',
    url: '/cli/commands',
    section: 'cli',
    locale: 'en',
  },
  {
    id: 'en:platform/observability',
    title: 'Observability',
    headings: 'Metrics Logs Traces',
    // "configure" and "rag" both appear, but far apart — proximity should
    // demote this relative to the rag page where they co-locate.
    body:
      'Tale ships with built-in metrics, logs, and traces. ' +
      'You can configure metric exporters, log destinations, and trace ' +
      'sampling independently. ' +
      'The default OTel pipeline writes to stdout in dev. ' +
      'In production, point the exporter at your collector. ' +
      'Some teams plug in a dedicated rag eval dashboard alongside the ' +
      'general observability stack.',
    url: '/platform/observability',
    section: 'platform',
    locale: 'en',
  },
  {
    id: 'en:index',
    title: 'Welcome',
    headings: 'Getting started',
    body: 'Welcome to Tale documentation. Pick a section to begin.',
    url: '/',
    locale: 'en',
  },
] as const;

/** Mirror copy in a non-English locale so locale-cache tests can switch and
 *  prove the right index loads. */
export const SAMPLE_DOCS_DE: readonly SearchDoc[] = [
  {
    id: 'de:platform/configuration',
    title: 'Konfiguration',
    headings: 'Umgebungsvariablen Datenbank',
    body: 'Die Konfiguration wird aus Umgebungsvariablen geladen.',
    url: '/de/platform/configuration',
    section: 'platform',
    locale: 'de',
  },
];
