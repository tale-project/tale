---
title: "Braucht dein Projekt wirklich mehrere KI-Agenten?"
description: "Entscheide, ob ein Agent reicht oder eine Aufteilung hilft. Ein Handbuchprojekt zeigt, wie du Aufgaben trennst und widersprüchliche Ergebnisse klärst."
slug: multi-agent-orchestration-business-teams
topicId: T01
reviewed: '2026-10-03'
draft: false
coverAlt: "Eine zentrale Koordination verbindet drei getrennte Aufgabenstationen mit einem gemeinsamen Ergebnis."
---

Fang mit einem Agenten an. Ein zweiter lohnt sich, wenn er eine eigene Frage beantworten, anderes Material untersuchen oder eine Prüfung übernehmen kann, die der erste nicht gut abdeckt. Kläre vor der Aufteilung, wer die Ergebnisse zusammenführt.

Darauf kommt es bei der Zusammenarbeit mehrerer Agenten an. Drei Agenten mit den Rollen Recherche, Redaktion und Prüfung können denselben Fehler wiederholen, wenn sie alle derselben irreführenden Quelle vertrauen. Entscheidend ist, was ein zusätzlicher Agent beiträgt, nicht wie seine Rolle heißt.

## Finde Aufgaben, die unabhängig voneinander vorankommen

Eine sinnvolle Aufteilung lässt jeden Agenten ein brauchbares Ergebnis liefern, ohne auf den anderen warten zu müssen. Einer kann etwa Kundeninterviews auswerten, während ein anderer die Produktdokumentation prüft. Aus ihren Ergebnissen formuliert anschließend eine Person oder ein Agent die Empfehlung.

Überlasse die gesamte Aufgabe einem Agenten, wenn jeder Schritt den vorherigen voraussetzt, nur wenige Quellen vorliegen oder mehrere Agenten ständig dasselbe Dokument umschreiben würden. Zusätzliche Übergaben können dann mehr Arbeit verursachen, als sie sparen.

Anthropic beschreibt doppelte Suchen, wenn Rechercheagenten zu vage Aufträge erhielten. Diese Erfahrung spricht für klare Aufgaben; sie belegt nicht, dass jedes Projekt mehrere Agenten braucht. [Lies den Bericht zum Recherchesystem](https://www.anthropic.com/engineering/multi-agent-research-system).

Eine hilfreiche Frage lautet: **Was liefert mir der zweite Agent, das mir sonst fehlen würde?** Wenn die Antwort nur „eine weitere Meinung“ ist, kläre zuerst, auf welche Belege sie sich stützen soll.

## Teile eine Handbuchüberarbeitung in zwei konkrete Fragen auf

Nehmen wir ein Beispiel: Ein Team will sein Einführungshandbuch überarbeiten. Es hat das Handbuch r6, die freigegebene Produktreferenz r12 und aktuelle Supportnotizen. Es möchte falsche Anweisungen korrigieren und Fragen beantworten, die Kunden tatsächlich stellen.

Dafür bieten sich zwei Untersuchungen an:

| Auftrag | Material | Erwartetes Ergebnis |
| --- | --- | --- |
| Unbeantwortete Kundenfragen finden | Supportnotizen | Wiederkehrende Fragen mit Links zu den ursprünglichen Notizen |
| Falsche Anweisungen finden | Handbuch r6 und Produktreferenz r12 | Jede Abweichung, beide Quellstellen und ein Korrekturvorschlag |

Keiner der beiden Agenten muss dafür das Handbuch bearbeiten. Gib einer Person oder einem Agenten die Verantwortung, die Erkenntnisse zu einem neuen Entwurf zusammenzuführen. Jemand muss die vorgeschlagenen Änderungen weiterhin an den Quellen prüfen.

![Zwei getrennte Untersuchungen liefern ihre Ergebnisse an eine Redaktion. Sie führt die Erkenntnisse zusammen und klärt Widersprüche, bevor die überarbeitete Fassung geprüft wird.](/blog/diagrams/de/T01-diagram.svg)

Für eine Anleitung mit drei Absätzen und einer einzigen Referenz wäre diese Aufteilung vermutlich übertrieben. Ein Agent könnte sie prüfen und überarbeiten, danach folgt die Kontrolle. Die Menge sinnvoller, unabhängiger Arbeit bestimmt, wie viele Agenten du brauchst.

## Beschreibe das Ergebnis, nicht nur die Rolle

„Sei der Faktenprüfer“ lässt zu viel offen. Für die Handbuchprüfung wäre dieser Auftrag brauchbarer:

> Vergleiche Handbuch r6 mit der freigegebenen Produktreferenz r12. Liefere für jede falsche Anweisung beide Quellstellen und einen Korrekturvorschlag. Bearbeite das Handbuch nicht. Wenn sich die Quellen widersprechen, halte den Widerspruch fest und benenne die Frage, die der Produktverantwortliche klären muss.

Füge das genannte Material bei, benenne den Empfänger und begrenze Zeit oder Aufwand. Vereinbare auch, was der Agent bei unvollständiger Arbeit zurückgeben soll. Bereits geprüfte Erkenntnisse und die konkret fehlenden Belege helfen mehr als eine selbstsichere Vermutung.

Die [Vorlage für einen Aufgabenauftrag](/blog/worksheets/de/T01-task-contract.md) bietet eine ausführlichere Fassung, wenn du zusätzlich Berechtigungen, Abhängigkeiten und Abnahmekriterien festhalten musst.

## Kläre Widersprüche anhand der Quellen

Angenommen, laut Handbuch dürfen alle Nutzer andere Personen einladen. Die freigegebene Referenz erlaubt das nur Administratoren. Eine Supportnotiz berichtet dagegen von einer erfolgreichen Einladung über ein Standardkonto.

Lass die Agenten nicht abstimmen. Das Handbuch ist das Dokument, das geprüft wird. Die freigegebene Referenz nennt die dokumentierte Regel. Die Supportnotiz wirft eine Frage zur tatsächlichen Rolle oder Konfiguration des Kunden auf; sie erklärt den Unterschied noch nicht.

Die Redaktion kann „Ein Administrator versendet die Einladung“ vorschlagen und den Produktverantwortlichen bitten, den widersprüchlichen Bericht zu untersuchen. Lässt sich die Regel nicht bestätigen, bleibt dieser Abschnitt offen. Auch Einigkeit unter den Agenten würde den fehlenden Beleg nicht ersetzen.

Halte bei den Erkenntnissen fest, welche Quellversionen verwendet wurden. Trifft während der Arbeit Referenz r13 ein, prüfe die Aussage zu Berechtigungen daran erneut. Die Liste der Kundenfragen kann weiterhin brauchbar sein, weil sich ihre Supportnotizen nicht geändert haben.

## Behalte die Aufteilung, wenn sie das Ergebnis verbessert

Bearbeite denselben kleinen Auftrag einmal mit einem Agenten und einmal mit der geplanten Aufteilung. Verwende dieselben Eingaben und Abnahmekriterien und notiere Unterschiede im Gesamtbudget. Vergleiche übersehene Fehler, nützliche Erkenntnisse, die Zeit bis zur Abnahme und den Aufwand für Abstimmung und Korrekturen.

Behalte den zweiten Agenten, wenn sein Beitrag diesen Aufwand rechtfertigt. Führe die Aufgaben wieder zusammen, wenn du mit weniger Übergaben zum gleichen Ergebnis kommst. Schnellere Einzelsuchen bringen wenig, wenn das Zusammenführen der Antwort länger dauert.

In Tale halten Projektaufgaben Aufträge, Berichte und Arbeitsergebnisse zusammen. Damit ein Agent an einen anderen delegieren kann, braucht er eine ausdrückliche Tool-Berechtigung; eine Zuweisung allein startet die Arbeit noch nicht. Die [Anleitung zur Aufgabendelegation](https://docs.tale.dev/de/platform/projects/task-automation) beschreibt die Einrichtung.
