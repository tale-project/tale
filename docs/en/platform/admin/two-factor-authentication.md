---
title: Two-factor authentication
description: TOTP enrolment, backup codes, the org-wide enforce policy, and how an admin resets a member who lost their authenticator. Read this when wiring 2FA for the org or recovering an account.
---

Two-factor authentication adds a second proof of identity on top of the password — a six-digit code from an authenticator app. Tale ships TOTP (time-based one-time passwords) compatible with Google Authenticator, 1Password, Authy, and any other app that follows the standard. The page covers per-user enrolment, the backup codes that recover an account when the phone is gone, the org-wide enforce policy, and the admin reset for a locked-out member.

Two-factor is optional by default. Admins can require it for the whole organisation with a grace window so members have time to enrol.

## Per-user enrolment

To turn 2FA on for your own account, open **Account > Security**. Click **Enable two-factor**, confirm your password, and scan the QR code with an authenticator app. Enter the six-digit code the app shows to verify the secret was captured, then save the backup codes the next screen presents. The codes show once — download or copy them before clicking **Done**.

The same screen carries **Disable** and **Regenerate backup codes**. Disabling clears the second factor; regenerating invalidates every previous backup code. Both actions require the account password as a confirmation.

## Backup codes

Backup codes are single-use strings the platform mints when 2FA is enabled or regenerated. Each one substitutes for the authenticator code on a single sign-in — useful when the phone is lost, the authenticator is uninstalled, or you are stuck somewhere without the device. The platform watches the remaining count and surfaces a low-balance banner when only a few codes remain; the banner links straight to the regenerate flow.

Treat backup codes like passwords. Store them in a password manager or print them and lock them away. Anyone who has both your password and a backup code can sign in as you.

## The enforce-for-org policy

Admins can require two-factor for every password-authenticated member of the organisation. Open **Settings > Governance > Authentication** and toggle **Require two-factor authentication**. The policy carries a grace period (in days) that gives each member time to enrol from their first sign-in under the policy; set it to zero for immediate enforcement.

| Field                             | Type    | Required | Description                                                                                                      |
| --------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Require two-factor authentication | Toggle  | yes      | Off keeps 2FA optional for every member; on turns the policy on.                                                 |
| Grace period (days)               | Integer | yes      | Days from a member's first signed-in moment under the policy before enrolment is required. Zero means immediate. |
| Exempt SSO-only users             | Toggle  | no       | When on, members whose only account is a federated identity rely on the upstream IdP for MFA.                    |

A member inside the grace window sees a count-down banner in the app pointing them at the enrolment flow. Once grace expires, the next sign-in routes through the enrolment screen and the member cannot continue until they have enrolled.

## Admin reset for a locked-out member

When a member loses their phone and their backup codes, an Admin clears the second factor on their account. Open **Settings > People**, find the member, and click **Reset two-factor** on their row. Tale disables 2FA for the account and ends every active session, so the member re-enrols on their next sign-in.

The reset is recorded in the audit log under `2fa_reset_by_admin`. Reach for it as a recovery action — the member should re-enrol immediately once they are back in.

## Where this fits

Two-factor sits one layer above the password — same login screen, second step. Pair it with [members and roles](/platform/admin/members-and-roles) (the admin who resets the second factor is the same admin who manages the account), with [policies and limits](/platform/admin/governance/policies-and-limits) (the enforce policy lives in the governance surface), and with [audit logs](/platform/admin/governance/audit-logs) (every enrolment, disablement, and admin reset lands there).
