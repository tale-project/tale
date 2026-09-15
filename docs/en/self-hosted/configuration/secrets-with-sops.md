---
title: Protect configuration secrets with SOPS
description: Distinguish file and database encryption, configure age keys, and rotate file-encryption keys without losing access.
---
Tale uses SOPS and age for supported configuration secret sidecars, including knowledge-database and object-storage connection files. Current AI-provider credentials are stored separately in the application database and use `ENCRYPTION_SECRET_HEX`. Rotating an age key does not rotate those database credentials.

## Identify the secret you are changing

Use the storage mechanism to choose the correct key:

| Secret storage | Encryption control | Operational consequence |
| --- | --- | --- |
| SOPS-enabled `*.secrets.json` configuration sidecar | `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` | Preserve a key that can decrypt every retained file and backup. |
| Database provider credentials and other secret-box values | `ENCRYPTION_SECRET_HEX` | Replacing the key makes existing ciphertext unreadable; age rotation does not migrate it. |
| Provider credential backed by an environment variable | `TALE_PROVIDER_KEY_*` | Rotate through the deployment’s secret manager and restart the consumers. |

A retired `providers/<name>.secrets.json` file may still exist in old configuration trees. Its presence does not mean that current provider credentials use that file. See [Providers](/self-hosted/configuration/providers) for the current credential model.

## Choose an age-key source

An inline `SOPS_AGE_KEY` takes precedence over `SOPS_AGE_KEY_FILE`. Use one source deliberately. The file form accepts one private age key per line and ignores blank lines and `#` comments; all configured recipients are included when Tale writes new SOPS ciphertext.

The file path is resolved inside the process that reads it. A host path in `.env` is insufficient by itself: mount the key file into each container that needs it, set the in-container path and restrict filesystem access. Recreate the consuming containers after changing their environment; `docker compose restart` does not load changed environment definitions.

If both variables are unset, the SOPS helper writes supported sidecars as plaintext JSON with mode `0600`. It still recognizes existing encrypted files and refuses to read them without a key. Unsetting the variables does not decrypt existing files.

## Prepare a rotation

Inventory the SOPS-encrypted files and their backups before replacing a key. Keep a protected copy of the old key and verify that you can decrypt a representative file without printing its contents or sending them to logs.

Create a new age key through your existing secret-management tooling. Build a protected key file containing **both the existing private key and the new private key**. Do not overwrite the old key file with a command that generates only the new key.

Update the deployment to mount that file and use `SOPS_AGE_KEY_FILE`. Remove the inline value from the consuming environment, or it will continue to take precedence. Roll out the environment change and confirm that existing connections still work.

## Re-encrypt and verify

Rewrite each affected sidecar through its supported configuration save path or an operator-controlled SOPS re-encryption procedure. Tale addresses newly encrypted files to all currently configured recipients; merely adding a key leaves existing ciphertext unchanged.

<Warning>

Do not remove the old key until every active encrypted file has been checked with the new key alone. Keep the old key protected for historical backups that still require it.

</Warning>

After that verification, deploy a key file containing only the new key. Restart the consuming processes to clear decrypted caches, then test each affected connection. A successful process restart alone does not prove that every file can be decrypted.

## Recover a decryption failure

| Symptom | Check |
| --- | --- |
| Encrypted file found without a key | Restore the matching key source; disabling encryption does not convert the file. |
| Key-file read fails | Check the mount, in-container path, ownership and permissions. |
| Old key is still selected | Remove the non-empty inline `SOPS_AGE_KEY` before relying on the file. |
| New key cannot decrypt one file | Keep the old key and re-encrypt that file before completing the rotation. |
| Provider credential fails after changing `ENCRYPTION_SECRET_HEX` | Follow the database-secret recovery path; changing age keys cannot repair it. |

For secrets managed by Vault, Kubernetes or another external store, prefer a provider’s [environment-variable key source](/self-hosted/configuration/providers#environment-variable-key-source) where supported. Keep encryption keys with your recovery plan, separately protected from the data backups they unlock.
