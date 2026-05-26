---
title: Arena-Modus
description: Modell-Vergleich nebeneinander im Chat — wie er rendert, wie du die Kontrahenten wählst, wie Bewertungen in die Feedback-Analyse einfliessen und wann du danach greifst.
---

Der Arena-Modus führt dasselbe Prompt parallel gegen zwei Modelle aus und fragt dich, welche Antwort besser ist. Die Bewertung fliesst in die Feedback-Analyse der Org; mit der Zeit zeigen die Daten, welches Modell das Team für welche Art von Frage tatsächlich bevorzugt — getrennt vom Bauchgefühl.

Greif zur Arena, wenn die Modellwahl eine Debatte statt einer Entscheidung war — Antworten nebeneinander zu vergleichen bricht die Patt mit Belegen statt mit Meinungen. Für gewöhnliche Arbeit reicht der reguläre Modell-Picker; der Wert der Arena sind die Bewertungen, die sie produziert, nicht die Vergleichsansicht selbst.

## Wie die Arena rendert

Schalt **Arena-Modus aktivieren** im Modell-Bereich des Composers ein, und die Textarea bekommt zwei Modell-Picker mit den Bezeichnungen **Modell A** und **Modell B**. Eine Nachricht zu senden führt beide Modelle parallel aus; der Bildschirm teilt sich, und jede Antwort streamt in ihre eigene Spalte. Sind beide fertig, erscheint unter den Spalten **Bewertung auswählen** mit vier Knöpfen: **A ist besser**, **B ist besser**, **Unentschieden**, **Beide schlecht**.

## Die Kontrahenten wählen

Die beiden Picker sind unabhängig — jedes chat-getaggte Modell, das die Policy des Agents erlaubt, ist auf jeder Seite zulässig. Dasselbe Modell auf beiden Seiten zu wählen ist erlaubt (nützlich, um Temperaturunterschiede zu testen, wenn der Agent das freigibt), aber die meisten Vergleiche spannen über Anbieter oder Grössen. Die Instructions, das Wissen und die Tools des Agents gelten für beide Spalten; nur das zugrunde liegende Modell unterscheidet sich.

## Eine Bewertung abgeben

Die Bewertung ist ein Einzelklick. **A ist besser** und **B ist besser** sind selbsterklärend; **Unentschieden** ist für ungefähr gleich gute Antworten; **Beide schlecht** ist für den Fall, dass keine akzeptabel ist. Der Knopf, den du klickst, speichert die Bewertung und löst den Chat auf die gewinnende Spalte hin auf — die nächste Nachricht, die du sendest, geht nur an dieses Modell. **Unentschieden** oder **Beide schlecht** zu wählen lässt beide Spalten für eine weitere Runde aktiv.

## Wo Bewertungen auftauchen

Bewertungen rollen unter **Arena verdicts** in die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) ein, neben einer **Top Model Matchups**-Tabelle, die Paarungen nach Gewinnrate sortiert. Die Daten sind org-gebunden, nicht pro User, also können die Bewertungen eines kleinen Teams die Defaults eines grossen Teams überwiegen, wenn ein Admin die Tabelle nutzt, um das Standardmodell der Org zu setzen.

## Wann du danach greifst

| Nutz … wenn                                                           | Arena-Modus | Regulärer Modell-Picker |
| --------------------------------------------------------------------- | ----------- | ----------------------- |
| Du entscheidest, auf welches Modell du standardmässig gehen sollst    | ✓           |                         |
| Du vermutest eine Modell-Regression nach einem Upgrade                | ✓           |                         |
| Du weisst schon, welches Modell du willst; du willst nur eine Antwort |             | ✓                       |
| Die Anfrage ist kurz und gewöhnlich                                   |             | ✓                       |

## Wo das hineinpasst

Die Arena ist die leichtgewichtige Rückkopplungsschleife auf der Modellwahl. Die schwerere Oberfläche ist die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) — dort werden deine Bewertungen zu einem Diagramm, mit dem jemand später über Defaults streitet. Wenn du derjenige bist, der die Tabelle später liest, dreh eine Handvoll Arena-Runden, bevor du sie liest; die selbst abgegebenen Bewertungen sagen dir, ob die Tabellen-Rahmung deine Erfahrung trifft.
