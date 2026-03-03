import { z } from 'zod/v4';

const workflowStatusLiterals = ['draft', 'active', 'archived'] as const;
export const workflowStatusSchema = z.enum(workflowStatusLiterals);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
