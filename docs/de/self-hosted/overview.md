---
title: Selbst gehostete Architektur
description: Acht Container, eine compose-Datei, zwei Postgres-Datenbanken. Diese Seite vermittelt das mentale Modell, was jeder Container tut, wo Daten auf dem Storage liegen und welche Secrets beim ersten Boot zählen.
---

Eine Tale-Instanz besteht aus acht Containern hinter einem Caddy-Proxy, die mit zwei Postgres-Datenbanken sprechen — einer operativen, einer für den Wissens-Korpus; zwei davon sind Sandbox-Container an der Seite für Code-Ausführung. Die compose-Datei ist der Vertrag — was läuft, was exponiert ist, was gemountet ist. Diese Seite vermittelt das mentale Modell, sodass die Install-, Konfigurations- und Betriebsseiten es nicht erneut erklären müssen.

Lies das, bevor du `docker compose up` ausführst. Komm zurück, wenn du einen Ausfall debuggst und wissen musst, welches Container-Log du zuerst öffnen solltest.

## Die acht Container

**tale-proxy** ist Caddy am Rand. Er terminiert TLS, leitet alles unter `/` an den Plattform-Container und alles unter `/api/` und die Convex-Pfade an den Convex-Container weiter. Health-Checks leben hier.

**tale-platform** ist der React + TanStack Start-Server. Er rendert die UI, liefert statische Assets aus und ist der einzige Container, der dem Browser exponiert ist. Er hält keinen Geschäfts-State — alles, was persistieren muss, spricht mit Convex.

**tale-convex** ist das Backend: die Actions, Queries, Mutations und die WebSocket-Schicht, die die UI abonniert. Provider-Keys, Agent-Definitionen, Workflow-Läufe, Audit-Logs — alles davon lebt hier. Es läuft auch die Wissens-Arbeit im Prozess — Dokument-Ingestion, Web-Crawling, RAG-Suche und Dokumentgenerierung sind Convex-Node-Actions, keine separaten Services. Die Headless-Arbeit, die diese Jobs brauchen (eine Webseite rendern, HTML in ein PDF oder Bild verwandeln), wird an die Sandbox-Laufzeit delegiert, die ohnehin schon Chromium und Playwright mitbringt.

**tale-db** ist das operative Postgres (ParadeDB). Es hält die Daten des Convex-Backends — Agents, Runs, das Audit-Log — und ist einer der zwei zustandsbehafteten Container, die für Backups zählen.

**tale-knowledge-db** ist das Postgres des Wissens-Korpus (ParadeDB), die `tale_knowledge`-Datenbank mit zwei Schemata: `private_knowledge` (Chunks hochgeladener Dokumente, Embeddings, der BM25-Index, der semantische Cache) und `public_web` (gecrawlte Webseiten). Es ist von `tale-db` getrennt, damit der Korpus — der datenresidenz-sensible Speicher — sich für sich allein verlagern oder ersetzen lässt. Das Convex-Backend verbindet sich direkt mit ihm; nichts sonst tut das.

**tale-sandbox-llm-gateway** ist das LLM-Gateway für Sandbox-Agents. Es ist der einzige Pfad von einem sandboxierten Agent zu einem Modell-Provider; die Plattform stellt es bereit und prägt Per-Session-Keys.

**tale-sandbox** und **tale-sandbox-egress** führen sandboxierten Code für das **Code-ausführen**-Tool und Fähigkeits-Skripte aus und dienen als die Headless-Browser-Laufzeit, die das Convex-Backend für Web-Render und Dokumentgenerierung aufruft. Der Egress-Container ist der einzige Netzwerkweg, den die Sandbox hat. Egress ist standardmäßig offen — sandboxierter Code erreicht jeden öffentlichen Host über HTTPS, Cloud-Metadaten und private Adressbereiche bleiben auf IP-Ebene blockiert. Einschränken kannst du das mit `SANDBOX_EGRESS_ALLOWLIST` auf eine Hostname-Allowlist; die Anleitung steht in [Hardening](/de/self-hosted/operate/security/hardening).

Ein weiterer Service kommt mit, bleibt aber standardmäßig aus: **tale-controller** ist ein Opt-in-Sidecar (das `controller`-compose-Profil), der den Convex-Container auf eine signierte Anfrage der App neu startet, damit eine Datenresidenz-Änderung greifen kann, ohne der browserzugewandten Plattform Docker-Socket-Zugriff zu geben.

## Daten auf dem Storage

Vier Volumes überleben ein `docker compose down`:

- `db-data` — das Datenverzeichnis des operativen Postgres: die Datenbank hinter Agents, Runs und dem Audit-Log.
- `knowledge-db-data` — das Datenverzeichnis des Postgres für den Wissens-Korpus: Dokument-Chunks, Embeddings, die Such-Indizes und gecrawlte Webseiten. Sichert separat von `db-data`, weil es eine eigene Datenbank ist.
- `backups` — checksummengesicherte Volume-Snapshots, geschrieben von `tale backup` und automatisch vor migrierenden Deploys; [Backups und Restore](/de/self-hosted/operate/backups-and-restore) ist der Drill.
- Der Object-Store-Mount von Convex — hochgeladene Dateien, generierte Dokumente, exportierte Bundles.

Alles andere ist flüchtig. Container können ohne Datenverlust ersetzt werden, solange die Volumes überleben.

## Provider-Secrets und die SOPS-Schicht

Provider-Keys (OpenAI, Anthropic, Azure, Ollama, etc.) leben auf dem Storage in einem `providers/`-Verzeichnis, das in den Plattform-Container gemountet wird. Jeder Provider hat eine `<name>.json` und eine `<name>.secrets.json`; die Secrets-Datei ist mit SOPS und der Variable [`SOPS_AGE_KEY`](/de/self-hosted/configuration/environment-reference) verschlüsselt.

Diese Trennung existiert aus zwei Gründen. Einen Provider-Key zu rotieren ist eine Datei zu bearbeiten, nicht die Plattform neu zu starten; die verschlüsselte Datei zu sichern ist sicher, sie neben der Infrastruktur zu committen. Der Klartext-Modus (kein SOPS, Secrets in Klartext) wird für streng kontrollierte Umgebungen unterstützt, wo der Storage selbst at-rest verschlüsselt ist.

## Auth und Sessions

Sign-in ist Better Auth, das im Convex-Container läuft. Vier Sign-in-Modi sind dabei: lokales Passwort, Microsoft Entra (OAuth/OIDC), generisches OIDC und Trusted Headers (der Reverse-Proxy liefert die Identität). Der Plattform-Container liest das Cookie, übergibt es an Convex, und Convex entscheidet, was die Session tun darf, basierend auf der Rolle des Benutzers und der Berechtigungs-Matrix pro Ressource, die in [Mitglieder und Rollen](/de/platform/admin/members-and-roles) dokumentiert ist.

Die [Authentifizierungs-Referenz](/de/self-hosted/configuration/authentication) behandelt die Umgebungsvariablen und die Trade-offs pro Modus.

## Wenn du Single-Host hinter dir lässt

Die Standard-compose-Datei betreibt alle acht Container auf einem Host. Die Architektur ist single-tenant: nichts im Design teilt Arbeit über Hosts hinweg. Das Erste, was du ohne Re-Architektur von der Box bewegen kannst, ist der Wissens-Korpus — `tale-knowledge-db` ist ein eigenständiges Postgres, also ist es eine Connection-String-Änderung, es auf verwaltete Infrastruktur zu zeigen (für Kapazität oder eine Residenz-Anforderung), behandelt in [Datenresidenz](/de/self-hosted/configuration/data-residency). Die Convex-Schicht ist immer noch Single-Instance; horizontale Skalierung des Backends ist kein v1-Feature.

## Wo das hingehört

Diese Architektur-Seite ist die Karte, die jede andere selbst-gehostete Seite voraussetzt. Die natürliche nächste Lektüre ist [Quickstart](/de/self-hosted/install/quickstart), wenn du eine frische Instanz aufsetzt, oder [Container-Architektur](/de/self-hosted/operate/container-architecture), wenn du eine betreibst und dasselbe Bild mit den Fehler-Modi überlagert brauchst.
