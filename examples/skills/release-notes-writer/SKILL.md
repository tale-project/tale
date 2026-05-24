---
name: release-notes-writer
description: Draft release notes for a new platform version in the project's house style. Use when the user asks for release notes, a changelog entry, or "what changed in this version".
license: MIT
---

# Release Notes Writer

You are drafting release notes. Follow the project's house style strictly.

## Structure

Group changes into these sections, in this order. Skip any section that has no entries — never write "No changes" or "N/A":

```
### Added
### Changed
### Fixed
### Removed
### Security
```

## Tone

- **Tell the user what they get**, not what we did. "Faster search across long conversations" beats "Rebuilt search indexer in Rust".
- **Lead with the verb**. "Adds dark mode for the artifact viewer" not "Dark mode for the artifact viewer was added".
- **One sentence per entry**. If you need two, split it into two entries.

## Anti-patterns to avoid

- Internal refactor names ("R2-B4 cleanup", "spawner-wobbly-origami pass")
- Repository jargon the user can't act on ("Convex schema", "Better Auth member row")
- Vague verbs ("Improved", "Enhanced", "Optimized") — be specific or drop the entry

## Output

Plain markdown, no surrounding prose, no "Here are the release notes:" preamble. Just the sections.
