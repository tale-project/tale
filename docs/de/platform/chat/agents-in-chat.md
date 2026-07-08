---
title: Agents im Chat
description: Wie der Agents-Picker im Chat funktioniert — welche Agents erscheinen, was Visible in chat steuert, einmalige versus klebrige Agents, mitten im Thread wechseln und Sub-Agent-Aufrufe.
---

Einen Agent im Chat zu wählen ist der Unterschied zwischen einem generischen Assistant zu fragen und etwas zu fragen, das die Org für eine Domäne geformt hat. Der Agents-Picker ist das meistgenutzte Bedienelement im Composer; die Regeln, welcher Agent erscheint, wann ein Agent bestehen bleibt und was beim Wechsel mitten im Chat passiert, sind das Thema dieser Seite.

Der Picker ist konzeptuell einfach — Namen tippen, Enter drücken — aber die Regeln zu Sichtbarkeit und Klebrigkeit verursachen in der Praxis die meisten „Warum sehe ich diesen Agent nicht"-Supporttickets. Die Regeln zu kennen erspart den Hin- und Herweg.

## Der Agents-Picker

Klick **Select agent** am Composer (oder den Chip mit dem aktuell gewählten Agent), und der Picker öffnet mit **Search agents** oben. Die Liste zeigt jeden Agent, auf den der User Zugriff hat und der als **Visible in chat** markiert ist; Agents ohne diesen Schalter existieren in der Org, tauchen aber nie im Picker auf, was die Liste kurz hält. **Add agent** unten ist eine Abkürzung für Redakteure und höher, um einen neuen zu erstellen — siehe [Agent erstellen](/de/platform/agents/create).

## „Visible in chat"

Jeder Agent hat einen **Visible in chat**-Schalter auf seiner Instructions-Seite. Ihn auszuschalten deaktiviert den Agent nicht — Workflows können ihn weiterhin aufrufen; Sub-Agent-Aufrufe aus anderen Agents funktionieren weiterhin — es versteckt den Agent nur vor dem Chat-Picker. Der Grund: Orgs enden mit Dutzenden von Agents, die ein durchschnittlicher User nie wählt (Hilfsagents, die andere Agents rufen, an einen bestimmten Workflow gebundene Agents), und sie alle anzuzeigen würde die Alltagsauswahl überschwemmen.

## Einmalig versus klebrig

Einen Agent **vor** der ersten Nachricht im Chat zu wählen, macht ihn klebrig — jede folgende Nachricht im selben Chat geht an denselben Agent. Einen Agent **mitten im Chat** zu wählen, wendet ihn auf die nächste Nachricht und alles danach an, bis du wieder wechselst. Es gibt keine „Agent einmal nutzen und zurückkehren"-Geste; um zum generischen Assistant zurückzukehren, wähl im Picker explizit **Assistant**. Das Transkript behält den Pro-Nachricht-Agent, also liest sich ein Chat mit einem Wechsel mittendrin wie zwei kollaborierende Agents.

## Mitten im Thread wechseln

Wissen und Tools des Agents wechseln mit dem Picker, die Konversationshistorie aber nicht. Der neue Agent liest alles, was davor war — deine Nachrichten und die Antworten des vorherigen Agents — und macht von dort weiter. Das ist nützlich für Übergaben: ein Triage-Agent antwortet auf die erste Nachricht, du wechselst zu einem Spezialisten für Folgefragen, der Spezialist hat den vollen Kontext, ohne dass jemand kopieren und einfügen muss.

## Sub-Agent-Aufrufe

Die Instructions eines Agents können ein Sub-Agent-Tool enthalten; wenn ja, kann der primäre Agent einen Teil der Arbeit delegieren, ohne dass der User irgendetwas wählt. Sub-Agent-Aufrufe rendern in der Antwort als eingeklappte Tool-Aufrufe — der User sieht, was delegiert wurde und was zurückkam, nicht eine vollständige zweite Konversation. Die Delegationsregeln und das Loop-Vermeidungsmodell leben auf [Agent-Delegation](/de/platform/agents/delegation).

## Wann du nach welcher Form greifst

| Nutz … wenn                                         | Chat | Projects | Conversations |
| --------------------------------------------------- | ---- | -------- | ------------- |
| Persönliche Aufgabe, einmalige Frage                | ✓    |          |               |
| Geteilter Workspace im Team, wiederkehrende Threads |      | ✓        |               |
| Eingehend aus einem Kundenkanal (E-Mail, Webhook)   |      |          | ✓             |

## Wo das hineinpasst

Agents im Chat ist die User-zugewandte Hälfte der Agents-Geschichte — was der Picker tut, was erscheint, wie Klebrigkeit funktioniert. Die Bau-zugewandte Hälfte ist [Agent-Konzepte](/de/platform/agents/concepts): die vier Knöpfe, die bestimmen, was ein Agent tut, sobald er gewählt ist. Wenn du hier bist, um den Agent zu bauen, den du dir im Picker wünschst, ist das die nächste Lektüre.
