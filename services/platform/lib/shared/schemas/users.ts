import { z } from 'zod';

export const roleSchema = z.string();
export type Role = 'admin' | 'member' | (string & {});
