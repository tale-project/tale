---
title: Selbst gehostete Architektur
description: Elf Container in einer compose-Datei, davon zwei Postgres-Datenbanken und ein S3-kompatibler Blob-Store. Diese Seite vermittelt das mentale Modell, was jeder Container tut, wo Daten auf dem Storage liegen und welche Secrets beim ersten Boot zählen.
---

Eine Tale-Instanz besteht aus elf Containern hinter einem Caddy-Proxy, die mit zwei Postgres-Datenbanken sprechen — einer operativen, einer für den Wissens-Korpus — und mit einem S3-kompatiblen Blob-Store; zwei davon sind Sandbox-Container an der Seite für Code-Ausführung. Die compose-Datei ist der Vertrag — was läuft, was exponiert ist, was gemountet ist. Diese Seite vermittelt das mentale Modell, sodass die Install-, Konfigurations- und Betriebsseiten es nicht erneut erklären müssen.

Lies das, bevor du `docker compose up` ausführst. Komm zurück, wenn du einen Ausfall debuggst und wissen musst, welches Container-Log du zuerst öffnen solltest.

## Die elf Container

**tale-proxy** ist Caddy am Rand. Er terminiert TLS, liefert HTML und statische Assets aus dem Plattform-Container und leitet alles unter `/api/` — plus `/events`, `/dav` und die Maschinen-API — an das Backend weiter. Er veröffentlicht außerdem den Bucket-Pfad des Blob-Stores, damit präsignierte Upload- und Download-URLs im Browser funktionieren. Health-Checks leben hier.

**tale-platform** ist der React + TanStack Start-Server. Er rendert die UI, liefert statische Assets aus und terminiert den Screencast-Socket für die Live-Browser-Ansicht. Er hält keinen Geschäfts-State und erreicht keine Datenbank — alles, was persistiert, geht durch das Backend.

**backend-api** ist das Anwendungs-Backend: ein Node-Prozess mit einer Hono-App, der jede Tür bedient, die die UI und die Maschinen-API brauchen — Anmeldung, App-API, WebDAV, den Live-Update-Stream. Provider-Keys, Agent-Definitionen, Workflow-Läufe und Audit-Logs liegen dahinter. Die Wissens-*Suche* läuft in diesem Prozess und fragt die Korpus-Datenbank direkt ab, nicht über einen separaten Retrieval-Dienst.

**backend-worker** ist dasselbe Image in der Worker-Rolle. Er fährt die Hintergrund-Jobs — Dokument-Ingestion und Embedding, Web-Crawling, Automation-Runs, Retention-Sweeps — aus einer pg-boss-Warteschlange, die in der Anwendungsdatenbank liegt: Ein Job committet damit in derselben Transaktion wie der Write, der ihn geplant hat. Die Headless-Arbeit, die einige dieser Jobs brauchen (eine Webseite rendern, HTML in ein PDF oder Bild verwandeln), geht an die Sandbox-Laufzeit, die ohnehin schon Chromium und Playwright mitbringt. Der Worker bedient kein HTTP.

**tale-db** ist das operative Postgres (ParadeDB). Es hält die `tale_app`-Datenbank — Agents, Runs, Sessions, das Audit-Log und die Job-Warteschlange — und das Backend legt seine Schema-Migrationen beim Boot darauf an, unter einem Advisory Lock, sodass ein rollender Deploy genau einmal migriert.

**tale-object-store** ist der Blob-Store: eine S3-kompatible MinIO-Instanz mit jedem hochgeladenen Dokument, Chat-Anhang, Audio und generierten Medium. S3-kompatibler Speicher ist das einzige Blob-Backend, ein Deployment ohne einen lehnt also jeden Upload ab. Er ist nur intern erreichbar; das Backend signiert präsignierte URLs, und der Proxy leitet sie weiter.

**tale-knowledge-db** ist das Postgres des Wissens-Korpus (ParadeDB), die `tale_knowledge`-Datenbank mit zwei Schemata: `private_knowledge` (Chunks hochgeladener Dokumente, Embeddings, der BM25-Index, der semantische Cache) und `public_web` (gecrawlte Webseiten). Dass er über einen eigenen Connection-String adressierbar bleibt, ist genau das, was den Korpus — den datenresidenz-sensiblen Speicher — für sich allein verlagerbar oder ersetzbar macht. Auf einem Single-Host-`tale deploy`-Stack ist er in `tale-db` gefaltet, das den Netzwerk-Alias `knowledge-db` trägt, sodass der Connection-String in beiden Fällen auflöst.

**tale-sandbox-llm-gateway** ist das LLM-Gateway für Harness-Züge. Es ist der einzige Pfad von einem sandboxierten Harness zu einem Modell-Provider; die Plattform stellt es bereit und prägt Per-Session-Keys.

**bgutil-provider** ist ein Drittanbieter-Helfer für die Video-Link-Aufnahme: Er stellt die Tokens aus, die YouTube verlangt, bevor ein Transkript geholt werden kann. Es ist das einzige Image im Stack, das Tale nicht selbst baut, es ist nur intern erreichbar, und ein Deployment, das nie Video-Links aufnimmt, kann es stoppen, ohne dass sonst etwas leidet.

**tale-sandbox** und **tale-sandbox-egress** führen sandboxierten Code für das **Code-ausführen**-Tool und Fähigkeits-Skripte aus und dienen als die Headless-Browser-Laufzeit, die das Backend für Web-Render und Dokumentgenerierung aufruft. Der Egress-Container ist der einzige Netzwerkweg, den die Sandbox hat. Egress ist standardmäßig offen — sandboxierter Code erreicht jeden öffentlichen Host über HTTPS, Cloud-Metadaten und private Adressbereiche bleiben auf IP-Ebene blockiert. Einschränken kannst du das mit `SANDBOX_EGRESS_ALLOWLIST` auf eine Hostname-Allowlist; die Anleitung steht in [Hardening](/de/self-hosted/operate/security/hardening).

## Daten auf dem Storage

Fünf Volumes überleben ein `docker compose down`:

- `db-data` — das Datenverzeichnis des operativen Postgres: die Datenbank hinter Agents, Runs, Sessions, dem Audit-Log und der Job-Warteschlange.
- `knowledge-db-data` — das Datenverzeichnis des Postgres für den Wissens-Korpus: Dokument-Chunks, Embeddings, die Such-Indizes und gecrawlte Webseiten. Getrennt von `db-data`, weil es eine eigene Datenbank ist, und auf einem Stack, der den Korpus in `tale-db` gefaltet hat, gar nicht vorhanden.
- `object-store-data` — der Blob-Store: jedes hochgeladene Dokument, jeder Chat-Anhang, jede Audiodatei und jedes generierte Medium.
- `convex-data` — der Org-Config-Baum: Agents, Automations, Connectors, Anbieter, Skills, Governance-Policies, SSO-Verbindungen, Branding. Der Name ist historisch und bleibt bewusst, damit die Abschaltung des Convex-Backends niemanden zwingt, ein Volume nur für eine Umbenennung zu migrieren.
- `backups` — checksummengesicherte Volume-Snapshots, geschrieben von `tale backup` und automatisch vor migrierenden Deploys; [Backups und Restore](/de/self-hosted/operate/backups-and-restore) ist der Drill.

Auf `object-store-data` musst du achten: Ein `tale backup`-Snapshot enthält es **nicht**, hochgeladene Dateien brauchen also ihren eigenen Platz in deinem Backup-Job. Alles andere ist flüchtig. Container können ohne Datenverlust ersetzt werden, solange die Volumes überleben.

## Provider-Secrets und die SOPS-Schicht

Config-Datei-Secrets — die Secrets-Sidecars der Anbieter, die Passwörter der Wissens- und Objektspeicher-Verbindungen, die Secrets der Deployment-Config selbst — leben auf dem Storage im Org-Config-Baum, verschlüsselt mit SOPS und der Variable [`SOPS_AGE_KEY`](/de/self-hosted/configuration/environment-reference). Die Backend-Container mounten diesen Baum read-write und sind die einzigen Prozesse, die den age-Schlüssel halten; die Web-Schicht mountet dasselbe Volume read-only für Branding-Bilder und entschlüsselt nie etwas.

Diese Trennung existiert aus zwei Gründen. Ein Secret zu rotieren ist eine Datei zu bearbeiten, nicht die Plattform neu zu starten; die verschlüsselte Datei zu sichern ist sicher, sie neben der Infrastruktur zu committen. Der Klartext-Modus (kein SOPS, Secrets in Klartext) wird für streng kontrollierte Umgebungen unterstützt, wo der Storage selbst at-rest verschlüsselt ist.

## Auth und Sessions

Sign-in ist Better Auth, das im Backend läuft. Vier Sign-in-Modi sind dabei: lokales Passwort, Microsoft Entra (OAuth/OIDC), generisches OIDC und Trusted Headers (der Reverse-Proxy liefert die Identität). Der Proxy schickt alles unter `/api/auth/` direkt an `backend-api`, die Web-Schicht steht also gar nicht im Anmelde-Pfad: Der Browser hält ein Session-Cookie, das Backend löst es bei jeder Anfrage auf, und das Backend entscheidet aus der Rolle des Benutzers und der Berechtigungs-Matrix pro Ressource, was die Session tun darf — dokumentiert in [Mitglieder und Rollen](/de/platform/admin/members-and-roles). Sessions liegen in Postgres, und deshalb meldet ein Neustart eines Backend-Containers niemanden ab.

Die [Authentifizierungs-Referenz](/de/self-hosted/configuration/authentication) behandelt die Umgebungsvariablen und die Trade-offs pro Modus.

## Wenn du Single-Host hinter dir lässt

Die Standard-compose-Datei betreibt alle elf Container auf einem Host. Das Erste, was du ohne Re-Architektur von der Box bewegen kannst, ist der Wissens-Korpus — er wird über einen eigenen Connection-String adressiert, ihn auf verwaltete Infrastruktur zu zeigen (für Kapazität oder eine Residenz-Anforderung) ist also eine Änderung an `KNOWLEDGE_DATABASE_URL`, behandelt in [Datenresidenz](/de/self-hosted/configuration/data-residency). Der Blob-Store bewegt sich genauso: Du richtest die Objektspeicher-Verbindung des Deployments auf einen Bucket, der dir gehört.

Die Backend-Schicht skaliert nach außen, nicht nach oben. `backend-api` und `backend-worker` nehmen beide `--scale`: Jeder API-Container pollt die Hinweis-Outbox und fächert Updates an seine eigenen Clients aus, es gibt also keine Koordination zwischen Containern und keine Sticky Sessions zu arrangieren, und jeder Worker konkurriert um dieselbe pg-boss-Warteschlange. Einzeln bleibt Postgres — ein Primary, und der Blob-Store daneben.

## Wo das hingehört

Diese Architektur-Seite ist die Karte, die jede andere selbst-gehostete Seite voraussetzt. Die natürliche nächste Lektüre ist [Quickstart](/de/self-hosted/install/quickstart), wenn du eine frische Instanz aufsetzt, oder [Container-Architektur](/de/self-hosted/operate/container-architecture), wenn du eine betreibst und dasselbe Bild mit den Fehler-Modi überlagert brauchst.
