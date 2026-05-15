---
title: Selbst gehostetes Tale
description: Tale auf eigener Infrastruktur betreiben — installieren mit der CLI, konfigurieren mit Umgebungsvariablen, upgraden mit `tale deploy`.
---

Die selbst gehostete Edition lässt Tale in deinem VPC, deinem Rechenzentrum oder in einer Air-Gap-Umgebung laufen. Du bekommst die vollständige Plattform als Docker-Compose-Bündel, installierst sie mit einem einzigen CLI-Befehl und upgradest mit `tale deploy` — Blue-Green, Zero-Downtime, genau so, wie die [Cloud](/de/cloud)-Edition vorwärtsrollt. Jede nutzerseitige Funktion, die unter [Platform](/de/platform) dokumentiert ist, ist identisch zur Cloud; dieser Bereich behandelt nur, was spezifisch ist für den Betrieb einer eigenen Instanz.

Dieser Bereich richtet sich an die Person, die installiert, konfiguriert, beobachtet, upgradet und sichert. Endnutzer — Mitglieder, Redakteure, Entwickler, Admins — konsumieren [Platform](/de/platform) direkt; die rollenspezifischen Seiten dort gelten auf beiden Editionen. Die einzigen selbst-hosted-spezifischen Oberflächen sind Installation, Konfigurationsdateien und Umgebungsvariablen, Container-Architektur, Observability, Release-Notes und Authentifizierung mit vertrauenswürdigen HTTP-Kopfzeilen.

## In diesem Bereich

Jede Seite steht auf der Ebene einer Betreiber-Entscheidung. Die Form: Titel fett, Gedankenstrich, ein Versprechen in einem Satz.

- **[Selbst-hosted-Übersicht](/de/self-hosted/overview)** — Betreiber, die die Plattform sondieren. Architektur, die fünf Services, die Datenbank-Wahl und was wo läuft.
- **[Installation: Quickstart](/de/self-hosted/install/quickstart)** — Erstinstallateure auf Linux/macOS/Windows. Lokale Installation über die `tale`-CLI, Zehn-Minuten-Durchlauf.
- **[Installation: Linux-Server](/de/self-hosted/install/linux-server)** — Betreiber, die auf einen Produktionsserver deployen. TLS, Reverse-Proxy, Subpath, Härtung.
- **[Konfiguration: Umgebungsreferenz](/de/self-hosted/configuration/environment-reference)** — jede `TALE_*`-Umgebungsvariable, nach Service gruppiert, mit Voreinstellungen.
- **[Konfiguration: Anbieter](/de/self-hosted/configuration/providers)** — KI-Anbieter-Konfigurationsdateien: Schema, Felder, Kostenregeln, Gateway-vs.-direkter-Anbieter-Unterscheidung.
- **[Konfiguration: Aufbewahrung](/de/self-hosted/configuration/retention)** — Aufbewahrungsrichtlinien pro Tabelle und wie sie durchgesetzt werden.
- **[Authentifizierung](/de/self-hosted/admin/authentication)** — Passwort, Microsoft Entra ID SSO und Integration mit vertrauenswürdigen HTTP-Kopfzeilen über einen vorgelagerten Reverse-Proxy.
- **[Container-Architektur](/de/self-hosted/operate/container-architecture)** — wie die fünf Services im internen Docker-Netzwerk verbunden sind, wo Ports nach aussen reichen und wie der Blue-Green-Roll aussieht.
- **[Observability: Betrieb](/de/self-hosted/operate/observability/operations)** — Prometheus-Metriken, Log-Ströme, Health-Probes und was du in deinen Monitoring-Stack verdrahtest.
- **[Observability: Fehlersuche](/de/self-hosted/operate/observability/troubleshooting)** — die drei oder vier Probleme, die Betreiber wirklich sehen, und wie du sie auf einer laufenden Instanz diagnostizierst.
- **[Sicherheitshinweise](/de/self-hosted/operate/security/advisories)** — wie Ruler GmbH CVEs veröffentlicht, wie du sie abonnierst und wer für welchen Patch zuständig ist.
- **[Release-Notes-Format](/de/self-hosted/operate/release-notes/format)** — das kanonische Format für GitHub-Release-Notes; was rein, was raus, wie du sie vor einem Upgrade liest.

## Installiere deine Instanz

Zwei Installationspfade. Wähle den, der zu deiner Umgebung passt.

- **Lokaler Laptop oder Workstation.** Folge dem [Quickstart](/de/self-hosted/install/quickstart) — `tale init my-project`, `tale start`, im Browser zu `https://localhost`. Am besten zum Evaluieren des Produkts oder für einzelne Entwickler.
- **Produktiver Linux-Server.** Folge der [Linux-Server-Installation](/de/self-hosted/install/linux-server) — richtet TLS via Caddy ein, konfiguriert einen vorgelagerten Reverse-Proxy, falls einer davor sitzt, und führt durch Subpath-Deployment. Das ist der kanonische Pfad für organisationsweite Nutzung.

Sobald die Instanz steht, liest jedes Mitglied, jeder Redakteur, jeder Entwickler und jeder Admin, den du einlädst, [Platform](/de/platform); die rollenspezifischen Seiten dort ändern sich zwischen den Editionen nicht.

## Konfigurieren und betreiben

Nach der Installation zählen zwei operative Oberflächen:

- **Konfiguration** — jeder Knopf ist entweder eine Umgebungsvariable oder eine JSON-Konfigurationsdatei unter `TALE_CONFIG_DIR`. Die Referenzseiten unter [Konfiguration](/de/self-hosted/configuration/environment-reference) sind erschöpfend; greif danach, wenn ein Wert angepasst werden muss.
- **Observability** — Tale exportiert Prometheus-Metriken auf dem Port jedes Service, schreibt strukturierte Logs nach stdout und stellt eine Liveness-/Readiness-Probe auf jedem Container bereit. Die Seite [Betrieb](/de/self-hosted/operate/observability/operations) behandelt, was du scrapen, worauf du alerten und was jede Log-Zeile bedeutet.

## Wo das einsetzt

Selbst gehostet ist der Bereich der Betreiberin. Das Produkt selbst — Chat, Agents, Automatisierungen, Wissen, Integrationen, Admin — lebt einmalig unter [Platform](/de/platform) und liest sich hier identisch. Quer-referenziere die Installationsseiten beim Aufbau der Instanz; greif zur Konfigurationsreferenz, wenn ein Wert angepasst werden muss; greif zu den Betriebsseiten, wenn in Produktion etwas schiefläuft. Für Quellbeiträge und die API ist [Develop](/de/develop/api-reference) einen Bereich weiter.
