---
title: Dokumentenvergleich
description: Der Seite-an-Seite-Diff-Dialog, der zwei Dokumente — hochgeladen oder aus der Bibliothek — nimmt und die Unterschiede absatzweise mit einer RAG-gestützten Zusammenfassung durchläuft.
---

Dokumentenvergleich ist der Dialog, der die Frage beantwortet „was hat sich zwischen diesen beiden Versionen geändert". Du zeigst ihm ein Basis-Dokument und ein Vergleichs-Dokument; Tale jagt beide durch dieselbe Extraktions-Pipeline, die die Wissensdatenbank speist, übergibt sie einem deterministischen Diff-Endpunkt im RAG-Dienst und rendert das Ergebnis als strukturierten Durchgang durch hinzugefügte, gelöschte und geänderte Absätze. Es ist das richtige Werkzeug für Verträge vorher-nachher, Policy-Überarbeitungen, zwei Entwürfe desselben Vorschlags — alles, wo die Worte zählen und die Worte sich bewegt haben.

Der Dialog lebt neben den Dokumenten, die du vergleichst: öffne ihn aus **Wissen > Dokumente** mit der Aktion **Dokumente vergleichen**. Die Basis- und Vergleichsdatei können je ein bereits indexiertes Dokument aus der Bibliothek oder ein einmaliger Upload sein, sodass keine Seite in die Wissensdatenbank geladen werden muss, wenn du nur einen Diff sehen willst.

## Die zwei Seiten wählen

Zwei Auswahlfelder sitzen nebeneinander: **Basis-Dokument** links, **Vergleichs-Dokument** rechts. Jedes Feld hat zwei Tabs — **Hochladen** und **Vorhandene** — und beide Tabs füllen denselben Slot.

Der Hochladen-Tab nimmt jedes Format, das die Wissensdatenbank-Pipeline bereits beherrscht: PDF, DOCX, DOC, XLSX, PPTX, Plaintext, Markdown, CSV. Die Datei lädt in Tales Objektspeicher, denselben Ort, an dem Chat-Anhänge und Bibliotheks-Dokumente leben; sie wird nicht indexiert und nicht an einen Agent gebunden, der Upload ist also ein einmaliger Input für diesen Diff und sonst nichts. Der Vorhandene-Tab listet jedes Dokument in der Bibliothek mit herunterladbarer Datei — wähle eines über die durchsuchbare Auswahl und der Slot füllt sich mit dem Namen des Dokuments.

Misch die Tabs frei. Vergleich zwei Uploads gegeneinander, wenn keine Version in der Bibliothek ist, vergleich einen Upload gegen ein vorhandenes Bibliotheks-Dokument, wenn du sehen willst, was ein eingehender Entwurf ändert, oder vergleich zwei Bibliotheks-Dokumente, wenn du sie im Wissensbereich versioniert hast.

## Den Diff laufen lassen

Klick **Vergleichen**. Der Dialog zeigt einen Spinner, während der RAG-Dienst beide Dateien herunterlädt, den Text extrahiert, Absatzgrenzen normalisiert und einen deterministischen Diff auf Absatzebene fährt. Der Endpunkt ist der einzige modellfreie Pfad der Vergleichsfunktion — der Diff selbst ist reines Stringmatching, das Ergebnis ist also bei gleichem Input reproduzierbar.

Das Warten ist begrenzt — die Anfrage läuft nach zwei Minuten in den Timeout, wenn der RAG-Dienst nicht geantwortet hat. Große Dateien treffen den Timeout häufiger als kleine; wenn er auslöst, wiederhol einmal und überleg, die Datei auf den Teil zu kürzen, der zählt.

## Das Ergebnis lesen

Vier Stat-Badges sitzen über dem Diff: **Hinzugefügt**, **Gelöscht**, **Geändert**, **Unverändert**, je mit der Absatzzahl für den Eimer. Die Badges sind auch die Legende für das Farbschema unten — grün für hinzugefügt, rot für gelöscht, gelb für geändert, neutral für unveränderten Kontext.

Unter den Badges sitzt die Änderungsliste. Jeder Eintrag ist ein **Change-Block** — eine Strecke zusammenhängender Änderungen plus ein Absatz Kontext davor und danach — gerendert als eine Karte. Innerhalb der Karte trägt jeder Absatz ein führendes Zeichen (`+` hinzugefügt, `-` gelöscht, `~` geändert, leer für Kontext) und eine Farbfüllung. Geänderte Absätze rendern den Inline-Diff, wenn der Endpunkt einen liefert — gelöschter Text durchgestrichen, hinzugefügter Text hervorgehoben — und fallen sonst auf das vollständige Vorher-Nachher-Paar zurück.

Wenn Basis und Vergleich so wenig gemeinsam haben, dass der Diff im Wesentlichen „lösche alles, füge alles hinzu" lautet, sitzt eine Warnung **Hohe Abweichung** über der Änderungsliste. Das ist der Diff, der dir sagt, dass die beiden Dateien eigentlich nicht zwei Versionen desselben Dokuments sind — sie mögen aus derselben Vorlage gestartet sein, aber die Inhalte sind über den Punkt hinausgedriftet, an dem ein Absatz-Diff die richtige Form ist.

## Das Trunkierungs-Banner

Der Endpunkt deckelt die Zahl der Change-Blöcke, damit der Dialog benutzbar bleibt. Wenn der Deckel greift, sitzt ein Banner **Ergebnisse gekürzt** unter den Stats: die angezeigten Blöcke sind die wichtigsten, die Summen in den Badges spiegeln weiterhin das volle Dateipaar. Der Deckel betrifft nur die Anzeige — der zugrundeliegende Diff sieht jeden Absatz.

## Wann du dazu greifst

Greif zum Dokumentenvergleich, wenn die Frage „was hat sich geändert" ist, nicht „was steht hier". Für „was steht hier" lad die Datei als Chat-Anhang an oder in die Wissensdatenbank und frag einen Agent — das Modell ist besser im Lesen von Prosa als der Diff. Der Diff ist besser darin, zwei Dateien parallel zu lesen und zu berichten, welche Absätze sich unterscheiden, was jedes zeilennummerierte Diff-Tool tut, aber erweitert auf extrahierten Text aus jedem Format, das die Pipeline unterstützt. Die nächste Lektüre, die sich lohnt, ist [Dokumente](/de/platform/knowledge/documents) — sie deckt die Indexier-Pipeline ab, die der Vergleich mit dem Rest der Wissensdatenbank teilt, und wo versionierte Dokumente leben, sobald du sie verglichen hast.
