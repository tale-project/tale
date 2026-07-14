---
title: Agenten-Ordner
description: Wie Agenten gruppiert werden — Ordner aus der Id des Agents, wie mit einer Automatisierung installierte Agenten sich einsortieren und wo die Berechtigungsgrenze wirklich liegt.
---

Agenten sind nach Ordnern gruppiert, und ein Ordner entsteht aus der Id des Agents: ein Agent mit der Id `review-github-pr/pr-reviewer` liegt überall dort, wo Agenten gelistet werden, in einem `review-github-pr`-Ordner. Ordner sind ein organisatorisches Sortierwerkzeug, keine Berechtigungsgrenze — wer einen Agent nutzen darf, regelt der Abschnitt **Zugriff** auf seiner Seite **Allgemein**, unabhängig davon, wo er einsortiert ist.

<Frame caption="Die Agentenliste mit ausgeklapptem chat-Ordner — der Ordner ist das Präfix des Slugs, die Zeilen sind seine Agenten.">

![Die Agentenliste mit den Agenten des chat-Ordners — Assistant und Automation Assistant —, jeweils mit Typ-Badge, Standardmodell und Tool-Anzahl.](/images/platform/agents-list-expanded.webp)

</Frame>

## Einen Agent in einen Ordner legen

Ids mit Ordner kommen von der Plattform, nicht aus dem Erstell-Dialog. Das Feld **Name** im Dialog nimmt eine flache Id — Kleinbuchstaben, Ziffern, Bindestriche und Unterstriche, kein `/` —, sodass ein dort erstellter Agent unabgelegt auf der obersten Ebene landet. Das Ordner-Präfix (`chat/`, `review-github-pr/`) ist Agenten vorbehalten, die die Plattform mitliefert oder installiert: Builtins kommen vorab einsortiert an, und die Installation einer [Automatisierung](/de/platform/automations/concepts) legt ihre Agenten in den Ordner, den ihre Id benennt. Eine Id kann sich später nicht ändern, der Ordner steht also mit dem Erstellen fest. Der Anzeigename ist unabhängig; benenn den Agent frei um, ohne ihn zu verschieben.

In der **Agenten**-Liste erscheinen Ordner als eingeklappte Zeilen mit Agentenzahl — klicke einen an, um ihn auszuklappen, und die Breadcrumb-Leiste zeigt, wo du bist. Die eingebauten Agenten kommen voreinsortiert an: die allgemeinen Assistenten unter `chat`; mit einer Automation installierte Agenten liegen im Ordner ihrer Automation.

## Agenten, die mit einer Automatisierung ankommen

Die Installation einer [Automatisierung](/de/platform/automations/concepts) sortiert ihre Agenten ein wie alle anderen — der PR Creator und der PR Reviewer aus dem Bundle „GitHub-Issues lösen“ landen in derselben Liste, in dem Ordner, den ihre Id benennt. Einen eigenen Agenten-Store zum Stöbern gibt es nicht: Aus dem [Katalog der Automatisierungen](/de/platform/automations/catalog) kommen gebündelte Agenten, und in der Liste wohnen sie danach.

<Note>

Die Agentenauswahl im Chat gruppiert nicht nach Ordnern — sie ist eine durchsuchbare Liste mit **Auto** obenauf, die jeden Agent zeigt, der aktiviert und im Chat sichtbar ist; Coding-Agenten stehen in einem eigenen Abschnitt **Coding-Agenten**.

</Note>

## Wann du danach greifst

| Nutze Ordner, wenn…                            | Nutze Team-Zugriff, wenn…                            |
| ---------------------------------------------- | ---------------------------------------------------- |
| Die Agentenliste lang wird und Ordnung braucht | Ein Agent nur für ein Team nutzbar sein darf         |
| Abteilungen je einen Satz Agenten besitzen     | Du eine Berechtigungsgrenze ziehst, kein Verzeichnis |

## Wo das hingehört

Ordner sind die leichteste verfügbare Gruppierung für Agenten — sie sortieren die Liste und den Katalog, mehr nicht. Größere Trennungen liegen woanders: [Projekt-Agenten](/de/platform/projects/project-agents) begrenzen einen Agent auf ein Projekt, und [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) regeln, was ein Agent ausgeben oder tun darf.
