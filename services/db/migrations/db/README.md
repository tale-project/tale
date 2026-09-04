# Platform DB migrations (`db` service)

dbmate migration set for the **platform** role of the Postgres image (the `db`
service). Applied by `docker-entrypoint.sh` when `TALE_DB_ROLE=platform`.

**This directory is intentionally empty.** The 0.5 application database
(`tale_app`) is owned and migrated by the platform backend, which applies its
own numbered `.sql` migrations from `services/platform/backend/db/migrations/`
at boot — not by dbmate. Put a timestamped `*.sql` here only if the platform
Postgres ever needs a raw-SQL migration outside the backend's reach
(extensions, roles, grants beyond `init-scripts/`).

The knowledge-corpus migrations live in the sibling [`../knowledge-db/`](../knowledge-db/)
(applied when `TALE_DB_ROLE=knowledge`).

> This README is excluded from the image (`*.md` in `Dockerfile.dockerignore`),
> so the `db/` directory ships empty and the platform-role migration step is a
> no-op until a real migration lands here.
