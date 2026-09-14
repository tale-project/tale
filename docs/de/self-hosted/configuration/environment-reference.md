---
title: Umgebungsvariablen-Referenz
description: Bereitstellungsvariablen, Standardwerte, Geheimnisübergabe und die jeweils betroffenen Dienste.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Hier findest du Bereitstellungsvariablen, ihre Standardwerte und die Prozesse, die sie benötigen. Die Projektdatei `.env` ist eine mögliche Quelle; Container-Umgebungen und Secret-Manager können Werte ebenfalls bereitstellen. Die [Beispieldatei](https://github.com/tale-project/tale/blob/main/.env.example) enthält die zugehörige Quellkonfiguration.

Erstelle betroffene Dienste nach einer Umgebungsänderung über deinen Bereitstellungsablauf neu. `docker compose restart` behält die vorhandene Containerumgebung. Dateibasierte Organisationskonfiguration hat einen getrennten Lebenszyklus.

## Wie du diese Seite liest

Die Tabellen nennen Variablennamen, Standardwerte und Zweck. Erforderliche Werte müssen den jeweiligen Dienst erreichen; einige erzeugt die Bereitstellung automatisch. Optionale Werte können ungesetzt bleiben. Ein angegebener Standard kann aus Compose stammen statt aus dem Prozess selbst.

Nutze zusätzlich die kommentierte Beispieldatei und prüfe bei fehlenden Werten die wirksame Umgebung des betroffenen Dienstes.

## Domain-Identität (Pflicht beim ersten Boot)

| Name        | Default             | Beschreibung                                                                                                                   |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HOST`      | `localhost`         | **Pflicht.** Hostname ohne Protokoll. Wird für Docker-Networking und ausgehende Mails verwendet.                               |
| `SITE_URL`  | `https://localhost` | **Pflicht.** Vollständige kanonische URL inklusive Schema und Port. Auth-Callbacks und externe Links nutzen das.               |
| `ADDITIONAL_SITE_URLS` | unset    | **Optional.** Weitere Origins, auf denen dasselbe Deployment antwortet, per Komma oder Leerzeichen getrennt (z. B. `https://a.example,https://b.example`). Jeder ist ein vollwertiger Eingang. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains#mehrere-domains-gleichzeitig). |
| `BASE_PATH` | unset               | **Optional.** Pfad-Präfix für Subpath-Deployments hinter einem Reverse-Proxy (z. B. `/app`). Bei Root-Deployment unset lassen. |

`SITE_URL` bezeichnet den kanonischen öffentlichen Ursprung. Protokoll, Hostname und Port müssen zur Browseradresse und zu registrierten Callbacks passen. `BASE_PATH` ergänzt einen Bereitstellungspfad. Einen abschließenden Schrägstrich normalisiert der Proxy. Weitere Adressen gehören als reine Ursprünge in `ADDITIONAL_SITE_URLS`. Ungültige zusätzliche Ursprünge verhindern den Backend-Start.

## TLS

| Name        | Default      | Beschreibung                                                                                                               |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Einer von `selfsigned`, `letsencrypt`, `external`. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | unset        | Kontakt-E-Mail für Let's-Encrypt-Benachrichtigungen. Optional aber empfohlen in Produktion.                                |

`selfsigned` erstellt ein lokales Caddy-Zertifikat. Vertraue der zugehörigen CA nur für deine eigene kontrollierte Installation. `letsencrypt` benötigt eine öffentliche Domain sowie erreichbare Ports 80/443. Bei `external` bedient Caddy HTTP hinter einem TLS-Proxy.

## Sicherheits-Secrets (Pflicht)

| Name                    | Default                   | Beschreibung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET` | Beispielwert in der Datei | Authentifizierungsgeheimnis für alle Backend-Replikate. Erzeuge einen zufälligen Wert, etwa mit `openssl rand -base64 32`, und halte ihn stabil. Ein Wechsel kann Sitzungen und laufende Anmeldungen ungültig machen. |
| `ENCRYPTION_SECRET_HEX` | Beispielwert in der Datei | Verschlüsselungsschlüssel mit 32 Byte als Hex-Wert; erzeuge ihn mit `openssl rand -hex 32`. Bewahre den zu vorhandenen Geheimnissen passenden Wert auf. Ein Austausch migriert keine verschlüsselten Daten. Stelle den passenden Schlüssel wieder her oder erfasse betroffene Geheimnisse über ihren vorgesehenen Ablauf neu. |
| `INSTANCE_SECRET`       | Beispielwert in der Datei | **Pflicht.** Das Root-Secret der Instanz: 64 Hex-Zeichen, `tale init` erzeugt es (von Hand: `openssl rand -hex 32`). Beim Boot leitet Tale daraus den WebDAV-App-Passwort-HMAC-Schlüssel (`WEBDAV_APP_PASSWORD_HMAC_KEY`) ab, sofern du den nicht selbst setzt; auch die kurzlebigen Tokens, mit denen Sandbox-Sessions Blobs holen, signiert ein Unterschlüssel derselben Ableitung. Halte ihn über Deploys stabil: Eine Rotation leitet den Schlüssel neu ab und macht jedes WebDAV-App-Passwort ungültig. |
| `SANDBOX_TOKEN`         | Beispielwert in der Datei | **Pflicht.** Gemeinsames HMAC-Secret zwischen Backend und Sandbox-Spawner: Das Backend signiert damit jeden Spawner-Aufruf, der Spawner weist unsignierte ab. Ohne das Secret startet der Spawner nicht — er hält den Docker-Socket des Hosts, es gibt also keinen unsignierten Modus. `tale init` und `bun run dev` erzeugen es; ein Stack, den du selbst zusammenstellst, setzt es vor dem ersten Boot (`openssl rand -hex 32`). Eine Rotation heißt: Backend und Spawner zusammen neu starten — sie müssen übereinstimmen. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | nicht gesetzt | **Für Sandbox-Harness-Aufrufe erforderlich.** Das Backend nutzt dieses Verwaltungsgeheimnis, um Sitzungsschlüssel am Gateway bereitzustellen. Es richtet den Gateway-Zugang bei der ersten Verwendung ein; der Passwort-Hash bleibt in `llm-gateway-data`. Bewahre das passende Geheimnis auf oder nutze die unterstützte Wiederherstellung bzw. Rotation des Gateways. Lösche dessen Zustand nicht als gewöhnlichen Reparaturschritt. Der Benutzername ist standardmäßig `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Ersetze die unsicheren Beispielwerte aus `.env.example`, bevor du die Instanz für andere zugänglich machst.

## Datenbank

Tale verwendet `tale_app` für Anwendungsdaten und `tale_knowledge` für Textabschnitte, Embeddings und Webseiten. Der Standardaufbau betreibt beide in einem Postgres-Dienst `db` mit dem Alias `knowledge-db`. Externe Verbindungen kannst du getrennt konfigurieren.

| Name                                      | Default                                                             | Beschreibung                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD` | `tale_password_change_me` | **Für das mitgelieferte Postgres erforderlich.** Gemeinsames Passwort der Anwendungs- und Wissensdatenbank im Standardaufbau. Ersetze den Beispielwert vor dem Produktivbetrieb. |
| `DATABASE_URL`                            | aus `DB_PASSWORD` konstruiert                                       | **Optional.** Verbindungs-URL der operativen Datenbank. Setz sie, um das Backend auf einen Postgres zu richten, den du selbst betreibst: er braucht keine Extensions und keinen Superuser, nur eine Datenbank und eine Rolle, die Schemata anlegen darf. Wird bei jedem Start gelesen. |
| `DATABASE_POOL_MAX`                       | `10`                                                                | **Optional.** Verbindungen, die ein Backend-Prozess zur operativen Datenbank öffnet. Jede Replik von `backend-api` und `backend-worker` kostet das doppelt — einmal der App-Pool, einmal die Job-Queue. Diese Zahl prüfst du gegen `max_connections` eines verwalteten Postgres. |
| `POSTGRES_CA_FILE`                        | nicht gesetzt                                                       | **Optional.** Pfad zu einem PEM-Bundle, dem **jede** Postgres-Verbindung vertraut: operative Datenbank, Wissens-Korpus und die Datenbanken, die Organisationen selbst mitbringen. Nötig, sobald eine URL `sslmode=verify-ca` oder `verify-full` gegen einen Anbieter verlangt, dessen Root Node nicht mitliefert — Amazon RDS ist der übliche Fall. Nutzen mehrere Datenbanken verschiedene Anbieter, häng ihre Roots in einer Datei aneinander. |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | Verbindungs-URL des Standard-Wissenskorpus. Eine andere URL wählt eine andere Datenbank; vorhandene Textabschnitte und Vektoren werden nicht übertragen. |
| `KNOWLEDGE_DB_NAME` | `tale_knowledge` | Name der Wissensdatenbank, die die mitgelieferte Datenbankinitialisierung erstellt. |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optional.** Größter BM25-Suchindex (in Bytes), den das Backend beim Start synchron neu aufbaut, wenn es ihn beschädigt vorfindet; einen größeren baut ein Hintergrundjob neu auf, während Schreibzugriffe auf diesen Korpus abgewiesen werden. Siehe [Container-Architektur](/de/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED` | nicht gesetzt | `1` oder `true` deaktiviert die automatische BM25-Prüfung und Reparatur beim Start. Beschädigungen bleiben bestehen; fehlgeschlagene Abfragen oder Schreibzugriffe brauchen eine Untersuchung und kontrollierte Reparatur. |

Die erzeugte Verbindungs-URL lautet `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app`; `APP_DB_NAME` ändert den Datenbanknamen. Der Wissenskorpus nutzt die Schemata `private_knowledge` und `public_web`. Unter **Einstellungen > Datenresidenz** kann eine Organisation eigene Verbindungen wählen. Eine gespeicherte URL ändert den Speicherort, überträgt aber keine Daten. Siehe [Datenresidenz](/de/self-hosted/configuration/data-residency).

Zwei Dinge musst du wissen, bevor du eine der beiden Datenbanken auf eigene Infrastruktur richtest:

- **Der Wissens-Korpus braucht ein installiertes `pgvector`.** Tale legt Schemata und Tabellen auf einer leeren Datenbank selbst an, installiert aber nie Extensions — die Chunk-Tabelle hat eine `vector`-Spalte, also muss `CREATE EXTENSION vector;` auf der Zieldatenbank bereits gelaufen sein. ParadeDBs `pg_search` ist optional: Fehlt es, fällt die Suche auf reine Vektorsuche zurück, statt zu scheitern. Die operative Datenbank braucht gar keine Extensions.
- **Verwende eine direkte oder sitzungskompatible Postgres-Verbindung.** Job-Benachrichtigungen, Migrationssperren und vorbereitete Abfragen brauchen Sitzungseigenschaften. Prüfe einen verwalteten Verbindungsproxy anhand dieser Anforderungen.

## Object-Store

Dateien und Medien verwenden S3-kompatiblen Speicher. Diese Variablen bestimmen den Bereitstellungsstandard. Eine ausdrücklich gewählte Organisationsverbindung hat Vorrang; ein ausgefallener Standardspeicher bedeutet nicht, dass auch die eigenen Buckets aller Organisationen ausfallen.

| Name                             | Default                        | Beschreibung                                                                                                                                                                    |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORE_ACCESS_KEY` | nicht gesetzt | Zugriffsschlüssel der Standard-S3-Verbindung. Setze bei mitgeliefertem MinIO denselben Wert als `MINIO_ROOT_USER`. Ohne Zugangsdaten entsteht keine Standardverbindung; eine Organisation kann trotzdem eine eigene gültige Verbindung haben. |
| `OBJECT_STORE_SECRET_KEY` | von `tale init` autogeneriert | Geheimschlüssel des Standardspeichers. Bei mitgeliefertem MinIO muss er zu `MINIO_ROOT_PASSWORD` passen. Rotiere Speicher- und Backend-Zugangsdaten abgestimmt und prüfe Lesen und Schreiben. Ein Passwortwechsel überträgt keine Dateien und macht sie nicht von sich aus verwaist. |
| `OBJECT_STORE_BUCKET`            | `tale-blobs`                   | Bucket, in dem Blobs liegen. Das Backend legt ihn an, wenn er fehlt und der Schlüssel das darf; einen vorhandenen nutzt es, wie er ist. |
| `OBJECT_STORE_ENDPOINT` | `http://object-store:9000` im mitgelieferten Compose | Endpunkt des Speichers aus Sicht des Backends. AWS S3 verwendet keinen eigenen Endpunkt; entferne oder leere den mitgelieferten Endpunkt ausdrücklich in der wirksamen Compose-Umgebung. MinIO, R2 und andere kompatible Dienste verwenden eine eigene URL. |
| `OBJECT_STORE_REGION`            | `us-east-1`                    | Signier-Region. Auf AWS bedeutungstragend; bei einem selbst gehosteten Store beliebig, aber vom Signierer verlangt. |
| `OBJECT_STORE_FORCE_PATH_STYLE`  | `true` mit Endpoint, sonst `false` | Adressiert den Bucket als `endpoint/bucket/key` statt `bucket.endpoint/key`. Der Default folgt dem Endpoint und passt damit für beide Fälle; setz ihn nur für einen Store, der von seiner eigenen Form abweicht. |
| `OBJECT_STORE_PREFIX`            | nicht gesetzt                  | Schlüssel-Präfix im Bucket, damit Tales Blobs sich einen Bucket mit anderen Daten teilen können. Leer heißt Bucket-Wurzel. |
| `OBJECT_STORE_PUBLIC_ENDPOINT`   | `${SITE_URL}` (die CLI setzt ihn) | Wo der **Browser** den Store erreicht. Der Proxy publiziert den gebündelten Store unter `/<bucket>/*` und leitet presignte URLs unverändert weiter, sodass Up- und Downloads direkt Browser↔Store laufen. Für einen Bucket, den der Browser ohnehin erreicht, lässt du ihn leer. |

Der mitgelieferte Proxy macht die Objektroute im Browser erreichbar, ohne den Verwaltungsport des Speichers zu veröffentlichen. Ein externer Speicher kann über seinen eigenen öffentlichen Endpunkt erreichbar sein.

### Wie diese Variablen im laufenden Deployment ankommen

Beim Start gleicht das Backend `default/object-storage/connection.json` mit seiner Umgebung ab. Erstelle `backend-api` und `backend-worker` mit den geänderten Werten neu. Die Startmeldungen unterscheiden diese Ergebnisse:

| Zeile | Bedeutung |
| --- | --- |
| `object store (seeded)` | es gab keine Verbindung; eine wurde aus der Umgebung geschrieben |
| `object store (reconciled)` | die Umgebung hat sich geändert; die Verbindung zieht nach |
| `object store (adopted)` | eine von einem älteren Release geschriebene Verbindung wurde erkannt und wird jetzt mitgeführt |
| `object store (ignored)` | die Verbindung trägt `"managedBy": "operator"`, diese Variablen tun also nichts |
| `object store (skipped)` | Keine Zugangsdaten für einen Bereitstellungsstandard vorhanden. Prüfe, ob eine nutzbare bestehende oder organisationsgebundene Verbindung bleibt. |
| *(nichts)* | schon im Gleichstand — der Normalfall |

Willst du den Store lieber von Hand führen, trag `"managedBy": "operator"` in `connection.json` ein; das Backend fasst die Datei dann nie wieder an. Eine Datei ganz ohne `managedBy` — vor diesem Verhalten geschrieben — übernimmt das Backend nur, wenn sie noch denselben Bucket am selben Endpoint nennt wie die Umgebung; hattest du sie von Hand umgebogen, bleibt deine Änderung stehen.

Bucket-Rechte: Das Backend prüft mit `HeadBucket`, ob der Bucket existiert, und legt ihn nur an, wenn nicht. Ein Schlüssel, der Objekte lesen, schreiben und löschen darf, aber keine Buckets anlegen, reicht also — solange du den Bucket selbst anlegst. Presignte Up- und Downloads laufen im Browser, ein externer Bucket braucht deshalb zusätzlich eine CORS-Policy, die den Origin deines Deployments mit `GET`, `PUT` und `HEAD` zulässt — siehe [Datenresidenz](/de/self-hosted/configuration/data-residency).

## Audit-Log-Signierung

Das aktuelle PostgreSQL-Backend prüft SHA-256-Hashes und die Verknüpfung der Audit-Zeilen, keine HMAC-signierten Prüfpunkte. Die CLI erzeugt und übernimmt die Signaturschlüssel-Variablen weiterhin aus Kompatibilitätsgründen. Ihr Vorhandensein belegt nicht, dass das aktuelle Backend die Historie signiert. Ein getrennter Pepper pseudonymisiert personenbezogene Daten fehlgeschlagener Anmeldungen.

| Name                              | Default                       | Beschreibung                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_SIGNING_KEY` | von `tale init` autogeneriert | Hex-Wert mit 64 Zeichen, den die CLI aus Kompatibilitätsgründen erzeugt und erhält. Bewahre bestehende Werte mit den Deployment-Geheimnissen auf. Die aktuelle PostgreSQL-Prüfung nutzt diesen Schlüssel nicht. |
| `TALE_AUDIT_SIGNING_KEY_PREVIOUS` | nicht gesetzt | Kompatibilitätsvariable für einen vorherigen Signaturschlüssel. Die aktuelle PostgreSQL-Prüfung nutzt sie nicht; das Setzen aktiviert keine Signaturprüfung. |
| `TALE_AUDIT_PEPPER` | von `tale init` autogeneriert | Mindestens 16 Zeichen für die Pseudonymisierung fehlgeschlagener Anmeldungen: HMAC-SHA256 aus E-Mail und gekürzter IP-Adresse. Ohne Wert enthalten diese Audit-Felder Klartext und das Backend warnt. Nach einer Rotation lassen sich neue Kennungen nicht mit früheren vergleichen. Die Aufbewahrung folgt der angewendeten Organisationsrichtlinie. |

Siehe [Audit-Log-Integrität](/de/self-hosted/operate/security/audit-log-integrity) für das Verifikationsmodell.

## Observability

| Name                        | Default | Beschreibung                                                                                                                                 |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry-DSN für Error-Tracking. Unset zum Deaktivieren. Kompatibel mit selbst gehostetem GlitchTip und Bugsink.                               |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optionale Sample-Rate für Performance-Traces im Browser (`0.0`–`1.0`). Nur Browser — das Backend meldet Fehler, nie Traces.                  |
| `METRICS_BEARER_TOKEN` | unset | Bearer-Token für die Proxy-Routen `/metrics/*`. Ohne konfigurierten Token antworten sie mit 401. Den Netzwerkzugriff auf interne Prozessendpunkte musst du gesondert beschränken. |

Mit `METRICS_BEARER_TOKEN` schützt der Proxy die Routen `/metrics/platform`, `/metrics/backend` und `/metrics/sla-rules`. [Überwachung einrichten](/de/self-hosted/configuration/observability-config) erklärt Inhalt und Grenzen der Messwerte.

## Provider-Secrets-Verschlüsselung

SOPS schützt unterstützte Geheimnisdateien der Konfiguration. Aktuelle Anbieterzugangsdaten in der Datenbank verwenden `ENCRYPTION_SECRET_HEX` aus dem Abschnitt zu Sicherheitsgeheimnissen.

| Name | Standard | Beschreibung |
| --- | --- | --- |
| `SOPS_AGE_KEY` | nicht gesetzt | Ein direkt gesetzter privater age-Schlüssel. Hat Vorrang vor der Schlüsseldatei. |
| `SOPS_AGE_KEY_FILE` | nicht gesetzt | Im lesenden Prozess erreichbarer Pfad mit einem oder mehreren privaten age-Schlüsseln, je einer pro Zeile. Binde die Datei in jeden benötigten Container ein. |

Ohne age-Schlüssel schreibt der SOPS-Helfer unterstützte Geheimnisdateien als Klartext mit Modus `0600`. Bereits verschlüsselte Dateien brauchen weiterhin ihren Schlüssel. Lies [Geheimnisse mit SOPS](/de/self-hosted/configuration/secrets-with-sops), bevor du eine der Variablen änderst.

Anbieterzugangsdaten können stattdessen eine Variable mit Präfix `TALE_PROVIDER_KEY_` und höchstens 40 Zeichen referenzieren. Zugangsdaten für Abonnement-Broker verwenden das getrennte Präfix `TALE_TOKEN_SOURCE_` mit höchstens 60 Zeichen. Diese Felder speichern Variablennamen, keine Geheimniswerte. Übergib Werte an die Backend-Prozesse und erstelle betroffene Container nach Änderungen neu. [Anbieter](/de/self-hosted/configuration/providers) beschreibt die Einrichtung.

## Connector-OAuth-Apps

OAuth-Connectoren (Gmail, Google Drive, Outlook, Teams, Slack, …) lösen ihre Vendor-App zuerst pro Organisation auf: Eine unter **Einstellungen > Connectors > OAuth-Apps** hinterlegte App gewinnt für diese Org. Die Umgebung liefert darunter den deployment-weiten Standard (und ist die einzige Quelle für Slack, dessen Event-Signaturprüfung läuft, bevor eine Org bekannt ist). Pro Connector-Slug:

| Name                                   | Default | Beschreibung                                                                                                   |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID`     | unset   | OAuth-Client-ID für diesen Connector. Slug großgeschrieben, Bindestriche als Unterstriche (`gmail` → `GMAIL`). |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` | unset   | Passendes Client-Secret.                                                                                       |
| `CONNECTOR_SLACK_SIGNING_SECRET`       | unset   | Das Signing-Secret der Slack-App. Der eingehende Events-Endpunkt prüft jede Zustellung damit und antwortet mit 503, solange es fehlt. |

Registriere `${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback` in der Vendor-App, für Slack zusätzlich `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` als Events Request URL. Details: [Connectors (Develop)](/de/develop/connectors).

## Knowledge-Cloud-Import (Dokumente)

Pro-Benutzer-Autorisierungen für OneDrive / Google Drive unter **Wissen → Dokumente** sind getrennt von Org-Connectors und vom Login. Auch hier hat eine unter **Einstellungen > Connectors > OAuth-Apps** hinterlegte Org-App Vorrang — der **google-drive**-Eintrag wird mit der Connector-Bahn geteilt, **OneDrive / SharePoint (Wissens-Import)** hat einen eigenen Eintrag; die Ketten unten greifen überall dort, wo die Org keine hinterlegt hat. Registriere diese Redirect-URI in der Microsoft- (oder Google-)App:

`${SITE_URL}${BASE_PATH}/api/cloud-import/oauth2/callback`

Credential-Auflösung für OneDrive (erster Treffer gewinnt):

| Name                                           | Beschreibung                             |
| ---------------------------------------------- | ---------------------------------------- |
| `CLOUD_IMPORT_MICROSOFT_CLIENT_ID` / `_SECRET` | Eigene Knowledge-Import-App (bevorzugt). |
| `CLOUD_IMPORT_MICROSOFT_TENANT_ID`             | Directory-(Tenant-)ID für diese App.     |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`       | Microsoft-Login-App.                     |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`            | Directory-(Tenant-)ID für die Login-App. |

Single-Tenant-Entra-App-Registrierungen brauchen eine tenant-spezifische Authorize-URL — `/common` scheitert mit AADSTS50194. Setze die Tenant-ID (oder `organizations` / `common` für eine Multi-Tenant-App). Fehlt sie, fällt Tale auf den Entra-SSO-Issuer-Tenant der Organisation zurück, falls konfiguriert.

Der Microsoft-Freigabe-Dialog fordert Graph **Files.Read** und **Sites.Read.All** (OneDrive und SharePoint listen/laden), **User.Read** (Konto-Label) und **offline_access** (Refresh-Token für Sync). Die Freigabe ist absichtlich und pro Benutzer — sie kommt nicht mit der Tale-Anmeldung.

Google Drive nutzt nur eine eigene App (kein Login-App-Fallback):

| Name                                              | Beschreibung                       |
| ------------------------------------------------- | ---------------------------------- |
| `CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | Knowledge-Google-Drive-Import-App. |

Registriere dieselbe Cloud-Import-Callback-URI am Google-OAuth-Client. Die Freigabe fordert **drive.readonly** und **userinfo.email**.

## Feature-Flags

Diese Variablen steuern Backend-Anmeldung, Datei-Ereignisse und Betreiberrechte. Erstelle die betroffenen Backend-Rollen nach einer Umgebungsänderung neu. Nur den Webcontainer zu ändern reicht nicht aus.

| Name                              | Default                  | Beschreibung                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | `false`                  | Aktiviert den Trusted-Headers-Auth-Modus (Identität vom Reverse-Proxy geliefert).                                                                                                                                                            |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | nicht gesetzt            | Shared Secret, das der authentifizierende Proxy mit jeder Trusted-Headers-Anfrage schicken muss. Pflicht, sobald der Modus an ist — ohne Secret verweigert der Endpunkt den Dienst.                                                          |
| `TRUSTED_SECRET_HEADER`           | `Remote-Internal-Secret` | Name des Request-Headers, der das interne Secret trägt.                                                                                                                                                                                      |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email`           | Name des Request-Headers mit der E-Mail-Adresse des Benutzers — die Identität, für die die Session ausgestellt wird.                                                                                                                         |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`            | Name des Request-Headers mit dem Anzeigenamen. Fehlt er, nimmt Tale den lokalen Teil der E-Mail-Adresse.                                                                                                                                     |
| `TRUSTED_ROLE_HEADER`             | `Remote-Role`            | Name des Request-Headers mit der Organisationsrolle, mit der die Session handelt (`member`, wenn der Header fehlt).                                                                                                                          |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams`           | Name des Request-Headers mit den Team-Zugehörigkeiten als kommagetrennte `id:name`-Einträge. Fehlt er, bleiben Teams unangetastet; ist er gesetzt, gilt die Liste des Proxys für die von ihm vergebenen Zugehörigkeiten (leer entzieht sie). |
| `TALE_FILE_EVENTS`                | `false`                  | Streamt Änderungen an Config-Dateien unter `TALE_CONFIG_DIR` an offene Browser-Tabs (`/events/file`): Eine auf der Platte bearbeitete Agent-, Skill- oder Branding-Datei erscheint ohne Reload. Im Dev-Compose an, in Produktion aus.        |
| `TALE_DEPLOYMENT_CONFIG_ADMINS`   | unset                    | Kommagetrennte E-Mail-Allowlist der Operatoren, die die Deployment-Konfigurationsdatei (`deployment.yml`, heute der Abschnitt zur Sandbox-Runtime) über die API schreiben dürfen. Leer/nicht gesetzt = nur lesend für alle Admins. Die Datenresidenz wird pro Organisation konfiguriert und hängt nicht an dieser Liste. |
| `TALE_ALLOW_PRIVATE_CRAWL_HOSTS`  | unset                    | Erlaubt, dass ein Crawl-Ziel (`POST /api/v1/websites` und jeder Abruf des Crawlers) einen Loopback-, Link-Local- oder Privatnetz-Host nennt (RFC 1918, CGNAT, ULA, `.internal`, `.local`, einteilige Namen). Nicht gesetzt, antwortet ein solches Ziel mit **400** `WEBSITE_DOMAIN_NOT_CRAWLABLE` — der Crawler wählt aus dem eigenen Netz des Deployments heraus. Setz die Variable nur auf `1`, wenn das Deployment sein eigenes Intranet crawlt; die Cloud-Metadaten-Endpoints bleiben in jedem Fall gesperrt. |

## RAG-Retrieval-Tuning

Diese optionalen `RAG_`-Variablen steuern Wissenssuche und Neubewertung durch den Cross-Encoder. Die Backend-Prozesse lesen sie beim Start. Erstelle nach einer Änderung der Bereitstellungsumgebung die betroffenen Backend-Container neu; `docker compose restart` behält ihre bisherige Umgebung.

| Name                         | Default                                | Beschreibung                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED` | `false` | Aktiviert die erneute Bewertung zusammengeführter BM25- und Vektortreffer. Konfiguriere zusätzlich den API-Anbieter unten. Miss Relevanz und zusätzliche Antwortzeit mit deinem Korpus. |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Cross-Encoder-Modellkennung, die an den Rerank-Provider übergeben wird.                                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Muss auf `api` gesetzt sein, um Re-Ranking zu aktivieren — es schickt die Kandidaten an einen externen `/rerank`-Endpoint (Cohere/Jina-kompatibel). `local` wird nicht mehr unterstützt und scheitert sofort. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Maximale Anzahl Ergebnisse, die der Reranker zurückgibt. Die Antwort übersteigt nie das `top_k` der Anfrage.                                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Grösse des Kandidaten-Pools für den Reranker. Ein breiterer Pool verbessert die Neubewertung und kostet proportional mehr Zeit pro Query.                                                                     |
| `RAG_RERANKING_API_BASE_URL` | unset                                  | Basis-URL für den Rerank-Provider; das Backend ruft `{base_url}/rerank` auf. Pflicht, wenn Re-Ranking aktiviert ist.                                                                                          |
| `RAG_RERANKING_API_KEY`      | unset                                  | Bearer-Token für den externen Rerank-Endpoint. Unset lassen für unauthentifizierte Endpoints.                                                                                                                 |

Re-Ranking ist standardmäßig deaktiviert. Setze zum Aktivieren `RAG_RERANKING_ENABLED=true`, `RAG_RERANKING_PROVIDER=api` und eine gültige `RAG_RERANKING_API_BASE_URL`; ergänze bei Bedarf Zugangsdaten. Das Backend führt kein lokales Re-Ranking-Modell aus. Vergleiche Ergebnisse und Antwortzeit vor der Freigabe.

## Deployment-Topologie

Diese Werte bestimmen Replikate je Anwendungsrolle eines Workspace-Deployments. `tale deploy` liest sie aus der Projektumgebung und begrenzt Werte mit einer Warnung auf den unterstützten Bereich.

| Name                           | Default | Beschreibung                                                                                             |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas des Web-Tiers, der die App-Shell ausliefert. Bereich `1`–`16`.                                    |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas der API — jede Anwendungstür, Auth und der Hint-Stream. Bereich `1`–`16`.                         |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas des Job-Runners: Ingest, Crawls, Automations, Agent-Turns. Bereich `1`–`16`.                      |

Bei einem Workspace-Deployment laufen vorübergehend beide Farben. Plane Kapazität für diese Überschneidung. Erhöhe die Rolle, deren gemessene Last den Engpass bildet. Mehr Replikate brauchen auch mehr Datenbankverbindungen und Arbeitsspeicher. Siehe [Upgrades](/de/self-hosted/operate/upgrades).

## Sitzungen

| Name                           | Default | Beschreibung                                                                                                                                                                                                                     |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Meldet eine Sitzung nach so vielen Minuten Inaktivität ab (`1`–`1440`). Das Fenster verschiebt sich bei Aktivität und wird serverseitig durchgesetzt — über E-Mail-/Passwort-, SSO- und Trusted-Headers-Sitzungen. |

Ohne Wert gilt die normale Sitzungsdauer. Mit gesetztem Limit läuft eine inaktive Sitzung serverseitig ab; Aktivität verschiebt das Fenster. Organisationsadmins können es über die [Richtlinie zur Sitzungsinaktivität](/de/platform/admin/governance/policies-and-limits) weiter verkürzen. Die zugehörige Bereinigung läuft ungefähr alle fünf Minuten.

## Sandbox-Infrastruktur {#sandbox-infrastructure}

Der Sandbox-Spawner liest die folgenden Einstellungen. Übergib sie seiner Umgebung und erstelle den Dienst nach einer Änderung neu. `SANDBOX_MAX_SESSIONS` legt die gemeinsame Kapazität aller Organisationen fest. Die drei Arbeitslimits einer Organisation ergeben automatisch ihre Gesamtsumme; liegt sie über dieser Kapazität, kannst du die Limits nicht speichern. Unter [Sandboxes](/de/platform/admin/sandboxes) verwaltest du die Limits und siehst tatsächliche Laufzeitzahlen und Host-Messwerte getrennt von der Kontingentbelegung.

| Name | Default | Beschreibung |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | `8` | Höchstzahl laufender und startender Sessions aller Organisationen auf dem Docker-Host oder im Kubernetes-Namespace, einschließlich weiterlaufender Container im Leerlauf. Die Kapazität reserviert weder CPU noch Arbeitsspeicher. Gleichzeitige Kubernetes-Replikate setzen sie nach bestem Bemühen durch; harte Ressourcengrenzen im Namespace setzt du mit ResourceQuota. |
| `SANDBOX_AGENT_CPUS` | `2` | CPU-Grenze je Agent-Session. Berücksichtige bei der Session-Anzahl gleichzeitig laufende Builds und andere Aufgaben auf dem Host. |
| `SANDBOX_AGENT_MEMORY` | `4g`; `8g` mit Docker in der Sandbox | Speichergrenze je Agent-Session, die auch für ihren inneren Docker-Daemon und dessen Container gilt. Ein expliziter Wert ersetzt beide Standardwerte und gilt für neu erstellte Sessions. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 Min.) | Leerlauffenster, nach dem nicht angepinnte Sessions stoppen. Die Build-Cache-Hilfscontainer einer Organisation stoppen ebenfalls nach diesem Fenster ohne möglicherweise aktive Session; Netzwerke und Cache-Volumes bleiben erhalten. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optional, vom Spawner gelesen.** Das Image, aus dem jeder Session-Container entsteht. Der Default ist der Tag, den der Entwicklungs-Stack lokal baut; ein Host, der seine Images zieht, setzt deshalb den Registry-Namen: `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, passend zum Rest des Stacks. `tale deploy` setzt ihn für dich. |
| `SANDBOX_DIND_INNER_POOL` | nicht gesetzt (automatisch) | Optionaler Adresspool für den inneren Docker-Daemon in Agent-Sessions auf Docker oder Kubernetes. Verwende ein kanonisches privates IPv4-`/16` nach RFC1918 außerhalb deiner Pod-, Service- und VPC-Netze. Die Runtime lehnt Überschneidungen mit erkannten Netzen und Adressen ab. |

Bei voller Kapazität kann der Spawner eine freigegebene, nicht angepinnte Session im Leerlauf schon vor Ablauf des Leerlauffensters stoppen, um neue Arbeit zuzulassen. Der Daemon muss bestätigen, dass keine Arbeit läuft; beschäftigte Sessions und Sessions mit unbekanntem Zustand bleiben geschützt. Das dauerhafte Arbeitsverzeichnis oder Volume bleibt beim Stoppen erhalten. Lässt sich keine Session sicher freigeben, blockiert die Kapazitätsgrenze weiterhin neue Starts.

### Session-Kapazität bemessen

Beginne mit 8 und teste die Aufgaben, die deine Bereitstellung gleichzeitig ausführen soll. Browser-Rendering und Docker-Builds haben unterschiedliche Lastspitzen; berücksichtige Agents, Workflows und Crawling aller Organisationen. Ein freier Session-Platz garantiert keine ausreichenden Ressourcen. Der Spawner passt diese Einstellung nicht automatisch an den Host-Speicher an.

Miss unter Docker den Ressourcenbedarf, während typische Aufgaben gleichzeitig laufen. Wiederhole diesen Befehl während des Durchlaufs; eine Messung im Leerlauf zeigt keine Lastspitzen:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

Ziehe den Bedarf von Betriebssystem, Plattformdiensten, Datenbanken und Build-Cache-Hilfscontainern sowie eine Sicherheitsreserve vom Host-Speicher ab. Teile den verbleibenden Speicher durch den gemessenen Spitzenbedarf je aktiver Session und runde ab. Beispiel: Ein Host mit 32 GiB, davon 8 GiB für Dienste und Reserve, und einem gemessenen Spitzenbedarf von 3 GiB je Session ergibt `(32 - 8) / 3 = 8` Sessions. Das ist ein Rechenbeispiel, kein Benchmark. Bei gemischten Aufgaben addierst du die gleichzeitig auftretenden Spitzen. Prüfe außerdem CPU-Auslastung und Aufgabendauer, bevor du die Grenze erhöhst.

Die 4 GiB oder 8 GiB eines Agents sind eine Speicherobergrenze; beim Start reserviert er diesen Speicher nicht. Acht Agents mit laufenden Docker-Builds können daher deutlich mehr Speicher benötigen als acht überwiegend untätige Sessions. Miss unter typischer Last und halte Reserven frei. Erhöhe die Kapazität erst auf 16 oder mehr, wenn der Host die Last dauerhaft trägt. Verringere vor einer Absenkung alle Organisationssummen, die über dem neuen Wert liegen. Die Standardlimits einer Organisation ergeben 6; eine kleinere Bereitstellungskapazität braucht entsprechend kleinere Organisationslimits.

### Eine Kapazitätsänderung anwenden

Ergänze oder ändere diese Zeile in der `.env` deiner Bereitstellung. Behalte die übrigen Einträge bei. Explizite Werte gelten auch nach Upgrades weiter; der Standardwert 8 greift, wenn die Variable fehlt.

```dotenv .env
SANDBOX_MAX_SESSIONS=8
```

Erstelle bei einem selbst verwalteten Compose-Stack nur den Sandbox-Dienst mit seinem vorhandenen lokalen Image neu:

```bash
docker compose up -d --no-deps --no-build --pull never sandbox
```

Verwende dasselbe Projekt, dieselben `-f`-Dateien und dieselben Optionen für Umgebungsdateien wie beim laufenden Stack. Ein Neustart allein lädt eine geänderte `.env` nicht. Für CLI-verwaltete Installationen folgst du dem Deployment-Ablauf unter [Upgrades](/de/self-hosted/operate/upgrades). Setze unter Kubernetes die Variable im Deployment des Sandbox-Spawners und führe dessen Rollout aus.

Prüfe die neue Bereitstellungskapazität unter [Sandboxes](/de/platform/admin/sandboxes). Bei Organisationslimits von 2/2/2 und einer Kapazität von 8 zeigt die Summe **6 / 8**. Bestehende Organisationseinstellungen bleiben erhalten; zum Speichern muss ihre Summe weiterhin in die aktuelle Kapazität passen. Die Kapazitätsänderung erhöht keine CPU- oder Speichergrenze eines Containers.

### Nach einem Upgrade

Die Standardkapazität lag bisher bei 16, und Organisationen aus früheren Versionen wurden mit den Limits 2/4/4 angelegt, also einer Summe von 10. Eine Bereitstellung, die `SANDBOX_MAX_SESSIONS` nie gesetzt hat, startet mit der neuen Version daher mit einer Kapazität von 8 und Organisationen, deren gespeicherte Summe darüber liegt. Laufende Arbeit ist davon nicht betroffen, und jede Organisation lässt weiterhin Arbeit unter ihren gespeicherten Limits zu; nur das Speichern der Sandbox-Seite bleibt gesperrt, bis die Summe passt, und niedrigere Limits lassen sich weiterhin speichern. Setze entweder `SANDBOX_MAX_SESSIONS=16` explizit, um die bisherige Kapazität zu behalten, oder bitte jede betroffene Organisation, ein Limit zu verringern.

### Docker-Build-Caches

Docker-Build-Caches sind nach Organisation getrennt. Jede Organisation nutzt einen privilegierten Builder und drei Registry-Mirrors ohne erhöhte Rechte. Sobald keine Session mehr auf sie zugreifen könnte, beginnt das Leerlauffenster; danach stoppen die Hilfscontainer. Der nächste Build startet sie mit ihren erhaltenen Cache-Volumes neu. Netzwerke und Volumes bleiben für die Wiederverwendung bestehen. Kubernetes-Sessions nutzen ihren eigenen inneren Docker-Builder; der Kubernetes-Abgleich ruft für diese Hilfscontainer keine Docker-CLI auf.

Der Spawner füllt den ersten verfügbaren Docker-Adresspool mit Organisationsnetzwerken, bevor er zum nächsten wechselt. Standardmäßig erhält jedes Netzwerk ein `/23` mit 512 Adressen; ein ansonsten freies `/16` bietet damit Platz für 128 Organisationsnetzwerke. Kleinere in Docker konfigurierte Subnetze bleiben kleiner. Der Spawner schließt vorhandene Docker-Netzwerke, Routen und DNS-Serveradressen auf dem Host des Docker-Daemons sowie `172.31.0.0/16` für ältere Runtime-Images aus und prüft anschließend das angelegte Netzwerk.

Auch bei einem entfernten Docker-Daemon erfasst der Spawner dessen Host über einen kurzlebigen Container aus dem konfigurierten BuildKit-Image. Dieser läuft im Host-Netzwerk-Namespace mit schreibgeschütztem Dateisystem, ohne Capabilities und ohne Mounts. Scheitert diese Abfrage oder bleibt kein sicheres Subnetz frei, bauen Sessions lokal ohne gemeinsamen Cache. Ein ungenutztes eigenes Netzwerk mit ungültigem Subnetz legt der Spawner neu an; belegte und fremde Netzwerke bleiben erhalten.

Beim Upgrade entstehen leere Organisationscaches; die alten globalen Cachedaten bleiben erhalten. Alte Hilfscontainer stoppen automatisch, sobald keine laufende Session mehr auf sie angewiesen ist. Lass alte angepinnte Sessions auslaufen oder stoppe sie, um den Übergang abzuschließen; bis dahin bleibt der alte gemeinsame Cachedienst erreichbar. Browserautomatisierung nutzt Chromium ohne grafische Oberfläche. Die Live-Ansicht und manuelle Browserübernahme sind entfernt.

### Innere Docker-Netzwerke

Die automatische Auswahl prüft unter Docker und Kubernetes IPv4-Routen und Gateways aus allen Routingtabellen, Adressen und Präfixe der Schnittstellen, DNS-Server sowie die aufgelösten Adressen der beim Containerstart konfigurierten Proxy- und Gateway-Hosts. Hosts, die erst während eines Agent-Turns übergeben werden, fehlen in dieser anfänglichen Erfassung. Ein später angeschlossenes Docker-Organisationsnetzwerk berücksichtigt sie ebenfalls. Die Runtime bevorzugt ein freies `172.31.0.0/16` und prüft danach andere private `/16`-Bereiche. Das erste `/24` gehört zu `docker0`; innere Compose-Netzwerke erhalten `/24`-Blöcke aus demselben Pool. Im automatischen Modus startet die Session nicht, wenn Abfragen scheitern oder kein privater Bereich frei bleibt.

Aus seinem eigenen Netzwerk-Namespace kennt ein Pod nicht die vollständigen Pod-, Service- und VPC-CIDRs des Clusters. Setze für DinD auf Kubernetes `SANDBOX_DIND_INNER_POOL` auf ein privates `/16`, das du gegen all diese Netze geprüft hast. Auch ein vorgegebener Pool scheitert bei jeder erkannten Überschneidung oder einem ungültigen Wert. Bleiben einzelne Abfragen ohne Ergebnis, nennt die Runtime sie in einer Warnung und kann mit dem vorgegebenen Pool fortfahren. Den nicht sichtbaren Adressraum musst du selbst berücksichtigen.

Starte nach einer Änderung dieses Pools den Spawner neu und erstelle bestehende Sessions neu, damit sie den Wert übernehmen. Ein Runner-Neustart innerhalb desselben Kubernetes-Pods behält dessen Umgebung und den inneren Docker-Speicher bei.

Der Egress-Proxy erlaubt DNS-Anfragen an die geprüften Nameserver-IP-Adressen aus seiner `/etc/resolv.conf`, auch an einen privaten Cluster-DNS-Dienst. Jede Ausnahme gilt nur für diese eine IP und den UDP-/TCP-Zielport 53. Andere private Ziele und die Weiterleitung zwischen angeschlossenen Netzwerken bleiben gesperrt.

### IPv6-Weiterleitungsschutz

Halte `sandbox`, `sandbox-egress` und `SANDBOX_RUNTIME_IMAGE` beim Upgrade auf demselben Release. Bevor der Spawner unter Docker das Build-Netzwerk einer Organisation anschließt, prüft er den Weiterleitungsschutz der Session. Compose und generierte Docker-Session-Container deaktivieren IPv6 mit `net.ipv6.conf.all.disable_ipv6=1` und `net.ipv6.conf.default.disable_ipv6=1`. Übernimm beide Werte in eigene Docker-Definitionen.

Kubernetes-Pods erhalten nicht automatisch unsichere Sysctls. Der Egress-Proxy braucht eine funktionierende IPv6-Firewall oder deaktiviertes IPv6 in seinem Netzwerk-Namespace. Ist die IPv6-Firewall nicht verfügbar, versucht der Entrypoint IPv6 dort zu deaktivieren und prüft danach den Standardwert und jede Schnittstelle. Ein schreibgeschütztes `/proc/sys` oder fehlende Schreibrechte können das verhindern; ohne Schutz für weiterhin aktives IPv6 startet der Proxy nicht. Konfiguriere den Egress-Pod vor dem Deployment mit den Netzwerkeinstellungen, die dein Cluster erlaubt.

## Sandbox-Agent-Turns

| Name                             | Default              | Beschreibung                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 Min.)  | **Optional.** Wie lange ein Coding-Agent-Turn in der Sandbox (Claude Code, OpenCode, Codex) ohne Abnehmer seiner Ausgabe liegen darf, bevor der Sandbox-Daemon ihn abräumt. Ein gleitendes Fenster, das bei jedem Wiederanbinden der Plattform neu startet — keine absolute Obergrenze für den Turn. Millisekunden. |

Untersuche zuerst, warum die Ausgabe nicht mehr gelesen wird. Die Frist begrenzt verwaiste Ausgabeströme, nicht die gesamte Aufgabendauer. Erstelle die betroffenen Backend-Rollen nach einer Umgebungsänderung neu.

## Video-Link-Ingestion (yt-dlp)

Der Worker verwendet diese Werte zum Abrufen von Videotranskripten. Sein Image enthält yt-dlp und ein PO-Token-Plugin. [Video-Import](/de/self-hosted/configuration/video-ingestion) hilft bei Quellenbeschränkungen, Egress-Problemen und berechtigten Sitzungen. Erstelle den Worker nach Änderungen seiner Umgebung neu. Erneutes Lesen einer Prozessvariablen lädt `.env` nicht nach.

| Name                             | Standard                                     | Beschreibung                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL` | nicht gesetzt | Proxy für yt-dlp-Anfragen. Unterstützte Protokolle: `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h`; das letzte löst Zielnamen am Proxy auf. Nutze einen freigegebenen Egress-Dienst. |
| `VIDEO_INGEST_POT_PROVIDER_URL` | `http://bgutil-provider:4416` (eingebacken) | URL des PO-Token-Anbieters. Bei vorhandenem Image-Plugin gilt der mitgelieferte Sidecar als Standard. Token können den Abruf unterstützen, geben aber keinen Zugriff auf private Inhalte und garantieren keinen Erfolg. |
| `VIDEO_INGEST_FETCH_POT` | `always`, sobald ein Provider angebunden ist | Zeitpunkt des Token-Abrufs: `never`, `auto` oder `always`. Mit mitgeliefertem Anbieter gilt `always`. Verwende `never`, wenn du diesen Token-Abruf bewusst deaktivierst. |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (eingebacken)          | Verzeichnis, aus dem yt-dlp Plugins lädt — jedes Plugin eine Ebene tiefer verschachtelt (`<dir>/<name>/yt_dlp_plugins/…`). Standardmäßig das eingebackene bgutil-Plugin-Verzeichnis, wenn vorhanden; nur überschreiben, um eigene Plugins zu ergänzen.                                                                                                              |
| `VIDEO_INGEST_COOKIES_FILE` | nicht gesetzt | Pfad im Worker zu einer Netscape-Cookiedatei. Schütze sie wie Kontozugangsdaten und verwende nur eine berechtigte Sitzung. Der organisationsgebundene Sitzungspool in der Video-Anleitung unterstützt verwalteten Import und Widerruf. |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                          | Kommagetrennte Fallback-Liste der YouTube-Player-Clients. Mit angebundenem PO-Token-Provider erweitert sich der Standard auf `default,mweb,tv_simply` (mweb benötigt ein GVS-Token); explizit setzen, um eine Liste zu erzwingen.                                                                                                                                   |
| `VIDEO_INGEST_PO_TOKEN`          | nicht gesetzt                                | Manuell gesetztes PO-Token (`CLIENT.CONTEXT+TOKEN`). Vor allem zum Testen — Tokens sind an die Video-ID gebunden und kurzlebig; den Provider bevorzugen.                                                                                                                                                                                                            |
| `VIDEO_INGEST_IMPERSONATE`       | nicht gesetzt                                | Ziel für Browser-TLS/JA3-Imitation (z. B. `safari`). Erfordert `curl_cffi` im Image; nicht setzen, sofern nicht verfügbar.                                                                                                                                                                                                                                          |
| `VIDEO_INGEST_BIN_DIR`           | nicht gesetzt                                | Verzeichnis, das dem `PATH` des yt-dlp/ffmpeg-Kindprozesses vorangestellt wird, damit ein selbst bereitgestelltes `yt-dlp` (samt Deno-Runtime) außerhalb der eingebackenen Bin-Verzeichnisse zuerst gefunden wird. Das Backend-Image backt yt-dlp in den `PATH` ein, dort also nicht gesetzt lassen; auf einem Host- oder Dev-Rechner mit eigener Toolchain setzen. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                            | Absoluter Pfad zu dem ffmpeg, das yt-dlp für die Nachbearbeitung nutzt (Untertitel-Konvertierung, Audio-Extraktion). Überschreiben, wenn ffmpeg woanders liegt — z. B. Homebrews `/opt/homebrew/bin/ffmpeg` auf einem macOS-Dev-Rechner.                                                                                                                            |
