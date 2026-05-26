---
title: Agent erstellen
description: Der End-zu-End-Bau-Flow für einen eigenen Agent — Namen geben, Modell wählen, Anweisungen, Wissen, Tools, Gesprächseinstiege, Delegation und die Worker-URL.
---

Einen Agent zu erstellen heisst, Werte für die vier Knöpfe zu wählen, die die Konzept-Seite eingeführt hat — Anweisungen, Wissen, Tools, Modell — und dem Agent dann einen Namen zu geben, eine Worker-URL für externe Aufrufer und die Gesprächseinstiege, die bei einem frischen Chat erscheinen. Die Zielgruppe ist Redakteur-Rolle oder höher; Mitglieder können veröffentlichte Agents nutzen, aber keine bauen.

Diese Seite arbeitet den Bau-Flow Tab für Tab ab. Das mentale Modell hinter den vier Knöpfen liegt unter [Agent-Konzepte](/de/platform/agents/concepts). Die Iterations-Schleife nach der ersten Veröffentlichung — Verlaufs-Snapshots, Vergleich, Wiederherstellen — liegt unter [Agent-Versionen](/de/platform/agents/versions). Diese Seite sitzt zwischen den beiden.

## Den Agent anlegen

Um einen neuen Agent zu starten, öffne **Agents** in der Seitenleiste und klicke **Agent erstellen**. Der Anlegen-Dialog fragt drei Dinge ab:

| Feld         | Was rein muss                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anzeigename  | Der Name, der im Agent-Selector und in Konversationen erscheint. `Support-Agent`, `Vertriebs-Recherche`.                                          |
| Name         | URL-sicherer Slug für API-Aufrufe und JSON-Datei-Verweise. Wird aus dem Anzeigenamen abgeleitet; überschreibe ihn, wenn ein konkreter Slug zählt. |
| Beschreibung | Optionale Einzeiler-Beschreibung, was der Agent tut. Erscheint im Tooltip des Agent-Pickers.                                                      |

Klicke **Weiter**. Der nächste Bildschirm ist die Konfigurationsseite des Agents, die sieben Tabs trägt: Allgemein, Anweisungen & Modell, Tools, Wissen, Starter, Delegation und Workers.

### Datei-basiertes Anlegen mit KI-Unterstützung

Um Agents über das direkte Hinzufügen von JSON-Dateien anzulegen, öffne das Verzeichnis `agents/` des Projekts und füge eine neue Datei hinzu. Ein KI-gestützter Editor (Claude Code, Cursor, GitHub Copilot, Windsurf), der auf dem Projekt offen ist, sieht das Agent-Schema und die Fähigkeiten der Plattform durch den extrahierten Referenzcode — beschreibe den Agent und der Editor erzeugt eine gültige Konfigurationsdatei. Siehe [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) für die Einrichtung.

## Anweisungen & Modell

Das ist der tragendste Tab. Das Feld **System-Anweisungen** ist der System-Prompt, den das Modell vor jeder Konversation sieht; es definiert Rolle, Umfang, Ton und Ausgabeform des Agents. Halte ihn kurz, spezifisch und als Regelliste — nenne, wer der Agent ist, was er beantworten darf, was er verweigern muss und wie er Antworten formatiert.

Zwei weitere Felder liegen auf diesem Tab. Der **Modell**-Picker wählt das KI-Modell, das den Agent antreibt — wähle aus den Modellen, die deine Organisation unter [KI-Anbieter](/de/platform/admin/providers) konfiguriert hat; der Picker lässt auch Fallback-Modelle hinzufügen, die einspringen, wenn das primäre nicht verfügbar ist. Der Schalter **Strukturierte Antworten** lässt den Agent grössere Antworten mit `[[CONCLUSION]]`-, `[[KEY_POINTS]]`- und `[[DETAILS]]`-Markern formatieren, die im Chat als reichhaltige UI-Abschnitte rendern; schalte ihn aus, um reine Textantworten zu erzwingen.

Änderungen speichern automatisch; ein Speicher-Indikator oben rechts zeigt den aktuellen Status.

## Tools

Um dem Agent Zugriff auf eine Fähigkeit zu geben, öffne den Tools-Tab und schalte den passenden Eintrag an. Eingebaute Tools umfassen Wissens-Suche, Web-Suche, Dokument-Verarbeitung und Bild-Analyse — jedes mit einem Vier-Wege-Abruf-Modus-Selector (**Aus**, **Tool**, **Kontext**, **Beide**), der entscheidet, ob der Agent auf Anfrage sucht, Ergebnisse in jede Antwort auto-injiziert bekommt oder beides. Jede konfigurierte Integration und jeder aktive [MCP-Server](/de/platform/integrations/mcp-servers) erscheint als umschaltbare Gruppe unter den eingebauten Tools.

Die Tool-Liste trennt den Agent, der nur reden kann, von dem, der handeln kann. Ein Nur-Lese-Research-Agent hat Web-Suche an und alle Schreib-Operationen aus; ein Agent, der Tickets aktualisiert, hat die Support-Integration an und alles andere aus.

## Wissen

Um einzugrenzen, was der Agent durchsuchen darf, öffne den Wissen-Tab und enge den Standard (das gesamte Organisationswissen) nach Ordner, Team oder Entitätstyp ein (Dokumente, Produkte, Kunden, Lieferanten). Engere Umfänge liefern relevantere Treffer — ein Support-Agent, der nur den Hilfe-Center-Ordner durchsucht, lässt sich nicht von Entwicklungs-Dokumenten ablenken — und kosten weniger, weil weniger Dokumente das Modell erreichen.

Der Wissen-Tab lässt dich auch **Agent-Dokumente** hochladen — Dateien, auf die nur dieser Agent zugreifen kann, nützlich für private Stilrichtlinien oder Antwort-Vorlagen, die du dem Rest der Organisation nicht zeigen willst. Um Wissen ganz abzuschalten (der Agent antwortet rein aus Anweisungen und Tools), setze auf diesem Tab den **Abruf-Modus** auf **Aus**.

## Starter

Um erste Nachrichten bei einem frischen Chat vorzuschlagen, öffne den Starter-Tab und füge Starter-Einträge hinzu. Jeder Starter hat einen **Titel** (den klickbaren Vorschlag) und einen **Prompt** (die Nachricht, die beim Klick gesendet wird). Starter senken die Hürde, die erste Nachricht zu schreiben, und sind ein guter Weg zu zeigen, wofür der Agent gebaut wurde.

Ein Agent ohne Starter zeigt bei einem frischen Chat einen leeren Composer — das Feature ist opt-in.

## Delegation

Um den Agent Konversationen an Spezialisten übergeben zu lassen, sobald das Thema driftet, öffne den Delegation-Tab und wähle Ziel-Agents. Für jedes Ziel benennst du das Thema oder die Bedingung, die die Übergabe auslöst; der Agent leitet dann passende Konversationen an den gewählten Delegaten weiter. Die Übergabe erscheint im Transkript als kurze Notiz mit dem Namen des neuen Agents, und Antworten ab diesem Punkt kommen aus den Anweisungen des Delegaten.

Delegation ist opt-in. Ein Agent ohne Delegationsziele beantwortet jedes Thema selbst.

## Workers

Jeder Agent bekommt eine eindeutige **Worker-URL**. Um den Agent von ausserhalb Tales aufzurufen — ein Chat-Widget auf einer Marketing-Site, ein Slack-Bot, ein externer Workflow — POSTe eine Nachricht und den Konversationskontext an die Worker-URL, und der Agent antwortet in derselben Form wie im Chat. Der Workers-Tab unterstützt mehrere Worker-URLs pro Agent, sodass du Zugangsdaten rotieren oder verschiedene Integrationen auf verschiedene Schlüssel scopen kannst.

Der Agent muss veröffentlicht sein, bevor sein Workers-Tab aktiv wird — bis dahin zeigt der Tab _Veröffentliche diesen Agent, um den Worker-Zugriff zu aktivieren_. Das Signatur-Schema und ein konkretes Beispiel in cURL, Node und Python liegen unter [Webhooks](/de/develop/webhooks).

## Verlauf

Um den Verlauf gespeicherter Snapshots des Agents zu durchstöbern, öffne das **Verlauf**-Menü. Der Dialog listet jeden veröffentlichten Snapshot mit Zeitstempel und Akteur; von dort kannst du zwei Snapshots nebeneinander vergleichen oder einen vorherigen als neuen Arbeitsstand wiederherstellen. Siehe [Agent-Versionen](/de/platform/agents/versions) für den vollen Lebenszyklus.

## Wo das einsetzt

Diese Seite ist der Bau-Flow — Name, Anweisungen, Modell, Wissen, Tools, Starter, Delegation, Workers. Die meiste Iteration an einem Agent passiert _nach_ diesem ersten Anlegen: Anweisungen umschreiben, wenn du lernst, was der Agent falsch versteht; Wissen verengen, wenn du siehst, woraus er sich verankert; Tools an- und abschalten, wenn der Anwendungsfall sich schärft. Die vier Knöpfe der Konzept-Seite sind die vier, an denen du weiter drehst.

Für die Iterations-Schleife — Entwerfen, Veröffentlichen, Live-Agents zurückrollen — ist [Agent-Versionen](/de/platform/agents/versions) die dedizierte Referenz. Um diesen Agent von ausserhalb der UI aufzurufen, decken [Webhooks](/de/develop/webhooks) und die [API-Referenz](/de/develop/api-reference) die beiden Nicht-UI-Oberflächen ab.
