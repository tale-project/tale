# Platform-role dbmate directory

The application database is migrated by the platform backend from
[`services/platform/backend/db/migrations/`](../../../platform/backend/db/migrations/).
Add application tables, indexes and data migrations there using the
[create-migration skill](../../../../.agents/skills/create-migration/SKILL.md).

This dbmate directory is intentionally empty. `TALE_DB_ROLE=platform` selects it,
and the image excludes Markdown files, so this step currently applies no SQL.
Database/role/extension bootstrap belongs to the image's idempotent infrastructure
scripts; do not create a competing application migration stream here.

Knowledge-corpus migrations live in [`../knowledge-db/`](../knowledge-db/) and
run for `TALE_DB_ROLE=knowledge`. See the [database README](../../README.md) for
role selection, readiness and migration ownership.
