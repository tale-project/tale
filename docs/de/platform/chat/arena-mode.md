---
title: Arena-Modus
description: Modell-Vergleich nebeneinander im Chat — wie er rendert, wie du die Kontrahenten wählst, wie Bewertungen in die Feedback-Analyse einfließen und wann du danach greifst.
---

Der Arena-Modus führt dasselbe Prompt parallel gegen zwei Modelle aus und fragt dich, welche Antwort besser ist. Die Bewertung fließt in die Feedback-Analyse der Org; mit der Zeit zeigen die Daten, welches Modell das Team für welche Art von Frage tatsächlich bevorzugt — getrennt vom Bauchgefühl.

Greif zur Arena, wenn die Modellwahl eine Debatte statt einer Entscheidung war — Antworten nebeneinander zu vergleichen bricht das Patt mit Belegen statt mit Meinungen. Für gewöhnliche Arbeit reicht der reguläre Modell-Picker; der Wert der Arena sind die Bewertungen, die sie produziert, nicht die Vergleichsansicht selbst.

## Wie die Arena rendert

Öffne das Plus-Menü des Composers und wähl **Arena-Modus** — der Composer bekommt zwei Modell-Picker mit den Beschriftungen **Modell A** und **Modell B**. Eine Nachricht zu senden führt beide Modelle parallel aus; der Bildschirm teilt sich, und jede Antwort streamt in ihre eigene Spalte. Sind beide fertig, erscheint unter den Spalten eine Bewertungszeile mit vier Knöpfen: **A ist besser**, **B ist besser**, **Unentschieden**, **Beide schlecht**.

<Frame caption="Dasselbe Prompt, von zwei Modellen beantwortet, mit der Bewertungszeile darunter.">

![Der Arena-Modus zeigt dasselbe Prompt in zwei Spalten mit unterschiedlichen Modellen im Kopf und darunter vier Bewertungs-Knöpfe.](/images/platform/chat-arena-split.webp)

</Frame>

<Note>

Die Arena braucht einen konkreten Agent — wähl im Agent-Picker einen aus statt **Auto**, bevor du sie aktivierst.

</Note>

## Die Kontrahenten wählen

Die beiden Picker sind unabhängig — jedes chat-getaggte Modell, das die Policy des Agents erlaubt, ist auf jeder Seite zulässig. Dasselbe Modell auf beiden Seiten zu wählen ist erlaubt (nützlich, um Temperaturunterschiede zu testen, wenn der Agent das freigibt), aber die meisten Vergleiche spannen über Anbieter oder Größen. Die Instructions, das Wissen und die Tools des Agents gelten für beide Spalten; nur das zugrunde liegende Modell unterscheidet sich.

## Eine Bewertung abgeben

Die Bewertung ist ein einzelner Klick. **A ist besser** und **B ist besser** erklären sich selbst; **Unentschieden** ist für ungefähr gleich gute Antworten; **Beide schlecht** für den Fall, dass keine akzeptabel ist. Der Knopf, den du klickst, speichert die Bewertung und löst den Chat zur gewinnenden Spalte hin auf — die nächste Nachricht, die du sendest, geht nur an dieses Modell. **Unentschieden** oder **Beide schlecht** lässt beide Spalten für eine weitere Runde aktiv.

## Wo Bewertungen auftauchen

Bewertungen laufen unter **Arena-Urteile** in der [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) zusammen, neben einer Tabelle **Top Modell-Duelle**, die Paarungen nach Gewinnrate ordnet. Die Daten sind org-gebunden, nicht pro User — die Bewertungen eines kleinen Teams können also die Defaults eines großen Teams überwiegen, wenn ein Admin die Tabelle nutzt, um das Standardmodell der Org zu setzen.

## Wann du danach greifst

| Nutz … wenn                                                          | Arena-Modus | Regulärer Modell-Picker |
| -------------------------------------------------------------------- | ----------- | ----------------------- |
| Du entscheidest, welches Modell zum Standard werden soll             | ✓           |                         |
| Du vermutest eine Modell-Regression nach einem Upgrade               | ✓           |                         |
| Du weißt schon, welches Modell du willst; du willst nur eine Antwort |             | ✓                       |
| Die Anfrage ist kurz und gewöhnlich                                  |             | ✓                       |

## Wo das hineinpasst

Die Arena ist die leichtgewichtige Rückkopplungsschleife auf der Modellwahl. Die schwerere Oberfläche ist die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) — dort werden deine Bewertungen zu einem Diagramm, mit dem jemand später über Defaults streitet. Wenn du derjenige bist, der die Tabelle später liest, dreh vorher eine Handvoll Arena-Runden; die selbst abgegebenen Bewertungen sagen dir, ob die Rahmung der Tabelle deine Erfahrung trifft.
