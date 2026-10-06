# Two-factor authentication — when a second factor is required, and what meets it

> **Prefix** `TFA-` · **Docs** [`admin/two-factor-authentication`](../../../../../docs/en/platform/admin/two-factor-authentication.md)

An organization can require its members to protect their account with a second factor. These
rules say who is held to the requirement, what meets it, who is exempt, and how the grace
period works. Setting up an authenticator or a passkey, the lock after wrong codes, and the
audit entries are not covered; see Not yet.

## Who must have a second factor

### TFA-R1 · A person is held to the strictest policy among their organizations

When none of their organizations requires a second factor, nothing is asked. When one does,
its requirement applies to the account, and of two policies the stricter one counts.

- **Example**: Mia belongs to one organization that requires a second factor and one that does
  not → her account must have one.

### TFA-R2 · An authenticator app or a passkey meets the requirement

Either is enough. A passkey meets it for someone who never set up an authenticator.

- **Example**: Mia has registered a passkey and no authenticator. Her organization requires a
  second factor → she signs in as usual.

### TFA-R3 · An account that signs in only through SSO is exempt when the policy says so

The exemption ends as soon as the account also has a password of its own. A policy that does
not exempt SSO accounts holds them like everyone else.

- **Example**: Noah signs in through the identity provider only, and the policy exempts SSO
  accounts → nothing is asked of him. He sets a Tale password → the requirement applies.

## The grace period

### TFA-R4 · The grace period starts at a person's first sign-in and is never restarted

Someone without a second factor gets the policy's number of days, counted from their first
sign-in under the requirement. Later sign-ins do not start it again, and neither does a policy
that is made more generous afterwards. A policy that is made shorter applies at once.

- **Example**: The policy gives 7 days. Mia first signs in on Monday → she has until the next
  Monday. An admin then cuts the period to 2 days → she has until Wednesday.

### TFA-R5 · After the grace period, the account is blocked until it has a second factor

A policy with a grace period of zero days blocks at the first sign-in.

- **Example**: Mia's grace period ended yesterday and she has set up nothing → her sign-in is
  blocked until she sets up an authenticator or a passkey.

## Not yet

- **The lock after wrong codes**: wrong authenticator or recovery codes lock the second factor
  on the same schedule as wrong passwords. No test holds it yet (`recordTwoFactorFailure` in
  `service.ts`).
- **The audit entries** for setting up, removing and failing a second factor.
- **Setting up an authenticator, recovery codes and passkeys**: handled by the sign-in library.
- **An admin resetting a member's second factor**: see the members spec.
