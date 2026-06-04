---
title: Umgebungsvariablen-Referenz
description: Jede Umgebungsvariable, die Tale beim Boot liest, der Default und die Oberfläche im Produkt, die sie steuert. Die vollständige Operator-Referenz für `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale liest seine Konfiguration aus einer einzigen `.env`-Datei im Repo-Stammverzeichnis. Etwa ein Dutzend Variablen sind beim ersten Boot Pflicht; der Rest stimmt das Verhalten ab. Diese Seite listet jede Variable, die [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) mitbringt, was sie als Default hat und welche Oberfläche im Produkt sie konsumiert.

Gruppen sind danach geordnet, wann du sie zuerst brauchst: Domain-Identität, TLS, Secrets, Datenbank, Instanz, Observability, Provider-Verschlüsselung. Ändert sich der Wert einer Variable, starte den Plattform-Container neu (`docker compose restart tale-platform tale-convex`), damit sie wirkt.

## Wie du diese Seite liest

Jede Gruppe ist eine `Name | Default | Beschreibung`-Tabelle. Variablen, die als **Pflicht** markiert sind, müssen gesetzt sein, damit `docker compose up` erfolgreich ist. **Optionale** Variablen können unset bleiben; die Beschreibung benennt, was das Deaktivieren des Features bedeutet.

Die `.env.example`-Datei bringt Inline-Kommentare mit, die jede Variable im Kontext erklären; diese Seite ist die strukturierte, gruppierte Referenz für dieselbe Menge.

## Domain-Identität (Pflicht beim ersten Boot)

| Name        | Default              | Beschreibung                                                                                                                   |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HOST`      | `tale.local`         | **Pflicht.** Hostname ohne Protokoll. Wird für Docker-Networking und ausgehende Mails verwendet.                               |
| `SITE_URL`  | `https://tale.local` | **Pflicht.** Vollständige kanonische URL inklusive Schema und Port. Auth-Callbacks und externe Links nutzen das.               |
| `BASE_PATH` | unset                | **Optional.** Pfad-Präfix für Subpath-Deployments hinter einem Reverse-Proxy (z. B. `/app`). Bei Root-Deployment unset lassen. |

Die `SITE_URL` muss exakt mit dem übereinstimmen, was der Benutzer im Browser eingibt. Ein nachgestellter Slash, ein fehlender Port oder `http` statt `https` brechen den Auth-Callback und produzieren Sign-in-Schleifen.

## TLS

| Name        | Default      | Beschreibung                                                                                                               |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Einer von `selfsigned`, `letsencrypt`, `external`. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | unset        | Kontakt-E-Mail für Let's-Encrypt-Benachrichtigungen. Optional aber empfohlen in Produktion.                                |

`selfsigned` lässt Caddy mit einem generierten Cert laufen — der Browser warnt, in Ordnung für Development. `letsencrypt` braucht eine echte Domain und Ports 80/443 vom öffentlichen Internet erreichbar. `external` lässt Caddy nur HTTP servieren; ein vorgelagerter Reverse-Proxy terminiert TLS.

## Sicherheits-Secrets (Pflicht)

| Name                    | Default                   | Beschreibung                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Beispielwert in der Datei | **Pflicht.** Base64-Secret für den Better-Auth-Session-Signer. Generier mit `openssl rand -base64 32`. Rotieren invalidiert jede Session.                                                                                                                                   |
| `ENCRYPTION_SECRET_HEX` | Beispielwert in der Datei | **Pflicht.** 32-Byte-Hex-Schlüssel. AES-256-Schlüssel für OAuth- und Integrations-Credentials und HKDF-Input für die Guardrails-Secret-Box. Generier mit `openssl rand -hex 32`. Rotieren invalidiert jeden DB-Ciphertext; Operator müssen betroffene Secrets neu eingeben. |
| `INSTANCE_SECRET`       | Beispielwert in der Datei | **Pflicht.** Wird genutzt, um den Convex-Admin-Schlüssel für `tale deploy` abzuleiten. Deploy schlägt fehl, wenn unset.                                                                                                                                                     |

Ersetze die Werte, die in `.env.example` mitkommen, bevor du die Instanz exponierst — sie sind absichtlich unsichere Platzhalter.

## Datenbank

| Name           | Default                       | Beschreibung                                                                                                                                                        |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`  | `tale_password_change_me`     | **Pflicht.** Passwort für den selbst gehosteten Postgres-Benutzer. Vor der Produktion ändern. Von jedem Service in compose genutzt.                                 |
| `POSTGRES_URL` | aus `DB_PASSWORD` konstruiert | **Optional.** Überschreibt die automatisch konstruierte Verbindungs-URL. Nutze das, wenn du auf einen externen Postgres oder einen Nicht-Standard-Host/Port zeigst. |

Die auto-konstruierte Form ist `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex erwartet die URL ohne Datenbanknamen; der Name wird aus der Instanz-Konfiguration abgeleitet.

## Observability

| Name                        | Default | Beschreibung                                                                                                                                 |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry-DSN für Error-Tracking. Unset zum Deaktivieren. Kompatibel mit selbst gehostetem GlitchTip und Bugsink.                               |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optionale Sample-Rate für Performance-Traces (`0.0`–`1.0`). Standard-Verhalten hängt vom Deployment ab.                                      |
| `METRICS_BEARER_TOKEN`      | unset   | Bearer-Token, das für den Zugriff auf die Prometheus-`/metrics/*`-Endpoints nötig ist. Unset hält Metrics-Endpoints von aussen unerreichbar. |

`METRICS_BEARER_TOKEN` zu setzen exponiert vier Endpoints hinter dem Token: `/metrics/crawler`, `/metrics/rag`, `/metrics/platform` und `/metrics/convex` (Convex' 261 eingebaute Metriken). Siehe [Observability-Konfig](/de/self-hosted/configuration/observability-config) für die Scrape-Konfiguration.

## Provider-Secrets-Verschlüsselung

| Name                | Default | Beschreibung                                                                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | unset   | Inline-age-Secret-Key. Verschlüsselt `providers/*.secrets.json`. Standardmodus nach `tale init`. Mehrere Keys sind inline nicht unterstützt.                      |
| `SOPS_AGE_KEY_FILE` | unset   | Pfad zu einer Datei mit einem oder mehreren age-Keys (einer pro Zeile; `#`-Kommentare erlaubt). Pflicht für Key-Rotation. Schliesst sich mit der Inline-Form aus. |

Wenn beide unset sind, speichert Tale `providers/*.secrets.json` als Klartext-JSON mit Modus 0600. Erreich diesen Modus nur, wenn der Host-Storage at-rest verschlüsselt ist oder die Dateien von externem Tooling erzeugt werden (ein Kubernetes-Secret-Mount, ein Vault-Template). Einen age-Key zu rotieren bedeutet, den neuen Key anzuhängen, jeden Provider in der UI neu zu speichern, dann den alten Key zu entfernen. Siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops) für den vollen Rotations-Walkthrough.

## Feature-Flags

Optionale Schalter für Features, die standardmässig nicht aktiviert sind. Jeder Flag schaltet ein Feature beim Boot ein oder aus; das Umschalten braucht einen Neustart des Plattform-Containers.

| Name                            | Default | Beschreibung                                                                                                                              |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MICROSOFT_AUTH_ENABLED`        | `false` | Aktiviert die Microsoft-Entra-Sign-in-Option.                                                                                             |
| `TRUSTED_HEADERS_ENABLED`       | `false` | Aktiviert den Trusted-Headers-Auth-Modus (Identität vom Reverse-Proxy geliefert).                                                         |
| `FILE_EVENTS_ENABLED`           | `false` | Aktiviert Datei-Watching-Events für die OneDrive-Sync-Integration.                                                                        |
| `TALE_DEPLOYMENT_CONFIG_ADMINS` | unset   | Kommagetrennte E-Mail-Allowlist der Operatoren, die die Datenresidenz bearbeiten dürfen. Leer/nicht gesetzt = nur lesend für alle Admins. |

## Sitzungen

| Name                           | Default | Beschreibung                                                                                                                                                                                                                     |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Meldet eine Sitzung nach so vielen Minuten Inaktivität ab (`1`–`1440`). Das Fenster verschiebt sich bei Aktivität und wird serverseitig durchgesetzt — über E-Mail-/Passwort-, SSO- und Trusted-Headers-Sitzungen. |

Lass es unset, um die Standard-Sitzungsdauer zu behalten. Wenn gesetzt, läuft eine inaktive Sitzung serverseitig ab, sobald das Fenster verstrichen ist, während eine aktive sich bei jeder Anfrage weiter verschiebt.

## Versionierung

| Name           | Default        | Beschreibung                                                                                                               |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `TALE_VERSION` | letzte stabile | Der Image-Tag, der von `docker compose pull` gezogen wird. Auf einen spezifischen Tag pinnen für reproduzierbare Upgrades. |

## Wo das hingehört

Die Variablen hier sind die Kontaktoberfläche des Operators; die UI-Oberfläche, die die meisten von ihnen konsumiert, lebt unter [Plattform-Verwaltung](/de/platform/admin/overview). Provider-Keys sind die eine Halb-und-Halb-Sache: die Keys selbst leben in `providers/*.secrets.json`, aber die UI unter **Einstellungen > Anbieter** ist, wie du sie in der Praxis hinzufügst und rotierst. Die nächste Lektüre, die sich lohnt, ist [Anbieter](/de/self-hosted/configuration/providers) — sie behandelt die Datei-Form, die SOPS-Modi und das Resolve-und-Failover-Verhalten.
