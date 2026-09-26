---
title: Der Workflow-Editor
description: Prüfe und ändere Knoten, gib Testdaten ein, speichere eine Version und schalte sie live oder kehre zu einer früheren zurück.
---

Im Workflow-Editor änderst du den Ablauf einer Automatisierung und wählst die gespeicherte Version für Live-Läufe. Änderungen brauchen Entwickler-, Admin- oder Inhaberrechte. Speichern, Testen und Bereitstellen sind getrennte Schritte: Die Arbeit an einem Entwurf lässt die bereitgestellte Version bestehen.

Öffne **Automatisierungen** und wähle einen Eintrag. Er öffnet sich im Tab **Editor**. Für einen neuen Ablauf beginne mit [Automatisierungen erstellen oder importieren](/de/platform/automations/catalog).

| Tab | Wofür du ihn nutzt |
| --- | --- |
| **Editor** | Den Workflow ändern, eine gespeicherte Version testen und die Live-Version wählen. |
| **Versionen** | Versionsnachrichten und gespeicherte Testergebnisse lesen. Eine Zeile öffnet diese Version im Editor. |
| **Läufe** | Die letzten Ausführungen prüfen und den vollständigen Datensatz eines Laufs öffnen. |

Im **Editor** stehen Versionsauswahl und Laufaktionen neben den Tabs, zusammen mit **Speichern** und **Verwerfen**. Ein Punkt am Tab **Editor** kennzeichnet ungespeicherte Änderungen. Beim Verlassen des Tabs oder einem Versionswechsel fragt Tale, wie du damit fortfahren möchtest.

<Frame caption="Wähle einen Knoten, um seine Felder zu prüfen. Neben den Tabs stehen die Aktionen für Test, Speichern und Bereitstellung.">

![Der Workflow-Editor zeigt verbundene Knoten, die Einstellungen eines ausgewählten Knotens die Tabs Editor, Versionen und Läufe sowie die Versions- und Laufaktionen.](/images/platform/automation-editor-canvas.webp)

</Frame>

Zum Wechseln musst du nicht zur Liste zurück: Klick im Navigationspfad auf den Namen der aktuellen Automatisierung. Das Menü zeigt alle Automatisierungen der Organisation, auch nach einem Wechsel in ein anderes Projekt. Oben stehen Automatisierungen ohne Projektzuordnung, darunter die mit Projektzuordnung. Eine waagerechte Linie trennt die beiden Gruppen. Such nach Name oder Slug und wähle einen Eintrag. Der aktuelle Tab bleibt geöffnet. Aus einem Laufdetail gelangst du zur Liste **Läufe** der anderen Automatisierung. Eine ausgewählte Versionsnummer wird nicht übernommen: Im **Editor** erscheint deren neueste gespeicherte Version.

## Den Canvas lesen

Jeder Kasten ist ein Knoten. Seine Beschriftung nennt Schritt und Typ; **Liest** zeigt verwendete Ausgaben anderer Knoten. Pfeile entstehen aus Referenzen wie `{{ nodes.draft.output.text }}`. Ändere die Referenz, um eine Abhängigkeit zu ändern. Das Zeichnen eines Pfeils erstellt keine Abhängigkeit.

Kennzeichnungen zeigen Bedingungen und Schleifen wie `when`, `else of`, `for each`, `repeat until` und `continue on error`. Eine Zykluswarnung bedeutet, dass mehrere Knoten voneinander abhängen. Entferne die kreisförmige Referenz, bevor du eine ausführbare Version speicherst.

## Einen Knoten bearbeiten

Wähle einen Kasten, um seine Felder zu öffnen. Ein `transform` hat **Code**, ein `llm` Felder für Prompt, Modell und Ausgabeschema. Ein `agent` ergänzt Harness und Ausstattung. **Eingabe** enthält JSON-Werte und Referenzen für diesen Knoten. Unvollständiges JSON wird gemeldet und ändert den Knoten nicht.

Öffne **Ablaufsteuerung** für Bedingungen und Wiederholungen. Klicke auf den leeren Canvas, auf **Schließen** oder drücke Escape außerhalb eines Textfelds, um zu Trigger und Projekteinstellungen zurückzukehren. [Automatisierungsgrundlagen](/de/platform/automations/concepts) erklärt Knotentypen und Ausdrücke.

## Eine Version speichern und testen

1. Ändere die nötigen Felder und klicke auf **Speichern**.
2. Erkläre die Änderung in der **Versionsnachricht** und wähle **Version speichern**. Eine neue Version entsteht; frühere Fassungen bleiben erhalten. Hat jemand während deiner Bearbeitung eine andere Version gespeichert, lehnt Tale das Speichern ab und fragt nach: **Meine Änderungen verwerfen und neu laden** zeigt die neuere Version, **Trotzdem speichern** legt deine Version darüber an — die neuere bleibt im Versionsverlauf, die aktuelle Version ist dann aber deine.
3. Klicke auf **Testlauf**. Hat der Workflow ein Eingabeschema, fülle im Dialog **Eingabe für den Lauf (JSON)** aus. Öffne **Eingabeschema**, um Pflichtfelder und Typen zu prüfen. Ungültiges JSON oder unpassende Werte verhindern den Start.
4. Starte den Test, wechsle zum Tab **Läufe** und öffne seinen Eintrag. Vergleiche aufgelöste Eingabe, Ausgabe und geplante Aktionen mit dem erwarteten Ergebnis.

Braucht ein Workflow `owner` und `repo`, könnte seine Eingabe so aussehen:

```json
{
  "owner": "your-organization",
  "repo": "your-repository"
}
```

Maßgeblich ist das tatsächliche Schema des Workflows. Ein Zahlenfeld braucht eine JSON-Zahl, keinen Text in Anführungszeichen. Prüfe auch den Projektumfang, wenn ein Projektwähler angeboten wird.

**Testlauf** führt die gewählte gespeicherte Version mit deterministischen Mocks aus. Er sendet keine E-Mails und ändert keine externen Datensätze. Ein Entwurf lässt sich vor der Bereitstellung testen. Ein erfolgreicher Mock prüft keine echten Zugangsdaten oder externen Dienste.

<Frame caption="Hat der Workflow Eingaben, gib JSON an und prüfe sein Schema vor dem Teststart.">

![Der Testlauf-Dialog zeigt JSON-Werte für owner und repo und das aufgeklappte Eingabeschema.](/images/platform/automation-run-input.webp)

</Frame>

## Bereitstellen und live ausführen

Wähle die getestete Fassung unter **Version** und klicke auf **Diese Version live schalten**. Die Kennzeichnung **Live** markiert die bereitgestellte Version. Sind die gespeicherten Tests einer Version fehlgeschlagen, lässt sie sich nicht bereitstellen. Behebe die Ursache und speichere eine neue Version.

**Live ausführen** startet die bereitgestellte Version, auch wenn du eine andere ansiehst. Die Bestätigung zeigt den Umfang und bei Bedarf **Eingabe für den Lauf (JSON)** für genau diese Version. Prüfe beides vor dem Bestätigen. Live-Läufe können verbundene Systeme verändern und auf eine [Freigabe](/de/platform/approvals/concepts) warten.

Ein Trigger nutzt ebenfalls die bereitgestellte Version. Richte ihn ein, wenn wiederholte oder extern ausgelöste Läufe gewünscht sind; siehe [Automatisierungstrigger](/de/platform/automations/triggers).

## Ein Ergebnis untersuchen

**Letzten Lauf anzeigen** legt Laufzustände über den Canvas. Wähle einen Knoten für die Angaben zu diesem Lauf: aufgelöste Eingabe, Ausgabe und Effekte. Häufig findest du so eine falsche Referenz. Vergleiche die Eingabe des fehlgeschlagenen Knotens mit der Ausgabe seiner Quelle.

Wechsle zu **Läufe** und öffne den vollständigen Datensatz. Die Tabs bleiben sichtbar; **Läufe** ist aktiv. Mit **Editor** kehrst du zum Workflow zurück. Prüfe Test- oder Live-Modus und bereits ausgeführte Aktionen, bevor du erneut startest. [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklärt Wartezustände, Fehler, automatische Wiederholungen und Abbruch.

## Zu einer früheren Version zurückkehren oder löschen

Öffne für eine Rückkehr **Versionen**, lies die Versionsnachrichten und wähle eine frühere Fassung. Die Zeile öffnet den **Editor** mit dieser Version. Klicke dort auf **Diese Version live schalten**. Du kannst die frühere Fassung auch im Menü **Version** des Editors wählen. Künftige Starts verwenden sie; der Versionsverlauf bleibt erhalten. Eine Nachricht wie „Vorherige Empfängerzuordnung wiederherstellen“ macht die Entscheidung nachvollziehbar.

Zum Löschen gehe zur Liste zurück, öffne das Zeilenmenü und wähle **Löschen**. Lies die Bestätigung mit dem Namen der Automatisierung. Versionen, Bereitstellung, Trigger und Projektzuordnungen werden entfernt. Ein offener Lauf blockiert das Löschen; beende ihn oder warte seinen Abschluss ab. Frühere Läufe unterliegen weiter der Aufbewahrung. Bereits ausgeführte Aktionen werden durch das Löschen nicht rückgängig gemacht.
