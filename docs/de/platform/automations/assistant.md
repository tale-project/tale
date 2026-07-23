---
title: Automatisierungs-Assistent
description: Der Chat-Agent, der auf eine Automatisierung fixiert ist — was er direkt editiert, was er für dich entwirft, und wie er bestehende Automatisierungen findet, bevor er eine neue baut.
---

Der **Automatisierungs-Assistent** ist der Chat-Agent, der auf eine einzelne Automatisierung ausgerichtet ist und mit deren Dokument, ihren Agents, ihren Skills und ihren Integrationen bereits im Kontext antwortet. Admins und Entwickler nutzen ihn, um eine Automatisierung zu verstehen, die sie nicht gebaut haben, eine bestehende zu erweitern statt sie zu duplizieren, oder Hilfe beim Verfassen der Bestandteile zu bekommen, die die eigene Seite der Automatisierung nicht editiert. Frag ihn, was etwas tut, bevor du von Hand daran rührst — er liest das ganze Dokument auf einmal statt eine Node nach der anderen.

## Was er direkt editiert

Das Dokument der Automatisierung ist der eine Bestandteil, auf den der Assistent vollen Werkzeugzugriff hat: Er liest die aktuelle Version, editiert Nodes, validiert das Ergebnis, speichert eine neue Version und lässt sie gegen Mocks laufen — dieselben Schritte, die du von Hand ausführen würdest, in derselben Reihenfolge. Er arbeitet unter denselben Regeln wie du: Ein Speichern hängt eine Version an, statt eine zu überschreiben, und die live geschaltete Version bleibt live, bis jemand live schaltet. Bei Agents ist er einen Schritt zurück: Er liest die Liste und kann einen installieren, aktivieren oder deaktivieren, aber Instructions, Modell und der Rest der Konfiguration eines Agents bleiben deine eigene Aufgabe im Agent-Editor — der Assistent entwirft das genaue JSON, und du fügst es dort ein.

## Was er stattdessen entwirft

Für Skills, Integrationen und mitgelieferte Ansichten gibt es überhaupt kein Editier-Werkzeug: Der Assistent schreibt die Definition im richtigen Format und sagt dir genau, wo du sie anwendest — Einstellungen > Integrationen für eine Anmeldung, die eigene Seite der Automatisierung für eine Ansicht. Installation und Einrichtung laufen genauso: Er geht die Einrichtungs-Checkliste mit dir durch und benennt, was noch verbunden und was noch aktiviert werden muss, statt selbst zu verbinden.

Dieselbe Grenze gilt für Trigger. Der Assistent kann dir sagen, welchen Zeitplan, welchen Webhook, welches Ereignis oder welchen API-Key-Trigger eine Automatisierung trägt und was jeder davon in einen Lauf schicken würde, und er kann dir den gewünschten Trigger genau ausformulieren — aber die Entscheidung, eine Automatisierung nach außen freizugeben, bleibt eine menschliche. [Workflow-Trigger](/de/platform/automations/triggers) behandelt, was jede Art tut.

## Finden, was schon existiert

Bevor er irgendetwas baut, sucht der Assistent nach einer Automatisierung oder einem Bundle, das er erweitern statt duplizieren kann — dieselbe Regel „Erst wiederverwenden, dann bauen", die auch beim Verfassen neuer Skills oder Integrationen gilt. Seine Suche reicht bis zu Automatisierungen, die der Katalog selbst versteckt: Die versteckten Mitglieder eines Bundles (siehe [Automatisierungskonzepte](/de/platform/automations/concepts)) bleiben für den Assistenten sichtbar, sodass er dich zum Beispiel auf den PR-Creator-Agent verweisen kann, der in GitHub-Issues lösen vergraben ist, statt einen neuen vorzuschlagen.

## Wo das hineinpasst

Der Automatisierungs-Assistent ist der schnellste Weg in eine Automatisierung, die du nicht selbst gebaut hast — frag ihn, was etwas tut, bevor du von Hand daran rührst. [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Vokabular, das er voraussetzt; [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) ist der Ort, an dem du umsetzt, was er dir sagt, falls die Automatisierung noch nicht installiert ist.
