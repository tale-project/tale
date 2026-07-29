---
title: Agent-Worker
description: Ein Agent kann über das spawn_agent-Tool einen fokussierten Worker für eine Aufgabe starten. Diese Seite gibt dir das Denkmodell — wann sich ein Worker lohnt, wie Fähigkeiten begrenzt bleiben und was die Job-Karte zeigt.
---

Einen Worker startest du, wenn eine Aufgabe ihren eigenen fokussierten Kontext verdient: offene Recherche, Massen-Extraktion, ein langer Entwurf. Der Agent, mit dem du chattest, stellt bei Bedarf einen **Worker** zusammen — Name, Aufgabenanweisungen, optional eine Arbeitsmethode und eine Tool-Auswahl — lässt ihn laufen und faltet das Ergebnis in seine Antwort zurück. Worker sind flüchtig: Sie existieren für genau einen Job, und ihr Lauf erscheint als **Job-Karte** im Chat.

Diese Seite gibt dir das Denkmodell, wann ein Worker die richtige Form ist und wie die Plattform ihn begrenzt hält. Der End-to-End-Durchlauf steht in [Arbeit an einen Worker geben](/tutorials/editor/delegate-between-agents).

## Wie ein Job läuft

Ruft der Agent **spawn_agent** auf, löst Tale die Fähigkeiten des Workers auf, startet eine frische Kind-Konversation und lässt den Worker nicht-interaktiv laufen: Er sieht nur die Aufgabe, die der Agent geschickt hat (nicht den ganzen Chat-Verlauf), verfolgt seinen Fortschritt auf einer live sichtbaren Checkliste, und seine letzte Nachricht geht als Ergebnis an den Agenten zurück. Der Chat zeigt eine Job-Karte mit Name, Live-Fortschritt, Endstatus und einem aufklappbaren Protokoll von allem, was der Worker getan hat.

Worker sprechen nie mit dir. Braucht ein Worker eine Eingabe, die nur ein Mensch geben kann, sagt er das in seinem Ergebnis, und der Agent fragt dich — Fragen kommen immer von dem Agenten, mit dem du tatsächlich sprichst.

## Fähigkeiten sind immer eine Teilmenge

Ein Worker kann höchstens halten, was der startende Agent selbst hält. Drei Ebenen bestimmen die wirksame Auswahl:

- **Org-Konfiguration** — die Tools, Skills und Connectors des Agenten, wie von deinen Admins konfiguriert. Pro Worker gibt es nichts zu pflegen.
- **Die Job-Auswahl** — der Agent wählt für diese Aufgabe die kleinste Menge aus seinen eigenen Fähigkeiten (weniger Tools = ein fokussierterer Worker).
- **Plattform-Ausnahmen** — einige Tools wandern nie mit, allen voran das Nutzer-Frage-Tool: Die Fragen eines Workers laufen über den Agenten, damit eine Antwort nie ins Leere führt. Worker können auch keine Worker starten. Eine Ausnahme läuft in die Gegenrichtung: Die Dateien des Threads (Uploads, erzeugte Ergebnisse) kann jeder Worker immer auflisten und lesen — Dateien schreiben oder Code ausführen bleibt eine ausdrückliche Auswahl.

Alles außerhalb dieser Grenzen wird still übersprungen und gemeldet — die Job-Karte zeigt, was weggeschnitten wurde, und der Agent passt sich an (sagt dir zum Beispiel, dass eine Connector verbunden werden muss).

## Arbeitsmethoden

Für offene Aufgaben kann der Agent einen **Methodik-Skill** als Arbeitsmethode mitgeben — `web-research` ist eingebaut: Live-Planung auf der Checkliste, Suchbudgets pro Frage und ein zitiertes Ergebnis. Methodiken sind Skills; deine Admins steuern sie wie jeden anderen Skill.

## Grenzen und Verbrauch

Ein Worker läuft im Zug, der ihn gestartet hat, und kann ihn nicht überdauern; ist die Obergrenze erreicht, endet der Job, und sein Teilfortschritt bleibt auf der Karte sichtbar. Diese Grenze gehört dem Host, der den Zug ausführt, nicht dem Agenten, der keine eigene Frist trägt. Token-Verbrauch rollt zum startenden Agenten hoch, und Ausgabengrenzen greifen für die Organisation als Ganzes statt pro Agent, die Kosten eines Jobs landen also beim übrigen Verbrauch der Organisation. Admins begrenzen, wie viele Jobs gleichzeitig laufen dürfen, über **Governance → agent_jobs** (Standard 10).

## Wann du danach greifst

| Nimm … wenn                                              | Worker | Einzelner Agent | Workflow |
| -------------------------------------------------------- | ------ | --------------- | -------- |
| Eine Teilaufgabe von einem isolierten Kontext profitiert | ✓      |                 |          |
| Der Agent inline gut antworten kann                      |        | ✓               |          |
| Arbeit feste Stufen mit Freigaben dazwischen hat         |        |                 | ✓        |

Die Kosten eines Workers sind ein zusätzlicher Lauf; der Gewinn ist ein sauberer Kontext mit genau den richtigen Fähigkeiten für die Teilaufgabe — und eine Job-Karte, die zeigt, was passiert ist. Sind die Stufen fest und willst du Freigaben oder Zeitpläne dazwischen, ist ein Workflow die richtige Form.
