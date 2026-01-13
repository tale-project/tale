import { createApi } from '@convex-dev/better-auth';
import schema from './schema';
import { getAuthOptions } from '../auth';

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, getAuthOptions);
