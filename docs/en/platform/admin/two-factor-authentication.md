---
title: Two-factor authentication
description: TOTP enrolment, passkeys, backup codes, the org-wide enforce policy, and how an admin resets a member who lost their authenticator.
---

Two-factor authentication adds a second proof of identity on top of the password — a six-digit code from an authenticator app, or a WebAuthn passkey. Tale ships TOTP (time-based one-time passwords) compatible with Google Authenticator, 1Password, Authy, and any other app that follows the standard, plus passkeys for a phishing-resistant alternative. The page covers per-user enrolment, passkeys, the backup codes that recover an account when the phone is gone, the org-wide enforce policy, and the admin reset for a locked-out member.

Two-factor is optional by default. Admins can require it for the whole organisation with a grace window so members have time to enrol.

## Per-user enrolment

To turn 2FA on for your own account, open **Account > Security**. Click **Enable two-factor**, confirm your password, and scan the QR code with an authenticator app. Enter the six-digit code the app shows to verify the secret was captured, then save the backup codes the next screen presents. The codes show once — download or copy them before clicking **Done**.

The same screen carries **Disable** and **Regenerate backup codes**. Disabling clears the second factor; regenerating invalidates every previous backup code. Both actions require the account password as a confirmation.

## Backup codes

Backup codes are single-use strings the platform mints when 2FA is enabled or regenerated. Each one substitutes for the authenticator code on a single sign-in — useful when the phone is lost, the authenticator is uninstalled, or you are stuck somewhere without the device. The platform watches the remaining count and surfaces a low-balance banner when only a few codes remain; the banner links straight to the regenerate flow.

Treat backup codes like passwords. Store them in a password manager or print them and lock them away. Anyone who has both your password and a backup code can sign in as you.

## Passkeys

A passkey is a WebAuthn credential — Face ID, Touch ID, Windows Hello, or a hardware security key — that signs a per-login challenge instead of producing a typed code. The credential is bound to the site's origin, so a look-alike phishing domain gets nothing to replay; that makes a passkey phishing-resistant in a way TOTP is not, and it satisfies an enforced two-factor policy exactly like TOTP does.

To register one, open **Account > Security** and click **Add a passkey**. Give the credential a name you will recognise later, then pick the **Authenticator type**: **Any (recommended)** lets the browser offer everything available, **This device (Face ID, Touch ID, Windows Hello)** narrows the ceremony to the built-in authenticator, and **Security key or phone** narrows it to a roaming one. The browser runs the registration ceremony from there. Each entry in the same list carries a **Remove** icon button for revoking your own credentials; it asks you to confirm before the passkey is removed.

A registered passkey works at three doors. On the login screen, **Sign in with a passkey** signs you in without typing the password — the credential is itself strong proof. On the verification screen after a password login, **Use a passkey instead** replaces the six-digit code. And on the enrolment screen an enforced policy routes unenrolled members to, **Register a passkey instead** sits next to the TOTP setup — a member who registers only a passkey, never TOTP, passes the policy.

When a member loses a device with a passkey on it, an Admin revokes the credential: open **Settings > Members**, click **Edit member** on the member, and remove the credential from the **Passkeys** section of the dialog. Tale deletes the credential and ends every active session of that member, so a lost or stolen authenticator can't keep a session alive. The admin revocation lands in the audit log as `passkey.revoked_by_admin`.

## The enforce-for-org policy

Admins can require two-factor for every password-authenticated member of the organisation. Open **Settings > Governance > Security** and, under **Two-factor authentication**, toggle **Require two-factor authentication**. The policy carries a grace period (in days) that gives each member time to enrol from their first sign-in under the policy; set it to zero for immediate enforcement.

<Frame caption="Settings > Governance > Security — login-attempt limits and password policy; the two-factor authentication policy sits in the same page below these.">

![The Security and Monitoring governance page showing login-attempt limit fields and the password-policy character-class requirements; the two-factor policy is further down the same page.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Field                             | Type    | Required | Description                                                                                                      |
| --------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Require two-factor authentication | Toggle  | yes      | Off keeps 2FA optional for every member; on turns the policy on.                                                 |
| Grace period (days)               | Integer | yes      | Days from a member's first signed-in moment under the policy before enrolment is required. Zero means immediate. |
| Exempt SSO-only users             | Toggle  | no       | When on, members whose only account is a federated identity rely on the upstream IdP for MFA.                    |

A member inside the grace window sees a count-down banner in the app pointing them at the enrolment flow. Once grace expires, the next sign-in routes through the enrolment screen and the member cannot continue until they have enrolled.

## Admin reset for a locked-out member

When a member loses their phone and their backup codes, an Admin clears the second factor on their account. Open **Settings > Members**, click **Edit member** on the member, and click **Reset two-factor** in the dialog. Tale disables 2FA for the account and ends every active session, so the member re-enrols on their next sign-in.

The reset is recorded in the audit log under `2fa_reset_by_admin`. Reach for it as a recovery action — the member should re-enrol immediately once they are back in.

## Where this fits

Two-factor sits one layer above the password — same login screen, second step. Pair it with [members and roles](/platform/admin/members-and-roles) (the admin who resets the second factor is the same admin who manages the account), with [policies and limits](/platform/admin/governance/policies-and-limits) (the enforce policy lives in the governance surface), and with [audit logs](/platform/admin/governance/audit-logs) (every enrolment, disablement, and admin reset lands there).
