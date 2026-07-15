---
title: Agents im Chat
description: Wie der Agent-Picker im Chat funktioniert — welche Agents erscheinen, was „Im Chat sichtbar" steuert, einmalige versus dauerhafte Agents, Wechsel mitten im Chat und Sub-Agent-Aufrufe.
---

Einen Agent im Chat zu wählen ist der Unterschied zwischen einer Frage an den generischen Assistenten und einer Frage an etwas, das die Org für eine Domäne geformt hat. Der Agent-Picker ist das meistgenutzte Bedienelement im Chat; welche Agents erscheinen, wann ein Agent gesetzt bleibt und was beim Wechsel mitten im Chat passiert, ist das Thema dieser Seite.

<Frame caption="Der geöffnete Agent-Picker über dem Chat — Auto, die installierten Agents und der Katalog-Shortcut.">

![Der über dem Chat geöffnete Agent-Picker zeigt ein Suchfeld, einen Auto-Eintrag, den ausgewählten Assistenten, einen Eintrag namens Automation Assistant und einen Knopf Automatisierungen durchsuchen.](/images/platform/chat-agent-picker.webp)

</Frame>

## Der Agent-Picker

Klick auf den Agent-Chip am Chat (sein zugänglicher Name ist **Agent auswählen**), und der Picker öffnet mit **Agents suchen** obenauf. Die Liste zeigt **Auto** — Tale routet jede Nachricht an den Agent, der am besten passt — gefolgt von jedem Agent, auf den du Zugriff hast und der als **Im Chat sichtbar** markiert ist; Coding-Agenten bekommen einen eigenen Abschnitt **Coding-Agenten**, sobald welche sichtbar sind. Agents ohne diesen Schalter existieren in der Org, tauchen hier aber nie auf, was die Liste kurz hält. **Automatisierungen durchsuchen** unten führt zum [Automatisierungen-Katalog](/de/platform/automations/catalog) — neue Agents kommen als Teil einer Automatisierung an, die du installierst.

## „Im Chat sichtbar"

Jeder Agent hat einen Schalter **Im Chat sichtbar** auf der Seite **Allgemein** seines Editors. Ihn auszuschalten deaktiviert den Agent nicht — Automatisierungen und Workflows können ihn weiterhin aufrufen, und Sub-Agent-Aufrufe aus anderen Agents funktionieren weiter — es versteckt den Agent nur vor dem Chat-Picker. Der Grund: Orgs landen bei Dutzenden Agents, die kaum jemand je von Hand wählt (Hilfs-Agents, die andere Agents rufen; Agents, die an einen bestimmten Workflow gebunden sind), und sie alle anzuzeigen würde die Alltagsauswahl ertränken.

## Einmalig versus dauerhaft

Wählst du einen Agent **vor** der ersten Nachricht eines Chats, bleibt er gesetzt — jede folgende Nachricht im selben Chat geht an denselben Agent. Wählst du einen Agent **mitten im Chat**, gilt er ab der nächsten Nachricht und für alles danach, bis du wieder wechselst.

<Note>

Eine Geste „diesen Agent einmal nutzen und zurückspringen" gibt es nicht — um den Chat zurückzugeben, wähl im Picker explizit **Assistent** (oder **Auto**). Das Transkript behält den Agent pro Nachricht, ein Chat mit einem Wechsel mittendrin liest sich also wie zwei Agents, die zusammenarbeiten.

</Note>

## Mitten im Chat wechseln

Wissen und Tools des Agents wechseln mit dem Picker, der Gesprächsverlauf aber nicht. Der neue Agent liest alles, was davor war — deine Nachrichten und die Antworten des vorherigen Agents — und macht von dort weiter. Das ist nützlich für Übergaben: Ein Triage-Agent beantwortet die erste Nachricht, du wechselst für die Nachfragen zu einem Spezialisten, und der Spezialist hat den vollen Kontext, ohne dass jemand kopieren und einfügen muss.

## Sub-Agent-Aufrufe

Die Instructions eines Agents können ein Sub-Agent-Tool enthalten; wenn ja, kann der primäre Agent einen Teil der Arbeit delegieren, ohne dass du irgendetwas wählst. Sub-Agent-Aufrufe rendern in der Antwort als eingeklappte Tool-Aufrufe — du siehst, was delegiert wurde und was zurückkam, nicht eine vollständige zweite Konversation. Die Delegationsregeln und das Loop-Vermeidungsmodell leben auf [Agent-Delegation](/de/platform/agents/delegation).

## Wann welche Form passt

| Nutz … wenn                                         | Chat | Projekte | Konversationen |
| --------------------------------------------------- | ---- | -------- | -------------- |
| Persönliche Aufgabe, einmalige Frage                | ✓    |          |                |
| Geteilter Workspace für ein Team, laufende Threads  |      | ✓        |                |
| Eingehendes aus einem Kundenkanal (E-Mail, Webhook) |      |          | ✓              |

## Wo das hineinpasst

Agents im Chat ist die nutzerzugewandte Hälfte der Agents-Geschichte — was der Picker tut, was erscheint, wann ein Agent gesetzt bleibt. Die bauzugewandte Hälfte ist [Agent-Konzepte](/de/platform/agents/concepts): die vier Knöpfe, die bestimmen, was ein Agent tut, sobald er gewählt ist. Wenn du hier bist, um den Agent zu bauen, den du dir im Picker wünschst, ist das die nächste Lektüre.
