---
title: Modelle
description: Lege Standardmodelle fest, beschränke den Modellzugriff und wähle das Bildlesemodell für reine Textagenten.
---

Als Admin oder Inhaber legst du unter **Einstellungen > Richtlinien > Modelle** fest, mit welchen Modellen Mitglieder starten und welche sie verwenden dürfen. Standardwerte lenken die Auswahl; Zugriffsregeln setzen Grenzen. Richte zuerst die [Anbieter-Zugangsdaten](/de/platform/admin/providers) ein, damit die gewünschten Modelle verfügbar sind.

<Frame caption="Einstellungen > Richtlinien > Modelle — die Standardmodellregeln pro Bereich, darunter die Allowlist des Modellzugriffs und weiter unten das Modell für Bilder.">

![Die Einstellungsseite Modelle zeigt die Tabelle der Standardmodelle mit drei Regeln — einem Standard für alle Benutzer und je einer Rollen-Regel für Entwickler und Mitglied, jede auf ein OpenRouter-Modell festgelegt — über dem Abschnitt Modellzugriff im Modus Allowlist mit einer Regel erlaubter Modelle pro Rolle.](/images/platform/governance-content-models.webp)

</Frame>

## Ein Standardmodell festlegen

1. Wähle unter **Standardmodelle** die Aktion **Regel hinzufügen**.
2. Wähle den Standardbereich als Grundlage, eine Rolle oder ein Team. Gib bei Bedarf das Ziel an.
3. Wähle Anbieter und Modell, dann **Bestätigen**. Speichere die ausstehenden Seitenänderungen in der Kopfzeile.
4. Starte als Mitglied der Zielgruppe einen Chat mit der Modellauswahl **Auto** und prüfe das tatsächlich verwendete Modell.

Der Standard greift, wenn kein Modell ausdrücklich gewählt wurde. Eine Teamregel hat Vorrang vor einer Rollenregel, danach gilt der allgemeine Standard. Ein Standard verhindert nicht, dass jemand ein anderes erlaubtes Modell wählt.

## Den Modellzugriff begrenzen

Wähle unter **Modellzugriff** den Modus und ergänze Regeln für Personen, Teams, Rollen oder den Standardbereich.

| Modus | Wirkung einer passenden Regel |
| --- | --- |
| Allowlist | Nur aufgeführte erlaubte Modelle dürfen verwendet werden; ein gesperrtes Modell bleibt abgelehnt. |
| Blocklist | Modelle sind erlaubt, solange sie nicht als gesperrt aufgeführt sind. |

Zuerst gelten Personenregeln, danach Teamregeln, Rollenregeln und der Standard. Mehrere passende Teamregeln kombinieren ihre Listen. Eine ausdrückliche Sperre hat für das Modell weiterhin Vorrang. Passt keine Regel, schränkt die Richtlinie diese Person nicht ein. Lege eine Standardregel an, wenn du alle abdecken willst.

Der Zugriff wird bei der Modellnutzung geprüft, auch bei ausdrücklich gewählten oder festgelegten Modellen. Ein Standardmodell muss die Prüfung ebenfalls bestehen. Wird es abgelehnt, kann die automatische Auswahl auf ein erlaubtes Modell ausweichen. Der Editor warnt bei widersprüchlichen Standard- und Zugriffsregeln. Löse den Widerspruch, damit der gewünschte Standard tatsächlich verwendet wird.

<Tip>
Prüfe nach einer Änderung beide Fälle: Ein erlaubtes Modell soll funktionieren, ein gesperrtes für das betroffene Mitglied abgelehnt werden. Ein Test nur als Admin belegt keine rollenspezifische Regel.
</Tip>

## Das Modell zum Lesen von Bildern wählen

Ein reiner Textagent braucht Hilfe beim Lesen von Bildern, etwa Screenshots oder gescannten Seiten. Der Bereich für das Vision-Modell legt fest, welches Modell die Transkription übernimmt. Kann das eigene Agentenmodell Bilder lesen, nutzt es diesen Ersatz nicht.

Lass die Bildlesemodellauswahl auf automatisch, um dem verfügbaren Anbieterkatalog zu folgen. Tale bevorzugt ein empfohlenes Vision-Modell und wählt sonst eine erreichbare günstige Option. Der Text unter der Auswahl nennt das aktuelle Modell und den Grund.

Lege ein Modell fest, wenn du eine stabile Auswahl brauchst. Die Auswahl bietet für Transkription geeignete Modelle an. Ist das festgelegte Modell später nicht mehr verfügbar, wechselt Tale zur automatischen Auswahl. Prüfe die aktuelle Wahl nach dem Austausch von Zugangsdaten oder Änderungen der Modellverfügbarkeit.

## Eine unerwartete Auswahl erklären

Prüfe Rollen und Teams der Person, die ausdrückliche Chatauswahl, den passenden Standard, die Zugriffsregel und die Modellliste der Anbieter-Zugangsdaten. Ein Katalogeintrag beweist nicht, dass die Organisation nutzbare Zugangsdaten dafür besitzt. Kosten- und Tokenlimits gelten weiterhin über [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).
