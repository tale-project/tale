---
title: Secrets with SOPS
description: How Tale encrypts provider keys on disk with SOPS and age, the three storage modes, and the full key rotation walk.
---

Tale stores provider API keys in `providers/*.secrets.json` files on disk. The default mode after `tale init` encrypts these files with SOPS using an age key; an alternative mode reads multiple keys from a file (the rotation path); a third mode keeps the files in plaintext at file mode 0600 for environments where the disk is encrypted at rest and rotation is handled externally. This page is the operator's walkthrough of the three modes and the safe rotation path.

The env vars that drive the modes are `SOPS_AGE_KEY` and `SOPS_AGE_KEY_FILE` — their reference rows live in [Environment reference](/self-hosted/configuration/environment-reference#provider-secrets-encryption). This page is the longer story.

## The three modes

| Mode              | Env vars                           | When to use                                                   |
| ----------------- | ---------------------------------- | ------------------------------------------------------------- |
| Inline age key    | `SOPS_AGE_KEY=AGE-SECRET-KEY-1...` | Default after `tale init`. Single host, single key.           |
| Key file          | `SOPS_AGE_KEY_FILE=/path/to/keys`  | Required for rotation. One age key per line, `#` comments.    |
| Plaintext at 0600 | Both unset                         | Disk encrypted at rest, or external tooling writes the files. |

The backend containers pick the mode at boot — they own every write to the config store and are the only processes that decrypt it; the web tier mounts the same volume read-only and never touches the age key. The inline form is the simplest; the file form is the only one that supports multiple readers (which is what makes rotation possible without downtime); the plaintext form skips SOPS entirely and trusts the filesystem.

## First-boot encrypted mode

`tale init` generates an age keypair and writes the private half into `SOPS_AGE_KEY` in your `.env`. Provider secret files written through **Settings > Providers** are encrypted on save:

```bash
# Inspect — the file is SOPS-encrypted JSON, not the cleartext API key
cat providers/openai.secrets.json
# {
#   "apiKey": "ENC[AES256_GCM,data:...,iv:...,tag:...]",
#   "sops": { ... }
# }
```

Decryption happens in-process when a backend container reads the file. The age key never leaves that container's memory.

## Rotating the age key

Rotation is the one path the inline form does not cover — only `SOPS_AGE_KEY_FILE` lets you accept ciphertext readable by both the old and the new key during the cutover. The walk:

```bash
# 1. Generate a new age key
age-keygen -o /etc/tale/age-keys.txt

# 2. Append the new key as a second line in the file
echo "AGE-SECRET-KEY-1NEW..." >> /etc/tale/age-keys.txt

# 3. Point .env at the file and restart the backend containers
sed -i 's|^SOPS_AGE_KEY=.*|# SOPS_AGE_KEY=|' .env
sed -i 's|^# SOPS_AGE_KEY_FILE=.*|SOPS_AGE_KEY_FILE=/etc/tale/age-keys.txt|' .env
docker compose restart backend-api backend-worker
```

Now both old and new keys can decrypt existing files. Re-save each provider's API key under **Settings > Providers** — each save produces ciphertext readable by both keys. Once every provider has been re-saved (the **Last rotated** column in the providers table tells you which still hold old ciphertext), remove the old key from the file:

```bash
# 4. Drop the old key line and restart again
sed -i '/^AGE-SECRET-KEY-1OLD/d' /etc/tale/age-keys.txt
docker compose restart backend-api backend-worker
```

The order is load-bearing: never remove the old key before every file is re-encrypted, or the backend will fail to read the still-old files at the next decryption.

## Switching to plaintext

When the host disk is encrypted at rest (LUKS, AWS EBS encryption, GCP CSEK) and you do not want a second layer of key management, the plaintext mode is the supported option. Comment out both `SOPS_AGE_KEY` and `SOPS_AGE_KEY_FILE`, restart, and re-save each provider — the files are now JSON at mode 0600.

The risk model shifts: a leaked filesystem dump is now a leaked credential dump. Pick this mode only when the disk encryption is real (not a tickbox), and audit the host's backup story to confirm no plaintext snapshot escapes.

## External secret stores

When your keys already live in Vault, a cloud secret manager, or Kubernetes Secrets, the first-class pattern is the env-var key source: point each provider at an **environment variable** with `secretsEnv` and let your secret store populate that variable. No cleartext file touches the disk, and the reserved-prefix gate keeps a config-write actor from reading an unrelated deployment secret. The full mechanism — the `TALE_PROVIDER_KEY_` prefix gate, resolution order, and the restart-on-change behaviour — lives in [Providers](/self-hosted/configuration/providers#environment-variable-key-source).

The file-mount approach is the legacy alternative: write the cleartext `*.secrets.json` files from the external store and run Tale in plaintext mode. It still works, but it puts the cleartext key on disk and breaks if you save a provider through the UI — the UI overwrites the mount. Prefer the env-var source unless a constraint forces the file form.

## Where this fits

This page is the operator's full guide to the SOPS layer; the env-var reference rows are in [Environment reference](/self-hosted/configuration/environment-reference#provider-secrets-encryption), and the provider file format itself in [Providers](/self-hosted/configuration/providers). If a key is leaked, rotation is the same walk above run urgently.
