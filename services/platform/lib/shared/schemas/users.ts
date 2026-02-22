import { z } from 'zod/v4';

export const PLATFORM_ROLES = [
  'owner',
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const roleSchema = z.enum(PLATFORM_ROLES);
