---
title: Selbst gehostete Architektur
description: Neun Container hinter einem Caddy-Proxy, ein Postgres, ein S3-kompatibler Blob-Store. Diese Seite vermittelt das mentale Modell, was jeder Container tut, wo Daten auf dem Storage liegen und welche Secrets beim ersten Boot zählen.
---

Eine Tale-Instanz besteht aus neun Containern hinter einem Caddy-Proxy: der Web-Tier, ein Application-Backend mit zwei Rollen, ein Postgres, ein S3-kompatibler Blob-Store und die dreiteilige Sandbox-Ebene an der Seite für die Code-Ausführung. Ein kleiner `bgutil-provider`-Sidecar rundet das Ganze für die Video-Link-Ingestion ab. Die compose-Datei ist der Vertrag — was läuft, was exponiert ist, was gemountet ist. Diese Seite vermittelt das mentale Modell, sodass die Install-, Konfigurations- und Betriebsseiten es nicht erneut erklären müssen.

Lies das, bevor du deployst. Komm zurück, wenn du einen Ausfall debuggst und wissen musst, welches Container-Log du zuerst öffnen solltest.

## Die Container

**tale-proxy** ist Caddy am Rand. Er terminiert TLS, liefert die SPA und die eigenen Routen der Plattform aus dem Plattform-Container aus und leitet die Anwendungsoberfläche — alles unter `/api/` außer `/api/health`, dazu `/events` und die WebDAV-Tür — an das Backend weiter. Health-Checks leben hier.

**tale-platform** ist der Web-Tier: eine Vite- + TanStack-Router-SPA plus der Bun-Server, der sie ausliefert. Er rendert die UI, liefert statische Assets und Branding aus, beobachtet den Config-Store auf Live-Änderungen und besitzt einige eigene Routen (die Health-Probe, die Canvas-Vorschau, den WebDAV-Fallback). Er ist der einzige Container, mit dem der Browser direkt spricht, und er hält keinen Geschäfts-State — alles, was persistiert, läuft über das Backend.

**tale-backend-api** ist das Application-Backend in der `api`-Rolle (`TALE_ROLE=api`): jede Anwendungstür — die App-API, Better Auth, der SSE-Hinweis-Stream, die Maschinentüren und die In-Sandbox-Bridges. Provider-Keys, Agent-Definitionen, Automation-Läufe und Audit-Logs laufen allesamt durch es hindurch. Es ist ein Singleton — beide Plattform-Farben zeigen auf dieselbe api — und ist zusätzlich ans Sandbox-Netz angebunden, damit ein Session-Container es direkt erreicht.

**tale-backend-worker** ist dasselbe Image in der `worker`-Rolle (`TALE_ROLE=worker`): der Job-Runner hinter Schedules, Watchdogs und Agent-Turns. Er erledigt auch die Wissens-Arbeit — Dokument-Ingestion, Web-Crawling, RAG-Indexierung und Dokumentgenerierung — als Hintergrund-Jobs statt als separate Services. Die Headless-Arbeit, die diese Jobs brauchen (eine Webseite rendern, HTML in ein PDF oder Bild verwandeln), wird an die Sandbox-Laufzeit delegiert, die ohnehin schon Chromium und Playwright mitbringt. Der Worker exponiert kein HTTP und skaliert horizontal (`--scale backend-worker=N`).

**tale-db** ist das operative Postgres (ParadeDB, mit `pg_search` + `pgvector`). Der Single-Host-Stack faltet zwei Datenbanken hinein: `tale_app` — den Anwendungsspeicher hinter Agents, Runs und dem Audit-Log — und `tale_knowledge`, den Wissens-Korpus mit zwei Schemata, `private_knowledge` (Chunks hochgeladener Dokumente, Embeddings, der BM25-Index, der semantische Cache) und `public_web` (gecrawlte Webseiten). Der Service ist im internen Netz als `knowledge-db` aliasiert, sodass der Korpus ohne zusätzliche Verdrahtung auf dasselbe Postgres auflöst. Die Entwicklungs-`compose.yml` trennt den Korpus stattdessen in einen eigenen `knowledge-db`-Service ab, damit er sich für sich allein verlagern lässt — siehe [Datenresidenz](/de/self-hosted/configuration/data-residency).

**tale-object-store** ist MinIO, das S3-kompatible Blob-Backend. Hochgeladene Dokumente, Chat-Anhänge, Audio und generierte Medien leben hier — es ist das einzige Blob-Backend, sodass ein Deployment, das es nicht erreicht, jeden Upload ablehnt. Es ist rein intern: Blobs erreichen den Browser über presignte URLs, die das Backend signiert und der Proxy weiterreicht, nie durch Exponieren des Stores selbst.

**tale-sandbox-llm-gateway** ist das LLM-Gateway für In-Sandbox-Coding-Agent-Turns (Harness). Es ist der einzige Pfad von einem sandboxten Harness zu einem Modell-Provider; das Backend provisioniert es und prägt Keys pro Session.

**tale-sandbox** und **tale-sandbox-egress** führen sandboxten Code im Auftrag des `Run code`-Tools und von Skill-Skripten aus und dienen als Headless-Browser-Laufzeit, die das Backend für Web-Rendering und Dokumentgenerierung aufruft. Der Egress-Container ist der einzige Pfad, den die Sandbox zum Netz hat. Egress ist standardmäßig offen — sandboxter Code erreicht jeden öffentlichen Host über HTTPS, während Cloud-Metadaten- und Private-Range-Ziele auf IP-Ebene blockiert bleiben; sperre ihn mit `SANDBOX_EGRESS_ALLOWLIST` auf eine Hostname-Allowlist herunter, beschrieben in [Härtung](/de/self-hosted/operate/security/hardening).

Ein zehnter Container, **tale-bgutil-provider**, ist ein Best-Effort-Sidecar eines Drittanbieters, der die PO-Tokens liefert, die die Video-Link-Ingestion braucht, um an YouTubes Bot-Wall vorbeizukommen — siehe [Video-Ingestion](/de/self-hosted/configuration/video-ingestion).

## Daten auf dem Storage

Diese Volumes überleben ein `docker compose down`:

- `db-data` — das Datenverzeichnis des operativen Postgres: der Anwendungsspeicher _und_ der Wissens-Korpus (Dokument-Chunks, Embeddings, die Such-Indizes, gecrawlte Seiten), da der Single-Host-Stack beide in eine Datenbank faltet.
- `convex-data` — der Org-Config-Store: Agents, Skills, Provider, Governance-Policies, SSO-Verbindungsdateien und hochgeladenes Branding. Der Name stammt aus der Zeit vor der Convex-Ablösung und bleibt, damit kein Operator ein Volume für eine Umbenennung migrieren muss; das Backend besitzt jeden Schreibzugriff, und die Plattform mountet es read-only.
- `object-store-data` — der Blob-Store: hochgeladene Dateien, Chat-Anhänge, generierte Dokumente, exportierte Bundles.
- `caddy-data`, `caddy-config` — TLS-Zertifikate und Proxy-State.
- `backups` — prüfsummengesicherte Volume-Snapshots, geschrieben von `tale backup` und automatisch vor migrierenden Deploys; [Backups und Restore](/de/self-hosted/operate/backups-and-restore) ist die Übung.

Alles andere ist ephemer. Container lassen sich ohne Datenverlust ersetzen, solange die Volumes überleben. `tale backup` snapshottet die Daten-Volumes oben — `object-store-data` eingeschlossen, solange die Blobs im mitgelieferten Objektspeicher liegen. Blobs in einem externen S3-Bucket, ob umgebogener Deployment-Default oder eigener Bucket einer Organisation, sicherst du selbst, und das Backup sagt dir das; [Backups und Restore](/de/self-hosted/operate/backups-and-restore) hat die Liste und die Übung.

## Provider-Secrets und die SOPS-Schicht

Provider-Keys (OpenAI, Anthropic, Azure, Ollama usw.) liegen auf dem Storage in einem `providers/`-Verzeichnis innerhalb des Config-Stores. Jeder Provider hat eine `<name>.json` und eine `<name>.secrets.json`; die Secrets-Datei ist mit SOPS und der Variable [`SOPS_AGE_KEY`](/de/self-hosted/configuration/environment-reference) verschlüsselt.

Diese Trennung existiert aus zwei Gründen. Einen Provider-Key zu rotieren heißt, eine Datei zu bearbeiten, nicht das Backend neu zu starten; die verschlüsselte Datei zu sichern ist gefahrlos neben der Infrastruktur eincheckbar. Der Klartext-Modus (kein SOPS, Secrets im Klartext bei Modus 0600) wird für streng kontrollierte Umgebungen unterstützt, in denen der Storage selbst at rest verschlüsselt ist.

## Auth und Sessions

Die Anmeldung ist Better Auth, das im backend-api-Container läuft. Die ausgelieferten Modi sind lokale E-Mail/Passwort-Anmeldung (mit optionalem Zweitfaktor und Passkeys), SSO — Microsoft Entra und generisches OIDC — und Trusted Headers, bei denen der Reverse-Proxy die Identität liefert. Der Plattform-Container liest das Cookie und leitet die Anfrage weiter; backend-api validiert die Session und entscheidet, was sie darf, basierend auf der Rolle des Nutzers und der Berechtigungsmatrix pro Ressource, dokumentiert in [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

Die [Authentifizierungs-Referenz](/de/self-hosted/configuration/authentication) behandelt die Env-Vars und die Abwägungen pro Modus.

## Wenn du Single-Host hinter dir lässt

Der Standard-Stack läuft mit jedem Container auf einem Host. Die Architektur ist single-tenant, aber die Tiers trennen sich schon sauber: `tale-backend-worker` skaliert horizontal, und der operative und der Wissens-Speicher sind getrennte Datenbanken, selbst wenn sie sich einen Postgres-Prozess teilen. Das Erste, was du ohne Umbau von der Box holen kannst, ist der Wissens-Korpus — zeige mit `KNOWLEDGE_DATABASE_URL` auf ein gemanagtes ParadeDB (für Kapazität oder eine Residenz-Anforderung), und er verlagert sich unabhängig, behandelt in [Datenresidenz](/de/self-hosted/configuration/data-residency). Der Blob-Store ist das Zweite — eine Org, die unter **Einstellungen > Datenresidenz** ihren eigenen S3-Bucket mitbringt, umgeht den gebündelten `object-store` vollständig.

## Wo das hingehört

Diese Architekturseite ist die Karte, die jede andere selbst-gehostete Seite voraussetzt. Der natürliche nächste Schritt ist [Schnellstart](/de/self-hosted/install/quickstart), wenn du eine frische Instanz aufsetzt, oder [Container-Architektur](/de/self-hosted/operate/container-architecture), wenn du eine betreibst und dasselbe Bild mit überlagerten Fehlermodi brauchst.
