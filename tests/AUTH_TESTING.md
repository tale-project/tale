# Authentication Testing Guide (AI-Directed)

> **Purpose**: Exercise the authentication module — sign-in, the admin-driven account model, password policy, forced password change, 2FA, and lockout — and collect every defect in the Issues Found table. Tale is offline-first: there is **no self-service sign-up** after the first owner, so most account creation happens in Settings → Members.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) (steps 1–5) and confirm `http://localhost:3000` is reachable. Then sign in as the seeded admin:

- Email: `admin@admin.test`
- Password: `Admin@123`

> **AI Instructions**: Run each test in order. For every row, record the actual result; if it differs from **Expected**, add a row to **Issues Found** with a screenshot. Ignore console warnings; treat 4xx/5xx and uncaught errors as failures.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/auth
```

Naming: `auth_{test_id}.png` (e.g. `auth_F1.png`).

## Functional tests

| ID  | Test                         | Steps                                                    | Expected                                                                             |
| --- | ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| F1  | Login page renders           | Open `/`                                                 | Email + password fields, sign-in button, "Forgot password?" link; no console error   |
| F2  | Valid login                  | Enter seeded admin credentials, submit                   | Redirects to `/dashboard/{id}/chat`; session cookie set                              |
| F3  | Wrong password               | Enter valid email, wrong password                        | Inline error; stays on `/`; no redirect                                              |
| F4  | Unknown email                | Enter `nobody@nowhere.test` + any password               | Generic failure (no account enumeration — same message as wrong password)            |
| F5  | Forgot-password link         | Click "Forgot password?"                                 | Toast "Contact your administrator — password reset is managed by your organization"  |
| F6  | No self-service sign-up      | With ≥1 user existing, open `/sign-up`                   | Redirects to `/` (sign-up only for initial owner)                                    |
| F7  | Admin creates a member       | Settings → Members → Add member; email + password + role | Member created; credentials panel shown; admin stays signed in                       |
| F8  | New member forced change     | Sign in as the member from F7                            | Redirected to forced-change-password screen; cannot proceed until a new password set |
| F9  | Sign out                     | User menu → Sign out → confirm                           | Hard redirect to `/`; protected routes now bounce to login                           |
| F10 | Change own password re-auths | Settings → Account → Change password; submit valid       | Signed out + redirected to login; new password works, old does not (#1255)           |

## Boundary & error tests

| ID  | Test                            | Input                                          | Expected                                                                                                                   |
| --- | ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| B1  | Empty password on add-member    | Add member, valid email, blank password        | Field-level error on the password field, not a generic toast (#1470)                                                       |
| B2  | Password policy — too short     | Set a password below the org minimum length    | Rejected with the policy hint; live validation list updates as you type                                                    |
| B3  | Password policy — missing class | Omit a required upper/lower/digit/special char | Rejected, naming the missing requirement                                                                                   |
| B4  | Duplicate member email          | Add member with an existing email              | "already a member" / existing-user path, no duplicate created                                                              |
| B5  | Login lockout                   | Enter wrong password repeatedly (5–10×)        | Account locks; further attempts rejected even with the right password; timing stays roughly constant (no fast/slow oracle) |
| B6  | Session persists across reload  | Log in, hard-refresh                           | Still authenticated; no re-login                                                                                           |

## 2FA tests

| ID  | Test            | Steps                                                    | Expected                                          |
| --- | --------------- | -------------------------------------------------------- | ------------------------------------------------- |
| T1  | Enroll TOTP     | Settings → Account → enable two-factor; scan, enter code | 2FA enabled; backup codes shown once              |
| T2  | Login with 2FA  | Sign out, sign in                                        | Prompted for a TOTP code after password           |
| T3  | Wrong TOTP code | Enter an invalid 6-digit code                            | Rejected; repeated failures contribute to lockout |

## Passkey tests (WebAuthn, #1508)

> These rows need an authenticator: real hardware (Touch ID, Windows Hello, a security key, or a phone) or the Chrome DevTools **WebAuthn** panel / Playwright CDP virtual authenticator. Virtual passes are fine for regression runs, but at least one full pass (P1–P8) must be recorded on a **real** authenticator before the feature is considered device-QA'd — that pass is the SOC 2 manual-procedure evidence for epic #1803.

| ID  | Test                          | Steps                                                                                                                                    | Expected                                                                                                                                        |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Register passkey (platform)   | Settings → Account → Passkeys → **Add a passkey**; name it, pick **This device (Face ID, Touch ID, Windows Hello)**, complete the prompt | Passkey appears in the list under its name; `passkey_added` row in Settings → Logs → Audit                                                      |
| P2  | Register passkey (roaming)    | **Add a passkey**; pick **Security key or phone**, complete with a security key or phone                                                 | Second passkey listed; `passkey_added` audit row                                                                                                |
| P3  | Passkey login                 | Sign out → **Sign in with a passkey** on the login page                                                                                  | Signed in without typing the password; `passkey_sign_in` audit row                                                                              |
| P4  | Passkey at the 2FA wall       | On a TOTP-enrolled account, sign in with email + password → on the verification screen click **Use a passkey instead**                   | WebAuthn prompt replaces the code entry; lands on the dashboard without a TOTP code                                                             |
| P5  | Enrolment wall offers passkey | Enforce 2FA with zero grace for a member with no TOTP and no passkey; sign in as them → **Register a passkey instead** on /2fa-enroll    | Registration ceremony runs with the session intact; continues straight to the dashboard                                                         |
| P6  | Passkey-only satisfies policy | With a passkey registered and TOTP never enrolled, sign in with email + password under the enforced policy                               | No enrolment wall; lands on the dashboard                                                                                                       |
| P7  | Self-revoke                   | Settings → Account → Passkeys → **Remove**                                                                                               | Passkey gone from the list; `passkey_removed` audit row                                                                                         |
| P8  | Admin revoke ends sessions    | As an admin: Settings → Organization → **Edit member** → Passkeys section → **Remove** → confirm                                         | Credential deleted; every session of the member ends (their open tab bounces to login); `passkey_revoked_by_admin` audit row keyed on the admin |

## API / integration tests

| ID  | Test                    | Steps                                                  | Expected                                               |
| --- | ----------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| A1  | API key requires bearer | `curl /api/v1/agents` with no `Authorization` header   | `401`                                                  |
| A2  | API key valid           | `curl /api/v1/agents -H "Authorization: Bearer <key>"` | `200` with `{ "agents": [...] }`                       |
| A3  | Cross-org key rejected  | Use a key from org A against org B's resource          | `403`/`404` — keys can't act outside their issuing org |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check               | Expected                                                           |
| --- | ------------------- | ------------------------------------------------------------------ |
| X1  | Keyboard-only login | Tab to email → password → submit; Enter submits; no mouse needed   |
| X2  | Labels & focus      | Inputs have associated labels; focus ring visible on each control  |
| X3  | Error announced     | A failed login error is exposed to assistive tech (role/aria-live) |
| X4  | Contrast            | Body and button text ≥ 4.5:1 against their background              |

## Performance tests

| ID  | Metric                 | Target                                |
| --- | ---------------------- | ------------------------------------- |
| P1  | Login page first paint | Interactive < 2 s on a warm container |
| P2  | Login round-trip       | Submit → dashboard < 2 s              |

## Issues Found

| #   | Test ID | Page / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ---------- | ---------------------------- | ----------- | ---------- |
|     |         |            |                              |             |            |

## Test summary

```
Module: Authentication
Functional: ___/10   Boundary: ___/6   2FA: ___/3   Passkeys: ___/8   API: ___/3   A11y: ___/4   Perf: ___/2
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
