## Summary

<!-- 1–3 sentences: what changed and why. Link issues / discussions. -->

## Checklist

Tick each box or mark **N/A** with a short reason. Empty boxes block review.

- [ ] `bun run check` passes (format, lint, typecheck, all tests).
- [ ] `bun run lint:sast` passes (Opengrep) — or N/A.
- [ ] Translations updated in `services/platform/messages/{en,de,fr}.json` — or N/A.
- [ ] Docs updated in `docs/{en,de,fr}/` for any user-visible change — or N/A.
- [ ] `README.md` / `README.de.md` / `README.fr.md` updated — or N/A.

<details>
<summary><strong>Does this need docs & translations?</strong> (decision tree)</summary>

Walk top-down; first **yes** wins. If unsure, default to **yes**.

- Added/renamed/removed a key in `services/platform/messages/`? → **Yes.**
- Added/changed/removed something a user can click, see, or read? → **Yes.**
- Changed an env var, CLI flag, config key, API field, or its default? → **Yes.**
- Changed error wording, validation, or rate limits a user can hit? → **Yes.**
- Pure refactor, internal type, test, or build script? → **No** (note it in the commit body).

</details>

## Test plan

<!-- How a reviewer can verify this works. -->

-
