---
title: Fähigkeiten
description: Eine Fähigkeit ist ein wiederverwendbares Bündel aus Anweisungen und einem optionalen Sandbox-Skript, das du an einen Agent hängen kannst. Diese Seite erklärt, wann du eine Fähigkeit statt Inline-Anweisungen wählst.
---

Eine Fähigkeit ist die Einheit, zu der Tale greift, wenn dasselbe Muster über mehrere Agents auftaucht. Sie ist ein wiederverwendbares Bündel — ein Stück Anweisungen und optional ein Sandbox-Skript, das der Agent aufrufen kann —, das du an einen Agent hängst, wie du ein Tool anhängst. Redakteure und Entwickler veröffentlichen Fähigkeiten auf Organisations-Ebene; Agents wählen aus der Fähigkeiten-Bibliothek der Organisation.

Diese Seite vermittelt dir das mentale Modell, wann eine Fähigkeit der richtige Zug ist und wann Inline-Anweisungen es sind. Lies sie, bevor du deine erste Fähigkeit veröffentlichst; komm zurück, wenn die Anweisungen eines Agents länger werden und du dich fragst, ob die Antwort darin liegt, sie in eine Fähigkeit zu trennen.

## Was eine Fähigkeit bündelt

Eine Fähigkeit trägt zwei Dinge:

- **Anweisungen** — Prosa, die ein spezifisches Verhalten rahmt. Die Anweisungen der Fähigkeit hängen sich zur Request-Zeit an die Anweisungen des Agents an; der Agent liest beide als einen langen Prompt.
- **Ein optionales Skript** — Code, der in der Sandbox läuft, wenn der Agent die Fähigkeit als Tool aufruft. Die Eingaben und Ausgaben des Skripts sind typisiert; der Agent gibt JSON weiter, die Fähigkeit gibt JSON zurück.

Eine reine Anweisungs-Fähigkeit ist die richtige Form, wenn das Verhalten Stimme oder Einschränkung ist — „Zitiere immer die Quelle nach Abschnittsnummer", „Verweigere Fragen ausserhalb dieses Produkts". Eine Fähigkeit mit Skript ist die richtige Form, wenn das Verhalten eine Berechnung, eine Transformation oder eine mehrstufige Aufgabe ist, die das Modell sonst in Tokens nachahmen müsste.

## An einen Agent hängen

Eine Fähigkeit wird durch Anhängen für einen Agent sichtbar. Der Editor des Agents listet die verfügbaren Fähigkeiten der Organisation unter dem Tab **Fähigkeiten**; häk die an, die gelten. Angehängte Fähigkeiten injizieren immer ihre Anweisungen; eine Fähigkeit mit Skript erscheint zusätzlich in der Tool-Liste des Agents, die der Agent aufrufen kann.

Das Anhängen geschieht pro Agent: zwei Agents können dieselbe Fähigkeit anhängen, und das Verhalten des Agents ist die Vereinigung seiner Anweisungen und der Anweisungen der Fähigkeit. Das Entfernen ist symmetrisch — der nächste Request läuft ohne die Fähigkeit.

## Fähigkeits-Skripte und die Sandbox

Fähigkeits-Skripte laufen in derselben Sandbox wie das **Code-ausführen**-Tool: Python oder Node, erlaubte Pakete pro Fähigkeit deklariert, Netzwerk-Egress kontrolliert durch die [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy) der Organisation. Der Vertrag des Skripts ist eine typisierte Eingabe und eine typisierte Ausgabe; was dazwischen läuft, ist dir überlassen.

Die Vertrauensgrenze ist scharf. Ein Fähigkeits-Skript kann von jedem Agent aufgerufen werden, an den es angehängt ist. Behandle das Veröffentlichen einer Fähigkeit so, als würdest du die Vertrauensoberfläche jedes Agents weiten, der sie aufgreift; die [Governance-Richtlinie zu Run-Code](/de/platform/admin/governance/run-code-policy) regelt, welche Pakete und welche Netzwerkziele erlaubt sind.

## Versionierung

Fähigkeiten sind versioniert. Das Speichern einer Fähigkeit erzeugt eine neue Version; der Agent, der sie anhängt, fixiert auf eine bestimmte Version. Eine Fähigkeit zu aktualisieren propagiert nicht automatisch — Agents nehmen die neue Version beim Speichern auf. Das ist Absicht: eine Fähigkeit ist ein Vertrag, und die Version des Vertrags ist, wie du den Vertrag hältst.

## Wann du danach greifst

| Nutz … wenn                                                                  | Fähigkeit | Inline-Anweisungen |
| ---------------------------------------------------------------------------- | --------- | ------------------ |
| Das Muster wiederholt sich über mehrere Agents                               | ✓         |                    |
| Das Verhalten beinhaltet ein Skript, das das Modell sonst nachahmen müsste   | ✓         |                    |
| Das Verhalten ist die Stimme eines Agents                                    |           | ✓                  |
| Du willst, dass die Organisation das Verhalten über eine Bearbeitung steuert | ✓         |                    |
| Die Anweisungen des Agents passen noch auf einen Bildschirm                  |           | ✓                  |

Inline-Anweisungen sind die richtige Form für einen Agent. Fähigkeiten sind die richtige Form, wenn dasselbe Verhalten in zwei oder drei Agents auftaucht und die Wartungskosten, ihre Inline-Anweisungen synchron zu halten, anfangen zu beissen.

## Bau eine

Fähigkeiten sind die Abstraktionsebene über den vier Knöpfen — sie lassen dich ein Verhalten einmal ausliefern, sodass jeder Agent, der es braucht, es per Anhängen aufgreift. Der natürliche nächste Walkthrough ist [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) — er führt durch das Veröffentlichen einer Fähigkeit mit Skript von der leeren Seite bis zum Anhängen an einen Agent.
