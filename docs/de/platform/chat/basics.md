---
title: Chat mit KI
description: Der Konversations-Arbeitsbereich, in dem du Fragen stellst, Dateien anhängst, einen Agent wählst und einem mehrstufigen Plan in Klartext zusiehst.
---

Chat mit KI ist Tales wichtigste Konversations-Oberfläche — der Ort, an dem jede Rolle im Produkt der KI zuerst begegnet. Du schreibst eine Frage in den Composer am unteren Bildschirmrand, hängst optional Dateien an oder wählst einen spezialisierten Agent, und die KI arbeitet sich in Klartext zur Antwort durch: durchsucht die Wissensdatenbank, ruft Integrationen auf, baut Artefakte im Canvas-Bereich und arbeitet einen mehrstufigen Plan ab, wenn die Frage breit ist. Diese Seite behandelt den Composer selbst, die umliegenden Bereiche und die Tastaturbedienung.

Die tieferen Funktionen haben jeweils eine eigene Seite. Anhänge, der Agent-Picker, der Arena-Modus zum Modellvergleich, Canvas für editierbare Artefakte, die Prompt-Bibliothek und der Recherche-Plan-Seitenbereich liegen je einen Klick in der Seitenleiste entfernt.

## Eine Konversation öffnen

Chat mit KI ist der erste Eintrag in der linken Seitenleiste. Um eine neue Konversation zu starten, klicke auf das Plus-Icon in der oberen Toolbar oder drücke `Alt + Ctrl + N` (`Option + Cmd + N` auf macOS). Jede Konversation speichert automatisch, sobald du die erste Nachricht sendest, sodass ein geschlossener Browser mitten im Gedanken keine Arbeit verliert.

## Nachrichten senden

Der Composer sitzt unten am Bildschirm. Drücke `Enter`, um die Nachricht zu senden; `Shift + Enter` setzt einen Zeilenumbruch in dieselbe Nachricht. Der Composer wächst beim Tippen — es gibt keine harte Längenbegrenzung jenseits des Kontextfensters des Modells. Klicke **Generierung stoppen**, um die KI mitten in der Antwort zu unterbrechen; die teilweise Ausgabe bleibt im Thread, sodass du das Nützliche behältst.

## Dateien anhängen

Um eine Datei mit einer Nachricht zu senden, klicke auf das Büroklammer-Icon oder zieh die Datei auf den Composer. Tale verarbeitet den Upload, bevor die Nachricht das Modell erreicht — ein Spinner zeigt pro Datei den Stand, mit einem separaten Transkriptions-Status für Audio und Video. Der vollständige Satz akzeptierter Formate:

- **Bilder:** PNG, JPEG, GIF, WebP. Der Agent analysiert den visuellen Inhalt.
- **Dokumente:** PDF, DOCX, XLSX, PPTX, TXT, Markdown. Der Agent liest den extrahierten Text.
- **Code-Dateien:** JavaScript, TypeScript, Python und die gängigen Quellcode-Formate.
- **Audio:** MP3, M4A, WAV, OGG, WebM. Die Audiospur wird serverseitig transkribiert und das Transkript an den Agent übergeben.
- **Video:** MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. Die Audiospur wird extrahiert, transkribiert und an den Agent übergeben — visueller Inhalt geht nicht raus.

Die vollständige Pipeline (Grössen-Limits, Transkriptions-Abrechnung, PII-Behandlung) liegt unter [Chat-Anhänge](/de/platform/chat/attachments).

## Einen Agent wählen

Der Agent-Selector ist das Bot-Icon unten links im Composer. Um eine Konversation an einen bestimmten Agent zu leiten, öffne den Selector und wähle ihn — die Voreinstellung ist der System-Assistent, der mit Tale ausgeliefert wird; eigene Agents, die dein Team gebaut hat, erscheinen darunter. Mitten in der Konversation den Agent zu wechseln ist erlaubt, und der neue Agent liest das bisherige Transkript, bevor er antwortet.

Die Anweisungen, der Wissensumfang und die aktivierten Tools des Agents bestimmen, was der Chat tun kann. Das Laufzeitverhalten beim Agent-Wechsel und das Lesen von Gesprächseinstiegen liegt unter [Agents im Chat nutzen](/de/platform/chat/agents-in-chat); das mentale Modell hinter den vier Knöpfen liegt unter [Agent-Konzepte](/de/platform/agents/concepts).

## Verlauf durchstöbern

Das Uhr-Icon in der oberen Toolbar öffnet die Verlaufs-Seitenleiste. Vergangene Konversationen sind nach Datum gruppiert — klicke eine an, um sie zu öffnen, doppelklicke einen Titel, um ihn inline umzubenennen, oder nutze das Drei-Punkte-Menü zum Archivieren oder Löschen. Um über alle Konversationen zu suchen, drücke `Ctrl + K` (`Cmd + K` auf macOS) und tippe — Betreff und Nachrichtentext sind indiziert.

## Was der Standard-Assistent kann

Der mit Tale ausgelieferte Agent ist mit dem breitesten Tool-Satz verdrahtet, damit eine frische Organisation sofort etwas Nützliches hat. Die fünf Tool-Kategorien des Standard-Assistenten:

| Tool-Kategorie         | Was du fragen kannst                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Wissensdatenbank-Suche | Fragen, die aus deinen hochgeladenen Dokumenten und gecrawlten Websites beantwortet werden.   |
| Web-Suche              | Aktuelle Informationen aus dem öffentlichen Internet.                                         |
| Dokument-Verarbeitung  | PDF, Word, PowerPoint, Excel und Text-Dateien inline parsen und analysieren.                  |
| Bild-Analyse           | Angehängte Bilder beschreiben, analysieren oder Informationen daraus extrahieren.             |
| Audio-Transkription    | Angehängte Audio- oder Video-Dateien transkribieren, damit der Agent sie zusammenfassen kann. |

Eigene Agents, die du baust, starten mit denselben Voreinstellungen; du engst sie ein. Der Bau-Flow läuft Schritt für Schritt durch unter [Agent erstellen](/de/platform/agents/create).

## Arena-Modus

Der Arena-Modus schickt denselben Prompt parallel durch zwei Modelle und zeigt die Antworten nebeneinander. Um Modelle an einem echten Prompt zu vergleichen, klicke auf das **Schwerter**-Icon in der Eingabe-Toolbar, wähle zwei Modelle und sende eine Nachricht — beide Antworten streamen in eine geteilte Ansicht. Trage ein Verdikt ein, um zu markieren, welche Antwort besser war; die Verdikte sammeln sich als Pro-Modell-Vergleichsdaten in der Nutzungsanalytik.

Die volle Doktrin liegt unter [Arena-Modus](/de/platform/chat/arena-mode).

## Canvas

Wenn die KI lauffähiges HTML, ein SVG, ein Mermaid-Diagramm, ein Markdown-Dokument oder ein Code-Snippet produziert, erzeugt sie ein **Artefakt** — eine Karte in der Artefakte-Leiste über dem Chat, die sich automatisch im Canvas-Bereich öffnet. Das Artefakt hat eine stabile Identität über die ganze Konversation, kleine Korrekturen brauchen also keine Neugenerierung des ganzen Dokuments — die KI patcht es über Runden hinweg an Ort und Stelle.

Die volle Doktrin liegt unter [Canvas](/de/platform/workspace/canvas).

## Prompt-Bibliothek

Um eine Prompt-Vorlage im Team wiederzuverwenden, öffne die Prompt-Bibliothek aus der Composer-Toolbar — jeder gespeicherte Prompt ist durchsuchbar und mit einem Klick einfügbar. Um den eben geschriebenen Prompt zu speichern, öffne das Drei-Punkte-Menü der Nachricht und wähle **Als Prompt speichern**; setze den Scope auf dich, dein Team oder die gesamte Organisation.

Die volle Doktrin liegt unter [Prompt-Bibliothek](/de/platform/workspace/prompt-library).

## Recherche-Plan

Breite Fragen, die Planung brauchen — Mehrquellen-Recherche, Vergleiche, Zusammenfassungen über mehrere Dokumente und das Web — werden in einen **Recherche-Plan** zerlegt. Der Plan öffnet sich automatisch als Seitenbereich, sobald der Agent das erste Todo für die Konversation ausgibt; pinne ihn aus dem Streifen am rechten Rand des Chats an oder schliesse ihn, wenn du den vollen Nachrichtenstrom zurückwillst.

Jeder Todo zeigt einen Status (offen, läuft, erledigt, fehlgeschlagen), eine einzeilige Zusammenfassung und die Quellen, die der Agent für diesen Schritt erfasst hat — Treffer aus der Wissensdatenbank, abgerufene Web-Seiten, Ergebnisse aus Integrationen. Der Plan aktualisiert sich live, sobald der Agent jeden Schritt beendet, sodass du der Argumentation zusiehst, statt am Ende auf eine lange Antwort zu warten.

Du kannst eingreifen, ohne den Lauf zu brechen. Klappe einen Schritt ein, um seine Quellen zu verbergen, wenn die Liste lang wird. Ordne neu, indem du eine Folge-Nachricht sendest — der Agent überarbeitet die verbleibenden Todos auf Basis deines Feedbacks. Stoppe mit dem Stop-Button im Composer — Teilergebnisse bleiben im Thread, und die Anzahl fehlgeschlagener Todos steht oben im Plan. Der Plan selbst ist schreibgeschützt; steuere den Lauf über reguläre Chat-Nachrichten.

## Tastaturkürzel

| Aktion                           | Windows / Linux  | macOS              |
| -------------------------------- | ---------------- | ------------------ |
| Neuer Chat                       | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Chats durchsuchen                | `Ctrl + K`       | `Cmd + K`          |
| Verlaufs-Seitenleiste umschalten | `Ctrl + H`       | `Cmd + H`          |

## Wo das einsetzt

Der Chat ist die Eingangstür für alles, was die KI kann. Die Agents, das Wissen, die Tools — jede andere Oberfläche in Tale füttert entweder den Chat (Wissensdatenbank kuratieren, Agents bauen, Anbieter konfigurieren) oder ersetzt ihn für Fälle, in denen die Chat-Form falsch ist (Automatisierungen für unbeaufsichtigte Arbeit, die API für Skripte). Die meisten Leser leben in dieser einen Seite; der Rest der Plattform liest sich entweder als _wie man den Chat besser macht_ oder als _was tun, wenn der Chat nicht die richtige Oberfläche ist_.

Um den Chat für das Team schärfer zu machen, ist der natürliche nächste Schritt ein passgenauer Agent — starte mit [Agent-Konzepte](/de/platform/agents/concepts) für das mentale Modell, dann arbeite [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) durch.
