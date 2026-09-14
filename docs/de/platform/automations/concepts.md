---
title: Automatisierungskonzepte
description: Das Modell hinter jeder Automatisierung — ein Workflow-Dokument, eine Versionshistorie, die sich nie ändert, genau eine live geschaltete Version, die Trigger, die sie starten, und die Läufe, die sie aufzeichnet.
---

Nutze eine Automatisierung für Arbeit mit einem wiederholbaren Ablauf. Der Workflow beschreibt die Schritte; gespeicherte Versionen erhalten jede Fassung, die Bereitstellung wählt die Version für Live-Läufe und ein Trigger kann sie nach Zeitplan oder Ereignis starten. Jeder Lauf zeigt Eingabe, Ergebnisse und Aktionen.

Lieber erst zusehen? Episode 5 öffnet die Triage-Automatisierung von vorne bis hinten und entscheidet eine Freigabekarte vor der Kamera, mit Untertiteln — aufgenommen auf der früheren Version, wo die Karte im Chat saß; in dieser Version sitzt sie auf der Detailseite des Laufs.

<Video src="/videos/de/tutorials/ep5-automations/ep5-automations.de.mp4" poster="/videos/de/tutorials/ep5-automations/ep5-automations.de.webp" captions="/videos/de/tutorials/ep5-automations/ep5-automations.de.vtt" lang="de" title="Episode 5 — Automatisierungen & Freigaben" caption="Episode 5 — Automatisierungen & Freigaben (3:11)">

</Video>

## Das Workflow-Dokument

Alles, was eine Automatisierung tut, steht in einem einzigen Dokument. Sein `name` ist zugleich seine Identität — kleingeschriebene Slug-Segmente mit Bindestrichen, wobei `/` verwandte Automatisierungen zu Ordnern gruppiert, etwa `billing/dunning-reminder`. Das erste Segment darf keines der Wörter sein, die die Plattform für eigene Seiten braucht — `asks`, `builder`, `catalog`, `listing`, `metrics`, `runs`, `serving-preview`, `upload` —, denn eine so benannte Automatisierung ließe sich speichern, aber nie öffnen; deshalb lehnt der Editor einen solchen Namen beim Speichern ab. Um den Namen herum stehen eine `description`, ein `inputs`-JSON-Schema für die Eingabe zur Laufzeit, die `nodes`, die die Arbeit erledigen, ein `output` als Rückgabewert und die `tests`, die darüber entscheiden, ob eine Version live gehen darf.

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

Die Positionen auf dem Canvas reisen in einem `ui`-Block mit, den die Engine ignoriert — eine Box zu verschieben ändert also nie das Verhalten.

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

Vier Typen sind eingebaut, und jede Connectorsaktion sowie jede Plattformfunktion — Wissenssuche, Dokumentoperationen — reiht sich in dieselbe Tabelle daneben ein.

**`transform`** führt reines JavaScript aus, um Daten umzuformen. Ohne Netzwerk und ohne Imports: Der Rumpf liest die aufgelöste `input` der Node und muss einen Wert zurückgeben.

**`llm`** ruft ein Sprachmodell mit einem Prompt-Template auf. `model` ist Pflicht und immer ausdrücklich — eine Automatisierung wählt nie eines für dich (das Auto der Chat-Eingabezeile ist eine reine Chat-Sache). Die Ausgabe ist `{text}` oder das Objekt in Form des Schemas, wenn die Node ein `outputSchema` deklariert.

**`agent`** führt einen Agent-Turn eines Coding-Agents (Claude Code, Codex und die übrigen Harnesses) in der Sandbox aus. Er liest bereitgestellte `files`, nutzt `skills`, vermittelte `connectors`, gewährte Plattform-`tools` und eingespielte `secrets` und gibt `{text, files, status}` zurück; `model` ist Pflicht. Greif zu `llm`, wenn eine einmalige Completion reicht, und zu `agent` nur, wenn der Schritt Werkzeuge, Dateien oder mehrere Turns braucht — eine live geschaltete Agent-Node läuft als asynchroner Turn, sitzt daher auf der obersten Ebene statt in einer `subautomation` und iteriert nicht mit `forEach`.

**`subautomation`** führt eine andere gespeicherte Automatisierung als einzelne Node aus; ihr Feld `automation` benennt `"name"` oder `"name@version"`. Ohne Version läuft die live geschaltete, und die Verschachtelung endet bei drei Ebenen.

### Strukturierte und unstrukturierte Ausgabe

Die Ausgabe jedes Node-Typs ist von einer von zwei Arten, und daran stolpern Autoren am häufigsten. Eine **strukturierte** Ausgabe ist eine typisierte Form, in die du mit `nodes.<id>.output.<field>` hineingreifen darfst. Eine **unstrukturierte** Ausgabe ist freier Text: Es existiert nur `nodes.<id>.output.text`, und das nur im Textkontext. Ein Werkzeug ohne deklariertes Ausgabeschema ist per Definition unstrukturiert, und die eine vorgesehene Brücke von Text zu strukturierten Daten ist eine `llm`-Node mit `outputSchema`.

Die Validierung weist den Fehler zurück, statt ihn erst zur Laufzeit auftauchen zu lassen, und jede Meldung trägt einen maschinenlesbaren Code sowie einen Hinweis darauf, was tatsächlich verfügbar ist. Diesen Hinweis zu lesen ist der Weg, die Form zu finden, die du referenzieren wolltest.

## Versionen ändern sich nie

Speichern hängt eine neue Version an; es überschreibt nie eine bestehende. Versionen sind ab 1 nummeriert und bleiben je Automatisierung lückenlos, und jede trägt die Notiz, die ihr Autor zur Änderung geschrieben hat. Version 3 einer Automatisierung ist deshalb für immer dasselbe Dokument.

Daraus folgt zweierlei. Eine Automatisierung zu bearbeiten kann nicht stören, was gerade läuft, denn die laufende Version ist eine andere Zeile. Und ein Lauf, der letzten Monat fehlgeschlagen ist, lässt sich gegen genau das Dokument lesen, das ihn erzeugt hat — dieses Dokument existiert unverändert weiter.

## Live-Schalten ist ein eigener Schritt

Genau eine Version pro Automatisierung ist live, und diese Version führen die Trigger aus. Eine Version live zu schalten oder auf eine ältere zurückzugehen ist ein einzelner Schritt, der keine Historie umschreibt — die Versionsliste bleibt exakt, wie sie war, und nur der Zeiger wandert. Eine Automatisierung darf auch gar nichts live haben und rein als Entwurf existieren.

Eine Version wird erst live-fähig, wenn ihre eigenen Tests bestanden sind. Tests liegen im Dokument: Jeder hat einen Namen, eine Eingabe und Erwartungen an die Ausgabe sowie an die Auswirkungen, die der Lauf erzeugen soll. Ob die Tests einer Version bestanden waren, wird beim Speichern festgehalten — das Live-Schalten liest diese festgehaltene Tatsache, statt die Suite erneut laufen zu lassen.

<Note>

Ein Live-Lauf braucht eine bereitgestellte Version. Einen gespeicherten Entwurf kannst du vorher mit **Testlauf** prüfen.

</Note>

## Was einen Lauf startet

Ein Trigger sagt, was eine Automatisierung starten darf, und es gibt genau drei Arten: einen **schedule** (ein Cron-Ausdruck, gelesen in einer benannten IANA-Zeitzone), einen **webhook** (eine eingehende URL, geschützt durch ein Token) und ein **event** (der Name eines Plattform-Ereignisses).

Ein Trigger hängt am **Namen** der Automatisierung, nie an einer Version. Eine neue Version live zu schalten macht deshalb nie eine Webhook-URL ungültig, auf die ein externes System angewiesen ist, und wirft nie einen Zeitplan weg, auf den sich jemand verlässt. Jeder Trigger lässt sich aus- und wieder einschalten, ohne verloren zu gehen, und jeder hält fest, wann der Scheduler zuletzt auf ihn reagiert hat. [Workflow-Trigger](/de/platform/automations/triggers) behandelt, was jede Art in den Lauf trägt.

## Was ein Lauf festhält

Ein Lauf ist ein dauerhaftes Objekt, keine Logzeile. Er hält seinen Status — `queued`, `running`, `waiting`, `success`, `failed` oder `cancelled` —, seinen Modus, was ihn gestartet hat, die empfangene Eingabe, die erzeugte Ausgabe und einen **Checkpoint für jede abgeschlossene Node**.

Diese Checkpoints sind der Kern. Ein Live-Lauf geht Node für Node vor, und wenn er an das Zeitfenster der Plattform stößt, gibt er sich zurück und setzt bei der letzten abgeschlossenen Node fort, statt bereits erledigte Nebenwirkungen zu wiederholen. Ein Lauf bewahrt außerdem die vollständige Spur der Engine und die geordnete Liste der Auswirkungen, die er erzeugt hat — das ist es, was den Canvas den Lauf nachzeichnen lässt und was jede Veränderung außerhalb der Plattform nachträglich prüfbar hält.

Läufe gibt es in zwei Modi. **Test** berührt die Außenwelt nie und ist die schnelle Rückmeldeschleife beim Bauen. **Live** darf es, weshalb einen solchen Lauf zu starten eine Entwickler-Berechtigung braucht. [Ausführungsprotokolle](/de/platform/automations/execution-logs) liest einen Lauf von Anfang bis Ende.

## Wo ein Mensch entscheidet

Ein Lauf, der eine Freigabe braucht, schlägt nicht fehl und startet nicht neu. Er pausiert im Status `waiting`, und sobald die Freigabe beantwortet ist, setzt er an genau der Node wieder ein, an der er stehen geblieben war, und trägt die Antwort weiter. Ein Lauf, der auf eine menschliche Eingabe wartet, verhält sich genauso. In `waiting` parkt ein Lauf auch, solange ein Agent-Turn noch arbeitet oder eine Node pollt, bis ihre Bedingung gilt — die brauchen niemanden, und der Lauf nennt, in welcher Art Warten er steckt (`waitingFor`: `approval`, `ask`, `agent` oder `repeat`), „braucht eine Person“ liest sich also nie am Status allein ab. [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) behandelt die Kontrollpunkte und was jede Entscheidung hinterlässt.

## Chat, Aufgabe oder Automatisierung wählen

| Bedarf | Nutze |
| --- | --- |
| Eine Frage stellen und die Antwort besprechen | Chat |
| Ein geprüftes Ergebnis mit Zuständigkeit erstellen | Eine Projektaufgabe, bei Bedarf einem Agenten zugewiesen |
| Abhängige Schritte ausführen oder auf Zeitplan, Webhook oder Ereignis reagieren | Eine Automatisierung |

Prüfe vor dem Erstellen die [mitgelieferten Automatisierungen](/de/platform/automations/builtin). Ein Webhook startet eine Automatisierung; er ist keine eigene Art von Projektagent.

## Das Modell in die Praxis bringen

Workflow, Versionen, Bereitstellung und Trigger sind getrennte Bestandteile einer Automatisierung. Folge dem [Workflow-Editor](/de/platform/automations/editor), um eine Änderung zu testen und live zu schalten. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) zeigen, was ein Lauf getan hat.
