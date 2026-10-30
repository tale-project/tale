---
title: Im Chat Dateien erstellen und Skills nutzen
description: Bitte den Assistenten um ein Dokument, eine Tabelle, eine Präsentation, ein Diagramm oder ein Bild und lass ihn einen Skill aus deiner Bibliothek befolgen, ohne das Gespräch zu verlassen.
---

Der Assistent erstellt im Gespräch, worum du ihn bittest: eine CSV- oder Markdown-Datei, die er selbst schreibt, ein Word-Dokument, eine Excel-Arbeitsmappe, eine PowerPoint-Präsentation, ein PDF oder ein Diagramm, das er in einer leichten Sandbox baut, und Bilder, wenn deine Organisation das erlaubt. Die Dateien erscheinen unter der Antwort, bereit zum Öffnen und Herunterladen. Skills aus deiner [Skill-Bibliothek](/de/platform/workspace/skills) sagen ihm, wie sie gut gelingen.

## Die gewünschte Datei anfragen

Nenne in deiner Nachricht Format und Inhalt, so wie du es jemandem im Team sagen würdest. Zum Beispiel: „Erstelle eine Excel-Datei mit unserem Monatsumsatz 2025 und einer Summenzeile mit Formel.“ Oder: „Mach daraus ein sauber formatiertes PDF“, gefolgt vom Text.

Der Assistent wählt den leichtesten Weg, der zum Ziel führt, und startet nichts, was er nicht braucht:

| Du bittest um | Der Assistent | Was er startet |
| --- | --- | --- |
| Eine Antwort, eine Vergleichstabelle, einen kurzen Codeblock | Antwortet direkt | Nichts |
| Eine Markdown-, CSV-, JSON-, HTML- oder SVG-Datei, einen Kalendereintrag (`.ics`) oder eine Kontaktkarte (`.vcf`) | Schreibt die Datei selbst | Nichts |
| Ein Bild: eine Illustration, eine fotoähnliche Szene, ein Logo | Erzeugt ein Bild | Das Bildmodell deiner Organisation, wenn die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet ist |
| Eine Word-, Excel-, PowerPoint- oder PDF-Datei, ein Diagramm, eine Berechnung mit Daten, eine Änderung an einer angehängten Datei | Führt Code in einer leichten Sandbox aus | Eine leichte Sandbox, in etwa einer Sekunde |
| Arbeit an einem Repository, in einer Browsersitzung oder über Stunden | Schlägt eine [Projektaufgabe](/de/platform/projects/tasks) vor | Im Chat nichts; der Agent der Aufgabe arbeitet in seiner eigenen Sandbox |

Eine Datei, die geprüft, mit anderer Arbeit aufbewahrt oder erst später erstellt werden soll, gehört in eine Aufgabe: Der [Standard-Agent](/de/platform/projects/project-agents#standard-agent-runs) des Projekts nutzt dort dieselben Tools, und die Dateien, die er erstellt, werden zu den Ergebnisdateien der Aufgabe.

Während der Assistent arbeitet, zeigen die Schritte über der Antwort, was er gerade tut, etwa **Schreibt contacts.csv**, **Liest den Skill xlsx** oder **Führt Python in einer leichten Sandbox aus**. Ein fehlgeschlagener Schritt sagt in der Zeile darunter, was schiefging, etwa **Alle leichten Sandboxen sind belegt** oder **Das Programm wurde mit einem Fehler beendet**; meist korrigiert der Assistent dann seinen Code und versucht es erneut.

## Die Dateien öffnen und herunterladen

Die Dateien erscheinen unter der Antwort, in der Reihenfolge ihrer Entstehung. PNG-, JPEG-, GIF- und WebP-Bilder werden direkt angezeigt; wähle eines aus, um es groß zu öffnen und durch die anderen zu blättern. Jede andere Datei, auch eine SVG-Datei, erscheint als Karte mit Name, Typ und Größe, ebenso ein Bild, das sich nicht anzeigen lässt. Wähle die Karte, um eine Vorschau zu öffnen; PDF-, Word-, Tabellen-, Markdown-, Text- und SVG-Dateien werden direkt angezeigt. Die Download-Schaltfläche neben der Karte speichert die Datei unter ihrem eigenen Namen.

<Frame caption="Die Datei, die der Assistent geschrieben hat, erscheint als Karte unter seiner Antwort, mit einer Download-Schaltfläche daneben.">

![Ein Chat bittet um die Feedback-Themen aus dem Onboarding als CSV-Datei. Die Schritte zeigen, dass onboarding-feedback-themes.csv geschrieben wird, die Antwort meldet die angehängte Datei, und eine Karte darunter zeigt onboarding-feedback-themes.csv, CSV, 251 Byte, mit einer Download-Schaltfläche.](/images/platform/chat-reply-files.webp)

</Frame>

Überarbeitet der Assistent eine Datei in derselben Antwort, etwa nachdem er sein Ergebnis geprüft hat, zeigt die Karte nur die endgültige Fassung. Bitte in einer Folgenachricht um eine Änderung, um in der nächsten Antwort eine neue Fassung zu erhalten.

Die Dateien gehören zum Gespräch: Wer das Gespräch öffnen kann, kann auch seine Dateien öffnen.

## Eine angehängte Datei ändern

[Hänge die Datei an](/de/platform/chat/attachments) und sag, was sich ändern soll: „Füge der angehängten Tabelle ein Diagramm der Summen hinzu“ oder „Wandle das angehängte Word-Dokument in ein PDF um.“ Der Assistent kopiert die Datei in die leichte Sandbox und liefert das Ergebnis als neue Datei. Die angehängte Datei bleibt unverändert.

Ein angehängtes Bild kann auch der Ausgangspunkt für ein neues Bild sein, wenn deine Organisation die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) erlaubt. Schreib zum Beispiel: „Mach aus dem angehängten Foto ein Aquarell.“ Der Assistent gibt das Foto an das Bildmodell weiter, und das neue Bild erscheint unter der Antwort.

## Einen Skill nutzen

Ein Skill ist ein erprobtes Vorgehen für eine bestimmte Arbeit, etwa ein Dokumentformat oder einen Hausstil. Deine Skill-Bibliothek enthält die Skills, die mit der ganzen Organisation oder mit deinen Teams geteilt sind; die eingebauten Skills `docx`, `xlsx`, `pptx` und `pdf` decken die Office-Formate und PDF ab.

Für eine einzelne Nachricht tippst du `/` an den Anfang des Nachrichtenfelds oder wählst im **+**-Menü des Eingabebereichs **Skill verwenden**. Über dem Feld erscheinen die Skills, die du nutzen kannst; tippe weiter, um die Liste einzugrenzen, und drück dann die Eingabetaste oder wähle einen aus. Deine Nachricht beginnt dann mit dem Namen des Skills, etwa `/docx Schreib das Anschreiben`, und zeigt ihn nach dem Senden als Chip. Die Antwort liest den Skill, bevor sie antwortet: Ihr erster Schritt ist **Liest den Skill docx**.

![Ein neuer Chat mit einem Schrägstrich im Nachrichtenfeld. Über dem Feld eine Liste der Skills docx, pdf, pptx, visual-aspect-analyzer und xlsx, jeweils mit dem Anfang ihrer Beschreibung; docx ist hervorgehoben.](/images/platform/chat-skill-picker.webp)

Für ein ganzes Gespräch öffnest du die Modellauswahl, gehst zu **Skills** und hakst bis zu vier an. Jede Antwort in diesem Gespräch liest sie, bevor sie antwortet. Ein neuer Chat beginnt ohne.

Der Assistent liest einen Skill auch von sich aus, wenn einer zu deiner Anfrage passt oder du ihn in deinen Worten nennst. Er sieht Name und Beschreibung jedes Skills deiner Bibliothek; umfasst sie mehr als 40 Skills, sieht er die ersten 40 in alphabetischer Reihenfolge; jeden weiteren wählst du mit `/`. Einen Skill, den sein Autor nur für den ausdrücklichen Aufruf vorgesehen hat, solltest du selbst wählen: Der Assistent wird gebeten, ihn sonst nicht zu nutzen.

Ein Skill leitet den Assistenten an; er ändert nicht, was der Assistent darf. Die Skripte und Vorlagen eines Skills laufen in der leichten Sandbox, wie der eigene Code des Assistenten. Schaltet ein Admin unter Chat-Tools **Skills** aus, gibt es nichts zu wählen, und eine Nachricht, die mit `/` beginnt, wird so gesendet, wie sie ist.

## Die Grenzen kennen

- Eine leichte Sandbox gehört zu einem Gespräch. Sie behält ihre Dateien zwischen den Schritten des Assistenten und deinen Folgenachrichten; nach etwa fünf Minuten ohne Nutzung wird sie entfernt, und die nächste Anfrage startet eine neue. Sind alle leichten Sandboxes deiner Organisation belegt, macht eine unbenutzte Platz; ist keine unbenutzt, bittet dich der Assistent, es in einer Minute noch einmal zu versuchen.
- Ein Code-Lauf darf bis zu drei Minuten dauern, und die Tools eines Schritts dürfen zusammen höchstens fünf Minuten laufen. In einem Schritt laufen höchstens 16 Tools. Klickst du auf **Generierung stoppen**, wird ein laufendes Programm innerhalb weniger Sekunden abgebrochen. Ein Lauf hängt bis zu 10 Dateien an, jede bis zu 20 MB groß; schreibt ein Programm sehr viel mehr, nennt die Antwort einige und zählt den Rest.
- Eine Datei, die der Assistent selbst schreibt, fasst bis zu 1 MB Text.
- Eine Anfrage erstellt bis zu 4 Bilder, eine Antwort bis zu 16. Eine Anfrage kann von bis zu 4 Bildern der Unterhaltung ausgehen, oder von weniger, wenn das Bildmodell weniger annimmt. Bilder werden deiner Organisation berechnet und zählen wie die Antwort selbst für dich.
- Lassen sich die Tools zum Erstellen von Dateien für eine Antwort nicht einrichten, etwa weil die Chat-Tools-Richtlinie deiner Organisation nicht lesbar ist, sagt die Antwort das darunter. Frag später noch einmal oder bitte einen Admin, die Richtlinie zu prüfen.

Was der Chat erstellen darf, legt ein Admin unter [Chat-Tools](/de/platform/admin/governance/policies-and-limits#chat-tools) fest, ob er Bilder erzeugen darf, unter [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images), und wie viele leichte Sandboxes deine Organisation gleichzeitig betreibt, unter [Sandboxes](/de/platform/admin/sandboxes#light-sandboxes). Ein ausgeschaltetes Tool fehlt in jedem Chat; der Assistent antwortet dann direkt oder schlägt stattdessen eine Aufgabe vor.

Bilder erstellt der Assistent nur, wenn die Bildgenerierung eingeschaltet ist und die Anbieter-Zugangsdaten deiner Organisation ein Bildmodell erreichen. Ist das nicht der Fall und bittest du um ein Foto, eine Illustration oder ein Kunstwerk, sagt er dir, dass die Bildgenerierung nicht verfügbar ist und ein Admin oder Inhaber sie unter **Einstellungen > Richtlinien > Modelle** einschalten kann. Ein SVG gibt er dir nicht als Bild aus; SVG-Dateien für Diagramme und Icons schreibt er weiterhin.
