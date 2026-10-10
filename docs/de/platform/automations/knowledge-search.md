---
title: Dein Wissen aus einer Automatisierung durchsuchen
description: Finde mit dem Schritt knowledge.search die Passagen deiner Dokumente und indexierten Websites, die zu einer Frage passen, verwende sie in einem späteren Schritt und erfahre, was eine Suche lesen darf.
---

Verwende einen `knowledge.search`-Schritt, wenn eine Automatisierung braucht, was deine Organisation schon weiß, etwa eine Richtlinie, ein Produktblatt oder eine Seite deines Hilfecenters, ohne einen Agent-Schritt. Er durchsucht deine [Dokumente](/de/platform/knowledge/documents), deine [indexierten Websites](/de/platform/knowledge/crawling) oder beides und gibt die Passagen zurück, die am besten zur Anfrage passen, die beste zuerst. Er ändert nichts und fragt deshalb nie nach einer Freigabe. Ein Testlauf antwortet mit einem Mock.

## Suchen, dann die Passagen verwenden

```yaml
nodes:
  - id: related
    type: knowledge.search
    input:
      query: '{{ input.question }}'
      corpus: documents
      limit: 3
  - id: answer
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Answer {{ input.question }} from these passages only, and say so when they do not answer it: {{ nodes.related.output.hits }}'
```

<Frame caption="Der Suchschritt im Editor: Seine Anfrage liest die Frage des Laufs, und er gibt seine Treffer an einen späteren Schritt weiter.">

![Der Tab Editor von Answer launch questions, live, mit No problems: Start, Related und End auf dem Canvas, Related ausgewählt, ein Schritt Knowledge · Search knowledge, der eine Liste von Treffern zurückgibt. Neben dem Canvas enthält sein Input limit 3, eine query, die die Frage der Laufeingabe liest, und corpus documents.](/images/platform/automation-knowledge-search-step.webp)

</Frame>

| Eingabe  | Was sie enthält                                                                        |
| -------- | -------------------------------------------------------------------------------------- |
| `query`  | Wonach gesucht wird, in Worten, bis zu 2.000 Zeichen.                                  |
| `limit`  | Wie viele Passagen zurückkommen: 1 bis 20, standardmäßig 5.                            |
| `corpus` | `documents`, `web` für deine indexierten Websites oder `all` für beides, der Standard. |
| `folder` | Nur Dokumente in diesem Ordner und den Ordnern darunter, etwa `/Policies/`.            |

Der Schritt gibt `{ hits }` zurück, die beste zuerst. Kein Treffer heißt, dass nichts gepasst hat, und der Schritt gelingt trotzdem. Jeder Treffer enthält:

| Feld         | Was es enthält                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `text`       | Die Passage, mit der Überschrift ihres Dokuments.                                                                        |
| `title`      | Der Titel des Dokuments oder der Seite, oder `null`.                                                                     |
| `source`     | `documents` oder `web`.                                                                                                  |
| `documentId` | Das Dokument, zu dem die Passage gehört.                                                                                 |
| `projectId`  | Das Projekt, in dem das Dokument abgelegt ist. Ein Dokument, das alle Mitglieder teilen, hat keines.                     |
| `url`        | Die Seite, von der eine Web-Passage stammt.                                                                              |
| `score`      | Der Rang, nach dem die Treffer geordnet sind.                                                                            |
| `similarity` | Wie nah die Bedeutung der Passage an der Anfrage liegt, näher an 1, je näher, wenn die Bedeutungssuche sie gefunden hat. |

Eine Suche behält jeden Treffer, den sie einordnet, so schwach er auch ist. Um schwache Treffer auszulassen, vergleiche `similarity` in einem späteren Schritt.

<Frame caption="Ein Live-Lauf in Website relaunch: Der Schritt hat die Frage des Laufs gelesen, die Dokumente durchsucht und drei Treffer zurückgegeben.">

![Die Seite eines erfolgreichen Live-Laufs von Answer launch questions mit ausgewähltem Schritt Related. Sein Tab Last run sagt, dass der Schritt knowledge.search ausgeführt und die question der Laufeingabe gelesen hat, What happens on launch day?, dass er limit 3, diese query und corpus documents erhalten und hits zurückgegeben hat, eine Liste mit 3 Einträgen.](/images/platform/automation-knowledge-search-run.webp)

</Frame>

## Was eine Suche liest

Eine Suche liest, was ihr Lauf lesen darf, nie das, was die Person sehen kann, die den Schritt geschrieben hat:

- Ein Lauf in einem Projekt liest die Dokumente dieses Projekts und die Dokumente, die alle Mitglieder teilen.
- Ein Lauf einer Automatisierung, die an Projekte gebunden ist und für die ganze Organisation gestartet wurde, liest die Dokumente dieser Projekte und die geteilten.
- Eine Automatisierung, die an kein Projekt gebunden ist, liest nur die Dokumente, die alle Mitglieder teilen.

Sie liest nie eine Team-Bibliothek, die dem Lauf nicht gegeben ist, und nie die Uploads und Mails einer Konversation. Das Embedding der Anfrage zählt zu den [Nutzungslimits](/de/platform/admin/governance/policies-and-limits), die für den Lauf gelten, und wird unter dem Namen der Automatisierung verbucht, wie der Aufruf eines `llm`-Schritts.

## Wenn eine Suche scheitert

Die Seite des Laufs sagt, warum ein Suchschritt gescheitert ist und wie du es behebst.

| Fehler                                         | Was geschehen ist                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Die Wissenssuche ist nicht eingerichtet**    | Die Organisation hat kein Embedding-Modell. Deine Administration wählt eines unter **Einstellungen › Datenresidenz**.                                   |
| **Die Wissenssuche ist fehlgeschlagen**        | Der Anbieter des Embedding-Modells hat den Aufruf abgelehnt oder ist dabei fehlgeschlagen.                                                              |
| **Ein Nutzungslimit hat den Schritt gestoppt** | Ein Limit, das für den Lauf gilt, hat keinen Spielraum mehr. Es zählt als Limit, nicht als Fehler, der sich wiederholt, deshalb pausiert kein Zeitplan. |
