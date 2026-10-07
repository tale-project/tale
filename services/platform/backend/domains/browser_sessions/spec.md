# Browser sessions — who can store a site's cookies, and what is kept of them

> **Prefix** `BSESS-`

A browser session is a set of cookies that an operator exports from a browser signed in to a
site, and imports so that video ingestion can reach that site. Sessions are kept per
organization and per site, and are managed through the REST API with an API key; the app has
no screen for them. These rules cover who can import and delete a session, what is kept of
its cookies, which sites it can name and how long it lasts. How ingestion picks and retires
sessions is not covered; see Not yet.

## Who can do what

| | List the sessions | Import or delete a session |
| --- | --- | --- |
| An owner or admin on the deployment's editor list | yes | yes |
| Any other member of the organization | yes | no |

The editor list is the set of sign-in emails the operator names on the host
(`TALE_DEPLOYMENT_CONFIG_ADMINS`).

### BSESS-R1 · Only an owner or admin on the editor list can import or delete a session

The person behind the API key must be an owner or admin (`FORBIDDEN_INSTANCE_ADMIN`
otherwise) and on the deployment's editor list (`FORBIDDEN_DEPLOYMENT_EDITOR` otherwise). The
check comes before the request is read, so someone who is refused learns nothing about what a
valid request looks like.

- **Example**: Ada is an admin, and the editor list names a colleague but not her. She imports
  a session → refused, and nothing is stored.

### BSESS-R2 · A session's cookies are stored encrypted and never shown

The cookies are encrypted before they are saved. The list returns each session's site, label,
status and dates, without the cookies.

- **Example**: Ada imports a cookie file for `youtube.com`, then lists the sessions → the list
  shows the session's site, status and expiry, and no cookie.

### BSESS-R3 · A session can be listed and deleted only within its own organization

Any member with an API key can list the sessions of their own organization, and only those.
An imported session belongs to the organization the key acts for. Deleting a session of
another organization is answered as not found (`BROWSER_SESSION_NOT_FOUND`), the same as a
session that does not exist.

- **Example**: Zoe is on the editor list. She deletes a session of Ada's organization by its
  ID → not found, and the session stays.

## What a session can name, and how long it lasts

An import names the site its cookies are for and, if it wants, how long they are kept.

### BSESS-R4 · A session is stored for one host name, never a local or wildcard one

A web address is reduced to its host name in lower case. `localhost`, a loopback address such
as `127.0.0.1`, a wildcard such as `*.example.com`, a file path and an `ftp://` address are
refused (`INVALID_SESSION`), and nothing is stored.

- **Example**: Ada imports a session for `HTTPS://Example.COM/path` → it is stored for
  `example.com`.
- **Example**: Ada imports a session for `localhost` → refused.

### BSESS-R5 · A session lasts 14 days unless the import says otherwise, at most 180

An import can name its own lifetime. One longer than 180 days is refused (`INVALID_BODY`),
and nothing is stored.

- **Example**: Ada imports a session without naming a lifetime → it expires 14 days later.
- **Example**: Ada imports a session with a lifetime of 181 days → refused.

## Not yet

- **How ingestion uses the sessions**: it takes the healthy session of the organization and
  site that was used least recently, sets a session aside after a blocked attempt, retires it
  at the third in a row, brings a set-aside one back after 30 quiet minutes, and removes a
  session a week after it expired (`claimBrowserSession`, `reportBrowserSessionResult` and
  `sweepBrowserSessions` in `service.ts`). Only the integration lane proves it, so no test
  title can name it.
- **Where the owner or admin role must be held**: the code accepts the role in any
  organization of the deployment, not only the one the session is stored for
  (`assertBrowserSessionImporter` in `service.ts`). No test tells the two apart.
- **Hosts on a private network**: the operator can admit them for the whole deployment
  (`TALE_ALLOW_PRIVATE_CRAWL_HOSTS`). No test holds that an import then accepts them.
- **The other limits of an import**: the size of the cookie file, the label and the browser
  details are refused field by field (`INVALID_BODY`). A test holds the refusal, not the
  numbers (`rest/v1-browser-sessions.ts`).
- **The list is not paged.** The contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
