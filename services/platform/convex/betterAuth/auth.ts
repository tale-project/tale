import { createAuth } from '../auth';

// Export a static instance for Better Auth schema generation
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth schema generation needs a ctx-shaped stub
export const auth = createAuth({} as Parameters<typeof createAuth>[0]);
