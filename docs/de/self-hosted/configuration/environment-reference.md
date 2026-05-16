---
title: Umgebungsreferenz
description: Vollständige Referenz aller Umgebungsvariablen zur Konfiguration von Tale.
---

Die Umgebungsreferenz katalogisiert jede Variable, die Tale beim Container-Start liest. Operatoren konsultieren diese Seite, wenn ein Knopf geändert werden muss — eine Domain, ein TLS-Modus, ein SSO-Mandant — und nochmal, wenn etwas, was die Laufzeit erwartete zu finden, nicht da ist. Die Wahrheitsquelle ist `.env.example` und die Per-Service-Env-Loader; die Tabellen unten sind nach Oberfläche gruppiert, sodass die Variablen, die eine Sorge regieren, nahe beieinander bleiben.

Jede Variable lebt in `.env` im Projekt-Wurzelverzeichnis. `tale init` versorgt die Datei mit vernünftigen Voreinstellungen; Produktions-Deployments überschreiben Domain-, TLS- und Datenbankwerte, und die meisten Installationen rühren nichts anderes an.

## Wie diese Seite zu lesen ist

Variablen sind danach gruppiert, was sie kontrollieren — Domain, TLS, Secrets, Datenbank, Monitoring, SSO, vertrauenswürdige HTTP-Kopfzeilen, Aufbewahrung, Deployment. Jede Gruppe öffnet mit ein bis zwei Sätzen, die benennen, was die Gruppe regiert, dann folgt eine `Name | Voreinstellung | Beschreibung`-Tabelle. Variablen ohne Voreinstellung sind voreingestellt ungesetzt; fehlende erforderliche Variablen führen dazu, dass der Container den Start mit der auf der [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting)-Seite genannten Meldung verweigert.

Änderungen greifen beim Container-Start, also verlangt das Bearbeiten von `.env` ein `tale deploy` (Produktion) oder ein `tale start` (lokal). Ein laufender Stack liest `.env` nie erneut.

## Domain

`HOST` ist der Hostname, den Docker für internes Routing und E-Mail nutzt; `SITE_URL` ist die vollständige URL, die Nutzer in den Browser tippen, einschließlich eines nicht standardmäßigen Ports. `BASE_PATH` wird nur gesetzt, wenn ein vorgelagerter Proxy Tale unter einem Subpath ausliefert.

| Name        | Voreinstellung       | Beschreibung                                                                                       |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `HOST`      | `tale.local`         | Hostname ohne Protokoll. Wird für Docker-Netzwerk-Aliase und ausgehende E-Mail-Kopfzeilen genutzt. |
| `SITE_URL`  | `https://tale.local` | Vollständige kanonische URL mit Protokoll. Wird für externe Links und Auth-Callbacks genutzt.      |
| `BASE_PATH` | _(leer)_             | Subpath hinter einem Pfad-Präfix-Proxy (z. B. `/app`). Leer lassen für Wurzel-Deployments.         |

`SITE_URL` muss der URL entsprechen, die Nutzer tatsächlich erreichen. Wenn dein Reverse-Proxy auf `:8443` lauscht, nimm ihn auf: `SITE_URL=https://example.com:8443`. Der Proxy nutzt diesen Wert, um OAuth-Callback-URLs und den Passwort-Reset-Link zu bauen, also bricht eine Diskrepanz beide Abläufe still.

## TLS

Drei Modi decken die Zertifikatsoptionen ab. `selfsigned` ist die lokale Voreinstellung; `letsencrypt` ist die Produktions-Voreinstellung; `external` ist für Deployments, in denen ein vorgelagerter Proxy TLS bereits terminiert.

| Name        | Voreinstellung | Beschreibung                                                                                   |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned`   | Zertifikatsbehandlung: `selfsigned`, `letsencrypt` oder `external`.                            |
| `TLS_EMAIL` | _(leer)_       | Kontakt-E-Mail für Let's-Encrypt-ACME-Benachrichtigungen. Empfohlen, wann immer `letsencrypt`. |

Selbstsignierte Zertifikate lösen eine Browser-Warnung aus, bis du auf dem Host `docker exec tale-proxy caddy trust` fährst. Let's Encrypt braucht die Ports 80 und 443 vom öffentlichen Internet erreichbar für die ACME-Challenge. Der externe Modus fährt Caddy nur auf HTTP; der vorgelagerte Proxy behandelt TLS und leitet WebSocket-Upgrades für den Convex-Realtime-Kanal weiter.

## Security-Secrets

Das sind die Secrets, ohne die die Plattform den Start verweigert. `tale init` erzeugt jedes einzelne; das Rotieren macht alles ungültig, was zuvor mit dem alten Wert verschlüsselt wurde.

| Name                    | Voreinstellung | Beschreibung                                                                                                                              |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | _(ungesetzt)_  | Signing-Schlüssel für Auth-Sessions. Mit `openssl rand -base64 32` erzeugen. Erforderlich.                                                |
| `ENCRYPTION_SECRET_HEX` | _(ungesetzt)_  | 32-Byte-Hex-Schlüssel für die in-Datenbank Secret-Box. Mit `openssl rand -hex 32` erzeugen. Rotieren macht gespeicherte Secrets ungültig. |
| `INSTANCE_SECRET`       | _(ungesetzt)_  | Seed für den Convex-Admin-Schlüssel, den `tale deploy` ableitet. Mit `openssl rand -hex 32` erzeugen.                                     |
| `SOPS_AGE_KEY`          | _(ungesetzt)_  | Inline-age-Secret-Key für SOPS-Verschlüsselung von `providers/*.secrets.json`. `tale init` versorgt diesen standardmäßig.                 |
| `SOPS_AGE_KEY_FILE`     | _(ungesetzt)_  | Pfad zu einer Datei mit einem oder mehreren age-Schlüsseln, einer pro Zeile. Nutze diese Form für Schlüssel-Rotation.                     |

Die Datei `.env.example` liefert Platzhalter-Secrets aus. Ersetze jeden einzelnen, bevor du den Stack startest, auch für lokale Entwicklung; die Platzhalter sind öffentlich auf GitHub, und ein Angreifer, der die Instanz erreicht, kann mit ihnen Auth-Tokens fälschen. Die SOPS-Modi — verschlüsselt, Klartext, Schlüssel-Rotation — werden unter [Anbieter](/de/self-hosted/configuration/providers#provider-secrets-storage) behandelt.

## Datenbank

`DB_PASSWORD` ist das Passwort für den gebündelten Postgres-Container. Die Override-Variablen zählen nur, wenn Tale auf eine externe Postgres-Instanz ausgerichtet wird — das vollständige Muster steht unter [Produktions-Deployment](/de/self-hosted/install/linux-server#using-an-external-database).

| Name                   | Voreinstellung | Beschreibung                                                                                                         |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`          | _(ungesetzt)_  | Passwort für den gebündelten Postgres. Erforderlich bei Nutzung des `db`-Containers.                                 |
| `POSTGRES_URL`         | _(ungesetzt)_  | Überschreibt die automatisch gebaute Verbindungs-URL. Format `postgresql://user:pass@host:port` ohne Datenbanknamen. |
| `RAG_DATABASE_URL`     | _(ungesetzt)_  | Pro-Service-Override für RAG. Schließe den Datenbanknamen ein (`/tale_knowledge`).                                   |
| `CRAWLER_DATABASE_URL` | _(ungesetzt)_  | Pro-Service-Override für den Crawler. Schließe den Datenbanknamen ein (`/tale_knowledge`).                           |

Ohne `POSTGRES_URL` baut Tale die URL als `postgresql://tale:${DB_PASSWORD}@db:5432`. Die beiden service-spezifischen URLs überschreiben die Basis-URL nur für den benannten Service, was Read-Replikas und Per-Service-Routing möglich macht.

## Fehler-Tracking

Tales Fehler-Reporting spricht das Sentry-DSN-Format. Selbst gehostetes Sentry, GlitchTip und Bugsink akzeptieren alle dieselbe DSN-Form, also funktioniert jedes davon als Drop-in-Ersatz. Lass die Variable ungesetzt, um Fehler nur in Docker-Logs zu halten.

| Name                        | Voreinstellung | Beschreibung                                                                                                   |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | _(ungesetzt)_  | DSN-Endpunkt für Crash- und Fehler-Reporting. Kompatibel mit Sentry, GlitchTip und Bugsink.                    |
| `SENTRY_TRACES_SAMPLE_RATE` | `1.0`          | Anteil der Transaktionen, der für Performance-Tracing gesampelt wird. Auf `0.0` setzen, um es zu deaktivieren. |

## Monitoring

Jeder Dienst exponiert einen Prometheus-Textformat-Endpunkt `/metrics` im internen Docker-Netzwerk. Um sie durch den Proxy für ein externes Prometheus zu exponieren, setze ein Bearer-Token:

| Name                   | Voreinstellung | Beschreibung                                                                                                          |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `METRICS_BEARER_TOKEN` | _(ungesetzt)_  | Bearer-Token, um `/metrics/<service>` durch den Proxy zu lesen. Ungesetzt antwortet jeder Metrics-Endpunkt mit `401`. |

Die vollständige Endpunkt-Liste und eine Beispiel-Prometheus-Scrape-Konfiguration stehen unter [Betrieb](/de/self-hosted/operate/observability/operations#monitoring).

## Service-URLs

Docker Compose verdrahtet Service-zu-Service-Verkehr automatisch, also müssen die URLs unten selten überschrieben werden. Die Variablen existieren für eigene Topologien — RAG auf einem separaten Host laufen lassen, den Crawler horizontal skalieren und so weiter.

| Name          | Voreinstellung        | Beschreibung                                          |
| ------------- | --------------------- | ----------------------------------------------------- |
| `CRAWLER_URL` | `http://crawler:8002` | Crawler-Dienst-Endpunkt, von der Platform konsumiert. |
| `RAG_URL`     | `http://rag:8001`     | RAG-Dienst-Endpunkt, von der Platform konsumiert.     |

## Docker

Diese kontrollieren, wie `docker compose` und `tale deploy` Images ziehen.

| Name          | Voreinstellung | Beschreibung                                                                                  |
| ------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `PULL_POLICY` | `build`        | `build` für lokale Entwicklung; `always`, um vorgefertigte Images von GHCR zu ziehen.         |
| `VERSION`     | `latest`       | Image-Versions-Tag. Kombiniere mit `PULL_POLICY=always`, um ein bestimmtes Release zu pinnen. |

## Microsoft Entra SSO

Diese drei Variablen zählen nur, wenn SSO über `.env` statt über den Bildschirm **Einstellungen > Integrationen** in der App konfiguriert wird. Die meisten Operatoren nutzen die UI; die Env-Var-Form ist nützlich für Infrastructure-as-Code-Setups, bei denen die SSO-Konfiguration im selben Repository wie `.env` lebt.

| Name                                | Voreinstellung | Beschreibung                             |
| ----------------------------------- | -------------- | ---------------------------------------- |
| `AUTH_MICROSOFT_ENTRA_ID_ID`        | _(ungesetzt)_  | Microsoft Entra Application (client) ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET`    | _(ungesetzt)_  | Microsoft Entra Client Secret.           |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | _(ungesetzt)_  | Microsoft Entra Directory (tenant) ID.   |

Der vollständige SSO-Ablauf steht unter [Authentifizierung](/de/self-hosted/admin/authentication#microsoft-entra-id-sso).

## Vertrauenswürdige HTTP-Kopfzeilen

Für Deployments hinter einem authentifizierenden Reverse-Proxy — Authelia, Authentik, oauth2-proxy — liest Tale die Identität des Nutzers aus HTTP-Kopfzeilen, die der Proxy setzt, und versorgt dann bei der ersten Anfrage ein Konto.

| Name                              | Voreinstellung | Beschreibung                                                                                              |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | `false`        | Auf `true` setzen, um vertrauenswürdige Kopfzeilen zu aktivieren. Die Login-Seite wird dann übersprungen. |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | _(ungesetzt)_  | Gemeinsames Geheimnis, das der convex-Endpunkt validiert, bevor er Kopfzeilen vertraut. Defense-in-Depth. |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email` | Name der HTTP-Kopfzeile, die die E-Mail-Adresse des Nutzers trägt.                                        |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`  | Name der HTTP-Kopfzeile, die den Anzeigenamen des Nutzers trägt.                                          |
| `TRUSTED_ROLE_HEADER`             | `Remote-Role`  | Name der HTTP-Kopfzeile, die die Rolle trägt (`admin`, `developer`, `editor` oder `member`).              |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams` | Name der HTTP-Kopfzeile, die eine komma-separierte `id:name`-Team-Liste trägt.                            |

Aktiviere vertrauenswürdige Kopfzeilen nur, wenn der vorgelagerte Proxy diese Kopfzeilen von externen Anfragen entfernt. Wenn externe Clients die Kopfzeilen direkt setzen können, können sie jeden Nutzer imitieren. Die vollständige Konfigurations-Anleitung steht unter [Authentifizierung](/de/self-hosted/admin/authentication#trusted-headers).

## Aufbewahrung

Die Aufbewahrungsgrenzen für jede Datenkategorie kommen aus JSON-Dateien unter `TALE_CONFIG_DIR/retention/`. Die Umgebungsvariablen unten verschärfen diese Grenzen — sie können nicht ausweiten, was die Datei deklariert. Das vollständige geschichtete Modell steht unter [Aufbewahrung](/de/self-hosted/configuration/retention).

Eine Handvoll Variablen berühren den Audit-Log-Boden und den Legal-Hold-Ablauf statt Per-Kategorie-Grenzen:

| Name                                     | Voreinstellung | Beschreibung                                                                                            |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_DISABLED`                | `false`        | Auf `true` setzen, um die nächtliche Bereinigung zu deaktivieren. Operator-Notschalter für Migrationen. |
| `TALE_AUDIT_PEPPER`                      | _(ungesetzt)_  | Geheimnis von 16+ Zeichen. Aktiviert HMAC-SHA256-Hashing von E-Mail und IP in Audit-Zeilen.             |
| `TALE_AUDIT_SIGNING_KEY`                 | _(ungesetzt)_  | Signiert `auditLogCheckpoints`-Zeilen, um Aufbewahrungs-Scrubs von Manipulation zu unterscheiden.       |
| `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS` | `24`           | Stunden zwischen Genehmigung und tatsächlicher Freigabe eines Legal-Hold.                               |
| `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK`        | `false`        | Auf `true` setzen, damit Single-Admin-Instanzen Legal-Hold-Freigaben selbst genehmigen dürfen.          |

Die Per-Kategorie-`_MIN`/`_MAX`-Overrides sind vollständig unter [Aufbewahrung — Umgebungsvariablen](/de/self-hosted/configuration/retention#environment-variables-tightening-overlay) gelistet.

## KI-Anbieter

Anbieter-API-Schlüssel, Basis-URLs und Modell-Definitionen sind keine Umgebungsvariablen — sie leben in JSON-Dateien unter `TALE_CONFIG_DIR/providers/`. Das On-Disk-Schema, die SOPS-Verschlüsselungsmodi und die Regeln für das Weiterleiten anbieterspezifischer Optionen stehen unter [Anbieter](/de/self-hosted/configuration/providers).

## Wo das einsetzt

Die Umgebungsreferenz ist die Operator-API zu Tale. Alles, was die Laufzeit braucht und was nicht im Code mitgeliefert oder über die UI gesetzt wird, lebt in einer der Variablen oben, und die meisten haben vernünftige Voreinstellungen — die produktionsreifen Installationsseiten überschreiben nur Domain, TLS, Secrets und die Datenbank. Die UI-Gegenstücke der in der App auftauchenden Werte leben unter **Einstellungen > Governance**, **Einstellungen > Anbieter** und **Einstellungen > Branding**; greife zu [Governance](/de/platform/admin/governance), [Anbieter](/de/self-hosted/configuration/providers) und [Branding](/de/platform/admin/branding) für die Per-Funktion-Referenz.

Wenn die Laufzeit eine Variable erwartet, die nicht da ist, sagt das Boot-Log das auf stderr. [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting) katalogisiert die häufigsten Umgebungs-Fehlkonfigurationen; die Seite [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) deckt ab, wie Deprecations landen.
