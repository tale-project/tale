# Auth & account

> **Prefix** `AUTH-` · **Reset** none · **Cost** 32 boxes

Exercise sign-in, the account/security model (password policy, 2FA, passkeys,
backup codes), the first-run and create-org wizards, the post-grace 2FA
enrollment wall, and role-based access. Auth is the dependency for every other
guide — run it first. Tale is offline-first: there is **no self-service
sign-up UI** and no forgot-password flow; F5/F6 mint accounts via the Better
Auth `/api/auth/sign-up/email` endpoint (agent-only loophole).

## Scope & routes

| Surface                | Route                                    | Backing file                                         |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Login                  | `/log-in`                                | `app/routes/_auth/log-in.tsx`                        |
| 2FA challenge          | `/2fa`                                   | `app/routes/_auth/2fa.tsx`                           |
| 2FA enrollment wall    | `/2fa-enroll`                            | `app/routes/2fa-enroll.tsx`                          |
| First-run setup        | `/setup`                                 | `app/routes/setup.tsx`                               |
| Create-org wizard      | `/dashboard/create-organization`         | `app/routes/dashboard/create-organization.tsx`       |
| Forced password change | `/forced-change-password/{id}`           | `app/routes/forced-change-password.$id.tsx`          |
| Account & security     | `/dashboard/{org}/settings/account`      | `app/routes/dashboard/$id/settings/account.tsx`      |
| Members & roles        | `/dashboard/{org}/settings/organization` | `app/routes/dashboard/$id/settings/organization.tsx` |

> The members/roles UI was split out of the old `…/settings/people` page; it
> now lives on the **Organization** route (`members-settings.tsx`). `_auth` is
> a pathless layout that **rejects authenticated users** — it does not appear
> in the URL. `/2fa-enroll`, `/setup`, and `/forced-change-password/{id}` live
> at the root (not under `_auth`) because they require an **active** session.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). AUTH-F5/AUTH-F6
require a **fresh** account — POST `/api/auth/sign-up/email` directly (see
SETUP.md §2). 2FA tests (AUTH-F8, AUTH-F9, AUTH-B3, AUTH-B4) need a TOTP
generator — the e2e suite uses a dependency-free RFC-6238 implementation
([`tests/e2e/helpers/totp.ts`](../../e2e/helpers/totp.ts)); reuse it to
compute codes from the enrollment secret.

> **Agent note**: a freshly minted user with no org lands on
> `/dashboard/create-organization`; a user who already has an org is
> redirected straight to `/dashboard/{org}/chat`. `/log-in`, `/2fa`, and
> `/setup` redirect an already-authenticated user to `/dashboard/{org}/chat`
> (the `_auth` guard + first-run gate). Password policy = length + lower +
> upper + digit + special (e.g. `TaleE2E!Passw0rd`). The SSO button (AUTH-F12)
> is hidden unless an IdP is configured (`useIsSsoConfigured()`), so its
> absence is expected, not a bug. **SSO error surfacing
> (AUTH-F15/AUTH-F16/AUTH-B7) needs no live IdP**: a failed SSO sign-in is
> bounced back to `/log-in?error=<key>&error_code=AADSTS…&recovery=<key>` by
> `redirectWithError`, so you drive it by opening that URL directly while
> signed out. `error`/`recovery` carry key SUFFIXES resolved under the `auth`
> namespace (rendered via `auth.sso.errors.*`); a value with no matching key
> degrades to rendering the string verbatim.

## Functional tests

- [ ] `AUTH-F1` · **Login renders** — Open `/log-in` while signed out → URL
  stays `/log-in`. Visible: **Email** (`auth.email`), **Password**
  (`auth.password`), **Log in** (`auth.login.loginButton`), **Sign in with a
  passkey** (`auth.login.continueWithPasskey`)
- [ ] `AUTH-F2` · **Wrong password** — Fill a valid-looking email + wrong
  password → **Log in** → A `role="alert"` shows **Wrong email or password**
  (`auth.login.wrongCredentials`); URL stays `/log-in`
- [ ] `AUTH-F3` · **Valid login** — Submit correct credentials → **Log in** →
  URL becomes `/dashboard/{org}/chat`; **Signed in successfully** toast
  (`auth.login.toast.success`)
- [ ] `AUTH-F4` · **Logout** — User menu → **Log out**
  (`auth.userButton.logOut`) → confirm dialog **Log out**
  (`auth.userButton.logOutConfirm.confirm`) → URL returns to `/log-in`
- [ ] `AUTH-F5` · **First-run setup** — On a **fresh DB** open `/setup`;
  complete owner → workspace → finish → Owner created; lands on
  `/dashboard/{org}/chat`. Unreachable once any user exists (redirects to
  dashboard) — manual-only, needs an empty DB.
- [ ] `AUTH-F6` · **Create-org wizard** — Fresh user →
  `/dashboard/create-organization`; fill **Organization name**
  (`settings.organization.organizationName`) → **Next**
  (`common.actions.next`) → **Go to dashboard**
  (`onboarding.finish.goToDashboard`) → URL becomes `/dashboard/{org}` (a 16+
  char id); the new org's chat loads.
- [ ] `AUTH-F7` · **Change password** — `/dashboard/{org}/settings/account` →
  **Change password** (`auth.changePassword.title`); fill **Current password**
  (`auth.changePassword.currentPassword`), **New password**
  (`auth.changePassword.newPassword`), **Confirm new password**
  (`auth.changePassword.confirmPassword`) → submit → Success toast; **log out
  and re-login with the new password succeeds** (the old password is rejected
  with `auth.login.wrongCredentials`)
- [ ] `AUTH-F8` · **Enroll 2FA** — Account → **Enable two-factor**
  (`twoFactor.enrollment.enableButton`); confirm **Password**
  (`twoFactor.confirmPassword.label`); read secret under **Can't scan?…**
  (`twoFactor.setup.manualEntry`); enter **Verification code**
  (`twoFactor.setup.verifyCodeLabel`) → **Verify and enable**
  (`twoFactor.setup.verifyButton`) → **Two-factor authentication enabled**
  toast (`twoFactor.enrollment.enabled`); **Save your backup codes**
  (`twoFactor.backupCodes.title`) view shows codes. Reload Account → 2FA shows
  as enabled.
- [ ] `AUTH-F9` · **2FA login** — Log out, then log in with password again →
  URL becomes `/2fa`; correct TOTP → **Verify**
  (`twoFactor.verify.submitButton`) → URL `/dashboard/{org}/chat`
- [ ] `AUTH-F10` · **Passkey register** — Account → **Add a passkey**
  (Passkeys section) → Platform-authenticator (WebAuthn) prompt; on success
  the passkey is listed. Manual-only — needs a real authenticator.
- [ ] `AUTH-F11` · **Forced change** — With a mid-session password-expiry
  policy active, trigger expiry → Redirects to `/forced-change-password/{id}`;
  the app is blocked until the password is changed. Manual-only — needs a
  mid-session policy.
- [ ] `AUTH-F12` · **SSO** — With an IdP configured, click **Continue with
  SSO** (`auth.login.continueWithSso`) on `/log-in` → OAuth round-trip →
  `/dashboard/{org}`. Manual-only — button is hidden unless
  `useIsSsoConfigured()` returns true.
- [ ] `AUTH-F13` · **Idle sign-out** — Open `/log-in?reason=idle` (the idle
  watchdog appends `?reason=idle`) → A `role="status"` notice reads **You were
  signed out because your session was inactive for too long.**
  (`common.sessionIdle.signedOutNotice`)
- [ ] `AUTH-F14` · **RBAC add member** — Owner:
  `/dashboard/{org}/settings/organization` → **Add member**
  (`settings.organization.addMember`) opens the **Add member** dialog
  (`dialogs.addMember.title`); fill name/email/role=**Member**
  (`settings.roles.member`)/password → submit → **New member created and added
  to organization** toast (`toast.success.newMemberCreated`); signing in as
  that member, the **Add member** button is NOT visible (admin-gated)
- [ ] `AUTH-F15` · **SSO error surfaced** — Signed out, open
  `/log-in?error=sso.errors.userNotAssigned&error_code=AADSTS50105&recovery=sso.errors.recovery.contactAdmin`
  → A `role="alert"` (`aria-live="assertive"`) block shows **"Your account is
  not assigned to this application. Contact your administrator to request
  access."** (`auth.sso.errors.userNotAssigned`) and the recovery hint
  **"Contact your administrator for access."**
  (`auth.sso.errors.recovery.contactAdmin`). URL stays `/log-in`; no live IdP
  needed.
- [ ] `AUTH-F16` · **SSO conditional-access / MFA** — Signed out, open
  `/log-in?error=sso.errors.mfaRequired&error_code=AADSTS50076&recovery=sso.errors.recovery.completeMfa`
  → The dedicated conditional-access UI (`ConditionalAccessError`) renders a
  `role="alert"` with the mapped message + recovery, a **Complete multi-factor
  sign-in** button (`auth.sso.actions.completeMfa`) and a **Try again** button
  (`auth.sso.actions.tryAgain`). Clicking **Try again** strips the
  `error`/`error_code`/`recovery` params → URL returns to a clean `/log-in`
  and the alert clears. CA code set = AADSTS50076/50079/53003.
- [ ] `AUTH-F17` · **Org-switch interstitial** — With ≥2 orgs: user-button
  dropdown → pick the other organization → The switch stages through
  `/dashboard/switching?to={targetOrgId}` showing a centered spinner labelled
  **Switching organization…** (`settings.organization.switchingLabel` /
  `settings.organization.switchingTo`), then lands on the target org's
  dashboard — the URL's org id changes and the org name in the user button
  matches the target. No flash of the old org's content after landing.

## Boundary & error tests

- [ ] `AUTH-B1` · **Empty login** — `/log-in` with both fields empty → **Log
  in** button is **disabled**; no auth request is sent.
- [ ] `AUTH-B2` · **Weak new password** — AUTH-F7 change-password dialog: new
  password `abc` → Policy errors listed (length/upper/digit/special); the
  submit is blocked.
- [ ] `AUTH-B3` · **Wrong TOTP** — At `/2fa`, enter a wrong 6-digit code →
  **Verify** → Invalid-code error (`twoFactor.errors.invalidCode`); URL stays
  `/2fa`. Manual-only — needs a 2FA-enabled account.
- [ ] `AUTH-B4` · **Backup-code reuse** — Sign in once with a backup code,
  then attempt to reuse the same code → Second use rejected (single-use).
  Manual-only — needs enrolled backup codes.
- [ ] `AUTH-B5` · **Illegal org name** — `/dashboard/create-organization` →
  **Organization name** = `@@@bad@@@` → Inline error **Use letters, digits,
  spaces, hyphens, and underscores only…**
  (`settings.organization.companyNameCharacterError`); **Next** stays
  **disabled** (client-side)
- [ ] `AUTH-B6` · **Reserved org name** — Create-org wizard → **Organization
  name** = `default` → Blocked **client-side**: inline **This name is reserved
  by the platform.** and **Next** stays **disabled** (the server-side
  `settings.organization.nameReserved` guard backs it as defense-in-depth);
  org is NOT created. `default` is the only reserved slug.
- [ ] `AUTH-B7` · **Unmapped SSO code** — Signed out, open
  `/log-in?error=Some+plain+reason&error_code=AADSTS999999` → A standard
  `role="alert"` renders the `error` value **verbatim** (a missing i18n key
  degrades to the string itself); the dedicated conditional-access UI is
  **not** shown (AADSTS999999 ∉ the CA set), so there is no **Complete
  multi-factor sign-in** button.

## Accessibility (WCAG 2.1 AA)

- [ ] `AUTH-A1` · **Field labels** → The Email and Password inputs each have
  an associated `<label>` (queryable by `getByLabel`)
- [ ] `AUTH-A2` · **Error announced** → The wrong-credentials notice is
  `role="alert"`; the idle notice is `role="status"`
- [ ] `AUTH-A3` · **Keyboard** → Tab order Email → Password → **Log in**;
  Enter in the form submits.
- [ ] `AUTH-A4` · **2FA input** → The verification-code input has an
  accessible name (`twoFactor.setup.verifyCodeLabel`); backup codes are
  `select-all` and copyable by keyboard.
- [ ] `AUTH-A5` · **Dialog focus** → The logout / add-member / change-password
  dialog traps focus and returns it to the trigger on close.

## Performance

- [ ] `AUTH-P1` · **Valid login → chat** → `/log-in` submit → first
  `/dashboard/{org}/chat` paint < 3 s.
- [ ] `AUTH-P2` · **2FA verify → chat** → Correct TOTP at `/2fa` →
  `/dashboard/{org}/chat` paint < 2 s.
- [ ] `AUTH-P3` · **Account page load** → `/dashboard/{org}/settings/account`
  first paint < 2 s (warm worker)
