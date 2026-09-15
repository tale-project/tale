---
title: Sicherheit und Compliance
description: Zertifizierungen einordnen, Zuständigkeiten klären und Nachweise für eine Sicherheitsprüfung sammeln.
---

Tale verfügt über Zertifizierungen nach ISO/IEC 27001 und SOC 2 Type II. Fordere für eine Sicherheitsprüfung die passenden Zertifikate, den Geltungsbereich der Berichte und ergänzende Unterlagen bei deinem Tale-Kontakt an. Verwende die Nachweise für den Dienst, den deine Organisation bezieht.

Die Produktkontrollen unterstützen eure Prozesse. Ob ein Einsatz eure Anforderungen erfüllt, hängt auch von der Konfiguration, den angebundenen Anbietern und den betrieblichen Abläufen ab.

## Eine Prüfung vorbereiten

Stelle den Dienstleistungsvertrag, die Vereinbarung zur Auftragsverarbeitung, die relevanten Zertifizierungsnachweise und eine Beschreibung der Installation zusammen. Die [Datenschutzerklärung](/de/legal/privacy) und die Angaben zu [Unterauftragsverarbeitern](/de/legal/subprocessors) ergänzen die Prüfung. Halte Version und Geltungsbereich jedes Dokuments fest.

Kläre, welche Organisation und Installation geprüft werden. Eine Zertifizierungsaussage ersetzt nicht die Prüfung, ob ein konkreter Dienst oder eine Konfiguration vom Bericht abgedeckt ist.

## Zuständigkeiten klären

| Bereich | Tale in der Cloud | Deine Organisation |
| --- | --- | --- |
| Hosting und Wartung | Betreibt den vereinbarten Dienst | Wählt das Angebot und stimmt Änderungen ab |
| Identität und Zugriff | Stellt Konten, Rollen und SSO bereit | Fügt Mitglieder hinzu und prüft deren Rechte |
| Modellanbieter und Konnektoren | Stellt Integrationskontrollen bereit | Wählt Dienste, Zugangsdaten und zulässige Nutzung |
| Nutzungs- und Inhaltsrichtlinien | Stellt Regeln und Aufzeichnungen bereit | Konfiguriert Regeln und bearbeitet Ereignisse |
| Datenanfragen und Aufbewahrung | Stellt die unterstützten Abläufe bereit | Legt Anforderungen fest und genehmigt Aktionen |

Im Eigenbetrieb trägt dein Betreiber zusätzlich die Verantwortung für die Infrastruktur. Welche Unterstützung Enterprise umfasst, regelt euer Vertrag.

## Kontrollen im Produkt prüfen

- [Mitglieder und Rollen](/de/platform/admin/members-and-roles) regeln den Zugriff. Prüfe inaktive Konten und erhöhte Rechte.
- [Enterprise-SSO](/de/platform/admin/enterprise-sso) bindet euren Identitätsanbieter an. Teste Anmeldung und Wiederherstellung, bevor du SSO verpflichtend machst.
- [Audit-Logs](/de/platform/admin/governance/audit-logs) helfen bei der Untersuchung erfasster Aktionen. Die [Integritätsprüfung](/de/self-hosted/operate/security/audit-log-integrity) erklärt Manipulationsnachweise und deren Grenzen.
- [Schutzregeln](/de/platform/admin/governance/guardrails), [Legal Hold](/de/platform/admin/governance/legal-hold) und [Betroffenenanfragen](/de/platform/admin/governance/data-subject-requests) unterstützen bestimmte Prozesse. Prüfe ihren Geltungsbereich, bevor du dich auf sie stützt.

## Einen Vorfall melden

Nutze bei einem Betriebsproblem den vereinbarten Enterprise-Supportkanal. Melde vermutete Sicherheitslücken über [GitHubs vertraulichen Meldeweg](https://github.com/tale-project/tale/security) oder an `security@tale.dev`. Nenne die betroffene Version und Schritte zur Reproduktion. Veröffentliche keine Zugangsdaten oder personenbezogenen Daten in einem Issue.

Wo Daten verarbeitet werden, beschreibt [Datenresidenz in der Cloud](/de/cloud/data-residency).
