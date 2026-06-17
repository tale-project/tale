# Auth & account — Manual Test Plan

> **Purpose**: Exercise sign-in, the account/security model (password policy, 2FA,
> passkeys, backup codes), the first-run and create-org wizards, and role-based
> access. Auth is the dependency for every other guide — run it first.

## Scope & routes

| Surface                | Route                                       |
| ---------------------- | ------------------------------------------- |
| Login                  | `/log-in`                                   |
| 2FA challenge          | `/2fa`                                      |
| 2FA enrollment         | `/2fa-enroll`                               |
| First-run setup        | `/setup` → `/dashboard/create-organization` |
| Forced password change | `/forced-change-password/{id}`              |
| Account & security     | `/dashboard/{org}/settings/account`         |
| Members & roles        | `/dashboard/{org}/settings/organization`    |

## Prerequisites

Stack up per [SETUP.md](SETUP.md). F5/F6 require a **fresh** account (use the
sign-up endpoint to mint one). 2FA tests need a TOTP generator — the e2e suite
uses a dependency-free RFC-6238 implementation
([`tests/e2e/helpers/totp.ts`](../../services/platform/tests/e2e/helpers/totp.ts)); an agent
can reuse it to compute codes.

> **Agent note**: a fresh user always lands on `/dashboard/create-organization`;
> an existing one goes straight to `/dashboard/{org}`. Password policy =
> length + lower + upper + digit + special (e.g. `TaleE2E!Passw0rd`).

## Automated coverage

| Case(s)                | Status         | e2e spec                                           |
| ---------------------- | -------------- | -------------------------------------------------- |
| F2, F3                 | ✅ automated   | `auth.spec.ts`                                     |
| F4, F7, F8, F9         | ✅ automated   | `auth-account.spec.ts`                             |
| F6                     | ✅ automated   | `onboarding.spec.ts`                               |
| F14                    | ✅ automated   | `rbac.spec.ts`                                     |
| B5                     | ✅ automated   | `validation.spec.ts` / `onboarding.spec.ts`        |
| F5, F10, F11, F12, F13 | ⛔ manual-only | — (fresh DB / WebAuthn / IdP / mid-session policy) |

## Functional tests

| ID  | Test              | Steps (route + control)                                                                                                                                                                                                             | Expected                                                                                            |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F1  | Login renders     | Open `/log-in`                                                                                                                                                                                                                      | Email (`auth.email`) + password (`auth.password`) fields + **Log in** (`auth.login.loginButton`)    |
| F2  | Wrong password    | Submit a valid email + wrong password                                                                                                                                                                                               | Error alert (`auth.login.wrongCredentials`); stays on `/log-in`                                     |
| F3  | Valid login       | Submit correct credentials                                                                                                                                                                                                          | Redirects to `/dashboard/{org}`                                                                     |
| F4  | Logout            | User menu → **Log out** (`auth.userButton.logOut`) → confirm (`auth.userButton.logOutConfirm.confirm`)                                                                                                                              | Returns to `/log-in`                                                                                |
| F5  | First-run setup   | On a fresh DB open `/setup`, complete owner → workspace → finish                                                                                                                                                                    | Owner created; lands on dashboard. Unreachable once a user exists                                   |
| F6  | Create-org wizard | Fresh user → `/dashboard/create-organization`; fill name (`settings.organization.organizationName`) → **Next** (`common.actions.next`) → **Skip** (`common.actions.skip`) → **Go to dashboard** (`onboarding.finish.goToDashboard`) | Org created; URL becomes `/dashboard/{org}`                                                         |
| F7  | Change password   | `/dashboard/{org}/settings/account` → **Change password** (`auth.changePassword.title`); fill current/new/confirm                                                                                                                   | Success; re-login with the new password works                                                       |
| F8  | Enroll 2FA        | Account → enable 2FA (`twoFactor.enrollment.enableButton`), confirm password, scan/transcribe secret (`twoFactor.setup.manualEntry`), enter code (`twoFactor.setup.verifyCodeLabel`) → **Verify** (`twoFactor.setup.verifyButton`)  | Backup codes shown (`twoFactor.backupCodes.title`); 2FA marked enabled                              |
| F9  | 2FA login         | Log out, log in again                                                                                                                                                                                                               | Redirects to `/2fa`; correct TOTP (`twoFactor.verify.submitButton`) → dashboard                     |
| F10 | Passkey           | Account → register a passkey                                                                                                                                                                                                        | Platform authenticator prompt; passkey listed after                                                 |
| F11 | Forced change     | With a mid-session password-expiry policy, trigger it                                                                                                                                                                               | Redirects to `/forced-change-password/{id}`; blocks app until changed                               |
| F12 | SSO               | With Microsoft SSO configured, use the SSO button on `/log-in`                                                                                                                                                                      | OAuth round-trip → dashboard                                                                        |
| F13 | Idle logout       | Idle past the session window                                                                                                                                                                                                        | Returns to `/log-in?reason=idle` with an idle notice                                                |
| F14 | RBAC add member   | Owner: `/dashboard/{org}/settings/organization` → **Add member** (`settings.organization.addMember`); fill name/email/role=member (`settings.roles.member`)/password → submit                                                       | Member-created toast (`toast.success.newMemberCreated`); the new member does NOT see **Add member** |

## Boundary & error tests

| ID  | Test              | Input                                         | Expected                                                                                    |
| --- | ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| B1  | Empty login       | Submit with empty fields                      | Submit disabled / inline validation; no request                                             |
| B2  | Weak new password | Change password to `abc`                      | Policy errors listed; save blocked                                                          |
| B3  | Wrong TOTP        | Enter a wrong 6-digit code at `/2fa`          | Error; stays on challenge                                                                   |
| B4  | Backup code reuse | Use one backup code to sign in, then reuse it | Second use rejected (single-use)                                                            |
| B5  | Invalid org name  | Wizard: enter reserved / illegal-char name    | `settings.organization.nameReserved` / `companyNameCharacterError`; **Next** stays disabled |

## Accessibility (WCAG 2.1 AA)

| ID  | Check           | Expected                                                                    |
| --- | --------------- | --------------------------------------------------------------------------- |
| A1  | Field labels    | Email/password inputs have associated `<label>`                             |
| A2  | Error announced | Wrong-credentials alert is `role="alert"`                                   |
| A3  | Keyboard        | Tab order email → password → submit; Enter submits                          |
| A4  | 2FA input       | Code input has an accessible name; backup codes copyable by keyboard        |
| A5  | Dialog focus    | Logout/add-member dialog traps focus and returns it to the trigger on close |

## Performance

| ID  | Metric            | Target                      |
| --- | ----------------- | --------------------------- |
| P1  | Login → dashboard | First dashboard paint < 3 s |
| P2  | 2FA verify        | Challenge → dashboard < 2 s |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Auth & account
Functional: ___/14   Boundary: ___/5   A11y: ___/5   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
