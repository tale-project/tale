---
title: Ein Release vor dem Upgrade prüfen
description: Finde das Zielrelease, bewerte die Folgen für deine Installation und bereite das Upgrade vor.
---

Lies die [Release-Hinweise auf GitHub](https://github.com/tale-project/tale/releases) für die Version, die du bereitstellen möchtest. Gehe von deiner installierten Version aus und prüfe jedes Release bis zum Ziel. Eine Patch-Nummer allein bedeutet nicht, dass Migrationen oder manuelle Schritte entfallen.

## Den Ausgangspunkt bestimmen

Mit `tale --version` ermittelst du die CLI-Version. Prüfe zusätzlich die laufende Runtime-Version: Die CLI zu aktualisieren und die Container neu bereitzustellen sind getrennte Vorgänge. Bei einem verwalteten Deployment nutzt du den Deployment-Beleg mit den festgelegten Quell-Commits und Image-Digests.

`tale update` wählt in der aktuellen CLI eine neuere Version innerhalb der bestehenden `x.y`-Reihe. Ein Wechsel zwischen Release-Reihen erfordert `--version`. Die Optionen deiner installierten CLI findest du mit `tale update --help`; die Release-Hinweise liest du auf GitHub.

## Die Folgen für den Betrieb bewerten

Prüfe ein Release in dieser Reihenfolge. Überschriften und Detailtiefe können variieren. Lies verlinkte Migrationshinweise oder Sicherheitsmeldungen vor der Bereitstellung.

| Information | Deine Entscheidung |
| --- | --- |
| Inkompatible Änderungen und Verhaltensänderungen | Welche Abläufe, Standardwerte oder Konfigurationen ändern sich? |
| Migrationen und Upgrade-Anleitung | Welche Voraussetzungen, Unterbrechungen oder Wiederherstellungsschritte sind nötig? |
| API-Änderungen | Brauchen Clients neue Anfragefelder, angepasstes Verhalten oder eine andere Fehlerbehandlung? |
| Sicherheit | Ist deine Installation betroffen, und welche korrigierte Version oder Übergangslösung hilft? |
| Bekannte Probleme | Sind die Einschränkungen akzeptabel und die Übergangslösungen praktikabel? |
| Neuerungen und vollständige Änderungsliste | Welche Funktionen und Korrekturen sollten deine Benutzer kennen? |

Tale ist ein fortlaufend aktualisiertes 0.x-Projekt. Auch Patch-Releases können additive Migrationen und Verhaltensänderungen enthalten. Sicherheitskorrekturen erscheinen in der neuesten Version, ohne Rückportierung auf ältere Versionen. Massgeblich ist die [Sicherheitsrichtlinie](https://github.com/tale-project/tale/security/policy).

## Die Änderung vorbereiten

1. Notiere Ausgangs- und Zielversion sowie die genauen Quell-Referenzen bei verwalteten Deployments.
2. Lies die dazwischenliegenden Release-Hinweise. Achte auf Konfiguration, Anmeldung, Datenspeicherung und Integrationen.
3. Plane Backup, Wiederherstellung und Wartungsfenster anhand der [Upgrade-Anleitung](/de/self-hosted/operate/upgrades).
4. Erprobe das Ziel in einer getrennten Umgebung mit deinen wichtigen Abläufen, einschliesslich API-Clients und Freigaberegeln.
5. Prüfe nach dem Deployment den Systemzustand und wiederhole diese Abläufe. Bewahre die Release-Hinweise beim Deployment-Protokoll auf.

Ein erfolgreich heruntergeladenes Image belegt nicht, dass die Anwendung nach einer Migration funktioniert. Prüfe die laufende Plattform, bevor du das Upgrade abschliesst. Unter [Sicherheitsmeldungen](/de/self-hosted/operate/security/advisories) erfährst du, wie du eine Schwachstelle bewertest und meldest.
