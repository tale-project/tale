## Summary

<!-- 1–3 sentences. What changed and why. Link issues / discussions. -->

## Pre-merge checklist

Tick each box or mark **N/A** with a short reason. Empty boxes are a blocker.

- [ ] Ran `bun run check` (format, lint, typecheck, all tests).
- [ ] Updated `services/platform/messages/{en,de,fr}.json` for any new/renamed/removed keys — or N/A.
- [ ] Updated `docs/`, `docs/de/`, and `docs/fr/` for every user-visible change — or N/A.
- [ ] Ran `bun run --filter @tale/docs lint` (broken links + oxlint) — or N/A.
- [ ] Updated `README.md`, `README.de.md`, `README.fr.md` if the change affects what they document — or N/A.

<details>
<summary><strong>Does this change need docs and translations?</strong> (decision tree)</summary>

Walk top-down. First **yes** wins.

- Did you add, rename, or remove a key in `services/platform/messages/`? → **Yes.**
- Did you add, change, or remove a UI element a user can click, see, or read? → **Yes.**
- Did you add, rename, remove, or change the default of an env var, CLI flag, config file key, or API field? → **Yes.**
- Did you change error wording, validation rules, or rate limits a user can hit? → **Yes.**
- Pure refactor, internal type, test, build script, or comment? → **No.** Note the scope in the commit body.

If unsure, default to **yes**. Reviewer time is cheaper than stale docs.

</details>

## Test plan

<!-- How a reviewer can verify this works. Bullet checklist. -->

-
