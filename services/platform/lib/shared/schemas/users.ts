import { z } from 'zod/v4';

export const roleSchema = z.string();
export type Role = 'admin' | 'member' | (string & {});
