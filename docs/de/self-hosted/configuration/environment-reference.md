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

| Name        | Default             | Beschreibung                                                                                                                   |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HOST`      | `localhost`         | **Pflicht.** Hostname ohne Protokoll. Wird für Docker-Networking und ausgehende Mails verwendet.                               |
| `SITE_URL`  | `https://localhost` | **Pflicht.** Vollständige kanonische URL inklusive Schema und Port. Auth-Callbacks und externe Links nutzen das.               |
| `BASE_PATH` | unset               | **Optional.** Pfad-Präfix für Subpath-Deployments hinter einem Reverse-Proxy (z. B. `/app`). Bei Root-Deployment unset lassen. |

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

Tale betreibt zwei Postgres-Datenbanken: den operativen Speicher (`db`, Port 5432) hinter dem Convex-Backend und den Wissens-Korpus (`knowledge-db`, Port 5433), der Dokument-Chunks, Embeddings und gecrawlte Seiten hält. Beide sind ParadeDB und teilen sich `DB_PASSWORD`, aber sie sind unabhängig — zeig jede für sich auf externe Infrastruktur.

| Name                     | Default                                                             | Beschreibung                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`            | `tale_password_change_me`                                           | **Pflicht.** Passwort für den selbst gehosteten Postgres-Benutzer. Vor der Produktion ändern. Von beiden Datenbank-Containern genutzt.                                                                                          |
| `POSTGRES_URL`           | aus `DB_PASSWORD` konstruiert                                       | **Optional.** Überschreibt die automatisch konstruierte URL der operativen Datenbank. Nutze das, wenn du auf einen externen Postgres oder einen Nicht-Standard-Host/Port zeigst.                                                |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | **Optional.** Verbindungs-URL, die das Convex-Backend für den Wissens-Korpus nutzt. Überschreib sie, um den Korpus auf dein eigenes verwaltetes ParadeDB zu verlagern — der datenresidenz-sensible Speicher wandert unabhängig. |
| `KNOWLEDGE_DB_NAME`      | `tale_knowledge`                                                    | **Optional.** Name der Wissensdatenbank. Der mitgelieferte `knowledge-db`-Container erstellt diese Datenbank beim ersten Boot.                                                                                                  |

Die auto-konstruierte operative Form ist `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex erwartet diese URL ohne Datenbanknamen; der Name wird aus der Instanz-Konfiguration abgeleitet. Der Wissens-Korpus lebt in `tale_knowledge` mit den Schemata `private_knowledge` und `public_web`; die UI unter **Einstellungen > Datenresidenz** schreibt eine reichere Per-Store-Konfiguration als diese rohen Variablen, behandelt in [Datenresidenz](/de/self-hosted/configuration/data-residency).

## Observability

| Name                        | Default | Beschreibung                                                                                                                                 |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry-DSN für Error-Tracking. Unset zum Deaktivieren. Kompatibel mit selbst gehostetem GlitchTip und Bugsink.                               |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optionale Sample-Rate für Performance-Traces (`0.0`–`1.0`). Standard-Verhalten hängt vom Deployment ab.                                      |
| `METRICS_BEARER_TOKEN`      | unset   | Bearer-Token, das für den Zugriff auf die Prometheus-`/metrics/*`-Endpoints nötig ist. Unset hält Metrics-Endpoints von aussen unerreichbar. |

`METRICS_BEARER_TOKEN` zu setzen exponiert zwei Endpoints hinter dem Token: `/metrics/platform` und `/metrics/convex` (Convex' 261 eingebaute Metriken, die jetzt auch die RAG- und Crawl-Timings tragen). Siehe [Observability-Konfig](/de/self-hosted/configuration/observability-config) für die Scrape-Konfiguration.

## Provider-Secrets-Verschlüsselung

| Name                | Default | Beschreibung                                                                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | unset   | Inline-age-Secret-Key. Verschlüsselt `providers/*.secrets.json`. Standardmodus nach `tale init`. Mehrere Keys sind inline nicht unterstützt.                      |
| `SOPS_AGE_KEY_FILE` | unset   | Pfad zu einer Datei mit einem oder mehreren age-Keys (einer pro Zeile; `#`-Kommentare erlaubt). Pflicht für Key-Rotation. Schliesst sich mit der Inline-Form aus. |

Wenn beide age-Vars unset sind, speichert Tale `providers/*.secrets.json` als Klartext-JSON mit Modus 0600. Erreich diesen Modus nur, wenn der Host-Storage at-rest verschlüsselt ist oder die Dateien von externem Tooling erzeugt werden (ein Kubernetes-Secret-Mount, ein Vault-Template). Einen age-Key zu rotieren bedeutet, den neuen Key anzuhängen, jeden Provider in der UI neu zu speichern, dann den alten Key zu entfernen. Siehe [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops) für den vollen Rotations-Walkthrough.

Die Umgebungsvariablen-Schlüsselquelle braucht keinen Deployment-Schalter: ein Anbieter kann seinen Schlüssel aus einer Umgebungsvariable statt aus einer Secrets-Datei lesen, solange die Variable mit dem reservierten Präfix `TALE_PROVIDER_KEY_` benannt ist (jeder andere Name wird abgelehnt). Der Mechanismus — die Präfix-Schranke, Auflösungs-Reihenfolge, die 40-Zeichen-Grenze, die Neustart-Anforderung — ist in [Anbieter](/de/self-hosted/configuration/providers#environment-variable-key-source) dokumentiert.

Eine [Token-Quelle](/de/platform/admin/token-sources) folgt demselben Muster für das Auth-Geheimnis, das sie _an den Broker_ sendet: Sie liest aus einem verschlüsselten `token-sources/<slug>.secrets.json`-Sidecar oder aus einer Umgebungsvariable, die mit dem reservierten Präfix `TALE_TOKEN_SOURCE_` benannt ist (jeder andere Name wird abgelehnt, sodass das Feld nie auf ein Deployment-Geheimnis zeigen kann). Die Variable gilt pro Quelle; definier sie hier oder in deinem Secret-Manager, damit sowohl die Plattform als auch das Convex-Backend sie lesen können.

## Feature-Flags

Optionale Schalter für Features, die standardmässig nicht aktiviert sind. Jeder Flag schaltet ein Feature beim Boot ein oder aus; das Umschalten braucht einen Neustart des Plattform-Containers.

| Name                            | Default | Beschreibung                                                                                                                              |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`       | `false` | Aktiviert den Trusted-Headers-Auth-Modus (Identität vom Reverse-Proxy geliefert).                                                         |
| `FILE_EVENTS_ENABLED`           | `false` | Aktiviert Datei-Watching-Events für die OneDrive-Sync-Integration.                                                                        |
| `TALE_DEPLOYMENT_CONFIG_ADMINS` | unset   | Kommagetrennte E-Mail-Allowlist der Operatoren, die die Datenresidenz bearbeiten dürfen. Leer/nicht gesetzt = nur lesend für alle Admins. |

## RAG-Retrieval-Tuning

Optionale Stellschrauben für die Wissensdatenbank-Suche. Der In-Process-RAG-Pfad (Convex-Node-Actions) bewertet Ergebnisse mit einem Cross-Encoder neu, wenn Re-Ranking an ist. Alle tragen das `RAG_`-Präfix und werden von den Containern `platform` und `convex` beim Boot gelesen; nach einer Änderung führe `docker compose restart platform convex` aus, damit sie wirkt.

| Name                         | Default                                | Beschreibung                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED`      | `false`                                | Bewertet die zusammengeführten BM25- und Vektor-Kandidaten mit einem Cross-Encoder neu, bevor Ergebnisse zurückkommen. Mehr Präzision, mehr Latenz pro Query.                                                 |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Cross-Encoder-Modellkennung, die an den Rerank-Provider übergeben wird.                                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Muss auf `api` gesetzt sein, um Re-Ranking zu aktivieren — es schickt die Kandidaten an einen externen `/rerank`-Endpoint (Cohere/Jina-kompatibel). `local` wird nicht mehr unterstützt und scheitert sofort. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Maximale Anzahl Ergebnisse, die der Reranker zurückgibt. Die Antwort übersteigt nie das `top_k` der Anfrage.                                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Grösse des Kandidaten-Pools für den Reranker. Ein breiterer Pool verbessert die Neubewertung und kostet proportional mehr Zeit pro Query.                                                                     |
| `RAG_RERANKING_API_BASE_URL` | unset                                  | Basis-URL für den Rerank-Provider; die Plattform ruft `{base_url}/rerank` auf. Pflicht, wenn Re-Ranking aktiviert ist.                                                                                        |
| `RAG_RERANKING_API_KEY`      | unset                                  | Bearer-Token für den externen Rerank-Endpoint. Unset lassen für unauthentifizierte Endpoints.                                                                                                                 |

Re-Ranking ist standardmässig deaktiviert, weil es Latenz pro Query addiert und von einem externen Endpoint abhängt. Aktiviere es — indem du `RAG_RERANKING_PROVIDER=api` setzt und `RAG_RERANKING_API_BASE_URL` auf einen gehosteten Rerank-Service zeigst — wenn Retrieval-Präzision wichtiger ist als Antwortzeit. Es gibt kein In-Process-Modell zum Herunterladen oder Cachen; mit ausgeschaltetem Re-Ranking gibt die Suche das einfache zusammengeführte BM25-+-Vektor-Ranking zurück.

## Sitzungen

| Name                           | Default | Beschreibung                                                                                                                                                                                                                     |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Meldet eine Sitzung nach so vielen Minuten Inaktivität ab (`1`–`1440`). Das Fenster verschiebt sich bei Aktivität und wird serverseitig durchgesetzt — über E-Mail-/Passwort-, SSO- und Trusted-Headers-Sitzungen. |

Lass es unset, um die Standard-Sitzungsdauer zu behalten. Wenn gesetzt, läuft eine inaktive Sitzung serverseitig ab, sobald das Fenster verstrichen ist, während eine aktive sich bei jeder Anfrage weiter verschiebt. Org-Admins können das wirksame Fenster pro Organisation verkürzen — niemals über diese Obergrenze hinaus verlängern — über die [Governance-Richtlinie zur Sitzungs-Leerlaufzeit](/de/platform/admin/governance/policies-and-limits); inaktive Sitzungen unter dieser Richtlinie widerruft ein Lauf, der etwa alle fünf Minuten läuft.

## Video-Link-Ingestion (yt-dlp)

Beim Einfügen eines Video-Links im Chat wird dessen Transkript für den Agenten abgerufen. YouTube blockiert automatisierten Zugriff von Rechenzentrums-/Server-IPs, sodass dies bei einer Cloud-Bereitstellung fehlschlagen kann. Alle Optionen unten sind optional und standardmäßig deaktiviert; jede lässt den Zugriff legitimer wirken, garantiert aber keine Umgehung — eine saubere Ausgangs-IP ist der wirksamste Hebel. Vom `convex`-Container gelesen und bei jeder Ingestion neu ausgewertet, sodass eine Änderung ohne Neustart greift.

| Name                            | Standard            | Beschreibung                                                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL`        | nicht gesetzt       | yt-dlp-Ausgang über einen Proxy leiten (eine Residential-/ISP-IP funktioniert am besten; Rechenzentrums-Proxys sind meist ebenfalls markiert). Schemata: `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` — bevorzugt `socks5h://`, damit DNS am Proxy aufgelöst wird. |
| `VIDEO_INGEST_POT_PROVIDER_URL` | nicht gesetzt       | Basis-URL eines PO-Token-Providers (des bgutil-HTTP-Servers), der die GVS-Tokens liefert, die YouTubes Bot-Sperre für die Clients `mweb`/`web`/`tv_simply` auflösen. Provider selbst betreiben.                                                                                 |
| `VIDEO_INGEST_COOKIES_FILE`     | nicht gesetzt       | Pfad zu einem Netscape-Cookie-Jar. Gast-Cookies aus einer Inkognito-Sitzung erhöhen das Ratenlimit ohne Sperrrisiko; Konto-Cookies schalten gesperrte Inhalte frei, riskieren aber das Konto.                                                                                   |
| `VIDEO_INGEST_PLAYER_CLIENT`    | `default,tv_simply` | Kommagetrennte Fallback-Liste der YouTube-Player-Clients. `mweb` nur ergänzen, wenn ein PO-Token-Provider konfiguriert ist (er benötigt ein GVS-Token).                                                                                                                         |
| `VIDEO_INGEST_PO_TOKEN`         | nicht gesetzt       | Manuell gesetztes PO-Token (`CLIENT.CONTEXT+TOKEN`). Vor allem zum Testen — Tokens sind an die Video-ID gebunden und kurzlebig; den Provider bevorzugen.                                                                                                                        |
| `VIDEO_INGEST_IMPERSONATE`      | nicht gesetzt       | Ziel für Browser-TLS/JA3-Imitation (z. B. `safari`). Erfordert `curl_cffi` im Image; nicht setzen, sofern nicht verfügbar.                                                                                                                                                      |

Keine dieser Optionen garantiert Erfolg gegen YouTubes adaptive Erkennung. Gewöhnliche öffentliche Videos, weniger aggressive Plattformen oder eine Bereitstellung mit Residential-IP bzw. Selbst-Hosting funktionieren üblicherweise auch ohne sie. Siehe [Chat-Anhänge](/platform/chat/attachments) dazu, wie abgerufene Transkripte verwendet werden.

## Wo das hingehört

Die Variablen hier sind die Kontaktoberfläche des Operators; die UI-Oberfläche, die die meisten von ihnen konsumiert, lebt unter [Plattform-Verwaltung](/de/platform/admin/overview). Provider-Keys sind die eine Halb-und-Halb-Sache: die Keys selbst leben in `providers/*.secrets.json`, aber die UI unter **Einstellungen > KI-Anbieter** ist, wie du sie in der Praxis hinzufügst und rotierst. Die nächste Lektüre, die sich lohnt, ist [Anbieter](/de/self-hosted/configuration/providers) — sie behandelt die Datei-Form, die SOPS-Modi und das Resolve-und-Failover-Verhalten.
