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

| Variable                | Pflicht | Beschreibung                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Ja      | Signatur-Schlüssel für Auth-Sessions. Erzeugen mit: `openssl rand -base64 32`.                                                                                                                                                                                                                     |
| `ENCRYPTION_SECRET_HEX` | Ja      | Verschlüsselungsschlüssel für sensible Daten, einschließlich der in der DB gespeicherten Guardrails-Secrets (Moderations-API-Schlüssel usw.). Erzeugen mit: `openssl rand -hex 32`. Eine Rotation invalidiert alle gespeicherten Guardrails-Secrets — Admins müssen sie über die UI neu speichern. |
| `INSTANCE_SECRET`       | Nein    | Convex-Instanz-Secret. Erzeugen mit: `openssl rand -hex 32`.                                                                                                                                                                                                                                       |
| `SOPS_AGE_KEY`          | Nein    | Age-Geheimschlüssel für die [SOPS](https://github.com/getsops/sops)-Verschlüsselung von `providers/*.secrets.json`. Wenn gesetzt, werden Anbieter-Secrets verschlüsselt gespeichert; sonst als Klartext mit Datei-Modus `0600`. Wird von `tale init` automatisch erzeugt.                          |
| `SOPS_AGE_KEY_FILE`     | Nein    | Alternative zu `SOPS_AGE_KEY`: Pfad zu einer Datei mit dem Age-Geheimschlüssel. Eine der beiden Variablen aktiviert den verschlüsselten Modus für Anbieter-Secrets.                                                                                                                                |

> **Wichtig:** `.env.example` enthält Beispiel-Secrets. Diese musst du vor dem Start durch eigene Werte ersetzen, auch in der lokalen Entwicklung.

## KI-Anbieter

Die Anbieter-Konfiguration (API-Schlüssel, Base-URLs, Modelle) erfolgt über Dateien im Verzeichnis `providers/`, nicht über Environment-Variablen. Siehe Seite Einstellungen > Anbieter in der Management-UI oder bearbeite die Anbieter-JSON-Dateien direkt.

- `providers/<name>.json` — öffentliche Konfiguration (Base-URL, Modelle, Tags).
- `providers/<name>.secrets.json` — API-Schlüssel. SOPS-verschlüsselt, wenn `SOPS_AGE_KEY` gesetzt ist; sonst Klartext mit Modus `0600`. Wird von `tale init` und der Einstellungs-UI automatisch erzeugt.

## Datenbank

| Variable               | Pflicht | Standard | Beschreibung                                                                                                                                    |
| ---------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`          | Ja      |          | Passwort für die mitgelieferte PostgreSQL-Datenbank.                                                                                            |
| `POSTGRES_URL`         | Nein    |          | Überschreibt die automatisch erzeugte DB-Connection-URL. Falls nicht gesetzt, wird sie als `postgresql://tale:${DB_PASSWORD}@db:5432` gebildet. |
| `RAG_DATABASE_URL`     | Nein    |          | Überschreibt die DB-URL für den RAG-Dienst (muss den DB-Namen enthalten, z. B. `postgresql://...host/tale_knowledge`).                          |
| `CRAWLER_DATABASE_URL` | Nein    |          | Überschreibt die DB-URL für den Crawler-Dienst (muss den DB-Namen enthalten, z. B. `postgresql://...host/tale_knowledge`).                      |

Zum Einsatz einer externen PostgreSQL-Instanz statt des mitgelieferten Containers siehe [Externe Datenbank nutzen](/de/self-hosted/install/linux-server#externe-datenbank-nutzen).

## Error-Tracking

| Variable     | Pflicht | Standard | Beschreibung                                                         |
| ------------ | ------- | -------- | -------------------------------------------------------------------- |
| `SENTRY_DSN` | Nein    |          | Sentry-DSN für Error-Tracking. Kompatibel mit GlitchTip und Bugsink. |

Falls nicht gesetzt, ist Error-Tracking deaktiviert und Fehler erscheinen nur in Docker-Logs.

## Monitoring

| Variable               | Pflicht | Standard | Beschreibung                                               |
| ---------------------- | ------- | -------- | ---------------------------------------------------------- |
| `METRICS_BEARER_TOKEN` | Nein    |          | Bearer-Token für externen Zugriff auf Prometheus-Metriken. |

Wenn leer, liefern alle `/metrics/*`-Endpoints `401`. Siehe [Operations](/de/self-hosted/operate/observability/operations) für Endpoint-Details.

## Dienst-URLs

In Docker Compose automatisch gesetzt, lassen sich aber für eigene Setups überschreiben:

| Variable      | Standard              | Beschreibung                                      |
| ------------- | --------------------- | ------------------------------------------------- |
| `CRAWLER_URL` | `http://crawler:8002` | Crawler-Dienst für Website-Crawling.              |
| `RAG_URL`     | `http://rag:8001`     | RAG-Dienst für Dokumenten-Indizierung und -Suche. |

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

## Trusted-Kopfzeilen-Authentifizierung

| Variable                          | Pflicht | Beschreibung                                                                      |
| --------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | Nein    | Auf `true` setzen, um Trusted-Kopfzeilen-Auth zu aktivieren.                      |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | Nein    | Gemeinsames Secret zur Prüfung von Trusted-Kopfzeile-Anfragen (Defense-in-Depth). |
| `TRUSTED_EMAIL_HEADER`            | Nein    | Kopfzeile-Name für die E-Mail des Nutzers (Standard: `Remote-Email`).             |
| `TRUSTED_NAME_HEADER`             | Nein    | Kopfzeile-Name für den Anzeigenamen des Nutzers (Standard: `Remote-Name`).        |
| `TRUSTED_ROLE_HEADER`             | Nein    | Kopfzeile-Name für die Rolle des Nutzers (Standard: `Remote-Role`).               |
| `TRUSTED_TEAMS_HEADER`            | Nein    | Kopfzeile-Name für die Teams des Nutzers (Standard: `Remote-Teams`).              |

Siehe die [Authentifizierungs-Anleitung](/de/self-hosted/admin/authentication) für Details zur Konfiguration von Trusted Kopfzeilen.

## Wo das hingehört

Das oben aufgeführte Umgebungsvariablen-Inventar ist die Operator-API zu Tale. Alles, was Tales Runtime wissen muss und nicht im Code mitgeliefert oder über die UI gesetzt wird, lebt in einer dieser Variablen, und die meisten haben sinnvolle Defaults, die nur die Produktions-Installation überhaupt überschreibt. Die UI-Gegenstücke dieser Schrauben liegen unter **Einstellungen > Governance**, **Einstellungen > KI-Anbieter** und **Einstellungen > Branding** — für die feature-spezifischen Referenzseiten siehe [Governance](/de/platform/admin/governance), [KI-Anbieter — Konfigurationsreferenz](/de/self-hosted/configuration/providers) und [Branding](/de/platform/admin/branding).

Wenn Tales Runtime etwas erwartet, das nicht da ist — ein fehlender API-Schlüssel, ein abwesender Pepper, ein verkorkstes `TALE_CONFIG_DIR` — sagt der Boot-Log das auf stderr. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) katalogisiert die häufigsten Umgebungs-Fehlkonfigurations-Fehlermodi.
