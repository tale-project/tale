---
title: Selbst gehostetes Tale
description: Tale auf eigener Infrastruktur betreiben — installieren mit der CLI, konfigurieren mit Umgebungsvariablen, upgraden mit `tale deploy`.
kind: index
---

Selbst gehostetes Tale ist dasselbe Produkt wie die [Cloud](/de-CH/cloud)-Edition, paketiert als sechs-Container-Docker-Compose-Stack, den du auf eigener Infrastruktur fährst. Die `tale`-CLI installiert es, Umgebungsvariablen und JSON-Konfigurationsdateien unter `TALE_CONFIG_DIR` konfigurieren es, und `tale deploy` upgradet es Blue-Green, so dass Nutzer nie ein Wartungsfenster sehen. Dieser Bereich ist für die Person, die die Instanz hochzieht und am Laufen hält; Endnutzer — Mitglieder, Redakteure, Entwickler, Admins — lesen [Platform](/de-CH/platform), das in Cloud und Selbsthosting identisch ist.

Drei Stränge ziehen sich durch jede Seite unten. **Installieren** deckt den Weg von einer frischen Box zur laufenden Instanz ab, auf einem Laptop oder einem Produktions-Linux-Server. **Konfigurieren** katalogisiert die Knöpfe, die es gibt — Umgebungsvariablen, Anbieter-Dateien, Aufbewahrungsgrenzen — und wo jeder einzelne auf der Platte lebt. **Betreiben** ist der Dauerzustand — Observability, Fehlersuche, Sicherheitshinweise, Release-Notes, die Authentifizierungs-Oberflächen, die Tale an deinen Identitäts-Anbieter anbinden.

## In diesem Bereich

Die Seiten unten sind in der Reihenfolge, in der ein Operator sie typischerweise erreicht: einen Installationspfad wählen, die Konfigurationsreferenz einmal lesen, dann auf den Betriebsseiten leben.

- **[Selbst-hosted-Übersicht](/de-CH/self-hosted/overview)** — Operatoren, die die Plattform sondieren. Die sechs Container, wo jeder läuft, was jeder Port und jedes Volume tut.
- **[Lokaler Quickstart](/de-CH/self-hosted/install/quickstart)** — Erstinstallateure auf Linux, macOS oder Windows. Lokale Installation über die `tale`-CLI in rund zehn Minuten.
- **[Produktions-Deployment](/de-CH/self-hosted/install/linux-server)** — Operatoren, die auf einen Produktionsserver deployen. TLS, Reverse-Proxies, Subpath-Deployments, externer Postgres, Blue-Green-Upgrades.
- **[Umgebungsreferenz](/de-CH/self-hosted/configuration/environment-reference)** — jede Umgebungsvariable, die Tale liest, gruppiert nach Oberfläche, mit Voreinstellungen aus `.env.example` und den Env-Loadern.
- **[Anbieter](/de-CH/self-hosted/configuration/providers)** — Anbieter-JSON-Dateien, das Kostenschema, die Gateway-vs.-direkter-Anbieter-Passthrough-Regeln und wie man Tale auf einen lokalen Ollama, vLLM oder LocalAI ausrichtet.
- **[Aufbewahrung](/de-CH/self-hosted/configuration/retention)** — das Drei-Schichten-Modell aus Datei, Env und UI, die sechzehn Datenkategorien, der nächtliche Bereinigungsjob und der DSGVO-Löschpfad.
- **[Authentifizierung](/de-CH/self-hosted/admin/authentication)** — Passwort, Microsoft Entra ID SSO und Integration über vertrauenswürdige HTTP-Kopfzeilen mit einem vorgelagerten authentifizierenden Reverse-Proxy.
- **[Container-Architektur](/de-CH/self-hosted/operate/container-architecture)** — wie die sechs Dienste im internen Docker-Netzwerk verbunden sind, die Volume-Karte, die Health-Check-Form und die Blue-Green-Topologie.
- **[Betrieb](/de-CH/self-hosted/operate/observability/operations)** — Prometheus-Metriken, Log-Ströme, Health-Probes, Image-Budgets, Container-Smoke-Tests.
- **[Fehlersuche](/de-CH/self-hosted/operate/observability/troubleshooting)** — die paar Probleme, die Operatoren wirklich sehen, jedes in der Form Symptom-Ursache-Behebung.
- **[Sicherheitshinweise](/de-CH/self-hosted/operate/security/advisories)** — wie CVEs koordiniert werden, wie Operatoren sie abonnieren und wie sich die Patch-Verantwortung zwischen Ruler GmbH und dem Operator aufteilt.
- **[Release-Notes-Format](/de-CH/self-hosted/operate/release-notes/format)** — die kanonische Form von GitHub-Release-Notes, die Reihenfolge der Abschnitte, was jeder Operator vor `tale upgrade` überfliegen sollte.

## Installiere deine Instanz

Zwei Installationspfade, gewählt nach Umgebung.

- **Laptop oder Workstation.** Lies den [Lokalen Quickstart](/de-CH/self-hosted/install/quickstart). Ein `tale init`, ein `tale start`, im Browser zu `https://localhost` — genug, um das Produkt zu evaluieren, eine Demo zu fahren oder gegen die Plattform zu entwickeln. Selbstsigniertes TLS als Voreinstellung, also zeigt der erste Besuch eine Browser-Warnung, durch die du klickst.
- **Produktiver Linux-Server.** Lies [Produktions-Deployment](/de-CH/self-hosted/install/linux-server). Echte Domain, Let's Encrypt TLS, Blue-Green-Topologie, die Upgrades ohne Wartungsfenster übersteht, optionaler externer Postgres. Das ist der kanonische Weg, um Tale einem Team vorzulegen.

Sobald die Instanz steht, liest jedes Mitglied, jeder Redakteur, jeder Entwickler und jeder Admin, den du einlädst, [Platform](/de-CH/platform). Nichts an den rollenindizierten Bereichen dort ändert sich zwischen den Editionen — der Unterschied ist, aus welchem Bereich sie kamen.

## Konfigurieren und betreiben

Nach der Installation zählen zwei Operator-Oberflächen täglich.

Die **Konfigurations**-Oberfläche ist `.env` und `TALE_CONFIG_DIR`. Jeder Laufzeit-Knopf ist entweder eine Umgebungsvariable, die beim Container-Start gelesen wird, oder eine JSON-Datei, die auf der Platte beobachtet wird; die [Umgebungsreferenz](/de-CH/self-hosted/configuration/environment-reference) ist erschöpfend, und die Seiten [Anbieter](/de-CH/self-hosted/configuration/providers) und [Aufbewahrung](/de-CH/self-hosted/configuration/retention) sind die JSON-Datei-Gegenstücke.

Die **Betriebs**-Oberfläche ist die langfristige Gestalt des Tale-Betriebs. Prometheus-Metriken leben auf jedem Dienst, strukturierte Logs gehen nach Docker-stdout, Health-Probes treiben die Blue-Green-Cutover-Entscheidungen. [Betrieb](/de-CH/self-hosted/operate/observability/operations) ist der Index; [Fehlersuche](/de-CH/self-hosted/operate/observability/troubleshooting) ist die Symptom-zur-Behebung-Karte, wenn auf einer lebenden Instanz etwas schiefläuft.

## Wo das einsetzt

Selbst gehostet ist der Operator-Bereich. Das Produkt selbst — Chat, Agents, Automatisierungen, Wissen, Integrationen, Admin — lebt einmal unter [Platform](/de-CH/platform) und liest sich hier identisch. Quer-referenziere die Installationsseiten beim Hochziehen der Instanz, die Konfigurationsreferenz, wenn ein Wert geändert werden muss, die Betriebsseiten, wenn in der Produktion etwas schiefläuft. Für Quellbeiträge und die API ist [Develop](/de-CH/develop/api-reference) einen Bereich weiter.
