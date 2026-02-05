export interface ApiKey {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  userId: string;
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastRequest: Date | null;
}
