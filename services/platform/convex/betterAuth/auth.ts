import { createAuth } from '../auth';

// Export a static instance for Better Auth schema generation
export const auth = createAuth(
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
  {} as unknown as Parameters<typeof createAuth>[0],
);
