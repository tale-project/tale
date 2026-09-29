---
title: Modelle
description: Lege Standardmodelle fest, begrenze den Zugriff und wähle getrennte Modelle für Bilder und Audiotranskription.
---

Als Admin oder Inhaber legst du unter **Einstellungen > Richtlinien > Modelle** fest, mit welchen Modellen Mitglieder starten und welche sie verwenden dürfen. Standardwerte lenken die Auswahl; Zugriffsregeln setzen Grenzen. Richte zuerst die [Anbieter-Zugangsdaten](/de/platform/admin/providers) ein, damit die gewünschten Modelle verfügbar sind.

## Ein Standardmodell festlegen

1. Wähle unter **Standardmodelle** die Aktion **Regel hinzufügen**.
2. Wähle den Standardbereich als Grundlage, eine Rolle oder ein Team. Gib bei Bedarf das Ziel an.
3. Wähle Anbieter und Modell, dann **Bestätigen**. Speichere die ausstehenden Seitenänderungen in der Kopfzeile.
4. Starte als Mitglied der Zielgruppe einen Chat mit der Modellauswahl **Auto** und prüfe das tatsächlich verwendete Modell.

Der Standard greift, wenn kein Modell ausdrücklich gewählt wurde. Eine Teamregel hat Vorrang vor einer Rollenregel, danach gilt der allgemeine Standard; gehört jemand mehreren Teams mit einer Regel an, gewinnt die erste passende Teamregel in der Tabelle (siehe [So werden Regeln kombiniert](/de/platform/admin/governance/policies-and-limits#how-rules-combine)). Ein Standard verhindert nicht, dass jemand ein anderes erlaubtes Modell wählt.

## Den Modellzugriff begrenzen

Wähle unter **Modellzugriff** den Modus und ergänze Regeln für Personen, Teams, Rollen oder den Standardbereich.

| Modus | Wirkung einer passenden Regel |
| --- | --- |
| Allowlist | Nur aufgeführte erlaubte Modelle dürfen verwendet werden; ein gesperrtes Modell bleibt abgelehnt. |
| Blocklist | Modelle sind erlaubt, solange sie nicht als gesperrt aufgeführt sind. |

Zuerst gelten Personenregeln, danach Teamregeln, Rollenregeln und der Standard. Mehrere passende Teamregeln kombinieren ihre Listen. Eine ausdrückliche Sperre hat für das Modell weiterhin Vorrang. Passt keine Regel, schränkt die Richtlinie diese Person nicht ein. Lege eine Standardregel an, wenn du alle abdecken willst.

Bei Chats wird der Zugriff bei der Modellnutzung geprüft, auch bei ausdrücklich gewählten oder festgelegten Modellen. Ein Standardmodell muss die Prüfung ebenfalls bestehen. Wird es abgelehnt, kann die automatische Auswahl auf ein erlaubtes Modell ausweichen. Der Editor warnt bei widersprüchlichen Standard- und Zugriffsregeln. Löse den Widerspruch, damit der gewünschte Standard tatsächlich verwendet wird.

<Tip>
Prüfe nach einer Änderung beide Fälle: Ein erlaubtes Modell soll funktionieren, ein gesperrtes für das betroffene Mitglied abgelehnt werden. Ein Test nur als Admin belegt keine rollenspezifische Regel.
</Tip>

### API-Schlüsseln die Modelle der Organisation öffnen {#model-endpoints}

Mit **Modell-Endpunkte für API-Schlüssel** nutzen Personen die Modelle, die diese Richtlinie erlaubt, aus ihren eigenen Tools, etwa opencode, Claude Code oder Skripten mit den SDKs von OpenAI oder Anthropic, mit einem persönlichen API-Schlüssel über OpenAI- und Anthropic-kompatible Endpunkte. Standardmäßig ist das ausgeschaltet. Aktiviere den Schalter **Modell-Endpunkte für API-Schlüssel**; die Änderung wird sofort gespeichert.

- **Wer aufrufen darf.** Inhaber, Admins und Entwickler über ihre Rolle. Jedes andere Mitglied nur mit der Kompetenz **Modelle über die API aufrufen**, die du unter [Kompetenzen](/de/platform/admin/governance/competences) zuweist.
- **Welche Modelle.** Die Chatmodelle, die deine Anbieter-Zugangsdaten mit API-Schlüssel oder Umgebungsvariable bereitstellen, eingeschränkt durch die erlaubten Modelle der jeweiligen Zugangsdaten. Die Zugriffsregeln oben gelten für jeden Aufruf, und zwar für die Person, deren Schlüssel ihn gesendet hat. Der Schalter wirkt unabhängig von **Modellzugriffsrichtlinie aktivieren**: Ist diese Richtlinie aus, grenzen nur die erlaubten Modelle der Zugangsdaten die Liste ein.
- **Was jeder Aufruf durchläuft.** Die Budgets unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) und die Eingabe-Guardrails unter [Guardrails](/de/platform/admin/governance/guardrails#model-endpoints). Die Antworten der Modelle werden nicht gefiltert.
- **Wo er erscheint.** Jeder Aufruf wird unter der Person und dem Schlüssel verbucht, in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) als **Direkter API-Aufruf**.

<Frame caption="Richtlinien > Modelle — Modell-Endpunkte für API-Schlüssel, eingeschaltet.">

![Der Bereich Modell-Endpunkte für API-Schlüssel auf der Seite Modelle mit eingeschaltetem Schalter; er erklärt, dass Inhaber, Admins, Entwickler und Mitglieder mit der Kompetenz Modelle über die API aufrufen die Modelle der Organisation aus ihren eigenen Tools nutzen dürfen.](/images/platform/governance-model-endpoints.webp)

</Frame>

Schaltest du den Schalter aus, lehnt Tale den nächsten Aufruf mit `403 MODEL_API_DISABLED` ab. [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor#model-endpoints) zeigt Mitgliedern, wie sie ihre Tools verbinden.

## Das Modell zum Lesen von Bildern wählen

Ein reiner Textagent braucht Hilfe beim Lesen von Bildern, etwa Screenshots oder gescannten Seiten. Der Bereich für das Vision-Modell legt fest, welches Modell das Bild für den Agenten beschreibt. Kann das eigene Agentenmodell Bilder lesen, liest es sie selbst; das Vision-Modell bedient weiterhin die Bildwerkzeuge, die Skripte und Coding-Agenten in ihrer Sandbox aufrufen, etwa die Stapeltranskription gescannter Seiten. Jeder verwaltete Agent erhält deshalb eines, sobald ein erreichbares Modell existiert.

Lass die Bildlesemodellauswahl auf automatisch, um dem verfügbaren Anbieterkatalog zu folgen. Tale bevorzugt ein empfohlenes Vision-Modell und wählt sonst eine erreichbare günstige Option. Der Text unter der Auswahl nennt das aktuelle Modell und den Grund.

Lege ein Modell fest, wenn du eine stabile Auswahl brauchst. Die Auswahl bietet Modelle an, die Bilder lesen können. Ist das festgelegte Modell später nicht mehr verfügbar, stelle seinen Anbieterzugang wieder her oder wähle ausdrücklich **Automatisch** und speichere. Tale wechselt ein festgelegtes Modell nicht stillschweigend. Prüfe die aktuelle Wahl nach dem Austausch von Zugangsdaten oder Änderungen der Modellverfügbarkeit.

## Agenten Bilder erstellen lassen {#let-agents-generate-images}

Mit der **Bildgenerierung** können [Projektagenten](/de/platform/projects/project-agents) bei ihren Aufgaben und Agent-Knoten in [Automatisierungen](/de/platform/automations/concepts) Bilder erstellen, etwa ein Titelbild für einen Bericht oder ein Motiv für eine Kampagne. Die Funktion bleibt aus, bis du sie einschaltest. Im Chat entstehen nie Bilder: Wer eines braucht, weist eine Aufgabe einem Projektagenten zu.

1. Schalte **Agenten Bilder erstellen lassen** ein. Der Schalter speichert sofort.
2. Lass **Bildmodell** auf **Automatisch** oder wähle ein Modell und speichere die offenen Änderungen der Seite in der Kopfzeile.
3. Prüfe die Zeile unter der Auswahl. Sie nennt das Modell, mit dem Agenten Bilder erstellen.

<Frame caption="Richtlinien > Modelle — die Bildgenerierung ist eingeschaltet, mit einem fest gewählten Bildmodell.">

![Der Bereich Bildgenerierung mit eingeschaltetem Schalter, dem Bildmodell OpenRouter · google/gemini-2.5-flash-image in der Auswahl und der Zeile darunter, die das Modell nennt, mit dem Agenten gerade Bilder erstellen.](/images/platform/governance-image-generation.webp)

</Frame>

**Automatisch** nimmt das erste Modell einer kurzen Empfehlungsliste, das deine Anbieter-Zugangsdaten erreichen: Gemini 2.5 Flash Image, GPT Image 1 Mini, GPT Image 1 und danach FLUX.2 Pro. Dabei berücksichtigt Tale Zugangsdaten für OpenRouter und OpenAI. Die Auswahl listet jedes Bildmodell, das deine Zugangsdaten bedienen können, auch die anderer kompatibler Anbieter. Ein ausgewähltes Modell bleibt fest, bis du es änderst. Ist es nicht mehr verfügbar, meldet Tale das und wechselt nicht zu einem anderen Modell. Schaltest du die Bildgenerierung aus, bleibt das gewählte Modell für das nächste Einschalten erhalten.

Solange die Bildgenerierung eingeschaltet und ein Modell verfügbar ist, bekommt jeder Agent, der in einer Laufzeit mit MCP-Kanal von Tale zu arbeiten beginnt, ein Tool für Bilder. Agenten in anderen Laufzeiten und alle Agenten bei ausgeschalteter Bildgenerierung sehen dieses Tool gar nicht; welche Laufzeiten den Kanal haben, zeigt [Eine Agent-Laufzeit wählen](/de/platform/agents/harnesses). Schaltest du die Funktion aus, lehnt Tale auch die nächste Bildanfrage eines Agenten ab, der gerade läuft. Ein Agent legt seine Bilder bei seinen Dateien ab: Die Bilder einer Aufgabe erscheinen unter ihren Ergebnisdateien, die eines Automatisierungsschritts in dessen Ausgabe.

Jedes Bild wird deiner Organisation berechnet und zählt wie der übrige Lauf für die Person, die ihn gestartet hat. Ein Zug eines Agenten erstellt höchstens 16 Bilder, eine Anfrage nach der anderen, und seine Bilder zehren vom selben Rahmen wie die Modellnutzung des Zugs: Die Kosten jedes Bilds gehen von dem ab, was das Modell noch ausgeben darf, und ist der Rahmen aufgebraucht, lehnt Tale das nächste Bild ab. Ein Budgetlimit, das für diese Person gilt, lehnt das Bild ab, bevor das Bildmodell aufgerufen wird. Lege Kosten- oder Anfragelimits für Bilder unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) fest; [So wird Nutzung gezählt](/de/platform/admin/governance/usage-attribution) erklärt, für wen ein Bild zählt. Die Richtliniendatei und eigene Bild-Endpunkte beschreibt die [Anbieter-Referenz für Self-Hosting](/de/self-hosted/configuration/providers#configure-image-generation).

## Das Modell für Audiotranskription auswählen

**Modell für Audiotranskription** steuert die serverseitige Transkription von Audio- und Videoanhängen, die Audiospur von Videolinks ohne nutzbare Untertitel sowie Diktate in Browsern ohne eigene Spracherkennung. Die Spracherkennung des Browsers nutzt ihren eigenen Dienst und hat Vorrang, wenn sie unterstützt wird.

<Frame caption="Die Audiotranskription hat eine eigene organisationsweite Auswahl: automatisch oder ein festgelegtes Modell.">

![Der Abschnitt für Audiotranskription zeigt die automatische Auswahl und nennt das aktuelle Modell für die serverseitige Transkription.](/images/platform/governance-content-models.webp)

</Frame>

Mit einem aktiven Standardzugang für OpenRouter stehen hier auch dessen Modelle zur Spracherkennung zur Auswahl. Tale findet sie im OpenRouter-Katalog. Prüfe, ob das gewünschte Transkriptionsmodell für den Zugang erlaubt ist. Nutze dann **Automatisch** oder wähle das Modell ausdrücklich aus.

1. Lass **Modell zur Audiotranskription** auf **Automatisch**, damit Tale ein verfügbares kompatibles Modell auswählt, oder wähle einen bestimmten Anbieter und ein Modell.
2. Speichere die ausstehenden Änderungen im Seitenkopf. Bis dahin ist die Auswahl ein Entwurf. Verwirf ihn, um die gespeicherte Einstellung beizubehalten.
3. Prüfe das aktuelle Modell unter der Auswahl. Teste eine kurze Aufnahme, bevor du mit dieser Einrichtung eine längere Datei hochlädst.

Ein Modellwechsel gilt für neue Transkriptionen; bereits verarbeitete Anhänge behalten ihr vorhandenes Transkript. Lädst du dieselben Bytes erneut hoch, wird die fertige Transkription für dasselbe Ziel wiederverwendet. Bei einem anderen Zielanbieter oder Zielmodell wird die Aufnahme erneut transkribiert.

Ein ausdrücklich ausgewähltes Modell bleibt festgelegt. Wird es nicht mehr verfügbar, zeigt Tale das an und wechselt nicht zu einem anderen Modell. Wähle ein anderes verfügbares Modell oder **Automatisch** und speichere. Ist kein kompatibles Modell verfügbar, richte unter [KI-Anbieter](/de/platform/admin/providers) einen aktiven Zugang ein und prüfe die dafür erlaubten Modelle. Kann Tale die Konfiguration vorübergehend nicht prüfen, versuche es erneut, statt deshalb ein anderes Modell auszuwählen.

Verhindert eine nicht verfügbare Servertranskription den Versuch, zu diktieren oder Audio oder Video anzuhängen, erklärt ein schließbarer Dialog das Problem. Je nach Zugriffsrechten erhalten Mitglieder einen Link zu den Einstellungen oder den Hinweis, einen Admin zu kontaktieren. Vorübergehend fehlgeschlagene Verfügbarkeitsprüfungen lassen sich wiederholen. Zur Auswahl über die Bereitstellungskonfiguration und zu eigenen Audioendpunkten siehe die [Anbieterreferenz für Self-Hosting](/de/self-hosted/configuration/providers#audiotranskription-konfigurieren).

## Eine unerwartete Auswahl erklären

Prüfe Rollen und Teams der Person, die ausdrückliche Chatauswahl, den passenden Standard, die Zugriffsregel und die Modellliste der Anbieter-Zugangsdaten. Ein Katalogeintrag beweist nicht, dass die Organisation nutzbare Zugangsdaten dafür besitzt. Kosten- und Tokenlimits gelten weiterhin über [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).
