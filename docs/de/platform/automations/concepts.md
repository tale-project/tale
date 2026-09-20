---
title: Automatisierungskonzepte
description: Verstehe Workflow-Schritte, gespeicherte Versionen, Bereitstellung, Trigger und den Verlauf einzelner Läufe.
---

Nutze eine Automatisierung für Arbeit mit einem wiederholbaren Ablauf. Der Workflow beschreibt die Schritte; gespeicherte Versionen erhalten jede Fassung, die Bereitstellung wählt die Version für Live-Läufe und ein Trigger kann sie nach Zeitplan oder Ereignis starten. Jeder Lauf zeigt Eingabe, Ergebnisse und Aktionen.

Lieber erst zusehen? Episode 5 öffnet die Triage-Automatisierung von vorne bis hinten und entscheidet eine Freigabekarte vor der Kamera, mit Untertiteln — aufgenommen auf der früheren Version, wo die Karte im Chat saß; in dieser Version sitzt sie auf der Detailseite des Laufs.

<Video src="/videos/de/tutorials/ep5-automations/ep5-automations.de.mp4" poster="/videos/de/tutorials/ep5-automations/ep5-automations.de.webp" captions="/videos/de/tutorials/ep5-automations/ep5-automations.de.vtt" lang="de" title="Episode 5 — Automatisierungen & Freigaben" caption="Episode 5 — Automatisierungen & Freigaben (3:11)">

</Video>

## Das Workflow-Dokument

Der `name` identifiziert die Automatisierung. Verwende kleingeschriebene Segmente mit Bindestrichen; `/` fasst verwandte Automatisierungen in Ordnern zusammen, etwa `billing/dunning-reminder`. Das erste Segment darf kein reservierter Seitenname sein: `asks`, `builder`, `catalog`, `listing`, `metrics`, `runs`, `serving-preview` oder `upload`.

Das Dokument enthält außerdem eine `description`, ein JSON-Schema `inputs` für die Eingabe eines Laufs, die ausführenden `nodes` und einen `output`-Ausdruck für das Ergebnis. Seine `tests` beschreiben Beispiele und erwartete Ergebnisse, die vor der Bereitstellung geprüft werden.

```yaml
name: billing/dunning-reminder
description: Einen Kunden an eine überfällige Rechnung erinnern.
inputs:
  type: object
  properties:
    invoiceId: { type: string }
  required: [invoiceId]
nodes:
  - id: invoice
    type: transform
    input:
      id: '{{ input.invoiceId }}'
    code: 'return { id: input.id, daysLate: 14 };'
  - id: message
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Schreibe eine höfliche Erinnerung zu Rechnung {{ nodes.invoice.output.id }}.'
output:
  text: '{{ nodes.message.output.text }}'
tests:
  - name: erzeugt eine Erinnerung
    input: { invoiceId: 'inv-1' }
```

Der `ui`-Block speichert die Positionen auf dem Canvas. Verschieben ändert die Anordnung, nicht die Ausführung einer Node.

### Kanten entstehen, sie werden nicht deklariert

Es gibt keine Kantenliste. Eine Node liest eine andere, indem sie sie referenziert — `{{ nodes.invoice.output.id }}` —, und genau diese Referenz _ist_ die Kante, die der Canvas zeichnet. Die Reihenfolge ergibt sich aus einer topologischen Sortierung über diese abgeleiteten Kanten. Deshalb verschwindet mit einer gelöschten Referenz auch ein Pfeil, und deshalb weist die Plattform zwei Nodes zurück, die einander lesen.

Templates nutzen eine einzige `{{ }}`-Grammatik aus JavaScript-Ausdrücken über `input`, `nodes.<id>.output` und, innerhalb einer iterierenden Node, `item` und `index`.

### Die Ablaufsteuerung sitzt an der Node

Verzweigen und Wiederholen sind Felder an einer Node statt eigener Schritttypen. Der Canvas zeigt sie deshalb als Badges an genau der Box, die sie betreffen.

| Feld                         | Wirkung                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `when`                       | Die Node läuft nur, wenn der Ausdruck wahr ist; abhängige Nodes werden mit übersprungen |
| `elseOf`                     | Läuft genau dann, wenn die genannte Node durch ihr eigenes `when` übersprungen wurde    |
| `forEach`                    | Läuft einmal pro Element einer Sammlung, mit `item` und `index` im Zugriff              |
| `repeatUntil` / `maxRepeats` | Wiederholt, bis der Ausdruck wahr ist, mit Deckel (Standard 5, Maximum 20)              |
| `onError`                    | `fail` bricht den Lauf ab; `continue` notiert den Fehler und überspringt Abhängige      |

### Node-Typen

Vier Typen sind eingebaut, und jede Connector-Aktion sowie jede Plattformfunktion — Wissenssuche, Dokumentoperationen — reiht sich in dieselbe Tabelle daneben ein.

**`transform`** führt reines JavaScript aus, um Daten umzuformen. Ohne Netzwerk und ohne Imports: Der Rumpf liest die aufgelöste `input` der Node und muss einen Wert zurückgeben.

**`llm`** ruft ein Sprachmodell mit einem Prompt-Template auf. `model` ist Pflicht und immer ausdrücklich — eine Automatisierung wählt nie eines für dich (das Auto der Chat-Eingabezeile ist eine reine Chat-Sache). Die Ausgabe ist `{text}` oder das Objekt in Form des Schemas, wenn die Node ein `outputSchema` deklariert.

**`agent`** führt einen Agent-Turn eines Coding-Agents (Claude Code, Codex und die übrigen Harnesses) in der Sandbox aus. Er liest bereitgestellte `files`, nutzt `skills`, vermittelte `connectors`, gewährte Plattform-`tools` und eingespielte `secrets` und gibt `{text, files, status}` zurück; `model` ist Pflicht. Greif zu `llm`, wenn eine einmalige Completion reicht, und zu `agent` nur, wenn der Schritt Werkzeuge, Dateien oder mehrere Turns braucht — eine live geschaltete Agent-Node läuft als asynchroner Turn, sitzt daher auf der obersten Ebene statt in einer `subautomation` und iteriert nicht mit `forEach`.

**`subautomation`** führt eine andere gespeicherte Automatisierung als einzelne Node aus; ihr Feld `automation` benennt `"name"` oder `"name@version"`. Ohne Version läuft die live geschaltete, und die Verschachtelung endet bei drei Ebenen.

### Strukturierte und unstrukturierte Ausgabe

Eine **strukturierte** Ausgabe hat benannte Felder, die du über `nodes.<id>.output.<field>` referenzierst. Eine **unstrukturierte** Ausgabe enthält freien Text. Verwende dafür `nodes.<id>.output.text` in einem Textausdruck; behandle die Ausgabe nicht wie ein Objekt mit weiteren Feldern.

Ein Werkzeug ohne Ausgabeschema liefert unstrukturierte Ausgabe. Soll daraus strukturierte Eingabe für weitere Schritte entstehen, nutze eine `llm`-Node mit `outputSchema`. Die Validierung nennt bei einem Fehler die ungültige Referenz und die zulässigen Felder oder Kontexte. Korrigiere die Referenz, bevor du erneut speicherst.

## Versionen ändern sich nie

Speichern legt eine neue Version an, statt die vorige zu überschreiben. Die Nummerierung beginnt für jede Automatisierung bei 1; jede Version enthält die Änderungsnotiz ihres Autors. Der Workflow einer vorhandenen Version bleibt unverändert.

Ein laufender Workflow behält die Version, mit der er gestartet wurde. Spätere Bearbeitungen ändern seine Schritte nicht. Öffne bei der Prüfung eines älteren Laufs dessen aufgezeichnete Version, um Eingabe und Ablauf zu vergleichen. Unveränderlichkeit ist keine unbegrenzte Aufbewahrung: Beim Löschen einer Automatisierung oder ihrer Historie können die Datensätze entfernt werden.

## Live-Schalten ist ein eigener Schritt

Genau eine Version pro Automatisierung ist live, und diese Version führen die Trigger aus. Eine Version live zu schalten oder auf eine ältere zurückzugehen ist ein einzelner Schritt, der keine Historie umschreibt — die Versionsliste bleibt exakt, wie sie war, und nur der Zeiger wandert. Eine Automatisierung darf auch gar nichts live haben und rein als Entwurf existieren.

Eine Version mit einem fehlgeschlagenen Test lässt sich nicht live schalten; eine Version, deren Tests bestanden sind oder die gar keine Tests hat, schon. Tests liegen im Dokument: Jeder hat einen Namen, eine Eingabe und Erwartungen an die Ausgabe sowie an die Auswirkungen, die der Lauf erzeugen soll. Ob die Tests einer Version bestanden waren, wird beim Speichern festgehalten — das Live-Schalten liest diese festgehaltene Tatsache, statt die Suite erneut laufen zu lassen.

<Note>

Ein Live-Lauf braucht eine bereitgestellte Version. Einen gespeicherten Entwurf kannst du vorher mit **Testlauf** prüfen.

</Note>

## Was einen Lauf startet

Eine gespeicherte Version kannst du manuell testen; die bereitgestellte Version lässt sich live ausführen. Für automatische Starts richtest du eine von drei Trigger-Arten ein: einen Zeitplan mit Cron-Ausdruck und IANA-Zeitzone, eine durch ein Token geschützte Webhook-URL oder ein benanntes Plattformereignis.

Der Trigger gehört zum Namen der Automatisierung. Bei einer neuen Bereitstellung bleiben Konfiguration und Webhook-URL erhalten; nachfolgende Starts verwenden die neu bereitgestellte Version. Deaktiviere den Trigger, um automatische Starts zu pausieren. [Workflow-Trigger](/de/platform/automations/triggers) erklärt Zeitsteuerung, Anmeldung und die Eingabe jeder Trigger-Art.

## Was ein Lauf festhält

Ein Lauf speichert Status (`queued`, `running`, `waiting`, `success`, `failed` oder `cancelled`), Modus, Auslöser, Eingabe, Ausgabe und einen Checkpoint für jede abgeschlossene Node. Die Ablaufspur zeigt die vom Ausführungssystem versuchten Schritte.

Gibt die Verarbeitung vorübergehend ab, setzt derselbe Lauf anhand seiner Checkpoints fort, ohne abgeschlossene Nodes erneut auszuführen. Die Liste der Auswirkungen erfasst Connector-Schreibaktionen. Sie ist kein vollständiges Verzeichnis der Änderungen durch eine Sandbox oder direkte Werkzeuge. Für die Laufhistorie gelten weiterhin Löschung und Aufbewahrungseinstellungen.

Im Modus **Test** werden externe Aktionen simuliert. **Live** kann sie tatsächlich ausführen und benötigt zum Starten Entwicklerrechte. Unter [Ausführungsprotokolle](/de/platform/automations/execution-logs) erfährst du, wie du gespeicherte Version, aufgelöste Eingaben, Fehler und protokollierte Auswirkungen prüfst.

## Wo ein Mensch entscheidet

Eine erforderliche Freigabe hält den Lauf vor einer geschützten Schreibaktion im Status `waiting` an. Die Freigabe erlaubt den Ausführungsversuch, garantiert aber keinen Erfolg. Ablehnen verhindert die Aktion und lässt den Lauf fehlschlagen. Eine Frage pausiert ebenfalls, verlangt jedoch Informationen statt einer Erlaubnis.

Der Status `waiting` kann auch bedeuten, dass ein Agent noch arbeitet oder eine Node ihre Bedingung wiederholt prüft. Lies deshalb `waitingFor`: `approval` und `ask` brauchen eine Person; `agent` und `repeat` setzen normalerweise automatisch fort. [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows) erklärt, wie du die menschlichen Anfragen prüfst und beantwortest.

## Chat, Aufgabe oder Automatisierung wählen

| Bedarf | Nutze |
| --- | --- |
| Eine Frage stellen und die Antwort besprechen | Chat |
| Ein geprüftes Ergebnis mit Zuständigkeit erstellen | Eine Projektaufgabe, bei Bedarf einem Agenten zugewiesen |
| Abhängige Schritte ausführen oder auf Zeitplan, Webhook oder Ereignis reagieren | Eine Automatisierung |

Prüfe vor dem Erstellen die [mitgelieferten Automatisierungen](/de/platform/automations/builtin). Ein Webhook startet eine Automatisierung; er ist keine eigene Art von Projektagent.

## Das Modell in die Praxis bringen

Workflow, Versionen, Bereitstellung und Trigger sind getrennte Bestandteile einer Automatisierung. Folge dem [Workflow-Editor](/de/platform/automations/editor), um eine Änderung zu testen und live zu schalten. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) zeigen, was ein Lauf getan hat.
