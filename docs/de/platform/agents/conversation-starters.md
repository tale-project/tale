---
title: Gesprächseinstiege
description: Die vorgeschlagenen Prompts pflegen, die ein Agent auf dem leeren Chat-Bildschirm zeigt — hinzufügen, ordnen, übersetzen und die Aktion Automatisch übersetzen.
---

Ein Einstieg ist ein kurzer vorgeschlagener Prompt, den der Agent auf einem leeren Chat-Bildschirm zeigt. Tipp einen an, und der Text fällt in den Composer; der User passt ihn bei Bedarf an und schickt ihn ab. Einstiege sind die kuratierten Einstiegspunkte des Agent-Autors in das, wofür der Agent da ist — diese Seite ist die Autorenseite; wie sie beim User erscheinen, zeigt [Einstiege und Prompts](/de/platform/chat/starters-and-prompts).

<Frame caption="Der Tab Gesprächseinstiege — eine geordnete Liste von Prompts mit Sprach-Tabs darüber.">

![Der Tab Gesprächseinstiege des Agenten-Editors mit vier englischen Gesprächseinstiegen samt Zieh-Griffen, Umsortier-Pfeilen und Entfernen-Buttons.](/images/platform/agent-editor-starters.webp)

</Frame>

## Einstiege hinzufügen und ordnen

Öffne den Agent und wechsle zum Tab **Gesprächseinstiege**. Jeder Einstieg ist ein Prompt mit bis zu 200 Zeichen; **Einstieg hinzufügen** hängt eine Zeile an, bis zu vier pro Agent — lass die Liste leer, um keine Vorschläge zu zeigen. Die Reihenfolge zählt, weil sie die Reihenfolge ist, die User sehen: zieh eine Zeile am Griff oder nutze die Pfeile, und entferne eine über das × in ihrer Zeile. Klicke auf **Speichern** — Einstiege reisen mit der Konfiguration des Agents wie jede andere Einstellung.

Schreib Einstiege so, wie ein User wirklich fragen würde: konkret, in der ersten Person, innerhalb der Domäne des Agents. Vier vage Prompts lesen sich schlechter als zwei scharfe.

## Übersetzen

Jeder Einstieg hat eine Standardversion (der Tab mit der Markierung **Standard**) und optional eine Übersetzung pro Sprache. Ein Sprach-Tab, dem seine Version noch fehlt, trägt die Markierung **Nicht übersetzt**, und User in dieser Sprache sehen den Standardtext. Wechsle auf einen Sprach-Tab, um Übersetzungen von Hand zu tippen — Übersetzungen überschreiben die bestehenden Zeilen; die Liste selbst (Anzahl und Reihenfolge) gehört der Standardsprache.

**Automatisch übersetzen** auf einem Sprach-Tab füllt die fehlenden Versionen in einem Schritt. Die Ergebnisse werden als gewöhnliche, bearbeitbare Strings gespeichert, also justiere danach, wo die Maschinen-Formulierung deine Stimme verfehlt; scheitert die Übersetzung, sagt es eine Meldung, und die Standardtexte bleiben stehen.

## Wo das hingehört

Gesprächseinstiege sind die kleinste Oberfläche im Agenten-Bereich — ein paar Sätze pro Stück, aber sie entscheiden, ob der leere Chat-Bildschirm einladend wirkt oder leer. Die Seite, die du daneben legst, ist [Einstiege und Prompts](/de/platform/chat/starters-and-prompts) — sie zeigt, wie sie beim User erscheinen; der Rest des Agent-Verhaltens liegt in [Agent-Konzepte](/de/platform/agents/concepts).
