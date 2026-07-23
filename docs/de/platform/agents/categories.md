---
title: Agenten-Ordner
description: Wie Agenten gruppiert werden — Ordner aus der Id des Agents, wie mit einer Automatisierung installierte Agenten sich einsortieren und wo die Berechtigungsgrenze wirklich liegt.
---

Agenten werden in Ordnern gruppiert, und ein Ordner ergibt sich aus der Id des Agenten: Ein Agent mit der Id `github/review-pull-requests/pr-reviewer` liegt überall dort, wo Agenten aufgelistet werden, im Ordner `github/review-pull-requests`. Ordner sortieren eine lange Liste; eine Berechtigungsgrenze ziehen sie nicht. Wer an einen Agenten herankommt, entscheidet seine **Sichtbarkeit** auf dem Tab **Allgemein**, und daran ändert der Ablageort nichts.

## Einen Agenten in einen Ordner einsortieren

Ordner-Ids kommen von der Plattform, nicht aus dem Anlege-Dialog. Das Feld **Name** dort nimmt eine flache Id entgegen — Kleinbuchstaben, Ziffern, Binde- und Unterstriche, kein `/` —, ein selbst angelegter Agent landet also unsortiert auf oberster Ebene. Das Ordner-Präfix (`chat/`, `github/review-pull-requests/`) ist Agenten vorbehalten, die die Plattform mitbringt oder installiert: Mitgelieferte kommen vorsortiert an, und eine installierte [Automatisierung](/de/platform/automations/concepts) legt ihre Agenten in den Ordner, den deren Id nennt. Eine Id lässt sich später nicht ändern, der Ordner steht also mit dem Anlegen fest. Der Anzeigename ist davon unabhängig — benenne den Agenten um, so oft du willst, ohne ihn zu verschieben.

In der Liste **Agenten** erscheinen Ordner als eingeklappte Zeilen mit einer Anzahl. Klick eine an, um sie aufzuklappen; die Brotkrumen zeigen, wo du gerade bist. Die mitgelieferten Agenten kommen vorsortiert, die allgemeinen Assistenten unter `chat`.

## Agenten, die mit einer Automatisierung kommen

Eine installierte [Automatisierung](/de/platform/automations/concepts) legt ihre Agenten ab wie alle anderen — PR Creator und PR Reviewer aus dem Bundle „GitHub-Issues lösen" landen in derselben Liste, im Ordner, den ihre Id nennt. Einen getrennten Agenten-Store zum Stöbern gibt es nicht: Aus dem [Automatisierungs-Katalog](/de/platform/automations/catalog) kommen gebündelte Agenten, und in der Liste wohnen sie danach.

<Note>

Der Composer gruppiert nicht nach Ordnern. Seine Auswahl ist eine durchsuchbare Liste mit zwei Abschnitten — **Models** für einen gewöhnlichen Zug und **Sandbox agents** für einen, der in einem Coding-Agent-Harness läuft — und nichts wird an deiner Stelle gewählt.

</Note>

## Wann du dazu greifst

| Nimm Ordner, wenn …                            | Nimm die Sichtbarkeit, wenn …                                      |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Die Agentenliste lang wird und Ordnung braucht | Ein Agent nur für die Person erreichbar bleiben soll, die ihn baut |
| Abteilungen jeweils eigene Agenten besitzen    | Du eine Berechtigungsgrenze ziehst und kein Verzeichnis            |

## Wo das hingehört

Ordner sind die leichteste Gruppierung, die es für Agenten gibt — sie sortieren Liste und Katalog, und mehr tun sie nicht. Größere Trennungen liegen anderswo: [Projekt-Agenten](/de/platform/projects/project-agents) binden einen Agenten an ein Projekt, und [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) regeln, was ein Agent ausgeben oder tun darf.
