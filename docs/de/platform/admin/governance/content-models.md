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

## Das Modell zum Lesen von Bildern wählen

Ein reiner Textagent braucht Hilfe beim Lesen von Bildern, etwa Screenshots oder gescannten Seiten. Der Bereich für das Vision-Modell legt fest, welches Modell das Bild für den Agenten beschreibt. Kann das eigene Agentenmodell Bilder lesen, liest es sie selbst; das Vision-Modell bedient weiterhin die Bildwerkzeuge, die Skripte und Coding-Agenten in ihrer Sandbox aufrufen, etwa die Stapeltranskription gescannter Seiten. Jeder verwaltete Agent erhält deshalb eines, sobald ein erreichbares Modell existiert.

Lass die Bildlesemodellauswahl auf automatisch, um dem verfügbaren Anbieterkatalog zu folgen. Tale bevorzugt ein empfohlenes Vision-Modell und wählt sonst eine erreichbare günstige Option. Der Text unter der Auswahl nennt das aktuelle Modell und den Grund.

Lege ein Modell fest, wenn du eine stabile Auswahl brauchst. Die Auswahl bietet Modelle an, die Bilder lesen können. Ist das festgelegte Modell später nicht mehr verfügbar, stelle seinen Anbieterzugang wieder her oder wähle ausdrücklich **Automatisch** und speichere. Tale wechselt ein festgelegtes Modell nicht stillschweigend. Prüfe die aktuelle Wahl nach dem Austausch von Zugangsdaten oder Änderungen der Modellverfügbarkeit.

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
