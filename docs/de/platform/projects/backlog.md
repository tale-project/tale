---
title: Projekt-Backlog
description: Der Tab Backlog sammelt Aufgaben, die eine Automatisierung oder ein Teammitglied vorgeschlagen hat, aber noch niemand gesichtet hat — Starten schiebt eine aufs Board, Schließen verwirft sie, und keine der beiden Aktionen rührt die Automatisierungen an, die sie eingespeist haben.
---

Der Tab **Backlog** eines Projekts sammelt jede Aufgabe im Status `backlog` — vorgeschlagene Arbeit, die noch niemand gesichtet hat, meistens eingespeist von einer Automatisierung wie [GitHub-Issues sichten](/de/platform/automations/builtin). Diese Seite behandelt den Tab selbst: wie eine Backlog-Aufgabe aussieht, die beiden Sichtungs-Aktionen, und wie er sich von den Ansichten Board und Liste unterscheidet. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) behandelt, was passiert, sobald eine Aufgabe das Backlog verlässt und in die Zuweisungs-Schleife eintritt.

## Eine synchronisierte Aufgabe

GitHub-Issues sichten schlägt eine Aufgabe pro umsetzbarem offenem Issue vor, verankert am Issue, sodass ein späterer Abgleich sie nie doppelt anlegt: Der Titel lautet `#<Nummer> <Titel>` — zum Beispiel `#482 Login-Button auf Safari verschoben` —, die Beschreibung beginnt mit der eigenen GitHub-URL des Issues, und ihre Labels spiegeln die GitHub-Labels des Issues. Eine Aufgabe, die du selbst anlegst, landet nie hier — das Backlog füllt sich nur aus Automatisierungen und den Teammitgliedern, die ausdrücklich Arbeit dafür vorschlagen; eine Aufgabe, die du vom Board aus hinzufügst, startet auf dem Board.

## Starten und Schließen

Jede Backlog-Zeile trägt zwei Aktionen. **Starten** schiebt die Aufgabe nach **Zu erledigen** und aufs Board — von dort durchläuft sie dasselbe [Task-Ops-Paket](/de/platform/projects/task-automation) wie jede andere Aufgabe, samt der _Triage für Unzugewiesenes_, die einen Agenten für sie auswählt, falls niemand sie von Hand beansprucht. **Schließen** schiebt die Aufgabe direkt nach **Abgebrochen**, ohne je das Board zu berühren — die richtige Wahl für eine vorgeschlagene Aufgabe, die sich nicht lohnt. Ein Klick auf die Zeile öffnet dasselbe Aufgaben-Detail wie Board und Liste; Starten und Schließen sind auch von dort aus erreichbar.

## Board und Liste blenden das Backlog aus

Board und Liste zeigen nie eine Aufgabe im Status `backlog` — genau darum geht es beim Tab: ungesichtete Vorschläge aus den Ansichten herauszuhalten, mit denen dein Team tagtäglich arbeitet. Eine Aufgabe erscheint erst auf dem Board, sobald sie gestartet wurde, sodass ein volles Backlog das Board nie überfüllt.

## Wo das hineinpasst

Das Backlog ist der Sichtungsschritt zwischen einer Automatisierung, die Arbeit vorschlägt, und einem Menschen, der sich dazu verpflichtet: Starten übergibt eine Aufgabe in dieselbe Ausführungsschleife, die jede andere Aufgabe nutzt, Schließen verwirft, was sich nicht lohnt. Die natürliche nächste Lektüre ist [Aufgaben-Automatisierung](/de/platform/projects/task-automation) dafür, was Starten eigentlich anstößt, oder [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) dafür, was überhaupt Aufgaben vorschlägt.
