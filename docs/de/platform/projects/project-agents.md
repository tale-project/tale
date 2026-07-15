---
title: Agenten und Modelle in einem Projekt
description: Der Tab Agenten & Modelle kuratiert, welche Agenten und Modelle Mitglieder in einem Projekt sehen — Empfohlen pinnt Favoriten nach oben, Eingeschränkt lässt nichts anderes zu.
---

Der Tab **Agenten & Modelle** eines Projekts entscheidet, welchen Agenten und Modellen Mitglieder begegnen, wenn sie im Projekt chatten. Er erstellt keine neuen Agenten — Agenten entstehen org-weit unter [Agenten](/de/platform/agents/concepts) —, er kuratiert den bestehenden Katalog für den Kontext dieses Projekts, damit ein Mitglied im Picker zuerst die richtigen Werkzeuge für die Arbeit sieht.

<Frame caption="Der Tab Agenten & Modelle — je eine Empfohlen/Eingeschränkt-Wahl für Agenten und für Modelle.">

![Der Tab Agenten & Modelle eines Projekts mit zwei Optionsgruppen, Agenten und Modelle, die jeweils einen Modus Empfohlen und einen Modus Eingeschränkt samt Hinzufügen-Button anbieten.](/images/platform/project-agents-models.webp)

</Frame>

## Die zwei Modi

Agenten und Modelle werden getrennt kuratiert, jeweils mit denselben zwei Modi:

- **Empfohlen** — die Einträge deiner Liste werden im Picker nach oben gepinnt; alles andere, was das Mitglied sonst nutzen könnte, bleibt darunter verfügbar. Das ist der Standard und der richtige Modus, um zu lenken, ohne zu blockieren.
- **Eingeschränkt** — nur die Einträge deiner Liste sind in diesem Projekt verfügbar. Wer etwas anderes wählt, bekommt eine klare Absage: Der Chat meldet, dass der Agent oder das Modell in diesem Projekt nicht verfügbar ist, und bittet um eine andere Wahl.

Die Reihenfolge der Liste ist die Reihenfolge, die Mitglieder sehen, und der erste Eintrag ist der Standard — zieh zum Umsortieren. **Agent hinzufügen** und **Modell hinzufügen** erweitern die Liste.

<Warning>

Im Modus **Eingeschränkt** sperrt eine leere Liste jedes Mitglied vom Chatten im Projekt aus — es bleibt nichts zum Auswählen übrig. Füge vor dem Speichern mindestens einen Eintrag hinzu oder wechsle zurück zu **Empfohlen**.

</Warning>

## Was Mitglieder erleben

Im Projekt spiegeln Agenten-Picker und Modell-Picker des Chats die Kuratierung — empfohlene Einträge zuerst, eingeschränkte Einträge ausschließlich. Ein Chat, der mit einem inzwischen unzulässigen Agenten ins Projekt verschoben wird, bricht nicht stumm: Das Senden wird mit dem Hinweis abgewiesen, dass der Agent in diesem Projekt nicht verfügbar ist, und das Mitglied wählt einen erlaubten. Außerhalb des Projekts ändert sich nichts; die Kuratierung gilt nur für Chats, die im Kontext des Projekts laufen.

## Wer es ändern darf

Das Bearbeiten des Tabs folgt den Org-Rollen: Zum Speichern braucht es eine Redakteurs- oder Admin-Rolle, und Mitglieder ohne sie sehen das Projekt schreibgeschützt, mit einem Banner, das auf einen Projekt-Redakteur verweist. Änderungen landen über **Speichern** in der Tab-Leiste — derselbe vereinheitlichte Speichern/Verwerfen-Block, den auch die Tabs Allgemein und Anweisungen nutzen.

## Wann du zu welchem Modus greifst

| Nimm … wenn                                                 | Empfohlen | Eingeschränkt |
| ----------------------------------------------------------- | --------- | ------------- |
| Der richtige Agent soll die offensichtliche erste Wahl sein | ✓         |               |
| Mitglieder sollen Zugriff auf den vollen Katalog behalten   | ✓         |               |
| Compliance oder Kosten verlangen eine feste, kurze Liste    |           | ✓             |
| Ein teures Modell darf für diese Arbeit nicht laufen        |           | ✓             |

## Wo das hingehört

Dieser Tab ist die Projekt-Seite der Kuratierung eines Org-Katalogs: Agenten zu bauen — samt Anweisungen und Wissen — ist Aufgabe des Bereichs [Agenten](/de/platform/agents/concepts); zu entscheiden, welche davon dieses Projekt zeigt, ist deine. Wie sich der Picker im Chat verhält, steht in [Agenten im Chat](/de/platform/chat/agents-in-chat).
