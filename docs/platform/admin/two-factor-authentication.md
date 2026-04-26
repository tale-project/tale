---
title: Two-factor authentication
description: Require a second factor on sign-in, enrol your own account, and reset a member who lost their device.
---

Two-factor authentication (2FA) adds a one-time code from an authenticator app to the password sign-in flow. Tale uses a TOTP-based second factor — the same protocol implemented by Google Authenticator, 1Password, Authy, and most password managers — together with single-use backup codes for recovery. 2FA only applies to accounts that sign in with a password; users authenticated through SSO or trusted headers inherit their identity provider's 2FA decision and never see the Tale prompts.

There are two surfaces to know about. **Account > Security** is where every user enrols, regenerates backup codes, or disables 2FA on their own account. **Settings > Governance** is where admins enforce 2FA across the organisation and reset the second factor for a member who lost their device.

## Enrol your own account

Open **Account > Security** from the avatar menu and click **Enable two-factor**. Tale prompts you to confirm your password, then displays a QR code and a manual-entry secret.

1. Scan the QR code with an authenticator app, or paste the secret manually if you can't scan.
2. Enter the 6-digit code the app shows. Tale verifies it before activating 2FA, so a wrong scan can never lock you out.
3. Save the **backup codes** Tale displays next. Each code works once and is the only way back into your account if you lose your authenticator. Tale shows the codes exactly once — download or print them now.

From the same page you can **regenerate backup codes** (invalidates the old set) or **disable two-factor** (requires a password confirmation). Regenerate as soon as you've used a few codes — Tale shows a low-codes banner when you fall under the threshold.

## Sign in with 2FA

After password entry, Tale prompts for the 6-digit code. The verify screen has two modes:

- **Authenticator app** — the default. Enter the current code from your app.
- **Backup code** — toggle _Use a backup code instead_ if you don't have your authenticator. Each code is consumed on use; reusing it is rejected. Tale reminds you to regenerate if you fall below five remaining codes.

Repeated failures are rate-limited using the same back-off as wrong-password attempts. Lockouts are recorded in the audit log.

## Enforce 2FA across the organisation

Open **Settings > Governance > Two-factor policy**. Toggle **Require two-factor** to make 2FA mandatory for every password-authenticated member. Two settings shape the rollout:

- **Grace period (days)** — how many days each user has from their first sign-in under the policy before enrolment is enforced. Set to `0` for immediate enforcement; pick a longer window when you roll out 2FA to an existing organisation so members can enrol without losing access. Members in their grace period see a banner reminding them to set up; once the grace ends they cannot reach the dashboard until they enrol.
- **Reset member's two-factor** — under **Settings > Members**, the row menu has a **Reset two-factor** action for admins. Use it when someone loses their authenticator and runs out of backup codes. The reset disables 2FA for that user, ends all their active sessions, and forces them to enrol again on their next sign-in. Every reset is recorded in the audit log so security teams can review the trail.

The policy only governs password sign-in. SSO and trusted-headers users are exempt because their identity provider already controls their second factor.

## Audit events

Every 2FA action emits a structured audit log entry visible under **Settings > Governance > Audit logs**:

| Action                   | When it fires                                              |
| ------------------------ | ---------------------------------------------------------- |
| `2fa_enrolled`           | A user completes enrolment.                                |
| `2fa_disabled`           | A user disables 2FA on their own account.                  |
| `2fa_verified`           | A successful TOTP verification at sign-in.                 |
| `2fa_verify_failed`      | A failed TOTP verification.                                |
| `2fa_backup_code_used`   | A backup code was successfully consumed.                   |
| `2fa_backup_code_failed` | A backup code attempt failed.                              |
| `2fa_reset_by_admin`     | An admin reset a member's 2FA from **Settings > Members**. |

## Related

- [Authentication](/self-hosted/admin/authentication) — password, SSO, and trusted-headers sign-in.
- [Members and roles](/platform/admin/members-and-roles) — reset a member's 2FA from the row menu.
- [Governance](/platform/admin/governance) — set the policy and read the audit log.
