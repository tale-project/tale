---
title: Automatisierungs-Assistent
description: Der Chat-Agent, der auf eine Automatisierung fixiert ist — was er direkt editiert, was er für dich entwirft, und wie er bestehende Automatisierungen findet, bevor er eine neue baut.
---

Der **Automatisierungs-Assistent** ist der Chat-Agent, der an die Automatisierung angeheftet ist, die du gerade geöffnet hast — klick auf **Assistent** auf der Seite einer Automatisierung, und er antwortet mit deren Agents, Workflow, Skills, Integrationen und Konfiguration bereits im Kontext. Admins und Entwickler nutzen ihn, um eine unbekannte Automatisierung zu verstehen, eine bestehende zu erweitern statt sie zu duplizieren, oder Hilfe beim Verfassen der Bestandteile zu bekommen, die die Automatisierungsseite nicht direkt editiert. Es ist derselbe Assistenten-Agent, den der [Workflow-Editor](/de/platform/automations/editor) einbettet, sodass sich eine dort begonnene Konversation auch von der anderen Oberfläche aus vertraut liest.

## Was er direkt editiert

Workflows sind der eine Bestandteil, auf den der Assistent vollen Werkzeugzugriff hat: Er liest die aktuelle Definition, editiert Schritte, speichert eine neue Version und führt sie aus — genau wie wenn du selbst durch den Editor geklickt hättest. Bei Agents ist er einen Schritt zurück: Er liest die Liste und kann einen installieren, aktivieren oder deaktivieren, aber Instructions, Modell und der Rest der Konfiguration eines Agents bleiben deine eigene Aufgabe im Agent-Editor; der Assistent entwirft das genaue JSON, und du fügst es dort ein.

## Was er stattdessen entwirft

Für Skills, Integrationen, mitgelieferte Ansichten und die Konfiguration einer Automatisierung gibt es überhaupt kein Editier-Werkzeug: Der Assistent schreibt die Definition im richtigen Format für Skills beziehungsweise Integrationen und sagt dir genau, wo du sie anwendest — Einstellungen > Integrationen für eine Anmeldung, die eigene Seite der Automatisierung für eine Ansicht oder ihre Konfiguration. Installation und Einrichtung laufen genauso: Er geht die Einrichtungs-Checkliste mit dir durch — verbinden, was nötig ist, Konfiguration ausfüllen, Agents und Workflow aktivieren —, statt selbst zu verbinden.

## Finden, was schon existiert

Bevor er irgendetwas baut, sucht der Assistent nach einer Automatisierung oder einem Bundle, das er erweitern statt duplizieren kann — dieselbe Regel „Erst wiederverwenden, dann bauen", die auch beim Verfassen neuer Skills oder Integrationen gilt. Seine Suche reicht bis zu Automatisierungen, die der Katalog selbst versteckt: Die versteckten Mitglieder eines Bundles (siehe [Automatisierungskonzepte](/de/platform/automations/concepts)) bleiben für den Assistenten sichtbar, sodass er dich zum Beispiel auf den PR-Creator-Agent verweisen kann, der in GitHub-Issues lösen vergraben ist, statt einen neuen vorzuschlagen.

## Wo das hineinpasst

Der Automatisierungs-Assistent ist der schnellste Weg in eine Automatisierung, die du nicht selbst gebaut hast — frag ihn, was etwas tut, bevor du von Hand daran rührst. [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Vokabular, das er voraussetzt; [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) ist der Ort, an dem du umsetzt, was er dir sagt, falls die Automatisierung noch nicht installiert ist.
