---
title: Selbst gehostete Architektur
description: Acht Container, eine compose-Datei, eine Postgres-Datenbank. Diese Seite vermittelt das mentale Modell, was jeder Container tut, wo Daten auf dem Storage liegen und welche Secrets beim ersten Boot zählen.
---

Eine Tale-Instanz besteht aus acht Containern hinter einem Caddy-Proxy, die mit einer Postgres-Datenbank sprechen; zwei davon sind Sandbox-Container an der Seite für Code-Ausführung. Die compose-Datei ist der Vertrag — was läuft, was exponiert ist, was gemountet ist. Diese Seite vermittelt das mentale Modell, sodass die Install-, Konfigurations- und Betriebsseiten es nicht erneut erklären müssen.

Lies das, bevor du `docker compose up` ausführst. Komm zurück, wenn du einen Ausfall debuggst und wissen musst, welches Container-Log du zuerst öffnen solltest.

## Die acht Container

**tale-proxy** ist Caddy am Rand. Er terminiert TLS, leitet alles unter `/` an den Plattform-Container und alles unter `/api/` und die Convex-Pfade an den Convex-Container weiter. Health-Checks leben hier.

**tale-platform** ist der React + TanStack Start-Server. Er rendert die UI, liefert statische Assets aus und ist der einzige Container, der dem Browser exponiert ist. Er hält keinen Geschäfts-State — alles, was persistieren muss, spricht mit Convex.

**tale-convex** ist das Backend: die Actions, Queries, Mutations und die WebSocket-Schicht, die die UI abonniert. Provider-Keys, Agent-Definitionen, Automatisierungs-Läufe, Audit-Logs — alles davon lebt hier und wird nach Postgres geschrieben.

**tale-db** ist Postgres. Es hält die Convex-Daten und ist der einzige zustandsbehaftete Container, der für Backups zählt.

**tale-rag** ist der Retrieval-Service: er extrahiert Text aus hochgeladenen Dokumenten, chunked sie, embeddet die Chunks und liefert den Vektor-Index an die Agent-Laufzeit zurück.

**tale-crawler** ist der Crawler für Website-Wissen: er holt und indexiert die URLs, die als Website-Entitäten deklariert sind.

**tale-sandbox** und **tale-sandbox-egress** führen sandboxierten Code für das **Code-ausführen**-Tool und Fähigkeits-Skripte aus. Der Egress-Container ist der einzige Netzwerkweg, den die Sandbox hat; die Allowlist-Richtlinie lebt in der [Governance Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy).

## Daten auf dem Storage

Drei Volumes überleben ein `docker compose down`:

- `db-data` — Postgres-Datenverzeichnis. Das einzige Volume, das Backups einfangen müssen.
- `db-backup` — Ziel für Postgres-Dumps, die der Container nach Plan schreibt.
- Der Object-Store-Mount der Plattform — hochgeladene Dateien, generierte Bilder, exportierte Bundles.

Alles andere ist flüchtig. Container können ohne Datenverlust ersetzt werden, solange die Volumes überleben.

## Provider-Secrets und die SOPS-Schicht

Provider-Keys (OpenAI, Anthropic, Azure, Ollama, etc.) leben auf dem Storage in einem `providers/`-Verzeichnis, das in den Plattform-Container gemountet wird. Jeder Provider hat eine `<name>.config.json` und eine `<name>.secrets.json`; die Secrets-Datei ist mit SOPS und der Variable [`SOPS_AGE_KEY`](/de/self-hosted/configuration/environment-reference) verschlüsselt.

Diese Trennung existiert aus zwei Gründen. Einen Provider-Key zu rotieren ist eine Datei zu bearbeiten, nicht die Plattform neu zu starten; die verschlüsselte Datei zu sichern ist sicher, sie neben der Infrastruktur zu committen. Der Klartext-Modus (kein SOPS, Secrets in Klartext) wird für streng kontrollierte Umgebungen unterstützt, wo der Storage selbst at-rest verschlüsselt ist.

## Auth und Sessions

Sign-in ist Better Auth, das im Convex-Container läuft. Vier Sign-in-Modi sind dabei: lokales Passwort, Microsoft Entra (OAuth/OIDC), generisches OIDC und Trusted Headers (der Reverse-Proxy liefert die Identität). Der Plattform-Container liest das Cookie, übergibt es an Convex, und Convex entscheidet, was die Session tun darf, basierend auf der Rolle des Benutzers und der Berechtigungs-Matrix pro Ressource, die in [Mitglieder und Rollen](/de/platform/admin/members-and-roles) dokumentiert ist.

Die [Authentifizierungs-Referenz](/de/self-hosted/configuration/authentication) behandelt die Umgebungsvariablen und die Trade-offs pro Modus.

## Wenn du Single-Host hinter dir lässt

Die Standard-compose-Datei betreibt alle acht Container auf einem Host. Die Architektur ist single-tenant: nichts im Design teilt Arbeit über Hosts hinweg. Wenn du das hinter dir lässt — typischerweise weil tale-rag oder tale-crawler eigene Ressourcen brauchen, oder du einen Hot-Standby willst — ist der Zug, diese Container auf einen zweiten Host zu extrahieren und die Plattform per Umgebungsvariablen auf sie zu zeigen. Die Convex-Schicht ist immer noch Single-Instance; horizontale Skalierung des Backends ist kein v1-Feature.

## Wo das hingehört

Diese Architektur-Seite ist die Karte, die jede andere selbst-gehostete Seite voraussetzt. Die natürliche nächste Lektüre ist [Quickstart](/de/self-hosted/install/quickstart), wenn du eine frische Instanz aufsetzt, oder [Container-Architektur](/de/self-hosted/operate/container-architecture), wenn du eine betreibst und dasselbe Bild mit den Fehler-Modi überlagert brauchst.
