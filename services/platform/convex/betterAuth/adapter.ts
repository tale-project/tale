import { createApi } from '@convex-dev/better-auth';

import { getAuthOptions } from '../auth';
import schema from './schema';

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, getAuthOptions);
