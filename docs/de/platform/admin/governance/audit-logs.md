---
title: Audit-Logs
description: Finde protokollierte Änderungen, prüfe Ereignisdetails, exportiere Ergebnisse und kontrolliere die Audit-Kette.
---

Öffne als Admin oder Inhaber **Einstellungen > Richtlinien > Protokolle**, um protokollierte Aktionen deiner Organisation zu untersuchen. Suche zuerst das Ereignis und den Zeitpunkt. Prüfe danach Akteur, Ziel, Ergebnis und vorhandene Änderungsdetails.

## Eine Änderung finden

1. Wähle **Audit-Protokolle** und öffne **Filter**.
2. Wähle die passende Kategorie, etwa Mitgliedsänderungen, Sicherheit oder Daten.
3. Finde das Ereignis anhand von Zeitpunkt, Aktion und Ziel. Öffne die Zeile für die Details.
4. Prüfe den Status: Ein abgelehnter oder fehlgeschlagener Versuch belegt nicht, dass die Änderung erfolgreich war.

Aktiver Tab und Kategorie stehen in der URL. Du kannst die Ansicht deshalb als Lesezeichen speichern. Der Zugriff hängt weiterhin von deinen Organisationsberechtigungen ab.

## Ein Ereignis lesen

| Feld | Worauf du achtest |
| --- | --- |
| Zeitstempel | Wann Tale die Aktion protokolliert hat. |
| Aktion | Welcher Vorgang versucht oder abgeschlossen wurde. Manche neueren Aktionen erscheinen mit ihrem technischen Namen. |
| Benutzer | Welche Person oder welcher Systemakteur verantwortlich war. |
| Ressource und Ziel | Um welche Art von Eintrag und welchen konkreten Datensatz es geht. |
| Kategorie | Welche Gruppe der Filter verwendet. |
| Status | Erfolg, Fehler oder abgelehnt. |
| Detailansicht | Vorhandener vorheriger/neuer Zustand, geänderte Felder, Metadaten und Fehlerdetails. Nicht jedes Ereignis enthält alle Angaben. |

Nutze das Protokoll als Nachweis der darin erfassten Ereignisse. Es enthält keine vollständige Kopie aller Gespräche, Anbieterantworten oder Aktivitäten externer Dienste.

## Den richtigen Tab wählen

**Audit-Protokolle** enthält einzelne Ereignisse. Die Ansicht für Anmeldesperren hilft bei blockierten Anmeldungen. Aktivitätslogs fassen Vorgänge und Ergebnisse über einen Zeitraum zusammen. Fehlerlogs konzentrieren sich auf Fehler und lassen sich nach Kategorie eingrenzen.

Kann sich ein Mitglied nicht anmelden, beginne mit den Anmeldesperren und der [Anleitung zur Kontosicherheit](/de/platform/admin/two-factor-authentication). Wurde eine Konfiguration unerwartet geändert, prüfe das Audit-Ereignis und seine Details.

## Ergebnisse exportieren

Setze den Kategoriefilter, öffne **Exportieren** und wähle CSV oder JSON. CSV liefert flache Spalten für Tabellenprogramme, darunter UTC-Zeitstempel, Akteur- und Ressourcenkennungen, Status und Fehler. JSON enthält die ausführlicheren Ereignisobjekte samt vorhandenen Änderungsdaten und Integritätshashes.

Exporte berücksichtigen den Kategoriefilter und enthalten höchstens 10.000 Zeilen, beginnend mit den neuesten. Sie werden auf dem Server erzeugt und über einen vorübergehend gültigen Link heruntergeladen. Ein gefilterter oder begrenzter Export ist eine Auswahl von Nachweisen, nicht zwangsläufig die gesamte Historie oder eine vollständige Hash-Kette.

## Aufbewahrung und Integrität

Wähle im Bereich der Kettenintegrität **Jetzt prüfen**, um die gespeicherte Audit-Kette zu kontrollieren. Der Bereich zeigt den Status und die letzte automatische Prüfung. Wird eine Unterbrechung gemeldet, sichere die Details und untersuche sie mit dem Betreiber, bevor du dich auf diesen Teil der Historie verlässt.

Eine erfolgreiche Prüfung gilt für die aufbewahrten Datensätze, die sie untersucht hat. Sie belegt keinen unabhängig signierten Ursprung der Historie. Die [Integritätsanleitung für den Betrieb](/de/self-hosted/operate/security/audit-log-integrity) erklärt die Prüfungen und ihre Grenzen.

Die Hash-Verkettung hilft, Veränderungen gespeicherter Datensätze zu erkennen. Sie beweist nicht, dass jede mögliche Aktion protokolliert wurde. Die Audit-Aufbewahrung ist unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) einstellbar. Prüfe die aktive Richtlinie und Deployment-Grenzen, statt eine feste Dauer anzunehmen. Wiederherstellbare Audit-Einträge können im [Papierkorb](/de/platform/admin/governance/trash) erscheinen. Endgültige Bereinigung begrenzt die verfügbare Historie.
