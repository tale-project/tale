---
title: Agents im Chat nutzen
description: Spezialisierte Agents im Composer wählen, um Wissen einzugrenzen, Tools zu beschränken und Konversationen über die richtige Stimme zu führen.
---

Ein Agent ist eine auf einen bestimmten Zweck zugeschnittene Version der KI — ein Support-Agent, der Kundenfragen aus dem Hilfe-Center-Ordner beantwortet, ein Vertriebs-Recherche-Agent mit Web-Zugriff, ein interner Research-Agent mit Nur-Lese-Rechten auf Entwicklungs-Dokumenten. Jeder Agent trägt seine eigenen Anweisungen, seinen eigenen Wissensumfang und seine eigenen Tool-Berechtigungen, und im Chat-Composer wählst du, welcher Agent eine Konversation bedient. Die Zielgruppe ist jeder im Produkt: Mitglieder greifen auf Agents zu, die das Team veröffentlicht hat, Redakteure und Entwickler bauen neue.

Diese Seite behandelt das Laufzeitverhalten von Agents im Chat — den aktiven Agent wechseln, Gesprächseinstiege nutzen, Delegation beim Themenwechsel beobachten. Das mentale Modell, _was_ ein Agent ist, liegt unter [Agent-Konzepte](/de/platform/agents/concepts); den Bau zeigt [Agent erstellen](/de/platform/agents/create).

## Aktiven Agent wechseln

Um eine Konversation an einen bestimmten Agent zu leiten, öffne den Agent-Selector (das Bot-Icon unten links im Composer), scrolle zum Agent und klicke ihn an. Die nächste Nachricht geht an die Anweisungen, das Wissen und die Tools des neuen Agents; die Titelzeile der Konversation zeigt den aktiven Agent. Mitten in der Konversation zu wechseln ist erlaubt — der neue Agent liest das bisherige Transkript, bevor er antwortet, der Kontext geht also nicht verloren.

Jede Konversation merkt sich den gewählten Agent. Ein neuer Chat setzt den Selector auf den Standard-Assistenten zurück, der mit Tale ausgeliefert wird.

## Gesprächseinstiege

Wenn der aktive Agent **Starter** konfiguriert hat, erscheint bei einer frischen Konversation eine Reihe klickbarer Vorschläge. Klicke einen an, um ihn als erste Nachricht zu senden — das ist schneller als Tippen und zeigt sofort, wofür der Agent gebaut wurde. Starter konfigurierst du pro Agent unter **Agents > [Agent] > Starter**; ein Agent ohne Starter zeigt einen leeren Composer.

## Warum Agents wechseln

Drei Gründe, zu einem nicht standardmäßigen Agent zu greifen. Ein engerer Wissensumfang liefert schärfere Antworten — ein Support-Agent, der nur den Hilfe-Center-Ordner durchsucht, lässt sich nicht von internen Entwicklungs-Dokumenten ablenken. Eine schlankere Tool-Liste hält Erkundungsfragen sicher — ein Nur-Lese-Research-Agent mit allen Schreib-Operationen aus kann nicht versehentlich ein Ticket aktualisieren. Eine andere Stimme verändert die Antwortform — Agents lassen sich mit unterschiedlichen Tönen, Ausgabeformaten (Markdown, JSON, reine Prosa) und Strenge konfigurieren.

Der grösste Qualitäts-Hebel sind die Anweisungen des Agents. Die meisten „Die KI macht ständig X"-Klagen führen auf einen fehlenden oder falschen Satz im System-Prompt zurück, nicht auf das falsche Modell.

## Delegation

Manche Agents sind so konfiguriert, dass sie bei Themenwechsel an Spezialisten **delegieren**. Erhält ein allgemeiner Support-Agent eine Abrechnungsfrage und hat einen Abrechnungs-Spezialisten als Delegationsziel registriert, übergibt er die Konversation automatisch. Die Übergabe erscheint im Transkript als kurze Notiz mit dem Namen des neuen Agents, und Antworten ab diesem Punkt kommen aus den Anweisungen des Delegaten.

Delegation ist pro Agent opt-in. Um sie zu aktivieren, öffne den **Delegation**-Tab des Agents und wähle, an welche Agents er übergeben darf, mit dem Thema oder der Bedingung, die die Übergabe auslöst. Die Konfigurationsoberfläche ist unter [Agent erstellen](/de/platform/agents/create) dokumentiert.

## Wo das einsetzt

Der Agent-Picker ist, wie der richtige Spezialist jede Frage beantwortet — statt einen generischen Assistenten jedes Thema abdecken zu lassen, wählst du den Agent, der für das Thema gebaut wurde. Die Mitglied-Rolle nutzt, was das Team veröffentlicht hat; Redakteur oder höher ist nötig, um einen neuen Agent zu bauen.

Um einen Spezialisten zu bauen, starte mit [Agent-Konzepte](/de/platform/agents/concepts) für das Vier-Knöpfe-Modell und arbeite dann [Agent erstellen](/de/platform/agents/create) Schritt für Schritt durch.
