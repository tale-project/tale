/**
 * `user_preferences` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../user_preferences.ts` are what
 * actually serve them.
 */

export interface UserPreferencesContract {
  'user_preferences/mutations:setCustomInstructionsEnabled': {
    kind: 'mutation';
    args: { organizationId: string; enabled: boolean };
    returns: string;
  };
  'user_preferences/mutations:setMemoriesEnabled': {
    kind: 'mutation';
    args: { organizationId: string; enabled: boolean };
    returns: string;
  };
  'user_preferences/mutations:setOnboardingCompleted': {
    kind: 'mutation';
    args: { organizationId: string; completed: boolean };
    returns: string;
  };
  'user_preferences/mutations:upsertMyPreferences': {
    kind: 'mutation';
    args: { organizationId: string; customInstructions: string };
    returns: string;
  };
  'user_preferences/queries:getMyPreferences': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | {
      _id: string;
      _creationTime: number;
      customInstructionsEnabled?: boolean;
      memoriesEnabled?: boolean;
      voiceOutput?: boolean;
      chatModelId?: string;
      onboardingCompleted?: boolean;
      organizationId: string;
      updatedAt: number;
      userId: string;
      customInstructions: string;
    };
  };
}
