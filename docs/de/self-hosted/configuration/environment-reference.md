---
title: Umgebungsvariablen-Referenz
description: Jede Umgebungsvariable, die Tale beim Boot liest, der Default und die Oberfläche im Produkt, die sie steuert. Die vollständige Operator-Referenz für `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale liest seine Konfiguration aus einer einzigen `.env`-Datei im Repo-Stammverzeichnis. Etwa ein Dutzend Variablen sind beim ersten Boot Pflicht; der Rest stimmt das Verhalten ab. Diese Seite listet jede Variable, die [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) mitbringt, was sie als Default hat und welche Oberfläche im Produkt sie konsumiert.

Gruppen sind danach geordnet, wann du sie zuerst brauchst: Domain-Identität, TLS, Secrets, Datenbank, Instanz, Observability, Provider-Verschlüsselung. Ändert sich der Wert einer Variable, starte die Services neu, die sie lesen (`docker compose restart platform backend-api backend-worker`), damit sie wirkt.

## Wie du diese Seite liest

Jede Gruppe ist eine `Name | Default | Beschreibung`-Tabelle. Variablen, die als **Pflicht** markiert sind, müssen gesetzt sein, damit `docker compose up` erfolgreich ist. **Optionale** Variablen können unset bleiben; die Beschreibung benennt, was das Deaktivieren des Features bedeutet.

Die `.env.example`-Datei bringt Inline-Kommentare mit, die jede Variable im Kontext erklären; diese Seite ist die strukturierte, gruppierte Referenz für dieselbe Menge.

## Domain-Identität (Pflicht beim ersten Boot)

| Name        | Default             | Beschreibung                                                                                                                   |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HOST`      | `localhost`         | **Pflicht.** Hostname ohne Protokoll. Wird für Docker-Networking und ausgehende Mails verwendet.                               |
| `SITE_URL`  | `https://localhost` | **Pflicht.** Vollständige kanonische URL inklusive Schema und Port. Auth-Callbacks und externe Links nutzen das.               |
| `ADDITIONAL_SITE_URLS` | unset    | **Optional.** Weitere Origins, auf denen dasselbe Deployment antwortet, per Komma oder Leerzeichen getrennt (z. B. `https://a.example,https://b.example`). Jeder ist ein vollwertiger Eingang. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains#mehrere-domains-gleichzeitig). |
| `BASE_PATH` | unset               | **Optional.** Pfad-Präfix für Subpath-Deployments hinter einem Reverse-Proxy (z. B. `/app`). Bei Root-Deployment unset lassen. |

Die `SITE_URL` muss exakt mit dem übereinstimmen, was der Benutzer im Browser eingibt. Ein nachgestellter Slash, ein fehlender Port oder `http` statt `https` brechen den Auth-Callback und produzieren Sign-in-Schleifen. Bedient ein Deployment mehrere Domains, bleibt `SITE_URL` die kanonische und der Rest kommt in `ADDITIONAL_SITE_URLS`; ein Eintrag dort muss ein blanker Origin sein, und ein fehlerhafter stoppt das Backend beim Boot, statt eine Domain zu hinterlassen, auf der sich niemand anmelden kann.

## TLS

| Name        | Default      | Beschreibung                                                                                                               |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Einer von `selfsigned`, `letsencrypt`, `external`. Siehe [TLS und Domains](/de/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | unset        | Kontakt-E-Mail für Let's-Encrypt-Benachrichtigungen. Optional aber empfohlen in Produktion.                                |

`selfsigned` lässt Caddy mit einem generierten Cert laufen — der Browser warnt, in Ordnung für Development. `letsencrypt` braucht eine echte Domain und Ports 80/443 vom öffentlichen Internet erreichbar. `external` lässt Caddy nur HTTP servieren; ein vorgelagerter Reverse-Proxy terminiert TLS.

## Sicherheits-Secrets (Pflicht)

| Name                    | Default                   | Beschreibung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`    | Beispielwert in der Datei | **Pflicht.** Base64-Secret für den Better-Auth-Session-Signer. Generier mit `openssl rand -base64 32`. Rotieren invalidiert jede Session.                                                                                                                                                                                                                                                                                                                                                                    |
| `ENCRYPTION_SECRET_HEX` | Beispielwert in der Datei | **Pflicht.** 32-Byte-Hex-Schlüssel. AES-256-Schlüssel für OAuth- und Connector-Credentials und HKDF-Input für die Guardrails-Secret-Box. Generier mit `openssl rand -hex 32`. Rotieren invalidiert jeden DB-Ciphertext; Operator müssen betroffene Secrets neu eingeben.                                                                                                                                                                                                                                     |
| `INSTANCE_SECRET`       | Beispielwert in der Datei | **Pflicht.** Das Root-Secret der Instanz: 64 Hex-Zeichen, `tale init` erzeugt es (von Hand: `openssl rand -hex 32`). Beim Boot leitet Tale daraus den WebDAV-App-Passwort-HMAC-Schlüssel (`WEBDAV_APP_PASSWORD_HMAC_KEY`) ab, sofern du den nicht selbst setzt; auch die kurzlebigen Tokens, mit denen Sandbox-Sessions Blobs holen, signiert ein Unterschlüssel derselben Ableitung. Halte ihn über Deploys stabil: Eine Rotation leitet den Schlüssel neu ab und macht jedes WebDAV-App-Passwort ungültig. |
| `SANDBOX_TOKEN`         | Beispielwert in der Datei | **Pflicht.** Gemeinsames HMAC-Secret zwischen Backend und Sandbox-Spawner: Das Backend signiert damit jeden Spawner-Aufruf, der Spawner weist unsignierte ab. Ohne das Secret startet der Spawner nicht — er hält den Docker-Socket des Hosts, es gibt also keinen unsignierten Modus. `tale init` und `bun run dev` erzeugen es; ein Stack, den du selbst zusammenstellst, setzt es vor dem ersten Boot (`openssl rand -hex 32`). Eine Rotation heißt: Backend und Spawner zusammen neu starten — sie müssen übereinstimmen. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | nicht gesetzt | **Pflicht für Agent-Runs.** Admin-Credential für die Management-API des Sandbox-LLM-Gateways, über die das Backend den session-scoped Virtual Key erzeugt, auf dem jeder Harness-Turn läuft. Das Gateway hängt mit im Sandbox-Netz, deshalb bleibt seine Management-Ebene nie anonym: ohne das Secret verweigert das Backend den Aufruf, und jeder Agent-Run scheitert schon am Start. `tale init` / `tale deploy` und `bun run dev` erzeugen es; ein Stack, den du selbst zusammenstellst, setzt es vor dem ersten Boot (`openssl rand -hex 32`). Nur das Backend liest es — das Gateway bekommt das Credential beim ersten Provisioning-Aufruf über seine Management-API und braucht keine eigene Env-Variable. Halt es stabil — das Gateway hasht es in `llm-gateway-data`, ein geänderter Wert sperrt die Plattform also aus, bis dieses Volume gelöscht ist. Der Username ist per Default `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Ersetze die Werte, die in `.env.example` mitkommen, bevor du die Instanz exponierst — sie sind absichtlich unsichere Platzhalter.

## Datenbank

Tale hält zwei Datenbanken: den operativen Speicher (`tale_app` — Agents, Runs, das Audit-Log) und den Wissens-Korpus (`tale_knowledge` — Dokument-Chunks, Embeddings, gecrawlte Seiten). Ein Produktions-Stack faltet beide in einen ParadeDB-Service (`db`, Port 5432, aliasiert `knowledge-db`). Beide teilen sich `DB_PASSWORD`, und der Korpus lässt sich für sich auf externe Infrastruktur zeigen.

| Name                                      | Default                                                             | Beschreibung                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`                             | `tale_password_change_me`                                           | **Pflicht.** Passwort für den selbst gehosteten Postgres-Benutzer. Vor der Produktion ändern. Von beiden Datenbank-Containern genutzt.                                                                                                                                                                                          |
| `DATABASE_URL`                            | aus `DB_PASSWORD` konstruiert                                       | **Optional.** Verbindungs-URL der operativen Datenbank. Setz sie, um das Backend auf einen Postgres zu richten, den du selbst betreibst: er braucht keine Extensions und keinen Superuser, nur eine Datenbank und eine Rolle, die Schemata anlegen darf. Wird bei jedem Start gelesen. |
| `DATABASE_POOL_MAX`                       | `10`                                                                | **Optional.** Verbindungen, die ein Backend-Prozess zur operativen Datenbank öffnet. Jede Replik von `backend-api` und `backend-worker` kostet das doppelt — einmal der App-Pool, einmal die Job-Queue. Diese Zahl prüfst du gegen `max_connections` eines verwalteten Postgres. |
| `POSTGRES_CA_FILE`                        | nicht gesetzt                                                       | **Optional.** Pfad zu einem PEM-Bundle, dem **jede** Postgres-Verbindung vertraut: operative Datenbank, Wissens-Korpus und die Datenbanken, die Organisationen selbst mitbringen. Nötig, sobald eine URL `sslmode=verify-ca` oder `verify-full` gegen einen Anbieter verlangt, dessen Root Node nicht mitliefert — Amazon RDS ist der übliche Fall. Nutzen mehrere Datenbanken verschiedene Anbieter, häng ihre Roots in einer Datei aneinander. |
| `KNOWLEDGE_DATABASE_URL`                  | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | **Optional.** Verbindungs-URL, die das Backend für den Wissens-Korpus nutzt. Überschreib sie, um den Korpus auf dein eigenes verwaltetes ParadeDB zu verlagern — der datenresidenz-sensible Speicher wandert unabhängig.                                                                                                        |
| `KNOWLEDGE_DB_NAME`                       | `tale_knowledge`                                                    | **Optional.** Name der Wissensdatenbank. Der mitgelieferte `knowledge-db`-Container erstellt diese Datenbank beim ersten Boot.                                                                                                                                                                                                  |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optional.** Größter BM25-Suchindex (in Bytes), den das Backend beim Start synchron neu aufbaut, wenn es ihn beschädigt vorfindet; einen größeren baut ein Hintergrundjob neu auf, während Schreibzugriffe auf diesen Korpus abgewiesen werden. Siehe [Container-Architektur](/de/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED`         | nicht gesetzt                                                       | **Optional.** `1` oder `true` schaltet die Prüfung und Reparatur der BM25-Suchindizes beim Start ab. Ein beschädigter Index bringt die Wissensdatenbank dann bei jedem Schreibzugriff zum Absturz, bis er von Hand neu aufgebaut wird.                                                                                          |

Die auto-konstruierte operative Form ist `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` (den Datenbanknamen überschreibst du mit `APP_DB_NAME`). Der Wissens-Korpus lebt in `tale_knowledge` mit den Schemata `private_knowledge` und `public_web`; diese Variablen setzen die Deployment-Defaults, die alle Organisationen teilen; eine Organisation kann zusätzlich ihren eigenen Korpus und ihren eigenen Bucket unter **Einstellungen > Datenresidenz** auf eigene Infrastruktur richten (Dateien pro Organisation, live wirksam, kein Neustart), behandelt in [Datenresidenz](/de/self-hosted/configuration/data-residency).

Zwei Dinge musst du wissen, bevor du eine der beiden Datenbanken auf eigene Infrastruktur richtest:

- **Der Wissens-Korpus braucht ein installiertes `pgvector`.** Tale legt Schemata und Tabellen auf einer leeren Datenbank selbst an, installiert aber nie Extensions — die Chunk-Tabelle hat eine `vector`-Spalte, also muss `CREATE EXTENSION vector;` auf der Zieldatenbank bereits gelaufen sein. ParadeDBs `pg_search` ist optional: Fehlt es, fällt die Suche auf reine Vektorsuche zurück, statt zu scheitern. Die operative Datenbank braucht gar keine Extensions.
- **Keine der beiden Datenbanken darf hinter einem Connection-Pooler im Transaction-Modus liegen.** Die Job-Queue hält `LISTEN`-Verbindungen, der Migrator hält einen Session-weiten Advisory-Lock, und die Query-Schicht nutzt Prepared Statements — alle drei brauchen eine Session für sich. PgBouncer im Session-Modus geht, der Transaction-Modus nicht, und ein Pooler-Endpoint, der multiplext, ebenso wenig (Supabase-Pooler-Port, RDS Proxy mit Pinning). Richte Tale auf den eigenen Port der Datenbank.

## Object-Store

Hochgeladene Dokumente, Chat-Anhänge, Audio und generierte Medien leben in einem S3-kompatiblen Store: dem gebündelten (dem `object-store`-Service, MinIO) oder jedem Bucket, den du mitbringst — AWS S3, MinIO, Cloudflare R2, Wasabi. Es ist das einzige Blob-Backend, sodass ein Deployment, das es nicht erreicht, jeden Upload ablehnt. Eine Organisation, die ihre Blobs auf einen eigenen Bucket richtet (**Einstellungen > Datenresidenz**), wird vor diesem Deployment-Default aufgelöst und bleibt von diesen Variablen unberührt.

| Name                             | Default                        | Beschreibung                                                                                                                                                                    |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORE_ACCESS_KEY`        | nicht gesetzt                  | **Pflicht.** S3-Access-Key — beim gebündelten Store zugleich dessen Root-User, wo beide Seiten denselben Wert lesen. Der Prozess hat keinen Default: Fehlt einer der beiden Schlüssel, konfiguriert das Backend keinen Store und lehnt jeden Upload ab. |
| `OBJECT_STORE_SECRET_KEY`        | von `tale init` autogeneriert  | **Pflicht.** S3-Secret-Key / MinIO-Root-Passwort. Beim **gebündelten** Store muss er stabil bleiben — er ist das Credential des Stores selbst, und ein neuer Wert verwaist jeden bereits geschriebenen Blob. Bei einem **externen** Bucket ist er nur ein Credential, und ihn hier zu ändern ist der vorgesehene Weg, ihn zu rotieren. |
| `OBJECT_STORE_BUCKET`            | `tale-blobs`                   | Bucket, in dem Blobs liegen. Das Backend legt ihn an, wenn er fehlt und der Schlüssel das darf; einen vorhandenen nutzt es, wie er ist. |
| `OBJECT_STORE_ENDPOINT`          | `http://object-store:9000` im mitgelieferten Compose | Wo das Backend den Store erreicht. **Für AWS S3 selbst lässt du ihn leer** — der Bucket wird dann unter `https://<bucket>.s3.<region>.amazonaws.com` adressiert. Für MinIO, R2, Wasabi oder jeden anderen S3-kompatiblen Endpoint setzt du ihn. |
| `OBJECT_STORE_REGION`            | `us-east-1`                    | Signier-Region. Auf AWS bedeutungstragend; bei einem selbst gehosteten Store beliebig, aber vom Signierer verlangt. |
| `OBJECT_STORE_FORCE_PATH_STYLE`  | `true` mit Endpoint, sonst `false` | Adressiert den Bucket als `endpoint/bucket/key` statt `bucket.endpoint/key`. Der Default folgt dem Endpoint und passt damit für beide Fälle; setz ihn nur für einen Store, der von seiner eigenen Form abweicht. |
| `OBJECT_STORE_PREFIX`            | nicht gesetzt                  | Schlüssel-Präfix im Bucket, damit Tales Blobs sich einen Bucket mit anderen Daten teilen können. Leer heißt Bucket-Wurzel. |
| `OBJECT_STORE_PUBLIC_ENDPOINT`   | `${SITE_URL}` (die CLI setzt ihn) | Wo der **Browser** den Store erreicht. Der Proxy publiziert den gebündelten Store unter `/<bucket>/*` und leitet presignte URLs unverändert weiter, sodass Up- und Downloads direkt Browser↔Store laufen. Für einen Bucket, den der Browser ohnehin erreicht, lässt du ihn leer. |

Der gebündelte Store ist rein intern: Presignte URLs signiert das Backend gegen den internen Endpoint, der Proxy reicht sie weiter, und der Store selbst wird nie publiziert.

### Wie diese Variablen im laufenden Deployment ankommen

Das Backend hält `default/object-storage/connection.json` im Config-Volume mit diesen Variablen im Gleichstand und liest sie bei jedem Start neu — den Store umzuhängen oder seine Zugangsdaten zu rotieren ist also eine Änderung an der Umgebung plus ein Neustart von `backend-api` und `backend-worker`. Was davon passiert ist, sagt das Boot-Log:

| Zeile | Bedeutung |
| --- | --- |
| `object store (seeded)` | es gab keine Verbindung; eine wurde aus der Umgebung geschrieben |
| `object store (reconciled)` | die Umgebung hat sich geändert; die Verbindung zieht nach |
| `object store (adopted)` | eine von einem älteren Release geschriebene Verbindung wurde erkannt und wird jetzt mitgeführt |
| `object store (ignored)` | die Verbindung trägt `"managedBy": "operator"`, diese Variablen tun also nichts |
| `object store (skipped)` | kein Schlüsselpaar; das Deployment lehnt jeden Upload ab |
| *(nichts)* | schon im Gleichstand — der Normalfall |

Willst du den Store lieber von Hand führen, trag `"managedBy": "operator"` in `connection.json` ein; das Backend fasst die Datei dann nie wieder an. Eine Datei ganz ohne `managedBy` — vor diesem Verhalten geschrieben — übernimmt das Backend nur, wenn sie noch denselben Bucket am selben Endpoint nennt wie die Umgebung; hattest du sie von Hand umgebogen, bleibt deine Änderung stehen.

Bucket-Rechte: Das Backend prüft mit `HeadBucket`, ob der Bucket existiert, und legt ihn nur an, wenn nicht. Ein Schlüssel, der Objekte lesen, schreiben und löschen darf, aber keine Buckets anlegen, reicht also — solange du den Bucket selbst anlegst. Presignte Up- und Downloads laufen im Browser, ein externer Bucket braucht deshalb zusätzlich eine CORS-Policy, die den Origin deines Deployments mit `GET`, `PUT` und `HEAD` zulässt — siehe [Datenresidenz](/de/self-hosted/configuration/data-residency).

## Audit-Log-Signierung

Die Audit-Hash-Kette wird durch eine HMAC-SHA256-Signatur über ihre Retention- und PII-Scrub-Checkpoints manipulationssicher gemacht (SOC 2 CC7.2, ISO 27001); der tägliche Integritäts-Cron verifiziert sie. Ein zweiter Schlüssel pseudonymisiert die personenbezogenen Daten, die ein fehlgeschlagener Login in der Kette hinterlässt.

| Name                              | Default                       | Beschreibung                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_SIGNING_KEY`          | von `tale init` autogeneriert | 64-stelliger Hex-HMAC-Schlüssel. Halte ihn über Deploys stabil und sichere ihn — ein fehlender oder geänderter Schlüssel löst den Alert „Audit log integrity check failed“ aus.                                                                                                                                                                                                                                                           |
| `TALE_AUDIT_SIGNING_KEY_PREVIOUS` | nicht gesetzt                 | Der vorige Schlüssel während eines Rotationsfensters. Kopier den aktuellen Schlüssel hierher, setz einen frischen `TALE_AUDIT_SIGNING_KEY`, deploye neu; der Verifier akzeptiert beide, dann fällt dieser beim nächsten Mal weg.                                                                                                                                                                                                          |
| `TALE_AUDIT_PEPPER`               | von `tale init` autogeneriert | Pepper (mindestens 16 Zeichen) für den HMAC-SHA256-Hash der E-Mail-Adresse und des `/24`- (IPv4) bzw. `/64`-Präfixes (IPv6) der IP, die ein fehlgeschlagener Login ins Audit-Log schreibt — Zeilen, die 365–3650 Tage leben, weit länger als der Versuch selbst. Ohne Pepper stehen E-Mail und IP im Klartext in diesen Zeilen und das Backend loggt eine `[SECURITY]`-Warnung. Rotieren beendet die Korrelation über die Grenze hinweg; ältere Zeilen laufen mit der Aufbewahrung aus. |

Siehe [Audit-Log-Integrität](/de/self-hosted/operate/security/audit-log-integrity) für das Verifikationsmodell.

## Observability

| Name                        | Default | Beschreibung                                                                                                                                 |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry-DSN für Error-Tracking. Unset zum Deaktivieren. Kompatibel mit selbst gehostetem GlitchTip und Bugsink.                               |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optionale Sample-Rate für Performance-Traces im Browser (`0.0`–`1.0`). Nur Browser — das Backend meldet Fehler, nie Traces.                  |
| `METRICS_BEARER_TOKEN`      | unset   | Bearer-Token, das für den Zugriff auf die Prometheus-`/metrics/*`-Endpoints nötig ist. Unset hält Metrics-Endpoints von aussen unerreichbar. |

`METRICS_BEARER_TOKEN` zu setzen exponiert die Metrics-Endpoints hinter dem Token: `/metrics/platform`, `/metrics/backend` (die Metriken des Application-Backends) und `/metrics/sla-rules`. Siehe [Observability-Konfig](/de/self-hosted/configuration/observability-config) für die Scrape-Konfiguration.

## Provider-Secrets-Verschlüsselung

| Name                | Default | Beschreibung                                                                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | unset   | Inline-age-Secret-Key. Verschlüsselt `providers/*.secrets.json`. Standardmodus nach `tale init`. Mehrere Keys sind inline nicht unterstützt.                      |
| `SOPS_AGE_KEY_FILE` | unset   | Pfad zu einer Datei mit einem oder mehreren age-Keys (einer pro Zeile; `#`-Kommentare erlaubt). Pflicht für Key-Rotation. Schliesst sich mit der Inline-Form aus. |

Wenn beide age-Vars unset sind, speichert Tale `providers/*.secrets.json` als Klartext-JSON mit Modus 0600. Erreich diesen Modus nur, wenn der Host-Storage at-rest verschlüsselt ist oder die Dateien von externem Tooling erzeugt werden (ein Kubernetes-Secret-Mount, ein Vault-Template). Einen age-Key zu rotieren bedeutet, den neuen Key anzuhängen, jeden Provider in der UI neu zu speichern, dann den alten Key zu entfernen. Siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops) für den vollen Rotations-Walkthrough.

Die Umgebungsvariablen-Schlüsselquelle braucht keinen Deployment-Schalter: Zugangsdaten können statt eines gespeicherten Schlüssels nur den _Namen_ einer Umgebungsvariable halten, solange dieser Name das reservierte Präfix `TALE_PROVIDER_KEY_` trägt. Die Schranke ist fail-closed — jeder andere Name wird abgelehnt, das Feld kann also nie auf ein fremdes Deployment-Geheimnis zeigen — und Namen sind auf 40 Zeichen begrenzt. Definier die Variable hier oder in deinem Secret-Manager, damit sowohl die Plattform als auch das Backend sie lesen können; den vollen Mechanismus beschreibt [Anbieter](/de/self-hosted/configuration/providers). Zugangsdaten mit Subscription-Broker haben einen zweiten, getrennten Namensraum für das Geheimnis, das Tale **dem Broker** präsentiert: Dieses Feld nimmt einen Umgebungsvariablen-Namen unter dem reservierten Präfix `TALE_TOKEN_SOURCE_`, begrenzt auf 60 Zeichen. Die zwei Präfixe bleiben mit Absicht getrennt — ein Broker-Geheimnis ist kein Anbieter-API-Schlüssel, und keines der Felder kann eine Variable außerhalb seines eigenen Namensraums benennen.

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

Optionale Schalter für Features, die standardmässig nicht aktiviert sind. Jeder Flag schaltet ein Feature beim Boot ein oder aus; das Umschalten braucht einen Neustart des Plattform-Containers.

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

## RAG-Retrieval-Tuning

Optionale Stellschrauben für die Wissensdatenbank-Suche. Der RAG-Pfad bewertet Ergebnisse mit einem Cross-Encoder neu, wenn Re-Ranking an ist. Alle tragen das `RAG_`-Präfix und werden vom Backend beim Boot gelesen; nach einer Änderung führe `docker compose restart backend-api backend-worker` aus, damit sie wirkt.

| Name                         | Default                                | Beschreibung                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED`      | `false`                                | Bewertet die zusammengeführten BM25- und Vektor-Kandidaten mit einem Cross-Encoder neu, bevor Ergebnisse zurückkommen. Mehr Präzision, mehr Latenz pro Query.                                                 |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Cross-Encoder-Modellkennung, die an den Rerank-Provider übergeben wird.                                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Muss auf `api` gesetzt sein, um Re-Ranking zu aktivieren — es schickt die Kandidaten an einen externen `/rerank`-Endpoint (Cohere/Jina-kompatibel). `local` wird nicht mehr unterstützt und scheitert sofort. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Maximale Anzahl Ergebnisse, die der Reranker zurückgibt. Die Antwort übersteigt nie das `top_k` der Anfrage.                                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Grösse des Kandidaten-Pools für den Reranker. Ein breiterer Pool verbessert die Neubewertung und kostet proportional mehr Zeit pro Query.                                                                     |
| `RAG_RERANKING_API_BASE_URL` | unset                                  | Basis-URL für den Rerank-Provider; das Backend ruft `{base_url}/rerank` auf. Pflicht, wenn Re-Ranking aktiviert ist.                                                                                          |
| `RAG_RERANKING_API_KEY`      | unset                                  | Bearer-Token für den externen Rerank-Endpoint. Unset lassen für unauthentifizierte Endpoints.                                                                                                                 |

Re-Ranking ist standardmässig deaktiviert, weil es Latenz pro Query addiert und von einem externen Endpoint abhängt. Aktiviere es — indem du `RAG_RERANKING_PROVIDER=api` setzt und `RAG_RERANKING_API_BASE_URL` auf einen gehosteten Rerank-Service zeigst — wenn Retrieval-Präzision wichtiger ist als Antwortzeit. Es gibt kein In-Process-Modell zum Herunterladen oder Cachen; mit ausgeschaltetem Re-Ranking gibt die Suche das einfache zusammengeführte BM25-+-Vektor-Ranking zurück.

## Deployment-Topologie

Wie viele Replicas jeder zustandslosen Rolle eine Farbe fährt. `tale deploy` liest sie aus der `.env` des Projekts; ein Wert außerhalb des Bereichs wird mit einer Warnung geklemmt statt abgelehnt — null Replicas der API ist ein Ausfall, den niemand absichtlich konfiguriert.

| Name                           | Default | Beschreibung                                                                                             |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas des Web-Tiers, der die App-Shell ausliefert. Bereich `1`–`16`.                                    |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas der API — jede Anwendungstür, Auth und der Hint-Stream. Bereich `1`–`16`.                         |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas des Job-Runners: Ingest, Crawls, Automations, Agent-Turns. Bereich `1`–`16`.                      |

Ein Deploy fährt beide Farben gleichzeitig, jede Zahl verdoppelt sich also für die Dauer des Kipps. Setz den Worker zuerst hoch — das ist am günstigsten. [Upgrades](/de/self-hosted/operate/upgrades) ist, wann diese Zahlen greifen.

## Sitzungen

| Name                           | Default | Beschreibung                                                                                                                                                                                                                     |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Meldet eine Sitzung nach so vielen Minuten Inaktivität ab (`1`–`1440`). Das Fenster verschiebt sich bei Aktivität und wird serverseitig durchgesetzt — über E-Mail-/Passwort-, SSO- und Trusted-Headers-Sitzungen. |

Lass es unset, um die Standard-Sitzungsdauer zu behalten. Wenn gesetzt, läuft eine inaktive Sitzung serverseitig ab, sobald das Fenster verstrichen ist, während eine aktive sich bei jeder Anfrage weiter verschiebt. Org-Admins können das wirksame Fenster pro Organisation verkürzen — niemals über diese Obergrenze hinaus verlängern — über die [Governance-Richtlinie zur Sitzungs-Leerlaufzeit](/de/platform/admin/governance/policies-and-limits); inaktive Sitzungen unter dieser Richtlinie widerruft ein Lauf, der etwa alle fünf Minuten läuft.

## Sandbox-Infrastruktur

Die folgenden Laufzeitgrenzen liest der Sandbox-Spawner. Übergib sie seiner Umgebung und starte den Dienst nach einer Änderung neu; die unter [Sandboxes](/de/platform/admin/sandboxes) bearbeiteten Organisationskontingente bleiben davon unabhängig. Dort siehst du tatsächliche Laufzeitzahlen und Host-Messwerte getrennt von diesen Kontingenten.

| Name | Default | Beschreibung |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | `16` | Laufende und startende Sessions aller Organisationen auf dem Docker-Host oder im Kubernetes-Namespace. Die Grenze reserviert weder CPU noch Arbeitsspeicher. Gleichzeitige Kubernetes-Replikate setzen sie nach bestem Bemühen durch; harte Ressourcengrenzen im Namespace setzt du mit ResourceQuota. |
| `SANDBOX_MAX_SESSIONS_PER_ORG` | `50` | Laufzeitgrenze einer Organisation für Projektagenten, Workflow-Läufe und Rendering zusammen, einschließlich weiterlaufender Container im Leerlauf. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 Min.) | Leerlauffenster, nach dem nicht angepinnte Sessions stoppen. Die Build-Cache-Hilfscontainer einer Organisation stoppen ebenfalls nach diesem Fenster ohne möglicherweise aktive Session; Netzwerke und Cache-Volumes bleiben erhalten. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optional, vom Spawner gelesen.** Das Image, aus dem jeder Session-Container entsteht. Der Default ist der Tag, den der Entwicklungs-Stack lokal baut; ein Host, der seine Images zieht, setzt deshalb den Registry-Namen: `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, passend zum Rest des Stacks. `tale deploy` setzt ihn für dich. |

Docker-Build-Caches sind nach Organisation getrennt. Jede Organisation nutzt einen privilegierten Builder und drei Registry-Mirrors ohne erhöhte Rechte. Sobald keine Session mehr auf sie zugreifen könnte, beginnt das Leerlauffenster; danach stoppen die Hilfscontainer. Der nächste Build startet sie mit ihren erhaltenen Cache-Volumes neu. Netzwerke und Volumes bleiben für die Wiederverwendung bestehen.

Der Spawner füllt den ersten verfügbaren Docker-Adresspool mit Organisationsnetzwerken, bevor er zum nächsten wechselt. Standardmäßig erhält jedes Netzwerk ein `/23` mit 512 Adressen; ein ansonsten freies `/16` bietet damit Platz für 128 Organisationsnetzwerke. Kleinere in Docker konfigurierte Subnetze bleiben kleiner. Der Spawner schließt vorhandene Docker-Netzwerke, Routen und DNS-Serveradressen auf dem Host des Docker-Daemons sowie `172.31.0.0/16` für ältere Runtime-Images aus und prüft anschließend das angelegte Netzwerk.

Auch bei einem entfernten Docker-Daemon erfasst der Spawner dessen Host über einen kurzlebigen Container aus dem konfigurierten BuildKit-Image. Dieser läuft im Host-Netzwerk-Namespace mit schreibgeschütztem Dateisystem, ohne Capabilities und ohne Mounts. Scheitert diese Abfrage oder bleibt kein sicheres Subnetz frei, bauen Sessions lokal ohne gemeinsamen Cache. Ein ungenutztes eigenes Netzwerk mit ungültigem Subnetz legt der Spawner neu an; belegte und fremde Netzwerke bleiben erhalten.

Vor dem Start des inneren Docker-Daemons wählt die Runtime ein privates `/16`, das weder ihre tatsächlichen IPv4-Routen noch das später angeschlossene Organisationsnetzwerk überlappt. Sie bevorzugt `172.31.0.0/16` und prüft danach weitere private Bereiche. Das erste `/24` gehört zu `docker0`; innere Compose-Netzwerke erhalten `/24`-Blöcke aus demselben Pool. Sind die Routen nicht lesbar oder ist kein Pool frei, startet die Session nicht und die Runtime meldet den konkreten Fehler.

Halte `sandbox`, `sandbox-egress` und `SANDBOX_RUNTIME_IMAGE` beim Upgrade auf demselben Release. Bevor der Spawner das Build-Netzwerk einer Organisation anschließt, prüft er den Weiterleitungsschutz der Session. Compose und generierte Session-Container deaktivieren IPv6 mit `net.ipv6.conf.all.disable_ipv6=1` und `net.ipv6.conf.default.disable_ipv6=1`. Übernimm diese Sysctls in eigene Deployment-Definitionen, sodass eine IPv4-Bereitstellung keine IPv6-Firewall-Unterstützung des Hosts voraussetzt.

Beim Upgrade entstehen leere Organisationscaches; die alten globalen Cachedaten bleiben erhalten. Alte Hilfscontainer stoppen automatisch, sobald keine laufende Session mehr auf sie angewiesen ist. Lass alte angepinnte Sessions auslaufen oder stoppe sie, um den Übergang abzuschließen; bis dahin bleibt der alte gemeinsame Cachedienst erreichbar. Browserautomatisierung nutzt Chromium ohne grafische Oberfläche. Die Live-Ansicht und manuelle Browserübernahme sind entfernt.

## Sandbox-Agent-Turns

| Name                             | Default              | Beschreibung                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 Min.)  | **Optional.** Wie lange ein Coding-Agent-Turn in der Sandbox (Claude Code, OpenCode, Codex) ohne Abnehmer seiner Ausgabe liegen darf, bevor der Sandbox-Daemon ihn abräumt. Ein gleitendes Fenster, das bei jedem Wiederanbinden der Plattform neu startet — keine absolute Obergrenze für den Turn. Millisekunden. |

Erhöhe den Wert, wenn lange Agent-Turns auf einem langsamen Host als abgeräumte Waisen zurückkommen; die Plattform bindet sich selbst wieder an, das Fenster beendet also nur einen Turn, dessen Abnehmerkette gestorben ist. Das Backend liest ihn beim Start — starte `backend-api backend-worker` nach einer Änderung neu.

## Video-Link-Ingestion (yt-dlp)

Liest Tale einen Video-Link ein, holt es dessen Transkript für den Agenten. YouTube blockiert automatisierten Zugriff von Rechenzentrums-/Server-IPs, sodass dies bei einer Cloud-Bereitstellung fehlschlagen kann. Die Bereitstellung bringt standardmäßig einen PO-Token-Provider verdrahtet mit (das vollständige Bild liefert [Video-Ingestion](/de/self-hosted/configuration/video-ingestion)); die Optionen unten sind optionale Überschreibungen und Eskalationen. Keine garantiert eine Umgehung — eine saubere Ausgangs-IP ist der wirksamste Hebel. Vom Backend-Worker gelesen und bei jeder Ingestion neu ausgewertet, sodass eine Änderung ohne Neustart greift.

| Name                             | Standard                                     | Beschreibung                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL`         | nicht gesetzt                                | yt-dlp-Ausgang über einen Proxy leiten (eine Residential-/ISP-IP funktioniert am besten; Rechenzentrums-Proxys sind meist ebenfalls markiert). Schemata: `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` — bevorzugt `socks5h://`, damit DNS am Proxy aufgelöst wird.                                                                                     |
| `VIDEO_INGEST_POT_PROVIDER_URL`  | `http://bgutil-provider:4416` (eingebacken)  | Basis-URL des PO-Token-Providers, der die GVS-Tokens liefert, die YouTubes Bot-Sperre auflösen. Standardmäßig das `bgutil-provider`-Compose-Sidecar, wenn das eingebackene Plugin vorhanden ist — nur setzen, um auf einen Provider auf einem anderen Host zu verweisen.                                                                                            |
| `VIDEO_INGEST_FETCH_POT`         | `always`, sobald ein Provider angebunden ist | Wann yt-dlp PO-Tokens beim Provider anfordert (`never`/`auto`/`always`). yt-dlps eigenes `auto` holt für den Player-Request nie ein Token — genau dort schlägt die Bot-Sperre zu —, deshalb setzt Tale mit Provider standardmäßig `always`. `never` umgeht einen fehlerhaften Provider.                                                                             |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (eingebacken)          | Verzeichnis, aus dem yt-dlp Plugins lädt — jedes Plugin eine Ebene tiefer verschachtelt (`<dir>/<name>/yt_dlp_plugins/…`). Standardmäßig das eingebackene bgutil-Plugin-Verzeichnis, wenn vorhanden; nur überschreiben, um eigene Plugins zu ergänzen.                                                                                                              |
| `VIDEO_INGEST_COOKIES_FILE`      | nicht gesetzt                                | Pfad zu einem Netscape-Cookie-Jar. Gast-Cookies aus einer Inkognito-Sitzung erhöhen das Ratenlimit ohne Sperrrisiko; Konto-Cookies schalten gesperrte Inhalte frei, riskieren aber das Konto.                                                                                                                                                                       |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                          | Kommagetrennte Fallback-Liste der YouTube-Player-Clients. Mit angebundenem PO-Token-Provider erweitert sich der Standard auf `default,mweb,tv_simply` (mweb benötigt ein GVS-Token); explizit setzen, um eine Liste zu erzwingen.                                                                                                                                   |
| `VIDEO_INGEST_PO_TOKEN`          | nicht gesetzt                                | Manuell gesetztes PO-Token (`CLIENT.CONTEXT+TOKEN`). Vor allem zum Testen — Tokens sind an die Video-ID gebunden und kurzlebig; den Provider bevorzugen.                                                                                                                                                                                                            |
| `VIDEO_INGEST_IMPERSONATE`       | nicht gesetzt                                | Ziel für Browser-TLS/JA3-Imitation (z. B. `safari`). Erfordert `curl_cffi` im Image; nicht setzen, sofern nicht verfügbar.                                                                                                                                                                                                                                          |
| `VIDEO_INGEST_BIN_DIR`           | nicht gesetzt                                | Verzeichnis, das dem `PATH` des yt-dlp/ffmpeg-Kindprozesses vorangestellt wird, damit ein selbst bereitgestelltes `yt-dlp` (samt Deno-Runtime) außerhalb der eingebackenen Bin-Verzeichnisse zuerst gefunden wird. Das Backend-Image backt yt-dlp in den `PATH` ein, dort also nicht gesetzt lassen; auf einem Host- oder Dev-Rechner mit eigener Toolchain setzen. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                            | Absoluter Pfad zu dem ffmpeg, das yt-dlp für die Nachbearbeitung nutzt (Untertitel-Konvertierung, Audio-Extraktion). Überschreiben, wenn ffmpeg woanders liegt — z. B. Homebrews `/opt/homebrew/bin/ffmpeg` auf einem macOS-Dev-Rechner.                                                                                                                            |

Keine dieser Optionen garantiert Erfolg gegen YouTubes adaptive Erkennung. Gewöhnliche öffentliche Videos, weniger aggressive Plattformen oder eine Bereitstellung mit Residential-IP bzw. Selbst-Hosting funktionieren üblicherweise auch ohne sie.

## Wo das hingehört

Die Variablen hier sind die Kontaktoberfläche des Operators; die UI-Oberfläche, die die meisten von ihnen konsumiert, lebt unter [Plattform-Verwaltung](/de/platform/admin/overview). Provider-Keys sind die eine Halb-und-Halb-Sache: die Keys selbst leben in `providers/*.secrets.json`, aber die UI unter **Einstellungen > KI-Anbieter** ist, wie du sie in der Praxis hinzufügst und rotierst. Die nächste Lektüre, die sich lohnt, ist [Anbieter](/de/self-hosted/configuration/providers) — sie behandelt die mitgelieferten Connector-Dateien und die reservierten Variablen, die Anbieter-Schlüssel halten.
