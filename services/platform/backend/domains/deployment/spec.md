# Deployment — who can read and change the deployment's settings

> **Prefix** `DEPLOY-`

The deployment settings are one file for the whole installation, not one per organization.
Today they hold how sandboxes are run. These rules say who can read and change them, and what
the platform does with a settings file it cannot read in full. Saving at the same time as
someone else is not covered; see Not yet.

## Who can do what

| | Read the settings | Change the settings |
| --- | --- | --- |
| An owner or admin of any organization, on the editor list | yes | yes |
| An owner or admin of any organization, not on the list | yes | no |
| Anyone else | no | no |

The editor list is the set of sign-in emails the operator names on the host
(`TALE_DEPLOYMENT_CONFIG_ADMINS`).

### DEPLOY-R1 · An owner or admin of any organization can read the deployment settings

Reading does not need a place on the editor list. Someone who is an owner or admin of no
organization is refused (`FORBIDDEN_INSTANCE_ADMIN`), for reading and for changing.

- **Example**: Mia is a member of her organization and not an admin. She opens the deployment
  settings → refused.

### DEPLOY-R2 · Only an owner or admin on the editor list can change the settings

Their sign-in email is compared with the list without regard to upper and lower case. An
owner or admin who is not on the list is refused (`FORBIDDEN_DEPLOYMENT_EDITOR`).

- **Example**: Ada is an owner. The editor list names a colleague and not her. She saves a
  change → refused.

### DEPLOY-R3 · With no editor list, nobody can change the settings

An operator who has named no editors has locked the settings for everyone, owners included.

- **Example**: The host sets no editor list. Ada, an owner, saves a change → refused.

## The settings file

### DEPLOY-R4 · A settings file with an unknown key or version is refused, never half-read

The same holds for a file that cannot be parsed. One section retired from older versions is
the exception: it is ignored with a warning, and the next save writes the file without it.

- **Example**: Someone adds a key the platform does not know to the settings file → reading
  the file fails, and none of its settings are applied.

## Not yet

- **Two people saving at once**: a save made against an older copy of the file is refused
  (`DEPLOYMENT_VERSION_CONFLICT`). No test holds it yet (`saveDeploymentConfig` in
  `service.ts`).
- **The audit entry** each save writes. No test holds it yet.
- **What the settings mean** for how sandboxes run: decided by the sandbox domain.
