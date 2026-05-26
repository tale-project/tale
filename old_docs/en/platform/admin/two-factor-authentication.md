---
title: Two-factor authentication
description: Require a TOTP second factor on password sign-in, enrol your own account, manage backup codes, and reset a member who lost their device.
---

Two-factor authentication adds a one-time code from an authenticator app to the password sign-in flow. Tale uses TOTP — the same protocol implemented by Google Authenticator, 1Password, Authy, and most password managers — together with single-use backup codes for recovery. The factor only applies to accounts that sign in with a password; users authenticated through SSO or trusted headers inherit their identity provider's MFA decision and never see the Tale prompts.

Two surfaces matter on this page. **Account > Security** is where every user enrols, regenerates backup codes, or disables 2FA on their own account. **Settings > Governance > Two-factor authentication** is where Admins enforce 2FA across the organisation, and **Settings > Members** is where Admins reset the second factor for a member who lost their device.

## Enrol your own account

Open the avatar menu and pick **Account**. Under **Security**, click **Enable two-factor**. Tale confirms your password, then displays a QR code and a manual-entry secret.

1. Scan the QR code with an authenticator app, or paste the secret manually if you cannot scan.
2. Enter the 6-digit code the app shows. Tale verifies it before activating 2FA, so a wrong scan cannot lock you out — the dialog stays open until the code matches.
3. Save the **backup codes** Tale displays next. Each code works once and is the only way back into your account if you lose the authenticator. Tale shows the codes exactly once — download or copy them now.

From the same screen you can **Regenerate backup codes** (invalidates the old set) or **Disable** (requires a fresh password confirmation). A low-codes banner appears when you fall under the threshold so you regenerate before the last code is gone.

## Sign in with 2FA

After password entry, Tale prompts for the 6-digit code. The verify screen has two modes:

- **Authenticator app** — the default. Type the current code from your app.
- **Backup code** — toggle **Use a backup code instead** if you do not have the authenticator. Each code is consumed on use; reusing it is rejected. A low-codes reminder fires below five remaining codes.

Repeated failures are rate-limited with the same back-off as wrong-password attempts. Lockouts are recorded in the audit log under the **Security** category.

## Enforce 2FA across the organisation

Open **Settings > Governance > Two-factor authentication**. The form takes three settings:

- **Require two-factor authentication** — the master toggle. While off, 2FA is optional for every user.
- **Grace period (days)** — how many days each user has from their first sign-in under the policy before enrolment is enforced. Set to `0` for immediate enforcement; pick a longer window when you roll out 2FA to an existing organisation so members can enrol without losing access. Members inside their grace window see a banner reminding them to set up; once the grace ends, they cannot reach anything past the sign-in screen until they enrol.
- **Exempt SSO-only users** — when on, accounts whose only credential is a federated identity (Microsoft Entra ID, OIDC) are exempted because the upstream IdP controls their MFA. A user who has both an SSO account and a password is **never** exempt, because the password is a bypass route.

Click **Save** to apply.

## Reset a member's 2FA

Open **Settings > Members**, click the row menu of the affected user, and pick **Reset two-factor**. The confirmation dialog spells out the consequence — 2FA is disabled for that user, every active session of theirs ends, and they must enrol again on their next sign-in. Use it when a member loses their authenticator and runs out of backup codes. Every reset is recorded in the audit log so security teams can review the trail.

## Audit events

Every 2FA action emits a structured audit log entry under **Settings > Governance > Audit logs**, category **Security**:

| Action                   | When it fires                                              |
| ------------------------ | ---------------------------------------------------------- |
| `2fa_enrolled`           | A user completes enrolment.                                |
| `2fa_disabled`           | A user disables 2FA on their own account.                  |
| `2fa_verified`           | A successful TOTP verification at sign-in.                 |
| `2fa_verify_failed`      | A failed TOTP verification.                                |
| `2fa_backup_code_used`   | A backup code was consumed successfully.                   |
| `2fa_backup_code_failed` | A backup code attempt failed.                              |
| `2fa_reset_by_admin`     | An Admin reset a member's 2FA from **Settings > Members**. |

## Where this fits

Two-factor authentication is the second-factor layer on password sign-in. It interacts with two other surfaces: [Authentication](/self-hosted/admin/authentication) decides whether a user signs in via password (where 2FA applies), SSO, or trusted headers (where the upstream IdP owns the second factor); [Members and roles](/platform/admin/members-and-roles) is where the Admin resets a member's 2FA when the device is lost. The org-wide enforcement policy lives on this page; the broader governance surface that holds budgets, retention, and guardrails is [Governance](/platform/admin/governance).
