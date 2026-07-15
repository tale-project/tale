---
title: Dein erster Tag als Agent-Autor
description: Der Einstieg für Redakteure — erstelle einen Agent, gib ihm Anweisungen und ein Modell, mach ihn im Chat sichtbar und sieh ihm beim Antworten zu.
---

Dieser Einstieg ist für die Person, die aus „das Team stellt immer dieselben Fragen“ einen Agent macht, der sie beantwortet. In fünfzehn Minuten erstellst du einen Agent, formst sein Verhalten und siehst ihm im Chat beim Antworten zu — die Schleife, die jeder spätere Agent verfeinert.

Du brauchst die Rolle **Redakteur** oder höher (der Bereich Agenten ist für Mitglieder ausgeblendet) in einem Arbeitsbereich, in dem der Chat bereits antwortet — das ist der [Quickstart](/de/get-started/quickstart).

<Steps>

<Step title="Erstelle den Agent">

Für einen Agent, den Teammitglieder im Chat auswählen können, öffne **Agenten** in der Sidebar und klicke auf **Agent erstellen**. Benenne ihn nach dem Job, nicht nach der Technologie — „Support-Triage“ schlägt „GPT-Helfer“ —, denn der Name ist das, was Teammitglieder später im Chat auswählen.

</Step>

<Step title="Gib ihm eine Identität">

Der Editor öffnet auf dem Tab **Allgemein**: der Anzeigename, den Teammitglieder sehen, eine einzeilige Beschreibung und der Agent-Typ. Der Schalter, der am ersten Tag zählt, ist **Im Chat sichtbar** — ohne ihn existiert der Agent zwar, aber niemand kann ihn im Chat auswählen.

<Frame caption="Der Tab Allgemein — Identität, Agent-Typ und Chat-Sichtbarkeit.">

![Der Tab Allgemein im Agent-Editor für den Assistenten-Agent mit den Agent-Typ-Optionen, dem Schalter Im Chat sichtbar und dem Feld für den Anzeigenamen.](/images/get-started/agent-editor-general.webp)

</Frame>

</Step>

<Step title="Schreib die Anweisungen">

Öffne **Anweisungen & Modelle** — der Hebel, der am meisten bewegt. Schreib einen Absatz, als würdest du eine neue Kollegin briefen: die Stimme, in der er antwortet, die Domäne, die er verantwortet, und die Fälle, die er ablehnen soll. Konkret schlägt vollständig — du verfeinerst, sobald du echte Antworten gesehen hast.

<Frame caption="Anweisungen & Modelle — der System-Prompt über der geordneten Modellliste.">

![Der Tab Anweisungen & Modelle im Agent-Editor mit dem Feld für den System-Prompt und der geordneten Modellliste für den Assistenten-Agent.](/images/platform/agent-editor-instructions.webp)

</Frame>

</Step>

<Step title="Binde das Modell">

Derselbe Tab bindet das Modell: Wähl eines aus den konfigurierten Anbietern des Arbeitsbereichs, oder lass das Routing auf automatisch, damit Tale pro Anfrage das beste verfügbare Modell ermittelt. Klicke auf **Speichern** — ein Toast **Agent gespeichert** bestätigt den Schreibvorgang.

</Step>

<Step title="Sieh ihm beim Antworten zu">

Öffne **Neuer Chat**, wähl deinen Agent in der Agent-Auswahl und frag etwas, das klar in deinen Anweisungen liegt. Frag danach etwas, das die Anweisungen ablehnen sollen.

<Frame caption="Die Agent-Auswahl — dein neuer Agent gelistet neben den Katalog-Agents.">

![Die geöffnete Agent-Auswahl des Chats, die die im Arbeitsbereich verfügbaren Agents listet.](/images/platform/chat-agent-picker.webp)

</Frame>

<Check>

Eine Antwort in der richtigen Stimme auf die erste Nachricht und eine Ablehnung auf die zweite heißt: Die Anweisungen greifen — der Agent ist echt.

</Check>

</Step>

</Steps>

## Wo du jetzt stehst

Du hast den kleinsten echten Agent ausgeliefert: Anweisungen, ein Modell, ein Platz in der Auswahl. Das vollständige Modell hinter dem, was du angefasst hast, sind die [Agent-Konzepte](/de/platform/agents/concepts) — Anweisungen, Wissen, Tools und Modell als vier Knöpfe. Der natürliche nächste Bau ist [dein erster Agent von Anfang bis Ende](/de/tutorials/editor/first-agent-end-to-end), der Wissensanbindungen und eine echte Domäne ergänzt; danach führen [Agents mit Wissen](/de/tutorials/editor/agent-with-knowledge) und [Delegation zwischen Agents](/de/tutorials/editor/delegate-between-agents) dieselbe Schleife weiter.
