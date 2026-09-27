/**
 * The longest display name a person can save — imported by both the server's
 * `updateUserName` (`backend/domains/users/service.ts`) and the account
 * form's schema, so the form refuses in the field what the server would
 * refuse, instead of letting a save fail on a generic toast.
 */
export const USER_NAME_MAX_LENGTH = 100;
