// The catalogs are YAML imports, one file per topic and locale
// (`messages/<locale>/<topic>.yml`, parsed by the shared vite plugin in
// bundled surfaces and natively by Bun elsewhere), so their module type is
// loose, and the global catalog adds nothing at the type level (it folds into
// every locale at runtime). Key correctness is enforced by the i18n test gates
// (parity, orphan, and missing-key checks), not by the type system.
import type metadata from '@/messages/en/metadata.yml';

/** The English catalog, topic by topic: `Messages['metadata']`, … */
export type Messages = Record<string, typeof metadata>;
export type Namespace = Extract<keyof Messages, string>;
