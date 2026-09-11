import { z } from 'zod';

/** An opaque native preimage token. Null means the resource is absent. */
export const configurationHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}(?![\s\S])/);
export const expectedConfigurationHashSchema =
  configurationHashSchema.nullable();
