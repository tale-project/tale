---
title: Gesprächseinstiege
description: Autorenarbeit für Beispielprompts, die ein Agent auf seinem leeren Chat-Bildschirm zeigt — hinzufügen, übersetzen und die Auto-Übersetzungs-Option.
---

Ein **Starter** ist ein kurzer Beispielprompt, den der Agent auf einem leeren Chat-Bildschirm zeigt. Tipp einen an, und der Text fällt in den Composer; der User bearbeitet ihn bei Bedarf und sendet dann. Starters sind die kuratierten Einstiegspunkte des Agent-Autors in das, wofür der Agent gut ist.

Diese Seite ist die Autorenseite. Die Userseite — wie Starters in einem frischen Chat rendern — liegt auf [Einstiege und Prompts](/de/platform/chat/starters-and-prompts).

## Einen Starter hinzufügen

Öffne den Agent und wechsle zum **Starters**-Tab. **Add starter** öffnet einen Editor mit zwei Feldern: dem Starter-Titel (was der User als Kachel auf dem leeren Chat sieht) und dem Body (was in den Composer fällt, wenn der User die Kachel antippt). Speichern, und der Starter erscheint in jedem frischen Chat, der mit diesem Agent gewählt wurde.

## Defaults und Übersetzungen

Jeder Starter hat eine **default**-Version (der EN-Body) und eine optionale übersetzte Version pro Locale. Das Default ist das, was angezeigt wird, wenn für die Locale des Users keine Übersetzung existiert. Unübersetzte Starters werden in der Autorenansicht mit **untranslated** markiert; User in diesen Locales sehen das Default.

## Auto-Übersetzung

Der Starters-Tab zeigt eine **Auto-translate**-Aktion, die den Übersetzungs-Provider der Org aufruft, um fehlende Locales zu füllen. Die Übersetzungen werden als bearbeitbare Strings gespeichert — der Autor kann sie danach anpassen. Auto-Übersetzung respektiert die Übersetzungs-Provider-Konfiguration der Org; unkonfigurierte Provider scheitern mit einem Toast.

## Wo das hineinpasst

Gesprächseinstiege sind die kleinste Oberfläche im Agent-Bereich — ein paar Sätze pro Stück, aber sie entscheiden, ob der leere Chat-Bildschirm einladend oder leer aussieht. Die Seite, die du damit paaren solltest, ist [Einstiege und Prompts](/de/platform/chat/starters-and-prompts), die zeigt, wie sie für den User rendern; der Rest des Agent-Verhaltens lebt in [Agent-Konzepte](/de/platform/agents/concepts).
