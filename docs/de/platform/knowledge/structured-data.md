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

## Einen Kontakt anlegen

Zum Pflegen der Organisationsdatensätze brauchst du die Rolle Redakteur oder höher. Öffne **Wissen > Kontakte**, wähle **Kontakt hinzufügen** und anschließend **Manuelle Eingabe**.

1. Trage die **E-Mail**-Adresse des Kontakts ein. Ergänze bei Bedarf **Name** und **Telefon**.
2. Prüfe **Sprache**. Das Feld ist mit `en` vorbelegt; passe es an die Sprache des Kontakts an.
3. Wähle **Speichern**. Der Kontakt erscheint mit seinen Angaben und dem Erstellungsdatum in der Tabelle.

Vor dem Speichern prüft das Formular jedes Feld gegen das, was Tale speichert: **Name** bis 300 Zeichen, **Telefon** bis 50, **Sprache** bis 20 und bei der **E-Mail** höchstens 64 Zeichen vor dem `@`. Ein Wert über einer Grenze wird unter seinem Feld genannt, und gespeichert wird erst, wenn du ihn korrigiert hast.

Um nur die Kontakte einer Sprache zu sehen, wähle über der Kontaktliste **Filter** und unter **Sprache** die gewünschte Sprache. Eine Sprache schließt ihre regionalen Varianten ein: **FR** zeigt Kontakte mit der Sprache `fr`, `fr-CH` oder `fr_CA`. Ein Kontakt ohne Sprache erscheint nur, solange keine Sprache gewählt ist.

Du kannst einen Kontakt auch beim Schreiben anlegen. Wähle im Bereich **Start** in der Ansicht **Inbox** die Schaltfläche **Neue E-Mail** und tippe eine Adresse in **An**: Trägt sie kein Kontakt, bietet die Liste **„…“ als Kontakt hinzufügen** an und öffnet dasselbe Formular mit bereits ausgefüllter **E-Mail**. Nach dem Speichern ist dieser Kontakt der Empfänger – du verlässt die begonnene Nachricht also nie.

Ist die E-Mail-Adresse bereits vorhanden, suche den bestehenden Kontakt und bearbeite ihn über sein Zeilenmenü; aus **Neue E-Mail** heraus wählt Tale den vorhandenen Kontakt für dich aus. Beim Speichern wird nur der Datensatz angelegt; Tale sendet dem Kontakt dabei keine E-Mail.

Kontakte, die dein Team hier erfasst oder importiert hat, bearbeitest oder löschst du einzeln über das Zeilenmenü. Um mehrere auf einmal zu löschen, setze bei ihren Zeilen das Häkchen und wähle **Ausgewählte löschen**. Kontakte aus einer Integration, der API oder einer Konversation gehören ihrer Quelle, die eine Änderung hier überschreiben würde. Deshalb bietet ihr Zeilenmenü weder **Bearbeiten** noch **Löschen**, und ihre Zeilen haben kein Kästchen.

## Ein Produkt anlegen

<Frame caption="Wissen > Produkte: Jedes Produkt ist ein Datensatz mit benannten Feldern für Bestand, Preis, Kategorie und Status.">

![Der Tab Produkte im Bereich Wissen listet drei Produkte: Team training workshop mit 12 Stück Bestand für 950,00 US-Dollar in Services, als Entwurf markiert, sowie Onboarding accelerator für 1.900,00 US-Dollar in Services und Analytics Pro — annual license für 1.188,00 US-Dollar in Licenses, beide aktiv.](/images/platform/knowledge-products-list.webp)

</Frame>

Öffne **Wissen > Produkte**, wähle **Produkt hinzufügen** und anschließend **Manuelle Eingabe**. Das Formular führt dich durch drei Schritte.

1. Gib im Schritt **Grundlagen** unter **Produktname** einen Namen ein. Ergänze bei Bedarf eine Beschreibung und ein Bild, damit das Produkt eindeutig erkennbar ist. Wähle **Weiter**.
2. Prüfe unter **Preis & Bestand** immer **Preis** und **Währung** zusammen. Trage beispielsweise `12.50` ein und wähle `CHF`. Eine andere Währung rechnet den Betrag nicht um. Ergänze bei Bedarf Bestand und Kategorie und prüfe den **Status**. Ein neues Produkt beginnt als **Entwurf**.
3. Prüfe unter **Überprüfen** die Angaben und wähle **Erstellen**. Die Tabelle zeigt das Produkt mit Preis, Status und Änderungsdatum.

Gespeicherte Produkte bearbeitest du über das Zeilenmenü. Verwende unterscheidbare Produktnamen und kontrolliere Preis und Währung, bevor du den Status änderst.

Wähle **Bild hochladen** oder ziehe eine PNG-, JPEG-, WebP-, GIF- oder SVG-Datei in den Bildbereich. Die Obergrenze liegt bei 5 MiB. Warte auf die Vorschau, bevor du fortfährst. Tale prüft die hochgeladenen Dateiinhalte; lehnt es die Datei ab, nennt die Meldung unter dem Bildfeld den Grund — ein nicht unterstütztes Format, eine Datei über der Obergrenze oder eine SVG-Datei mit Skripten oder Event-Handlern —, damit du weißt, ob eine andere Datei nötig ist.

Das hochgeladene Bild bleibt nach dem Speichern und Neuladen des Produkts verfügbar. Sobald das Produkt gespeichert ist, können andere Organisationsmitglieder mit Produktzugriff das Bild sehen. Die Bildadresse setzt eine angemeldete Sitzung voraus und eignet sich nicht als öffentlicher Freigabelink. Zum Entfernen bearbeitest du das Produkt, wählst **Bild entfernen** und speicherst die Änderung. Wird das Bild entfernt oder ersetzt oder das Produkt gelöscht, wird auch die hochgeladene Datei selbst entfernt, sofern kein anderes Produkt sie noch zeigt.

Wenn du **Oder URL einfügen** wählst, gib eine vollständige öffentliche HTTPS-Adresse ein, die mit `https://` beginnt. Eine unvollständige Adresse nennt das Formular unter dem Feld, bevor du weitergehen kannst. Tale weist unsichere oder nicht zugelassene Hosts ab. Frage einen Administrator, wenn du eine interne Bildquelle brauchst. Für Bilder von externen Adressen gelten die Zugriffsregeln der jeweiligen Quelle.

## Zugriff und Aktualität prüfen

Ein Datensatz oder Dokument hilft nur Personen, die darauf zugreifen dürfen. Prüfe die Team-Zuordnung, wenn jemand einen Eintrag nicht findet. Bei Projektdateien gilt der Projektzugriff statt der Team-Zuordnung der Dokumentbibliothek; siehe [Projektdateien](/de/platform/projects/manage-files).

Ändert sich eine Angabe, aktualisiere den maßgeblichen Datensatz. Warte nach einer Dokumentänderung auf die abgeschlossene Indexierung, bevor du eine Frage zum neuen Inhalt testest. Website-Inhalte folgen dem eingestellten Scan-Intervall und können deshalb hinter der Live-Seite zurückliegen.

## Wenn eine Liste nicht lädt

Lässt sich die Liste der Kontakte, Produkte oder Websites nicht abrufen, meldet Tale das in der Liste. Ein Fehler erscheint nie als leere Liste. **Erneut versuchen** wiederholt den Abruf, ohne dass du die Seite neu laden musst:

- Lässt sich nichts laden, zeigt die Tabelle statt des leeren Zustands den Fehler mit **Erneut versuchen**. Der Fehler bedeutet nicht, dass die Datensätze verschwunden sind: Versuche es erneut, bevor du sie noch einmal importierst oder anlegst.
- Sind bereits Datensätze zu sehen, bleiben sie stehen, und ein Hinweis über der Tabelle sagt, dass die Liste unvollständig oder veraltet sein kann.

Scheitert **Erneut versuchen** immer wieder, bitte einen Administrator zu prüfen, ob die Dienste von Tale laufen.

## Mit den vorhandenen Datentypen arbeiten

Der Wissensbereich bietet Kontakte, Produkte und Websites. **Einstellungen > Richtlinien > Modelle** steuert den Zugriff auf KI-Modelle und deren Vorauswahl. Dort legst du keine eigenen Datentypen oder Datenbankfelder an.

Passen die vorhandenen Felder nicht zu deinem Inhalt, halte die Details in einem Dokument fest und ordne den Ablauf dem passenden Datensatz zu. Welche Felder sich programmatisch importieren lassen, steht in der [API-Referenz](/de/develop/api-reference).

Unter [Dokumente](/de/platform/knowledge/documents) erfährst du, wie du eine Datei hochlädst und prüfst. [Wissenseinträge](/de/platform/knowledge/knowledge-entries) erklärt die Pflege einzelner Informationen; [Crawling](/de/platform/knowledge/crawling) beschreibt die regelmäßige Erfassung öffentlicher Seiten.
