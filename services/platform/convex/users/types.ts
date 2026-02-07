export type { Role } from '../../lib/shared/schemas/users';

export interface CreateUserWithoutSessionArgs {
  email: string;
  password: string;
  name?: string;
  organizationId: string;
  role?: string;
  displayName?: string;
}

export interface CreateUserWithoutSessionResult {
  userId: string;
  memberId: string;
}

export interface CreateMemberArgs {
  organizationId: string;
  email: string;
  password: string;
  displayName?: string;
  role?: string;
}

export interface CreateMemberResult {
  userId: string;
  memberId: string;
}

export interface AddMemberInternalArgs {
  organizationId: string;
  email: string;
  identityId: string;
  role?: string;
  displayName?: string;
}

export interface AddMemberInternalResult {
  memberId: string;
}

