# Login attempts — when wrong passwords lock an account

> **Prefix** `LOGIN-`

Repeated wrong passwords lock an account for a while. These rules say when the lock starts,
how long it lasts, whose policy applies, and what counts as a wrong password. What happens to
an address nobody has an account for, who is told about a lock, and limits per network address
are not covered; see Not yet.

## When an account is locked

Under the default policy, wrong passwords in a row lock the account like this:

| Wrong passwords in a row | The account is locked for |
| --- | --- |
| 1 to 4 | not locked |
| 5 | 1 second |
| 6 | 10 seconds |
| 7 | 1 minute |
| 8 or more | 10 minutes, each time |

### LOGIN-R1 · The fifth wrong password in a row locks the account, longer each time after

The table above is the default. An organization can set its own number of attempts and its
own waiting times; past the last waiting time on its list, every further wrong password locks
for that last time again.

- **Example**: Mia mistypes her password five times in a row → her account is locked for one
  second. A sixth mistake locks it for ten seconds.

### LOGIN-R2 · A member of several organizations gets the strictest of their policies

The strictest policy is the one that locks after the fewest wrong passwords. Between two that
lock after the same number, it is the one whose first lock lasts longer. An organization that
has switched its policy off is left out of the comparison.

- **Example**: Mia belongs to one organization that locks after 5 wrong passwords and one that
  locks after 3 → her account locks after 3.

## What counts as a wrong password

### LOGIN-R3 · An address is the same account however it is typed

Upper and lower case and spaces around the address make no difference: the count, the lock
and the reset after a correct password all belong to the one account.

- **Example**: Mia's account is locked. She tries again as ` MIA@Example.com ` → still locked,
  and no second count is opened for the other spelling.

### LOGIN-R4 · A wrong password typed while signed in counts like a failed sign-in

Tale asks for the password again before some account changes, such as turning two-factor
authentication off. A wrong password there adds to the same count as a failed sign-in, and the
audit log records where it was typed. A sign-in's own entries carry no such note.

- **Example**: Ada is signed in and mistypes her password while turning off two-factor
  authentication → her count of wrong passwords goes up by one, and the audit entry says it
  was typed there.

## Not yet

- **An address nobody has an account for**: a wrong password for it is not counted and not
  logged, so the answer does not reveal which addresses exist. No test holds it yet
  (`recordFailure` in `service.ts`).
- **Who is told**: the first time an account locks, the admins of its organizations are
  notified, and each attempt is written to the audit log of each organization. No test holds
  these yet.
- **Limits per network address**, and the hourly count of refused attempts (`recordBlocked`).
- **Undecided: can an organization switch the lock off?** A policy can be marked as off, and
  recording a wrong password has a branch that skips the lock for a policy that is off
  (`recordFailure` in `service.ts`). But choosing the policy answers the default policy, which
  is on, when every organization of the person has switched theirs off
  (`selectStrictestPolicy` in `core/login_attempts/helpers.ts`, held by its test "returns
  defaults if every input is disabled"), so that branch is never reached and the lock always
  applies. One of the two is the intended rule.
