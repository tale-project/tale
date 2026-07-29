---
title: Einen Agent erstellen
description: Vom leeren Dialog zu einem einsatzfähigen Agenten — benennen, Anweisungen schreiben, Tools und Skills gewähren, Wissen eingrenzen und im Chat ausprobieren.
---

Diese Anleitung führt vom leeren Dialog zu einem Agenten, den deine Kolleginnen auswählen können. Am Ende steht eine Persona, die ihre Domäne kennt, die Tools hat, um mit dem Gelesenen etwas anzufangen, und aus jedem Chat deiner Organisation erreichbar ist. Rechne mit rund fünfzehn Minuten.

Als durchgehendes Beispiel dient ein Agent für die Support-Triage — derselbe, den [Agent-Konzepte](/de/platform/agents/concepts) einführt. Setz ruhig deine eigene Domäne ein; keiner der Schritte hängt am Beispiel.

## Bevor du anfängst

Zwei Dinge sollten stehen:

- Deine Organisation hat mindestens einen Provider-Zugang unter **Einstellungen > Provider**. Der Agent selbst nennt kein Modell — wer eine Nachricht abschickt, wählt es im Composer —, aber der Composer hat nichts anzubieten, solange kein Zugang existiert. In der Cloud ist einer voreingestellt; wer selbst hostet, folgt [Konfiguration → Provider](/de/self-hosted/configuration/providers).
- Du hast hier mindestens die Rolle Editor. Unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles) siehst du nach, falls du unsicher bist.

## Schritt 1 — Benennen und festlegen, wer ihn sieht

Öffne **Agenten** in der Seitenleiste und lege einen neuen an. Der Dialog fragt nach einem **Namen** — der eindeutigen ID, die in Links und in der API auftaucht und sich später nicht mehr ändern lässt, also lieber sprechend und klein geschrieben, `support-triage` statt `agent2` — dazu nach einem **Anzeigenamen**, unter dem das Team ihm begegnet, und einer kurzen **Beschreibung**. Bestätige, und der Editor öffnet sich auf **Allgemein**.

Auf **Allgemein** sitzt die Identität: Anzeigename, Beschreibung, ein Icon und die **Sichtbarkeit** des Agenten. Halte ihn privat, solange du noch an ihm formst, dann kommst nur du heran; gib ihn für die Organisation frei, und jedes Mitglied kann ihn im Composer auswählen. Ein privater Agent hält einen Besitzer fest, und das bist du — ein Agent, den niemand besitzt und niemand sieht, wäre für niemanden erreichbar.

## Schritt 2 — Die Anweisungen schreiben

Öffne **Anweisungen**. Das Feld ist reines Markdown, begrenzt auf 20.000 Zeichen, und es wird jedem Zug vorangestellt, den der Agent beantwortet. Drei Ratschläge aus der Praxis:

- **Fang mit der Stimme an.** Ein Absatz dazu, wer der Agent ist, wem er antwortet und welchen Ton er trifft. Das Modell wertet ihn als das stärkste Signal der ganzen Datei.
- **Benenne die Ablehnungsfälle ausdrücklich.** Drei, vier Sätze dazu, was der Agent nicht tut und was er sagt, wenn er ablehnt.
- **Widersteh der Lust, jedes Verhalten festzuschreiben.** Lange Anweisungen verwässern in langen Gesprächen. Gehört ein Verhalten in Code, nimm ein Tool; gehört es in Dokumente, nimm den Wissensbereich; wiederholt es sich über Agenten hinweg, nimm einen Skill.

Die Anweisungen lassen sich wie Anzeigename und Beschreibung pro Sprache übersetzen — eine französische Leserin bekommt so einen auf Französisch gebrieften Agenten und nicht ein englisches Briefing, das auf Französisch antwortet.

## Schritt 3 — Tools und Skills gewähren

Wechsle auf **Tools**. Tools sind einzelne Schalter, gebündelt in Kategorie-Karten — Kontakte, Produkte, Dateien, Wissen, Automatisierungen und mehr —, und jeder gewährte Schalter erweitert, was der Agent in deinem Namen lesen oder ändern darf. Gewähre das kleinste Set, das die Aufgabe erledigt, und lass den Rest aus. Angebundene Connectors und die Automatisierungen der Organisation stehen in derselben Liste, das Binden ist also derselbe Handgriff wie das Gewähren eines Plattform-Tools.

<Frame caption="Der Tool-Katalog — eine Karte pro Kategorie, jede mit der Zahl der Tools, die der Agent gewährt bekommen hat.">

![Der Tools-Tab des Agenten-Editors, gescrollt zu den Kategorie-Karten, mit Wissen bei drei von vier angehakten Tools und Dateien bei sieben von sieben, während Konversationen, Diskussionen, Analysen und Aufgaben & Projekte nichts gewährt bekommen haben.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Code ausführen** startet Skripte in einer Sandbox und untersteht der [Run-Code-Policy](/de/platform/admin/governance/run-code-policy) der Organisation — der Schalter gewährt das Tool, die Policy entscheidet, was ein Lauf tatsächlich darf.

</Note>

Öffne danach **Skills** und binde die Bundles, die dieser Agent aufklappen können soll, höchstens zehn. Ein Skill ist ein Wissenspaket aus der [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation: Bind hier das hauseigene Bundle für den Antwortton, und der Triage-Agent formuliert wie jeder andere Agent auch. Bleibt die Liste leer, klappt er nichts auf.

## Schritt 4 — Das Wissen eingrenzen

Wechsle auf **Wissen**. Eine Einstellung entscheidet, welchen Bestand die Suche des Agenten lesen darf: die hochgeladenen **Dokumente** der Organisation, die für sie geholten **Web**-Seiten, **alles** davon zusammengeführt, oder **nichts**, womit der Agent gar keine Suche angeboten bekommt. Gesucht wird nur, wenn der Agent es für nötig hält — in eine Antwort rutscht nichts, wonach er nicht gefragt hat.

Grenz ein, wo du kannst. Alles im Bereich konkurriert bei jeder Frage um Relevanz, und ein Agent, der auf die Dokumente zeigt, um die es geht, antwortet besser als einer, der auf alles zeigt, was die Organisation besitzt.

## Schritt 5 — Speichern und ausprobieren

Klick auf **Speichern**. Öffne einen neuen Chat, wähle den Agenten, wähle im Composer ein Modell und schick eine Nachricht, die das Wissen und die Tools beansprucht, die du gewährt hast. Das Modell ist bei jedem Zug deine Wahl, derselbe Agent kann also eine billige Frage auf einem kleinen und eine harte auf einem großen Modell beantworten, ohne dass du etwas änderst.

Antwortet er so, wie du ihn geschrieben hast, bist du fertig. Wenn nicht, liegen unter **Verlauf** oben rechts im Editor alle gespeicherten Fassungen zum Vergleichen und Zurückholen — siehe [Agent-Versionen](/de/platform/agents/versions).

## Fehlersuche

- **Der Agent taucht in der Chat-Auswahl nicht auf.** Seine Sichtbarkeit steht noch auf privat, also siehst nur du ihn. Gib ihn auf dem Tab **Allgemein** für die Organisation frei.
- **Antworten ignorieren das Wissen.** Der Wissensbereich steht womöglich auf nichts, oder das Dokument ist noch nicht indexiert — sieh es unter [Dokumente](/de/platform/knowledge/documents) nach.
- **Ein gebundener Skill wird nie benutzt.** Ein Modell greift über die Beschreibung nach einem Skill, eine vage Beschreibung wird also übergangen; sag, was er tut und wann er passt. Ein Bundle mit `disable-model-invocation` wartet absichtlich darauf, benannt zu werden.
- **Ein Tool-Aufruf wird zur Laufzeit abgelehnt.** Dann bremst eine Governance-Policy: Der Agent darf das Tool aufrufen, und die Laufzeit lehnt ab. Sieh unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) nach.

## Wo das gebraucht wird

Mit dem ersten eigenen Agenten fängt der Rest der Plattform an, sich nach Tale anzufühlen und nicht nach einem beliebigen Chatfenster. Du hast eine Persona geschrieben, ihre Grenzen mit zwei Erlaubnislisten und einem Wissensbereich gezogen und jede Frage nach dem Ablauf eines Zuges dem Gespräch überlassen. Der nächste sinnvolle Weg ist [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) — dieselbe Form, aber mit einem gebundenen Dokumentenordner und der Belegkette von Anfang bis Ende. Wie ein Agent eine Teilaufgabe an einen Worker abgibt, zeigt [Arbeit an einen Worker geben](/de/tutorials/editor/delegate-between-agents).
