# produce-video

The production discipline for docs tutorial videos — storyboard-first episodes, the ElevenLabs TTS stage, the planned-timeline recorder, and the watch-it QA gate. The runnable pipeline lives in `services/platform/tests/docs-videos/`.

A plain (docs-only) skill — its guidance lives entirely in [`SKILL.md`](SKILL.md);
there is no bundled code. See `AGENTS.md` (the skills section) for how this skill's
home ships and where to register it (a repo-dev guide also needs `bun run skills:sync`).
