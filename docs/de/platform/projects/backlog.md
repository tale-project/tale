---
title: Projekt-Backlog
description: Backlog ist ein Board-Status für vorgeschlagene Arbeit — Automatisierungen synchronisieren Issues hierher, und du bewegst Aufgaben mit denselben Drag-, Status- und Zuweisungs-Steuerelementen wie in jeder anderen Spalte.
---

Eine Aufgabe im Status **`backlog`** ist vorgeschlagene Arbeit, für die sich noch niemand verpflichtet hat — meist eingespeist von einer Automatisierung wie [GitHub-Issues sichten](/de/platform/automations/builtin). Sie liegt in der **linken Spalte** auf dem Board und im **obersten Abschnitt** in der Liste, mit derselben Karte, demselben Detail-Sheet, demselben Status-Picker und demselben Zuweisungs-Picker wie jeder andere Status. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) behandelt, was passiert, sobald eine Aufgabe **Zu erledigen** erreicht und in die Zuweisungs-Schleife eintritt.

## Eine synchronisierte Aufgabe

GitHub-Issues sichten schlägt eine Aufgabe pro umsetzbarem offenem Issue vor, verankert am Issue, sodass ein späterer Abgleich sie nie doppelt anlegt: Der Titel lautet `#<Nummer> <Titel>` — zum Beispiel `#482 Login-Button auf Safari verschoben` —, die Beschreibung beginnt mit der eigenen GitHub-URL des Issues, und ihre Labels spiegeln die GitHub-Labels des Issues. Eine Aufgabe, die du vom Board aus mit dem Standardstatus anlegst, startet bei **Zu erledigen**; wähle **Backlog** im Erstellungsformular, wenn du selbst einen Vorschlag ablegen willst.

## Arbeit weiterbewegen

Es gibt keine Backlog-spezifischen Buttons. Ziehe eine Karte in eine andere Spalte, öffne das Detail-Sheet und wähle einen neuen Status, oder weise einen Owner zu — dieselben Wege wie bei **Zu erledigen** oder **In Bearbeitung**. Auto-Zuweisung und Zuweisungs-Vorschläge von Agenten laufen nur bei **Zu erledigen**, nicht solange die Aufgabe im **Backlog** liegt. Wenn du einen Vorschlag direkt nach **In Bearbeitung** schiebst oder von Hand zuweist, übernimmst du die Verantwortung selbst.

Lehne einen Vorschlag ab wie jede andere Aufgabe: Setze den Status im Picker auf **Abgebrochen**. Eine menschliche Stornierung bleibt bestehen — ein späterer GitHub-Abgleich holt einen abgelehnten Vorschlag nicht zurück, solange das Issue auf GitHub offen bleibt. War eine Aufgabe auf dem Board **Erledigt** und jemand öffnet das Issue auf GitHub wieder, setzt der Abgleich die Aufgabe zurück ins **Backlog**.

## Wo das hineinpasst

Backlog ist die Eingangsspalte zwischen einer Automatisierung, die Arbeit vorschlägt, und deinem Team, das sich dazu verpflichtet. Die natürliche nächste Lektüre ist [Aufgaben-Automatisierung](/de/platform/projects/task-automation) für das, was bei **Zu erledigen** passiert, oder [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) dafür, was überhaupt Aufgaben vorschlägt.
