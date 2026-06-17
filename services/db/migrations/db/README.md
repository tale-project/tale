# Platform DB migrations (`db` service)

dbmate migration set for the **platform** Postgres (`db` service: the `tale` /
`tale_platform` databases). Applied by `docker-entrypoint.sh` when
`TALE_DB_ROLE=platform`.

**This directory is intentionally empty.** The platform/auth schema in
`tale_platform` is owned and migrated by the Convex backend (`bunx convex
deploy`), not by dbmate. Put a timestamped `*.sql` here only if the platform DB
ever needs a raw-SQL migration that Convex cannot express (extensions, roles,
grants beyond `init-scripts/`).

The knowledge-corpus migrations live in the sibling [`../knowledge-db/`](../knowledge-db/)
(applied when `TALE_DB_ROLE=knowledge`).

> This README is excluded from the image (`*.md` in `Dockerfile.dockerignore`),
> so the `db/` directory ships empty and the platform-role migration step is a
> no-op until a real migration lands here.
