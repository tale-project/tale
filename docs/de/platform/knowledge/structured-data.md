---
title: Dokumente oder strukturierte Datensätze wählen
description: Finde den passenden Ort für Richtlinien, Kontaktdaten, Produktangaben und Website-Inhalte, damit Tale die benötigten Informationen findet.
---

Nutze Dokumente für Inhalte, die eine Erklärung in ganzen Absätzen brauchen, etwa Verträge oder Gesprächsnotizen. Strukturierte Datensätze eignen sich für Angaben mit festen Feldern, etwa die E-Mail-Adresse eines Kontakts oder eine Produktkennung. Meist brauchst du beides: Der Datensatz hält die Stammdaten fest, die Dokumente liefern die Zusammenhänge.

## Den passenden Ort wählen

| Information | Ablage | Grund |
| --- | --- | --- |
| Richtlinie, Vertrag, Handbuch oder Gesprächsnotiz | **Dokumente** | Tale durchsucht den Text und ruft passende Abschnitte ab. |
| Kurze Information mit eigenem Änderungsverlauf | **Wissenseinträge** | Pro Thema gilt eine aktuelle Version; frühere Versionen bleiben erhalten. |
| Person oder Organisation, mit der du arbeitest | **Kontakte** | Feste Felder bündeln die Angaben in einem bearbeitbaren Datensatz. |
| Produkt und seine Eigenschaften | **Produkte** | Produktangaben stehen in Feldern und verschwinden nicht im Fließtext. |
| Seiten einer öffentlichen Website | **Websites** | Tale erfasst die Seiten und aktualisiert die durchsuchbaren Inhalte regelmäßig. |
| Referenzdateien für ein einzelnes Projekt | **Wissen** im Projekt | Der Projektzugriff bestimmt die Sichtbarkeit; Projektchats können die Dateien abrufen. |

Die Ablage bestimmt, wie Tale Informationen abruft. Ein gefundener Dokumentabschnitt bedeutet nicht, dass die gesamte Datei geprüft wurde. Beim Lesen eines Datensatzes erhält Tale dessen Feldwerte. Ob diese noch aktuell sind und die daraus abgeleitete Antwort stimmt, musst du weiterhin prüfen.

## Datensätze mit Dokumenten ergänzen

Du bereitest zum Beispiel ein Gespräch mit Acme vor. Pflege die Kontaktdaten unter **Kontakte** und lege Vertrag und Gesprächsnotizen unter **Dokumente** oder im Bereich **Wissen** des zugehörigen Projekts ab.

Bitte den Chat-Assistenten, den Kontakt zu Acme zu finden und die offenen Fragen aus den letzten Notizen zusammenzufassen. Prüfe die E-Mail-Adresse im Datensatz und die Entscheidungen in den zitierten Notizen. Liegen die Dateien in einem Projekt, starte auch den Chat dort.

<Tip>

Verwende in Datensätzen und zugehörigen Dateien denselben eindeutigen Firmen- oder Produktnamen. Ergänze Gesprächsnotizen um ein Datum und Richtlinien um eine Revisionskennung, damit aktuelle und ältere Quellen erkennbar bleiben.

</Tip>

## Zugriff und Aktualität prüfen

Ein Datensatz oder Dokument hilft nur Personen, die darauf zugreifen dürfen. Prüfe die Team-Zuordnung, wenn jemand einen Eintrag nicht findet. Bei Projektdateien gilt der Projektzugriff statt der Team-Zuordnung der Dokumentbibliothek; siehe [Projektdateien](/de/platform/projects/manage-files).

Ändert sich eine Angabe, aktualisiere den maßgeblichen Datensatz. Warte nach einer Dokumentänderung auf die abgeschlossene Indexierung, bevor du eine Frage zum neuen Inhalt testest. Website-Inhalte folgen dem eingestellten Scan-Intervall und können deshalb hinter der Live-Seite zurückliegen.

## Mit den vorhandenen Datentypen arbeiten

Der Wissensbereich bietet Kontakte, Produkte und Websites. **Einstellungen > Governance > Modelle** steuert den Zugriff auf AI-Modelle und deren Vorauswahl. Dort legst du keine eigenen Datentypen oder Datenbankfelder an.

Passen die vorhandenen Felder nicht zu deinem Inhalt, halte die Details in einem Dokument fest und ordne den Ablauf dem passenden Datensatz zu. Welche Felder sich programmatisch importieren lassen, steht in der [API-Referenz](/de/develop/api-reference).

Unter [Dokumente](/de/platform/knowledge/documents) erfährst du, wie du eine Datei hochlädst und prüfst. [Wissenseinträge](/de/platform/knowledge/knowledge-entries) erklärt die Pflege einzelner Informationen; [Crawling](/de/platform/knowledge/crawling) beschreibt die regelmäßige Erfassung öffentlicher Seiten.
