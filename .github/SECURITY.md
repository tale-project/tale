# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately
through GitHub: the repository's **Security** tab → **Report a vulnerability**.
If you cannot use GitHub, email `security@tale.dev`.

Include what you can — the affected component, reproduction steps, and impact.
Reporters are credited in the resulting advisory if they wish.

## Supported versions

Tale is a rolling-release 0.x project. Security fixes land in the latest release
only; there are no backports to earlier versions. Keep your deployment current
with `tale update` followed by `tale deploy`.

## What to expect

- Acknowledgement and triage within 72 hours.
- A fix or workaround shared privately with the reporter within 14 days.
- A GitHub Security Advisory published with the patched release.

The advisory format, severity scale, and full disclosure timeline are documented
in [Security advisories](https://tale.dev/docs/self-hosted/operate/security/advisories).
