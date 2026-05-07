---
title: Selbst gehostetes Tale
description: Tale auf eigener Infrastruktur betreiben — installieren, konfigurieren, betreiben.
---

Die selbst gehostete Edition von Tale läuft in deinem VPC, in deinem Rechenzentrum oder in einer Air-Gap-Umgebung. Du bekommst die gesamte Plattform als Docker-Compose-Bundle, das du mit einem einzigen Befehl (`tale deploy`) aktualisierst. Die Zertifizierungen sind dieselben wie in Cloud — ISO 27001, SOC 2 Type II und DSGVO-Konformität — nur für den Betrieb bist du selbst verantwortlich. Jede nutzerseitige Funktion ist identisch zur gemanagten [Cloud](/de/cloud); dieser Bereich beschreibt ausschließlich, was beim Betrieb einer eigenen Instanz dazukommt.

Alles, was Member, Editor, Developer oder Admin täglich nutzen — Chat, Wissensdatenbank, Agents, Automatisierungen, Organisationsverwaltung, Rollenberechtigungen — liegt unter [Platform](/de/platform) und gilt für beide Editionen. Dieser Bereich richtet sich an Operator:innen, die die Instanz installieren, aktualisieren, überwachen und sichern.

## Instanz installieren

Starte mit der [Self-hosted-Übersicht](/de/self-hosted/overview) für Architektur und Services. Danach führt dich der [Installationsleitfaden für Linux-Server](/de/self-hosted/install/linux-server) Schritt für Schritt durch die Einrichtung. TLS, Reverse Proxies und Deployments unter einem Unterpfad sind dort ebenfalls beschrieben.

## Konfigurieren

- [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) — jede Umgebungsvariable, die Tale liest, geordnet nach Service.
- [Aufbewahrung](/de/self-hosted/configuration/retention) — Regeln zur Datenaufbewahrung pro Tabelle.
- [Authentifizierung](/de/self-hosted/admin/authentication) — Passwort-Login, SSO (Microsoft Entra ID) oder Trusted Headers. Self-hosted-spezifisch, weil über Umgebungsvariablen gesteuert.

## Betreiben

- [Container-Architektur](/de/self-hosted/operate/container-architecture) — wie die Services zusammenspielen.
- [Observability](/de/self-hosted/operate/observability/operations) — Metriken, Logs und Health Checks.
- [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting) — Probleme auf einer laufenden Instanz eingrenzen.
- [Sicherheitshinweise](/de/self-hosted/operate/security/advisories) — Patch-Verantwortung und CVE-Tracking.
- [Release Notes](/de/self-hosted/operate/release-notes/format) — wie Release Notes aufgebaut sind, plus Upgrade-Hinweise pro Version.

## Funktionen und Organisationsverwaltung

Funktionsbeschreibungen (Chat, Agents, Automatisierungen, Wissen, Integrationen) und alles zur Organisationsverwaltung (Mitglieder, Rollen, Teams, Branding, Governance, KI-Anbieter, Analytics) stehen unter [Platform](/de/platform). Die rollenbezogenen Endnutzer-Leitfäden liegen ebenfalls dort.
