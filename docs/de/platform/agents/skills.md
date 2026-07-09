---
title: Agent-Skills
description: Ein Skill ist ein wiederverwendbares Bündel — eine SKILL.md plus optionale Skripte und Referenzen — das Agenten zur Laufzeit lesen. Diese Seite zeigt, wann du dazu greifst statt zu längeren Anweisungen.
---

Ein Skill ist die Einheit, zu der Tale greift, wenn dasselbe Muster über mehrere Agenten auftaucht. Er ist ein wiederverwendbares Bündel — eine `SKILL.md` mit Anweisungen, plus optionale Skripte, Referenzen und Assets — das in der Skill-Bibliothek der Organisation lebt und das Agenten zur Laufzeit lesen. Binde denselben Skill an drei Agenten, und du pflegst das Verhalten an einer Stelle.

Diese Seite vermittelt dir das mentale Modell dafür, wann ein Skill der richtige Zug ist und wann Inline-Anweisungen es sind. Lies sie, bevor du deinen ersten Skill hochlädst; komm zurück, wenn die Anweisungen eines Agents lang werden und du überlegst, ob du sie auslagerst.

## Was ein Skill bündelt

Ein Skill wird als Zip mit einer `SKILL.md` an der Wurzel hochgeladen. Das Frontmatter der Datei trägt die Metadaten — Beschreibung, Lizenz, empfohlene Python- oder Node-Versionen — und der Rumpf trägt die Anweisungen. Bündel-Assets liegen unter `scripts/`, `references/` oder `assets/`: Code, den der Agent ausführen kann, wenn er in einer Sandbox arbeitet, und Referenzmaterial, das er bei Bedarf liest.

Ein reiner Anweisungs-Skill ist die richtige Form, wenn das Verhalten Stimme oder Einschränkung ist — „zitiere die Quelle immer mit Abschnittsnummer“, „lehne Fragen außerhalb dieses Produkts ab“. Ein Skill mit Skripten ist die richtige Form, wenn das Verhalten eine Berechnung, eine Transformation oder eine mehrstufige Aufgabe ist, die das Modell sonst in Tokens improvisieren müsste.

## An einen Agent binden

Ein Skill wird für einen Agent sichtbar, indem du ihn auf dem Tab **Skills** des Agents bindest — **Gebundene Skills** listet die Bibliothek der Organisation mit einer Checkbox pro Skill. Ein Agent kann höchstens zehn Skills binden, und ein Agent ohne Bindungen sieht keinen: es gibt keinen impliziten Rückfall auf organisationsweite Sichtbarkeit. Der Agent liest einen gebundenen Skill zur Laufzeit — die Beschreibung sagt ihm, wann der Skill greift, und dann zieht er Rumpf und Bündeldateien heran.

Die Bindung gilt pro Agent: zwei Agenten können denselben Skill binden, und das Lösen ist symmetrisch — die nächste Anfrage läuft ohne ihn.

## Die Bibliothek verwalten

Skills zu verwalten verlangt Admin- oder Entwickler-Berechtigungen. Die Bibliothek liegt in den Skills-Einstellungen der Organisation; jeder Skill zeigt dort seine Übersicht, den Anweisungs-Rumpf, den Bündel-Dateibaum und die Änderungsspur **Letzte Änderungen**. **Skill hochladen** ergänzt ein neues Bündel, **Bundle ersetzen** überschreibt ein bestehendes an Ort und Stelle, und **Duplizieren** forkt es unter einem neuen Slug.

<Warning>

Es gibt kein Versions-Pinning: ein ersetztes Bundle ändert ab der nächsten Anfrage, was jeder gebundene Agent liest, und ein gelöschter Skill entfernt das Bündel von der Platte — jeder aktuell gebundene Agent verliert den Zugriff.

</Warning>

## Wann du danach greifst

| Nutze … wenn                                                           | Skill | Inline-Anweisungen |
| ---------------------------------------------------------------------- | ----- | ------------------ |
| Das Muster sich über mehrere Agenten wiederholt                        | ✓     |                    |
| Das Verhalten Skripte umfasst, die das Modell sonst imitieren würde    | ✓     |                    |
| Das Verhalten die Stimme eines einzelnen Agents ist                    |       | ✓                  |
| Die Organisation das Verhalten über eine einzige Änderung steuern soll | ✓     |                    |
| Die Anweisungen des Agents noch auf einen Bildschirm passen            |       | ✓                  |

Inline-Anweisungen sind die richtige Form für einen Agent. Skills sind die richtige Form, wenn dasselbe Verhalten in zwei oder drei Agenten auftaucht und die Wartungskosten, ihre Inline-Anweisungen synchron zu halten, zu beißen beginnen.

## Bau einen

Skills sind die Abstraktionsebene über den vier Knöpfen — sie lassen dich ein Verhalten einmal ausliefern, und jeder Agent, der es braucht, holt es sich per Bindung. Der natürliche nächste Gang ist [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) — er führt von der leeren Seite zu einem Skill mit Skripten, gebunden an einen Agent.
