---
title: Skills auf Agenten
description: Wie ein Skill aus der Bibliothek einen Agenten erreicht — die Agenten eines Projekts ausrüsten, wessen Sichtbarkeit zählt und wie ein Bundle in einer Sandbox-Sitzung landet.
---

Ein Agent kommt an einen Skill nur heran, wenn er ausgerüstet ist — und ausgerüstet wird aus der [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation. Diese Seite handelt von den Oberflächen, die daraus wählen: den Agenten eines Projekts und den Agent-Knoten einer Automation. Eine Regel entscheidet, was sie wählen dürfen: **Es zählt die Sichtbarkeit des Projekts selbst, nie die des Mitglieds, das konfiguriert.**

## Was Ausrüsten entscheidet

Ein ausgerüsteter Skill wird dem Modell über seine Beschreibung angeboten. Hält das Modell diese Beschreibung für relevant für deine Anfrage, liest es den Body der `SKILL.md` und öffnet einzelne Bundle-Dateien, wo der Body auf sie verweist. Nichts wird ausgeführt, nichts vorab eingefügt — ein Skill kostet nur in den Zügen Kontext, in denen das Modell wirklich zu ihm greift.

Ein Bundle mit `disable-model-invocation: true` im Frontmatter verhält sich anders: Es bleibt ausgerüstet und lesbar, aber das Modell darf nicht ungefragt danach greifen; es wartet auf einen Zug, in dem es jemand beim Namen nennt.

## Die Agenten eines Projekts ausrüsten

Ein [Projekt-Agent](/de/platform/agents/create) trägt seine eigene Ausrüstung, gewählt im Ausrüstungsmenü im Dialog des Agenten. Die Liste dort folgt der Sichtbarkeit des **Projekts**, nicht deiner: organisationsweite Skills plus Team-Skills, die mit einem der Teams des Projekts geteilt sind. Ein organisationsweites Projekt sieht nur Organisations-Skills, und niemandes alte private Skills tauchen auf — ein Projekt-Agent läuft für jedes Mitglied des Projekts, seine Ausrüstung darf also nie etwas einschmuggeln, das nur seine Autorin sehen könnte.

Dieselbe Regel gilt zur Laufzeit. Ein Task-Lauf lädt die Skills des Agenten als das Projekt; eine Automation auf Organisationsebene als die Organisation. Ein Skill, der für diese Sicht unsichtbar wird, lässt den Lauf mit seinem Namen fehlschlagen, statt still ohne ihn zu laufen — bewusst gewählte Ausrüstung, die stumm fehlt, ist schlimmer als ein fehlgeschlagener Lauf.

## Skills in einer Sandbox-Sitzung

Läuft ein Zug in einer Sandbox, kommen ausgerüstete Bundles nicht über einen Tool-Aufruf an. Sie werden als Dateien in die Sitzung geladen, im Layout, das die Laufzeit ohnehin kennt — das Harness findet sie so, wie es einen Skill auf jeder Maschine fände, auf der es arbeitet.

Für Kollisionen gilt eine Regel: Das Repository gewinnt. Liefert das ausgecheckte Repository einen Skill unter demselben Slug wie einer, den Tale laden würde, hält Tale seine Kopie zurück, und die Version des Repositories steht. Ein Repository kann immer überschreiben, was die Plattform dem Agenten sonst beibringen würde, und die Sitzung hält nie zwei Bundles mit demselben Namen.

## Skill oder Instruktionen

| Nimm … wenn                                                 | Skill | Agent-Instruktionen |
| ----------------------------------------------------------- | ----- | ------------------- |
| Das Muster wiederholt sich über mehrere Agenten             | ✓     |                     |
| Das Verhalten braucht Referenzdateien neben der Prosa       | ✓     |                     |
| Das Verhalten ist die Stimme genau dieses einen Agenten     |       | ✓                   |
| Eine Änderung soll alle erreichen, die das Verhalten nutzen | ✓     |                     |
| Die Instruktionen des Agenten passen noch auf einen Schirm  |       | ✓                   |

Instruktionen sind die richtige Form für den eigenen Charakter eines Agenten. Ein Skill ist die richtige Form, sobald dasselbe Verhalten beim zweiten und dritten Agenten auftaucht und es dich etwas kostet, ihre Instruktionen im Gleichschritt zu halten.

## Wo das hingehört

Ausrüsten ist die schmale Hälfte der Skills: Die Bibliothek entscheidet, was existiert und wer es sieht; der Agenten-Dialog eines Projekts und die Agent-Knoten einer Automation entscheiden, wo es genutzt wird — immer durch die Sichtbarkeit des Projekts oder der Organisation selbst. Halte Ausrüstungslisten kurz, ersetze ein Bundle lieber, statt es zu klonen, und lass ein Repository überschreiben, was die Plattform laden würde, wenn ein Agent in einem arbeitet. Die andere Hälfte der Geschichte — eine `SKILL.md` schreiben, einen Ordner hochladen, ein Bundle teilen — ist die [Skill-Bibliothek](/de/platform/workspace/skills).
