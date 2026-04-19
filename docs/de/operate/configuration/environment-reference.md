---
title: Environment-Referenz
description: Vollständige Referenz aller Environment-Variablen zur Konfiguration von Tale.
---

Die gesamte Konfiguration erfolgt über Environment-Variablen in der `.env`-Datei. Kopiere `.env.example` nach `.env` und fülle deine Werte ein.

## Domain-Konfiguration

| Variable    | Pflicht | Standard             | Beschreibung                                                                         |
| ----------- | ------- | -------------------- | ------------------------------------------------------------------------------------ |
| `HOST`      | Ja      | `tale.local`         | Hostname ohne Protokoll (wird für Docker-Netzwerk und E-Mails genutzt).              |
| `SITE_URL`  | Ja      | `https://tale.local` | vollständige kanonische URL mit Protokoll (für externe Links und Auth-Callbacks).    |
| `BASE_PATH` | Nein    |                      | Basis-Pfad für Subpath-Deployments (z. B. `/app`). Leer lassen bei Root-Deployments. |

`SITE_URL` muss der URL entsprechen, die Nutzer im Browser aufrufen, inklusive nicht-standardmäßiger Ports (z. B. `https://example.com:8443`).

## TLS/SSL

| Variable    | Pflicht | Standard     | Beschreibung                                                            |
| ----------- | ------- | ------------ | ----------------------------------------------------------------------- |
| `TLS_MODE`  | Nein    | `selfsigned` | Zertifikatsverwaltung: `selfsigned`, `letsencrypt` oder `external`.     |
| `TLS_EMAIL` | Nein    |              | E-Mail für Let's-Encrypt-Benachrichtigungen (für Produktion empfohlen). |

- **selfsigned**: selbstsignierte Zertifikate für Entwicklung. Browser zeigt eine Warnung.
- **letsencrypt**: kostenlose vertrauenswürdige Zertifikate von Let's Encrypt. Benötigt eine gültige öffentliche Domain und die Ports 80/443 offen.
- **external**: TLS wird vom externen Reverse-Proxy erledigt. Caddy lauscht nur auf HTTP.

## Sicherheits-Secrets

| Variable                | Pflicht | Beschreibung                                                                        |
| ----------------------- | ------- | ----------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Ja      | Signatur-Schlüssel für Auth-Sessions. Erzeugen mit: `openssl rand -base64 32`.      |
| `ENCRYPTION_SECRET_HEX` | Ja      | Verschlüsselungsschlüssel für sensible Daten. Erzeugen mit: `openssl rand -hex 32`. |
| `INSTANCE_SECRET`       | Nein    | Convex-Instanz-Secret. Erzeugen mit: `openssl rand -hex 32`.                        |

> **Wichtig:** `.env.example` enthält Beispiel-Secrets. Diese musst du vor dem Start durch eigene Werte ersetzen, auch in der lokalen Entwicklung.

## KI-Anbieter

Die Anbieter-Konfiguration (API-Schlüssel, Base-URLs, Modelle) erfolgt über Dateien im Verzeichnis `providers/`, nicht über Environment-Variablen. Siehe Seite Einstellungen > Providers in der Management-UI oder bearbeite die Provider-JSON-Dateien direkt.

- `providers/<name>.json` — öffentliche Konfiguration (Base-URL, Modelle, Tags).
- `providers/<name>.secrets.json` — SOPS-verschlüsselte API-Schlüssel (automatisch von `tale init` erzeugt).

## Datenbank

| Variable               | Pflicht | Standard | Beschreibung                                                                                                                                    |
| ---------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`          | Ja      |          | Passwort für die mitgelieferte PostgreSQL-Datenbank.                                                                                            |
| `POSTGRES_URL`         | Nein    |          | Überschreibt die automatisch erzeugte DB-Connection-URL. Falls nicht gesetzt, wird sie als `postgresql://tale:${DB_PASSWORD}@db:5432` gebildet. |
| `RAG_DATABASE_URL`     | Nein    |          | Überschreibt die DB-URL für den RAG-Dienst (muss den DB-Namen enthalten, z. B. `postgresql://...host/tale_knowledge`).                          |
| `CRAWLER_DATABASE_URL` | Nein    |          | Überschreibt die DB-URL für den Crawler-Dienst (muss den DB-Namen enthalten, z. B. `postgresql://...host/tale_knowledge`).                      |

Zum Einsatz einer externen PostgreSQL-Instanz statt des mitgelieferten Containers siehe [Externe Datenbank nutzen](/de/operate/deployment/production#externe-datenbank-nutzen).

## Error-Tracking

| Variable     | Pflicht | Standard | Beschreibung                                                         |
| ------------ | ------- | -------- | -------------------------------------------------------------------- |
| `SENTRY_DSN` | Nein    |          | Sentry-DSN für Error-Tracking. Kompatibel mit GlitchTip und Bugsink. |

Falls nicht gesetzt, ist Error-Tracking deaktiviert und Fehler erscheinen nur in Docker-Logs.

## Monitoring

| Variable               | Pflicht | Standard | Beschreibung                                               |
| ---------------------- | ------- | -------- | ---------------------------------------------------------- |
| `METRICS_BEARER_TOKEN` | Nein    |          | Bearer-Token für externen Zugriff auf Prometheus-Metriken. |

Wenn leer, liefern alle `/metrics/*`-Endpoints `401`. Siehe [Operations](/de/operate/observability/operations) für Endpoint-Details.

## Dienst-URLs

In Docker Compose automatisch gesetzt, lassen sich aber für eigene Setups überschreiben:

| Variable       | Standard                 | Beschreibung                                      |
| -------------- | ------------------------ | ------------------------------------------------- |
| `CRAWLER_URL`  | `http://crawler:8002`    | Crawler-Dienst für Website-Crawling.              |
| `RAG_URL`      | `http://rag:8001`        | RAG-Dienst für Dokumenten-Indizierung und -Suche. |

## Docker-Deployment

| Variable      | Pflicht | Standard | Beschreibung                                                                    |
| ------------- | ------- | -------- | ------------------------------------------------------------------------------- |
| `PULL_POLICY` | Nein    |          | Auf `always` setzen, um vorgebaute Images von GitHub zu nutzen.                 |
| `VERSION`     | Nein    |          | Image-Version-Tag (z. B. `latest`, `v1.0.0`). Genutzt mit `PULL_POLICY=always`. |

## Microsoft Entra ID SSO

Diese Variablen sind nur nötig, wenn du SSO über Environment-Variablen konfigurierst statt über die In-App-UI Einstellungen > Integrationen.

| Variable                            | Pflicht | Beschreibung                                |
| ----------------------------------- | ------- | ------------------------------------------- |
| `AUTH_MICROSOFT_ENTRA_ID_ID`        | Nein    | Microsoft-Entra-ID-Application (Client) ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET`    | Nein    | Microsoft-Entra-ID-Client-Secret.           |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Nein    | Microsoft-Entra-ID-Tenant-ID.               |

## Trusted-Headers-Authentifizierung

| Variable                          | Pflicht | Beschreibung                                                                   |
| --------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `TRUSTED_HEADERS_ENABLED`         | Nein    | Auf `true` setzen, um Trusted-Headers-Auth zu aktivieren.                      |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | Nein    | Gemeinsames Secret zur Prüfung von Trusted-Header-Requests (Defense-in-Depth). |
| `TRUSTED_EMAIL_HEADER`            | Nein    | Header-Name für die E-Mail des Nutzers (Standard: `Remote-Email`).             |
| `TRUSTED_NAME_HEADER`             | Nein    | Header-Name für den Anzeigenamen des Nutzers (Standard: `Remote-Name`).        |
| `TRUSTED_ROLE_HEADER`             | Nein    | Header-Name für die Rolle des Nutzers (Standard: `Remote-Role`).               |
| `TRUSTED_TEAMS_HEADER`            | Nein    | Header-Name für die Teams des Nutzers (Standard: `Remote-Teams`).              |

Siehe die [Authentifizierungs-Anleitung](/de/admin/authentication) für Details zur Konfiguration von Trusted Headers.
