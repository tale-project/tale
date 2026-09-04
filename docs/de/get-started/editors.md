---
title: Dein erster Tag als Agent-Autor
description: Der Einstieg für Redakteure — erstelle einen Projekt-Agenten, gib ihm Anweisungen und sieh ihm bei echter Arbeit auf einer Aufgabe zu.
---

Dieser Einstieg ist für die Person, die aus „das Team stellt immer dieselben Fragen“ einen Agent macht, der sie beantwortet. In fünfzehn Minuten erstellst du einen Agent auf einem Projekt, formst sein Verhalten und siehst ihm bei echter Arbeit auf einer Aufgabe zu — die Schleife, die jeder spätere Agent verfeinert.

Du brauchst Bearbeitungsrechte auf einem Projekt und mindestens einen Anbieter unter **Einstellungen > KI-Anbieter** mit einem Modell darauf; antwortet der Chat bereits, ist der Anbieter da — das ist der [Quickstart](/de/get-started/quickstart). Agenten leben in dieser Version auf Projekten: Es gibt keinen Eintrag Agenten in der Sidebar und keinen Agent, den du im Chat auswählst.

<Steps>

<Step title="Erstelle den Agent">

Für einen Agent, den Teammitglieder an die Arbeit schicken können, öffne den Tab **Agenten** eines Projekts und klicke auf **Neuer Agent**. Benenne ihn nach dem Job, nicht nach der Technologie — „Support-Triage“ schlägt „GPT-Helfer“ —, denn diesen Namen sehen Teammitglieder auf den Aufgabenkarten, wenn sie ihm Arbeit zuweisen.

</Step>

<Step title="Wähl Laufzeit und Modell">

Der Dialog fragt nach einer **Agent-Laufzeit** — der Coding-CLI, auf der der Agent läuft — und einem **Modell**; ein Modell, das mehrere Anbieter bedienen, steht einmal pro Anbieter in der Liste, und die Wahl gilt genau so. Lass **Skills, Connectors & Tools** und **Secrets** am ersten Tag leer: Jedes Tool, das du gewährst, erweitert, was der Agent erreichen kann, und der erste Job braucht keines.

</Step>

<Step title="Schreib die Anweisungen">

**Anweisungen** ist der Hebel, der am meisten bewegt. Schreib einen Absatz, als würdest du eine neue Kollegin briefen: die Stimme, in der er antwortet, die Domäne, die er verantwortet, und die Fälle, die er ablehnen soll. Konkret schlägt vollständig — du verfeinerst, sobald du echte Ergebnisse gesehen hast. Klicke auf **Agent erstellen**; ab diesem Moment lässt sich ihm Arbeit zuweisen, ein separater Veröffentlichungsschritt entfällt.

</Step>

<Step title="Sieh ihm bei der Arbeit zu">

Agents arbeiten auf Aufgaben — der Chat führt nur den eingebauten Assistenten aus. Erstell auf dem Projekt-Board eine Aufgabe, die die Arbeit in einem Satz benennt, weis sie dem Agent zu und klicke auf **Agent starten**. Die Karte wandert nach _In Bearbeitung_, während der Agent in seiner Sandbox arbeitet; sein Bericht landet als Aufgabenkommentar, und die Karte parkt unter **In Prüfung** — auf _Erledigt_ setzt sie nur ein Mensch.

<Check>

Folgt das Ergebnis der Stimme und dem Rahmen, die du geschrieben hast, greifen die Anweisungen — der Agent ist echt.

</Check>

</Step>

</Steps>

## Wo du jetzt stehst

Du hast den kleinsten echten Agent ausgeliefert: einen benannten Agent im Tab **Agenten** eines Projekts mit einem Absatz Anweisungen. Das vollständige Modell hinter dem, was du angefasst hast, sind die [Agent-Konzepte](/de/platform/agents/concepts) — Anweisungen, Tools, Skills und Wissensbereich —, und [Projekt-Agenten](/de/platform/projects/project-agents) ist die Referenz Feld für Feld. Der natürliche nächste Bau ist [dein erster Agent von Anfang bis Ende](/de/tutorials/editor/first-agent-end-to-end), der dieselben vier Handgriffe an einer echten Domäne durchspielt und das Ergebnis prüft; danach sagt der [Wissens-Überblick](/de/platform/knowledge/overview), wo Wissen liegt, und [Aufgaben-Automatisierung](/de/platform/projects/task-automation), wie die Arbeit eines Agenten über das Board beim nächsten ankommt.
