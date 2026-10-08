---
title: So wird die Nutzung gezählt
description: Wem ein Chat, ein Agentenlauf oder eine Sprachanfrage angerechnet wird, welche Limits gelten und wo sie in der Nutzungsanalyse erscheinen.
---

Jede KI-Anfrage, die Tale für deine Organisation stellt, wird einmal erfasst, einer Person zugeordnet und an den [Budgetregeln](/de/platform/admin/governance/policies-and-limits) gemessen, die für diese Person gelten. Diese Seite erklärt, wer diese Person bei jeder Art von Arbeit ist, gegen welche Limits die Arbeit zählt und wo du sie in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) findest. Mitglieder sehen ihren eigenen Anteil unter [Einstellungen > Nutzung](/de/platform/member/preferences#usage-limits).

## Was als Nutzung zählt

Tale erfasst eine Anfrage, sobald ein Modell oder ein gemessener Dienst für deine Organisation läuft: eine Chatantwort, auch eine neu erzeugte oder bearbeitete und beide Seiten eines Modellvergleichs; der kurze Modellaufruf, der einem neuen Chat seinen Titel gibt; ein Zug eines verwalteten Agenten, der an einer Aufgabe oder in einer Automatisierung arbeitet; ein Bild, das ein solcher Agent erstellt; Sprachausgabe; die Transkription einer hochgeladenen Aufnahme; ein gemessener Connector-Aufruf; und ein Aufruf der Modell-Endpunkte mit einem API-Schlüssel. Jeder Eintrag enthält die verbrauchten Tokens oder Einheiten und die Kosten, die zu diesem Zeitpunkt aus dem Listenpreis des Anbieters geschätzt wurden; bei einem Aufruf der Modell-Endpunkte sind es die Kosten, die das Modell-Gateway gemessen hat.

## Wem eine Anfrage angerechnet wird

Die Regel ist überall dieselbe: Eine Anfrage zählt für die Person, die die Arbeit angestoßen hat. Der Weg, über den sie kam, etwa die App, die REST-API, der MCP-Endpoint oder die Modell-Endpunkte, ändert daran nichts.

| Arbeit | Zählt für | Zählt zusätzlich für | Erscheint in der Nutzungsanalyse als |
| --- | --- | --- | --- |
| Eine Chatantwort oder der Titel eines neuen Chats | Das Mitglied, das die Nachricht gesendet hat | Den API-Schlüssel, wenn die Nachricht über die REST-API kam | Der verwendete Assistent; ein Titel unter `thread-title` |
| Ein Agentenlauf zu einer Aufgabe | Das Mitglied, das den Lauf aus der Aufgabe gestartet hat oder mit einem Kommentar oder einer Aufgabenbeschreibung, die den Agenten erwähnt; bei einem Lauf, den ein anderer Agent oder ein Automatisierungsschritt gestartet hat, das Mitglied, für das der Lauf dieses Agenten oder dieser Automatisierung zählt | — | Der Name des Agenten unter **Top-Assistenten** |
| Ein Automatisierungslauf, den jemand gestartet hat | Das Mitglied, das ihn aus der Laufliste, dem Builder, einem Chat, einer Aufgabe, über die REST-API oder den MCP-Endpoint gestartet hat | Den API-Schlüssel, wenn der Lauf mit einem gestartet wurde | Der Name der Automatisierung unter **Top-Assistenten** |
| Ein Automatisierungslauf, den ein Trigger gestartet hat | Niemanden: Hinter einem Zeitplan, einem Webhook oder einem Ereignis steht keine Person | — | Die Zeile **Automatisierungen (Trigger)** unter **Nutzung pro Benutzer** |
| Ein Lauf eines Projektagenten, den ein Zeitplan begonnen hat, oder einer, den ein anderer Agent aus einem solchen Lauf heraus gestartet hat | Niemanden, wie beim Lauf, den der Zeitplan selbst gestartet hat | — | Die Zeile **Automatisierungen (Trigger)** unter **Nutzung pro Benutzer** und der Name des Agenten unter **Top-Assistenten** |
| Ein Bild, das ein Agent erstellt | Die Person, für die der Lauf des Agenten zählt: wer ihn gestartet hat, bei einem Trigger-Lauf niemand | Den API-Schlüssel, wenn der Lauf mit einem gestartet wurde | Der Name des Agenten oder der Automatisierung unter **Top-Assistenten** und das Bildmodell unter **Top-Modelle** |
| Sprachausgabe oder eine Transkription | Das Mitglied, das sie angefordert hat | — | **Sprachausgabe** oder **Transkription** unter **Top-Assistenten**; Sprachausgabe zusätzlich unter **Top-Sprachmodelle** |
| Ein gemessener Connector-Aufruf | Das Mitglied, dessen Anfrage den Aufruf ausgelöst hat | — | Der Assistent, der ihn gemacht hat, oder **Connector** |
| Ein Aufruf der [Modell-Endpunkte](/de/develop/use-tale-from-your-editor#model-endpoints) | Das Mitglied, dessen API-Schlüssel ihn gesendet hat | Den API-Schlüssel | **Direkter API-Aufruf** unter **Top-Assistenten** |

Ein erneuter Versuch eines Agentenlaufs führt den Lauf fort, den sein Starter angestoßen hat; seine Nutzung bleibt deshalb bei dieser Person. Handelt eine Integration mit einem API-Schlüssel für ein anderes Mitglied, zählt der Lauf für dieses Mitglied, und das Limit des Schlüssels zählt ihn ebenfalls.

Ein API-Schlüssel, den ein Admin für ein Mitglied erstellt hat, zählt für dieses Mitglied, wie dessen eigener Schlüssel. Ein Schlüssel, der einem Team, einem Projekt oder der Organisation gehört ([API-Schlüssel](/de/platform/admin/api-keys#create-a-key-for-someone-else)), ist keine Person: Was er anstößt, zählt für den Schlüssel selbst. Die Nutzungsanalyse zeigt ihn als eigene Zeile unter **Nutzung pro Benutzer**, unter dem Namen des Schlüssels mit seinem Team, seinem Projekt oder der Organisation darunter, und zählt ihn nie als aktive Person. Der Schlüssel eines Teams zählt zusätzlich für die Nutzung seines Teams.

## Welche Limits gelten

- **Persönliche, Team- und Rollenlimits** binden die Person, der eine Anfrage angerechnet wird. Ein Lauf, den ein Zeitplan, ein Webhook oder ein Ereignis gestartet hat, hat keine solche Person und wird an keinem davon gemessen. Ebenso wenig der eigene Schlüssel eines Teams, eines Projekts oder der Organisation, außer dass der Schlüssel eines Teams an das Limit seines Teams gebunden ist.
- **Organisationslimits** binden jede Anfrage, auch die Läufe eines Triggers.
- **API-Schlüssellimits** binden die Anfragen, die mit diesem Schlüssel authentifiziert wurden: die damit gesendeten Chatnachrichten, die damit gestellten Aufrufe der Modell-Endpunkte und die damit gestarteten Läufe.

Ist ein Limit erreicht, lehnt Tale die nächste Anfrage vor der Ausführung ab und nennt das Limit. Ein Zug eines verwalteten Agenten wird beim Start abgelehnt; ein bereits laufender Zug behält den Rahmen, den er bekommen hat. Ein Bild, das der Agent während seines Zugs anfordert, wird eigens geprüft, bevor das Bildmodell aufgerufen wird: Ist ein Limit erreicht, lehnt Tale das Bild ab, und der Zug läuft weiter. Das Bild zehrt außerdem vom Rahmen des Zugs, der es angefordert hat. [So werden Regeln kombiniert](/de/platform/admin/governance/policies-and-limits#how-rules-combine) beschreibt den Fall, dass mehrere Regeln für eine Person gelten.

## Drei Situationen, die du kennen solltest

**Ein Teammitglied erwähnt deinen Agenten in einem Aufgabenkommentar oder in einer Aufgabenbeschreibung.** Der gesendete Kommentar oder die gespeicherte Beschreibung startet einen Lauf, und dieser zählt für das Teammitglied, von dem der Text stammt, nicht für dich als Ersteller des Agenten.

**Eine geplante Automatisierung gibt jede Nacht Geld aus.** Ihre Läufe erscheinen in der Zeile **Automatisierungen (Trigger)**. Sie erhöhen weder die persönliche Nutzung von jemandem noch die Zahl der aktiven Benutzer, und nur die Organisationslimits können sie stoppen. Lege ein Kosten- oder Anfragelimit für die Organisation fest, wenn du eine Obergrenze dafür brauchst.

**Eine Integration nutzt einen API-Schlüssel im Namen eines Mitglieds.** Die persönlichen und Team-Limits des Mitglieds sehen den Lauf, und das Limit des Schlüssels ebenfalls. Zwei Obergrenzen gelten, und die strengere lehnt zuerst ab.

## Was Mitglieder sehen

**Einstellungen > Nutzung** zeigt jedes Limit, das für das angemeldete Mitglied gilt, mit dem aktuellen Verbrauch: die gesendeten Chats, die angeforderten Sprachausgaben, die Aufrufe der Modell-Endpunkte und die gestarteten Agentenläufe, egal auf welchem Weg sie gestartet wurden. Geteilte Team- und Organisationslimits stehen ebenfalls dort, weil sie vor einem persönlichen Limit erreicht sein können.
