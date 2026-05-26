---
title: Projekt-Agents
description: Projektgebundene Agents gegenüber Org-Agents — wann du nach welchem greifst, wie Projekt-Agents Org-Agents im Picker überschatten, und wie das Veröffentlichen innerhalb eines Projekts funktioniert.
---

Ein Projekt-Agent ist ein Agent, der nur innerhalb des Projekts existiert. Er erscheint im Agent-Picker des Chats für Projektmitglieder, sonst nirgends; er erbt automatisch die Files und Instructions des Projekts; das Projekt zu löschen löscht ihn. Greif zu Projekt-Agents, wenn ein Agent projektspezifische Instructions braucht, die ein generischer Org-Agent nicht tragen sollte.

Diese Seite deckt den Unterschied zwischen Projekt-Agents und Org-Agents ab, die Schattenregel, die entscheidet, welcher erscheint, wenn beide einen Namen teilen, und wie sich das Veröffentlichen zwischen den beiden Bereichen ändert.

## Projekt-Agents gegenüber Org-Agents

Ein **Org-Agent** lebt in der [Agents](/de/platform/admin/agents)-Liste der Org und taucht in jedem Chat auf, auf den der User Zugriff hat. Ein **Projekt-Agent** lebt nur im Projekt; ausserhalb existiert er nicht. Die Formen sind gleich — dieselben Instructions, Wissen, Tools, Modell — nur die Sichtbarkeit unterscheidet sich.

## Die Schattenregel

Projekt-Agents und Org-Agents können denselben Namen teilen. Wenn sie das tun, **gewinnt der Projekt-Agent im Projekt** — er überschattet den Org-Agent im Picker. Ausserhalb des Projekts erscheint der Org-Agent. Das erlaubt einem Team, einen org-weiten Agent („Sales assistant") zu nehmen und ihn für ein bestimmtes Konto mit zusätzlichen Instructions zu überschreiben, ohne ihn umzubenennen.

## In ein Projekt veröffentlichen

Einen Agent aus dem Projekt heraus zu erstellen produziert automatisch einen Projekt-Agent. Einen aus der Org-**Agents**-Liste zu erstellen produziert einen Org-Agent, in den jedes Projekt einbuchen kann. Um einen Org-Agent in ein Projekt zu bringen, dupliziere ihn in den Agents-Tab des Projekts — das Original bleibt org-weit; das Duplikat wird ein Projekt-Agent, den das Team bearbeiten kann, ohne die org-weite Kopie zu beeinflussen.

## Berechtigungen

Projekt-Agents folgen der Projektmitgliedschaft. Projektmitglieder können sie ausführen; Projekt-Editors können sie bearbeiten; der Projektbesitzer kann sie löschen. Org-weite Editor- und Entwickler-Rollen haben nicht automatisch Zugriff auf die Agents eines Projekts — Projektmitgliedschaft ist der einzige Weg hinein.

## Wann du nach welchem greifst

| Nutz … wenn                                                      | Projekt-Agent | Org-Agent |
| ---------------------------------------------------------------- | ------------- | --------- |
| Instructions sind spezifisch für die Daten dieses Projekts       | ✓             |           |
| Derselbe Prompt wäre für jedes Team nützlich                     |               | ✓         |
| Du brauchst eine einmalige Variante eines bestehenden Org-Agents | ✓             |           |
| Du willst einen Agent über viele Projekte teilen                 |               | ✓         |

## Wo das hineinpasst

Projekt-Agents sind die Antwort auf „wir lieben diesen Agent, aber er muss sich für diesen Kunden anders verhalten". Der breitere Abschnitt [Agents](/de/platform/agents/concepts) ist org-weit; greif dorthin, wenn das Publikum alle sind. Die natürliche Anschlusslektüre ist [Projekte nutzen](/de/tutorials/member/use-projects), das ein Projekt zeigt, das mit einem Projekt-Agent endet, der echte Arbeit macht.
