// The catalog is a YAML import (parsed by the shared vite plugin in bundled
// surfaces and natively by Bun elsewhere), so its module type is loose, and
// the global catalog adds nothing at the type level (it folds into every
// locale at runtime). Key correctness is enforced by the i18n test gates
// (parity, orphan, and missing-key checks), not by the type system.
import localeMessages from '@/messages/en.yml';

export type Messages = typeof localeMessages;
export type Namespace = Extract<keyof Messages, string>;
