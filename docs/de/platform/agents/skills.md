---
title: Skills auf Agenten
description: Wie ein Skill aus der Bibliothek eine Konversation oder einen Agenten erreicht — das Ausrüstungsmenü im Chat, der /-Befehl für eine Nachricht, Projekt-Agenten und wessen Sichtbarkeit wo zählt.
---

Ein Chat oder ein Agent kommt an einen Skill nur heran, wenn er ausgerüstet ist — und ausgerüstet wird aus der [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation. Diese Seite handelt von den Oberflächen, die daraus wählen: dem Chat-Composer, dem `/`-Befehl und den Agenten eines Projekts. Eine Regel entscheidet, was jede Oberfläche wählen darf: **Im Chat zählt deine Sichtbarkeit; in einem Projekt die des Projekts selbst.**

## Was Ausrüsten entscheidet

Ein ausgerüsteter Skill wird dem Modell über seine Beschreibung angeboten. Hält das Modell diese Beschreibung für relevant für deine Anfrage, liest es den Body der `SKILL.md` und öffnet einzelne Bundle-Dateien, wo der Body auf sie verweist. Nichts wird ausgeführt, nichts vorab eingefügt — ein Skill kostet nur in den Zügen Kontext, in denen das Modell wirklich zu ihm greift.

Ein Bundle mit `disable-model-invocation: true` im Frontmatter verhält sich anders: Es bleibt ausgerüstet und lesbar, aber das Modell darf nicht ungefragt danach greifen; es wartet auf einen Zug, in dem es jemand beim Namen nennt.

Der `usage-mode` eines Skills entscheidet, welche Oberflächen ihn überhaupt anbieten: `chat` hält ihn bei Konversationen (Ausrüstungsmenü und `/`-Befehl), `agent` bei Agenten und Automationen, und `all` — der Standard — bietet ihn überall an.

## Eine Konversation ausrüsten

Das Ausrüstungsmenü neben der Modellauswahl des Chat-Composers listet jeden chat-nutzbaren Skill, den du siehst, neben den aktivierten Connectors. Was du dort anhakst, ist die Ausrüstung der Konversation: Es wird in die Sitzung des Agenten geladen und bleibt für den ganzen Thread ausgerüstet.

Weil ein Chat deiner ist, folgt die Liste **deiner** Sichtbarkeit — deine privaten Skills, die deiner Teams und die der Organisation. Ein Skill, den du aus dem Blick verlierst (anders geteilt, gelöscht), hört mit deinem nächsten Zug schlicht auf zu laden.

## Einen Skill für eine Nachricht aufrufen

Tippe `/` als erstes Zeichen der Nachricht, und der Composer bietet die chat-nutzbaren Skills an, die du siehst; tippe weiter zum Eingrenzen, Pfeiltasten zum Bewegen, Enter zum Vervollständigen. Eine Nachricht wie

```text
/release-notes alles, was seit Dienstag gemergt wurde
```

ruft diesen einen Skill für diese eine Nachricht auf: Das Bundle wird für den Zug geladen, das Modell liest es zuerst und behandelt den Rest der Nachricht als seine Argumente — die gespeicherte Ausrüstung der Konversation bleibt unberührt. Ein `/irgendwas`, das auf keinen Skill passt, den du im Chat nutzen kannst, geht als gewöhnlicher Text raus. Dieses Durchfallen ist die Ausweichtür — es gibt nichts zu escapen.

## Die Agenten eines Projekts ausrüsten

Ein [Projekt-Agent](/de/platform/agents/create) trägt seine eigene Ausrüstung, gewählt im selben Ausrüstungsmenü im Dialog des Agenten. Die Liste dort folgt der Sichtbarkeit des **Projekts**, nicht deiner: organisationsweite Skills plus Team-Skills, die mit einem der Teams des Projekts geteilt sind. Ein organisationsweites Projekt sieht nur Organisations-Skills, und private Skills tauchen nie auf — ein Projekt-Agent läuft für jedes Mitglied des Projekts, seine Ausrüstung darf also nie etwas einschmuggeln, das nur seine Autorin sehen könnte.

Dieselbe Regel gilt zur Laufzeit. Ein Task-Lauf lädt die Skills des Agenten als das Projekt; eine Automation auf Organisationsebene als die Organisation. Ein Skill, der für diese Sicht unsichtbar wird, lässt den Lauf mit seinem Namen fehlschlagen, statt still ohne ihn zu laufen — bewusst gewählte Ausrüstung, die stumm fehlt, ist schlimmer als ein fehlgeschlagener Lauf.

## Skills in einer Sandbox-Sitzung

Läuft ein Zug in einer Sandbox, kommen ausgerüstete Bundles nicht über einen Tool-Aufruf an. Sie werden als Dateien in die Sitzung geladen, im Layout, das die Laufzeit ohnehin kennt — der Dritt-Agent findet sie so, wie er einen Skill auf jeder Maschine fände, auf der er arbeitet.

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

Ausrüsten ist die schmale Hälfte der Skills: Die Bibliothek entscheidet, was existiert und wer es sieht; das Chat-Menü, der `/`-Befehl und der Agenten-Dialog eines Projekts entscheiden, wo es genutzt wird — jede Oberfläche durch ihre eigene Sichtbarkeit. Halte Ausrüstungslisten kurz, ersetze ein Bundle lieber, statt es zu klonen, und lass ein Repository überschreiben, was die Plattform laden würde, wenn ein Agent in einem arbeitet. Die andere Hälfte der Geschichte — eine `SKILL.md` schreiben, einen Ordner hochladen, ein Bundle teilen — ist die [Skill-Bibliothek](/de/platform/workspace/skills).
