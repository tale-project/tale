---
title: Sicherheitsmeldungen verfolgen
description: Finde veröffentlichte Sicherheitshinweise, prüfe deine Betroffenheit und melde Schwachstellen vertraulich.
---

Prüfe bei einem Sicherheitsupdate die [GitHub Security Advisories von Tale](https://github.com/tale-project/tale/security/advisories) und die [Release-Hinweise](https://github.com/tale-project/tale/releases) der Zielversion. Die [Sicherheitsrichtlinie](https://github.com/tale-project/tale/security/policy) des Repositorys legt Meldeweg und unterstützte Versionen fest.

## Eine Meldung bewerten

Lies zuerst, welche Versionen betroffen und welche korrigiert sind. Vergleiche sie mit dem laufenden System und seinen aktivierten Komponenten, nicht nur mit der CLI auf deinem Rechner.

| Information | Was du klären solltest |
| --- | --- |
| Betroffene Versionen und Komponenten | Ob der verwundbare Code in deiner Installation vorhanden ist. |
| Voraussetzungen und Auswirkungen | Ob deine Konfiguration den betroffenen Pfad zugänglich macht und welcher Zugriff möglich wäre. |
| Korrigierte Versionen | Welches Release die Korrektur enthält. |
| Schweregrad und gegebenenfalls CVSS-Vektor | Welche Auswirkungen und Annahmen bewertet wurden; ergänze deine eigene Expositionsanalyse. |
| Übergangslösungen | Welche vorübergehenden Einschränkungen helfen, wenn das Update nicht sofort möglich ist. |
| Kennung und Referenzen | Welchen dauerhaften Nachweis du im Vorfalls- und Deployment-Protokoll verwendest. |

Ein privates Netzwerk allein beweist nicht, dass deine Installation sicher ist. Anmeldung, Connector-Verhalten und interne Zugriffe können weiterhin relevant sein. Bestimme die Dringlichkeit anhand der Meldung und deines Ablaufs für Sicherheitsvorfälle.

## Die Korrektur einspielen und prüfen

Tale ist ein fortlaufend aktualisiertes 0.x-Projekt. Sicherheitskorrekturen erscheinen nur in der neuesten Version; ältere Versionen erhalten keine Rückportierungen. Lies alle Release-Hinweise bis zum Ziel und folge der [Upgrade-Anleitung](/de/self-hosted/operate/upgrades), einschließlich Backup und Wiederherstellungsvorbereitung.

Dokumentiere die installierte Korrektur und prüfe das betroffene Verhalten nach dem Deployment. Hebe eine vorübergehende Schutzmaßnahme erst auf, wenn die korrigierte Runtime läuft und deine Prüfungen erfolgreich sind.

## Eine Schwachstelle vertraulich melden

Öffne im Repository den Tab **Security** und wähle **Report a vulnerability**. Falls du GitHub nicht nutzen kannst, schreibe an `security@tale.dev`. Veröffentliche eine noch nicht korrigierte Schwachstelle nicht in einem öffentlichen Issue.

Nenne Komponente und Version, Schritte zur Reproduktion und vermutete Auswirkungen. Nutze ein möglichst kleines Beispiel ohne Zugangsdaten, personenbezogene Daten oder unnötige Produktionsdatensätze. Auf Wunsch nennt die spätere Sicherheitsmeldung den Reporter.

Die Sicherheitsrichtlinie sieht Bestätigung und erste Bewertung innerhalb von 72 Stunden vor, eine vertraulich mit dem Reporter geteilte Korrektur oder Übergangslösung innerhalb von 14 Tagen sowie ein GitHub Security Advisory zur korrigierten Version. Stimme die Untersuchung über die vertrauliche Meldung ab.

## Die Prüfung regelmäßig durchführen

Speichere die Seiten für Sicherheitsmeldungen und Releases und nimm sie in deine regelmäßige Update-Prüfung auf. Halte fest, wer sie prüft, welche Installationen betroffen sind und wohin dringende Befunde eskaliert werden. Die [Release-Prüfung](/de/self-hosted/operate/release-notes/format) enthält den übergreifenden Ablauf; [Härtung](/de/self-hosted/operate/security/hardening) beschreibt Schutzmaßnahmen zwischen Updates.
