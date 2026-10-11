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

Während er arbeitet, zeigen die Schritte über der Antwort, was er gerade tut, etwa **Schreibt contacts.csv**, **Liest den Skill xlsx** oder **Führt Python in einer leichten Sandbox aus**. Ein fehlgeschlagener Schritt sagt, was schiefging; meist korrigiert der Assistent dann seinen Code und versucht es erneut.

## Die Dateien öffnen und herunterladen

Die Dateien erscheinen unter der Antwort, in der Reihenfolge ihrer Entstehung. Bilder werden direkt angezeigt; wähle eines aus, um es groß zu öffnen und durch die anderen zu blättern. Jede andere Datei erscheint als Karte mit Name, Typ und Größe. Wähle die Karte, um eine Vorschau zu öffnen; PDF-, Word-, Tabellen-, Markdown- und Textdateien werden direkt angezeigt. Die Download-Schaltfläche neben der Karte speichert die Datei unter ihrem eigenen Namen.

<Frame caption="Die Datei, die der Assistent geschrieben hat, erscheint als Karte unter seiner Antwort, mit einer Download-Schaltfläche daneben.">

![Ein Chat bittet um die Feedback-Themen aus dem Onboarding als CSV-Datei. Die Schritte zeigen, dass onboarding-feedback-themes.csv geschrieben wird, die Antwort meldet die angehängte Datei, und eine Karte darunter zeigt onboarding-feedback-themes.csv, CSV, 251 Byte, mit einer Download-Schaltfläche.](/images/platform/chat-reply-files.webp)

</Frame>

Überarbeitet der Assistent eine Datei in derselben Antwort, etwa nachdem er sein Ergebnis geprüft hat, zeigt die Karte nur die endgültige Fassung. Bitte in einer Folgenachricht um eine Änderung, um in der nächsten Antwort eine neue Fassung zu erhalten.

Die Dateien gehören zum Gespräch: Wer das Gespräch öffnen kann, kann auch seine Dateien öffnen.

## Eine angehängte Datei ändern

[Hänge die Datei an](/de/platform/chat/attachments) und sag, was sich ändern soll: „Füge der angehängten Tabelle ein Diagramm der Summen hinzu“ oder „Wandle das angehängte Word-Dokument in ein PDF um.“ Der Assistent kopiert die Datei in die leichte Sandbox und liefert das Ergebnis als neue Datei. Die angehängte Datei bleibt unverändert.

## Einen Skill nutzen

Ein Skill ist ein erprobtes Vorgehen für eine bestimmte Arbeit, etwa ein Dokumentformat oder einen Hausstil. Der Assistent sieht Name und Beschreibung jedes Skills in deiner Skill-Bibliothek, also der Skills, die mit der ganzen Organisation oder mit deinen Teams geteilt sind. Passt einer zu deiner Anfrage, liest er ihn, bevor er beginnt, und befolgt ihn; die Schritte zeigen dann zum Beispiel **Liest den Skill docx**. Die eingebauten Skills `docx`, `xlsx`, `pptx` und `pdf` decken die Office-Formate und PDF ab.

Soll ein bestimmter Skill sicher zum Einsatz kommen, nenne ihn: „Nutze den Skill brief-summary, um das angehängte Briefing zusammenzufassen.“ Einen Skill, den sein Autor nur für den ausdrücklichen Aufruf vorgesehen hat, nutzt der Assistent nur, wenn du ihn beim Namen nennst. Umfasst die Bibliothek mehr als 40 Skills, sieht der Assistent die ersten 40 in alphabetischer Reihenfolge und nutzt jeden weiteren, sobald du ihn nennst.

Ein Skill leitet den Assistenten an; er ändert nicht, was der Assistent darf. Die Skripte und Vorlagen eines Skills laufen in der leichten Sandbox, wie der eigene Code des Assistenten.

## Die Grenzen kennen

- Eine leichte Sandbox gehört zu einem Gespräch. Sie behält ihre Dateien zwischen den Schritten des Assistenten und deinen Folgenachrichten; nach etwa fünf Minuten ohne Nutzung wird sie entfernt, und die nächste Anfrage startet eine neue. Sind alle leichten Sandboxes deiner Organisation belegt, macht eine unbenutzte Platz; ist keine unbenutzt, bittet dich der Assistent, es in einer Minute noch einmal zu versuchen.
- Ein Code-Lauf darf bis zu drei Minuten dauern. Er hängt bis zu 10 Dateien an, jede bis zu 20 MB groß.
- Eine Datei, die der Assistent selbst schreibt, fasst bis zu 1 MB Text.
- Eine Anfrage erstellt bis zu 4 Bilder, eine Antwort bis zu 16. Bilder werden deiner Organisation berechnet und zählen wie die Antwort selbst für dich.

Was der Chat erstellen darf, legt ein Admin unter [Chat-Tools](/de/platform/admin/governance/policies-and-limits#chat-tools) fest, ob er Bilder erzeugen darf, unter [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images), und wie viele leichte Sandboxes deine Organisation gleichzeitig betreibt, unter [Sandboxes](/de/platform/admin/sandboxes#light-sandboxes). Ein ausgeschaltetes Tool fehlt in jedem Chat; der Assistent antwortet dann direkt oder schlägt stattdessen eine Aufgabe vor.
