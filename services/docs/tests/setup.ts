import '@testing-library/jest-dom/vitest';
// Initialise the docs i18n instance as a side-effect so components that call
// `useT(...)` (e.g. the shared `@tale/ui` SearchCommand resolving the `search`
// namespace) render real copy in unit tests instead of raw keys.
import '@/lib/i18n/i18n';
