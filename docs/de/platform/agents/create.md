---
title: Einen Agent erstellen
description: Vom Dialog Agent erstellen zum veröffentlichten Agent — benenne ihn, schreib Anweisungen, setz den Wissens-Scope, gewähre Tools und prüfe ihn im Chat.
---

Dieses Tutorial führt vom leeren Dialog **Agent erstellen** zu einem Agent, den du veröffentlichst und nutzt. Das Ergebnis ist ein funktionierender Agent, der seine Domäne kennt, die Tools hat, um auf das zu reagieren, was er liest, und aus jedem Chat deiner Organisation erreichbar ist. Etwa fünfzehn Minuten, wenn ein Modellanbieter schon konfiguriert ist; länger, wenn du erst einen einrichten musst.

Das Tutorial nutzt einen Support-Triage-Agent als durchgehendes Beispiel — denselben, den [Agent-Konzepte](/de/platform/agents/concepts) einführt. Ersetze die Domäne frei durch deine eigene; die Schritte hängen nicht am Beispiel.

## Bevor du beginnst

Stell sicher, dass zwei Dinge stehen:

- Ein Modellanbieter ist unter **Einstellungen > Anbieter** konfiguriert. Cloud-Nutzer bekommen standardmäßig einen; selbst gehostete Betreiber folgen [Konfiguration → Anbieter](/de/self-hosted/configuration/providers). Ohne Anbieter stoppt dich der Dialog: ein Agent braucht ein Modell, um zu laufen.
- Du hast die Rolle Redakteur oder höher in dieser Organisation. Prüfe deine Mitgliederzeile unter **Einstellungen > Organisation**, wenn du unsicher bist.

## Schritt 1 — Den Agent erstellen

Öffne **Agenten** in der Seitenleiste und klicke auf **Agent erstellen**, dann wähle **Leer** (das Menü bietet auch **Aus Vorlage** und **Datei hochladen** für den Import von Agent-JSON). Der Dialog fragt nach vier Dingen: einem **Name** — der eindeutigen Id für Links und die API, die du später nicht ändern kannst; füge ein `/` ein, um den Agent in einem Ordner abzulegen, z. B. `marketing/seo-writer` —, einem **Anzeigename**, den Teamkollegen im Chat sehen, einer **Beschreibung** und der **Modell**-Liste. Das erste Modell ist der Standard, der Rest sind Fallbacks; zieh zum Umsortieren oder ergänze jederzeit weitere. Klicke auf **Weiter**, und der Editor öffnet sich auf dem Tab **Allgemein**.

<Frame caption="Die Agentenliste — Agent erstellen sitzt oben rechts; die Ordnerzeilen entstehen aus Slugs mit einem /-Präfix.">

![Die Agentenliste mit ausgeklapptem chat-Ordner, die die Zeilen Assistant und Automation Assistant mit ihren Standardmodellen und Tool-Anzahlen zeigt.](/images/platform/agents-list-expanded.webp)

</Frame>

## Schritt 2 — Die Anweisungen schreiben

Öffne **Anweisungen & Modelle**. Das Feld **Systemanweisungen** ist reines Markdown, mit **Prompts durchsuchen** als Start aus der Prompt-Bibliothek der Organisation und Template-Variablen, die zur Laufzeit aufgelöst werden. Drei Ratschläge aus der Praxis:

- **Beginne mit der Stimme.** Ein Absatz, der benennt, wer der Agent ist, wem er antwortet und welchen Ton er anschlägt. Das Modell behandelt das als stärkstes Signal.
- **Benenne die Ablehnungsfälle explizit.** Drei oder vier Sätze, die sagen, was der Agent ablehnt und was er sagt, wenn er ablehnt.
- **Widersteh dem Drang, jedes Verhalten zu spezifizieren.** Lange Anweisungen verwässern in langen Konversationen. Gehört ein Verhalten in Code, stütz dich auf ein Tool; gehört es in Daten, stütz dich auf Wissen.

Derselbe Tab hält die Modell-Liste aus dem Dialog — das erste Modell ist das primäre, und jedes Modell darunter ist der nächste Fallback, wenn das darüber nicht verfügbar ist.

<Frame caption="Anweisungen & Modelle — oben das System-Prompt, darunter die geordnete Modell-Liste.">

![Der Tab Anweisungen & Modelle des Agenten-Editors mit dem Systemanweisungen-Feld samt Sprach-Tabs und einer geordneten Liste von fünf Modellen mit Umsortier-Reglern.](/images/platform/agent-editor-instructions.webp)

</Frame>

## Schritt 3 — Den Wissens-Scope setzen

Wechsle zum Tab **Wissen**. Wähle einen **Abrufmodus** — **Tool** lässt den Agent bei Bedarf suchen, **Kontext** injiziert relevantes Wissen in jede Antwort, **Beides** tut beides, **Aus** schaltet die Wissensdatenbank ab. Setz dann den Scope des Durchsuchbaren: **Team-Dokumente einbeziehen**, **Organisationsdokumente einbeziehen** und **Agent-Dokumente**, die du nur für diesen Agent hochlädst. Binde die kleinste nützliche Menge — alles, was du einbeziehst, konkurriert bei jeder Frage um den Abruf.

<Frame caption="Der Wissen-Tab — Abrufmodus, Dokument-Scopes und die indizierten Organisationsdokumente.">

![Der Wissen-Tab des Agenten-Editors mit den Abrufmodus-Optionen, den Schaltern für Team- und Organisationsdokumente und drei indizierten Organisationsdokumenten.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Schritt 4 — Die Tools gewähren

Wechsle zum Tab **Tools**. Tools sind einzelne Checkboxen, gruppiert nach Kategorie — Kunden, Produkte, Dateien, Workflows und mehr — plus einer Auswahl für den **Websuche**-Modus ganz oben. Gewähre, was der Agent braucht, und lass den Rest aus; jeder Schalter weitet die Vertrauensgrenze.

<Frame caption="Der Tools-Tab — eine Checkliste pro Tool nach Kategorie, mit dem Websuche-Modus obenauf.">

![Der Tools-Tab des Agenten-Editors mit den Websuche-Modus-Optionen und Checkboxen pro Tool, gruppiert unter Kunden, Produkte, Lieferanten und Wissen.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Code ausführen** (unter **System**) führt Skripte in einer Sandbox aus und untersteht der [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy) der Organisation — die Checkbox gewährt das Tool, die Richtlinie entscheidet, was ein Lauf tun darf.

</Note>

## Schritt 5 — Sichtbar machen und ausprobieren

Zurück auf **Allgemein**: Schalte **Im Chat sichtbar** ein und klicke auf **Speichern**. Eine Meldung bestätigt **Agent gespeichert**. Öffne einen neuen Chat, wähle den Agent in der Agentenauswahl und schick eine Nachricht, die das gewährte Wissen und die Tools fordert. Antwortet der Agent so, wie du es ihm geschrieben hast, bist du fertig; wenn nicht, zeigt der Button **Verlauf** oben rechts im Editor jede gespeicherte Version und lässt dich vergleichen oder wiederherstellen.

## Fehlerbehebung

- **Speichern scheitert mit einer Modell-Warnung.** Der Agent hat kein Modell gesetzt — ergänze eines auf dem Tab Anweisungen & Modelle, bevor du speicherst.
- **Der Agent taucht nicht in der Agentenauswahl auf.** Bestätige, dass **Im Chat sichtbar** an ist; ist es aus, ist der Agent nur über Delegation erreichbar. Ist es an, prüfe den Abschnitt **Zugriff** — ein Agent, der einem Team zugewiesen ist, ist nur für dieses Team nutzbar.
- **Antworten ignorieren das Wissen.** Der Abrufmodus steht womöglich auf **Aus**, die Scope-Schalter sind aus, oder das Dokument ist noch nicht im Zustand **Indiziert** — öffne es über [Dokumente](/de/platform/knowledge/documents) und prüfe.
- **Ein Tool-Aufruf wird zur Laufzeit verweigert.** Eine Governance-Richtlinie sperrt das Tool: die Agent-Definition erlaubt es, die Laufzeit verweigert. Prüfe [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

## Wo das gebraucht wird

Einen Agent zu erstellen ist der Moment, in dem sich der Rest der Plattform nach Tale anfühlt statt nach generischem Chat. Der natürliche nächste Gang ist [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) — dieselbe Form, aber mit einem Ordner voller Dokumente und der Zitat-Pipeline von Anfang bis Ende. Um zu sehen, wie ein Agent eine Teilaufgabe an einen Worker gibt, ist [Arbeit an einen Worker geben](/de/tutorials/editor/delegate-between-agents) der Durchlauf.
