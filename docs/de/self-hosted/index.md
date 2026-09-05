---
title: Selbst gehostet
description: Selbst gehostetes Tale läuft auf deiner Infrastruktur — on-premise, in deiner VPC oder air-gapped.
kind: index
---

Selbst gehostetes Tale läuft auf deiner eigenen Infrastruktur — on-premise, in deiner VPC oder air-gapped. Neun Container, deine Daten auf deinem Storage, keine Pro-Sitz-Abrechnung und kein Traffic, der zu Tales Servern fließt, außer du richtest einen Anbieter dort ein.

Dieser Abschnitt ist für Operator: die Leute, die entscheiden, wo Tale läuft, es installieren, konfigurieren, gepatcht halten und den Pager übernehmen, wenn etwas schiefgeht. Endnutzer von selbst gehosteten Instanzen lesen meist den Reiter Plattform — die Produktoberfläche ist zwischen den Editionen identisch.

## Seiten in diesem Abschnitt

**[Architektur-Überblick](/de/self-hosted/overview)** — was jeder Container tut, wo Daten auf dem Storage liegen, was mit was spricht.

**[Installation](/de/self-hosted/install/quickstart)** — Quickstart auf dem Laptop, Produktions-Setup auf einem Linux-Host, die docker-compose-Referenz, erstes Admin-Setup, das CLI-Installationsskript.

**[Konfiguration](/de/self-hosted/configuration/environment-reference)** — jede Umgebungsvariable, Provider-Dateien, Authentifizierungsmodi, TLS, Speicher, Aufbewahrung, SOPS-verschlüsselte Secrets, Observability.

**[Betrieb](/de/self-hosted/operate/container-architecture)** — Upgrades, Backups und Restore, Observability und Troubleshooting, Security-Advisories, Härtung, Format der Release Notes.

**[Mitwirken](/de/self-hosted/contributing-docker)** — wie du eine lokale Container-Änderung baust und testest.

## Wo das hingehört

Selbst gehostet ist die Edition, in der der Operator mehr vom Stack besitzt. Wenn dein Team klein ist und der Betriebsaufwand die Produktarbeit verdrängen würde, ist [Cloud](/de/cloud) die andere Form desselben Produkts. Wenn du gerade eine frische Instanz aufsetzt, ist [Quickstart](/de/self-hosted/install/quickstart) der richtige nächste Lesestoff.
