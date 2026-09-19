---
title: So wird die Nutzung gezählt
description: Wem ein Chat, ein Agentenlauf oder eine Sprachanfrage angerechnet wird, welche Limits gelten und wo sie in der Nutzungsanalyse erscheinen.
---

Jede KI-Anfrage, die Tale für deine Organisation stellt, wird einmal erfasst, einer Person zugeordnet und an den [Budgetregeln](/de/platform/admin/governance/policies-and-limits) gemessen, die für diese Person gelten. Diese Seite erklärt, wer diese Person bei jeder Art von Arbeit ist, gegen welche Limits die Arbeit zählt und wo du sie in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) findest. Mitglieder sehen ihren eigenen Anteil unter [Einstellungen > Nutzung](/de/platform/member/preferences#usage-limits).

## Was als Nutzung zählt

Tale erfasst eine Anfrage, sobald ein Modell oder ein gemessener Dienst für deine Organisation läuft: eine Chatantwort, auch eine neu erzeugte oder bearbeitete und beide Seiten eines Modellvergleichs; der kurze Modellaufruf, der einem neuen Chat seinen Titel gibt; ein Zug eines verwalteten Agenten, der an einer Aufgabe oder in einer Automatisierung arbeitet; Sprachausgabe; die Transkription einer hochgeladenen Aufnahme; und ein gemessener Connector-Aufruf. Jeder Eintrag enthält die verbrauchten Tokens oder Einheiten und die Kosten, die zu diesem Zeitpunkt aus dem Listenpreis des Anbieters geschätzt wurden.

## Wem eine Anfrage angerechnet wird

Die Regel ist überall dieselbe: Eine Anfrage zählt für die Person, die die Arbeit angestoßen hat. Der Weg, über den sie kam, etwa die App, die REST-API oder der MCP-Endpoint, ändert daran nichts.

| Arbeit | Zählt für | Zählt zusätzlich für | Erscheint in der Nutzungsanalyse als |
| --- | --- | --- | --- |
| Eine Chatantwort oder der Titel eines neuen Chats | Das Mitglied, das die Nachricht gesendet hat | Den API-Schlüssel, wenn die Nachricht über die REST-API kam | Der verwendete Assistent; ein Titel unter `thread-title` |
| Ein Agentenlauf zu einer Aufgabe | Das Mitglied, das den Lauf aus der Aufgabe oder mit einem Kommentar gestartet hat, der den Agenten erwähnt | — | Der Name des Agenten unter **Top-Assistenten** |
| Ein Automatisierungslauf, den jemand gestartet hat | Das Mitglied, das ihn aus der Laufliste, dem Builder, einem Chat, einer Aufgabe, über die REST-API oder den MCP-Endpoint gestartet hat | Den API-Schlüssel, wenn der Lauf mit einem gestartet wurde | Der Name der Automatisierung unter **Top-Assistenten** |
| Ein Automatisierungslauf, den ein Trigger gestartet hat | Niemanden: Hinter einem Zeitplan, einem Webhook oder einem Ereignis steht keine Person | — | Die Zeile **Automatisierungen (Trigger)** unter **Nutzung pro Benutzer** |
| Sprachausgabe oder eine Transkription | Das Mitglied, das sie angefordert hat | — | **Sprachausgabe** oder **Transkription** unter **Top-Assistenten**; Sprachausgabe zusätzlich unter **Top-Sprachmodelle** |
| Ein gemessener Connector-Aufruf | Das Mitglied, dessen Anfrage den Aufruf ausgelöst hat | — | Der Assistent, der ihn gemacht hat, oder **Connector** |

Ein erneuter Versuch eines Agentenlaufs führt den Lauf fort, den sein Starter angestoßen hat; seine Nutzung bleibt deshalb bei dieser Person. Handelt eine Integration mit einem API-Schlüssel für ein anderes Mitglied, zählt der Lauf für dieses Mitglied, und das Limit des Schlüssels zählt ihn ebenfalls.

## Welche Limits gelten

- **Persönliche, Team- und Rollenlimits** binden die Person, der eine Anfrage angerechnet wird. Ein Lauf, den ein Zeitplan, ein Webhook oder ein Ereignis gestartet hat, hat keine solche Person und wird an keinem davon gemessen.
- **Organisationslimits** binden jede Anfrage, auch die Läufe eines Triggers.
- **API-Schlüssellimits** binden die Anfragen, die mit diesem Schlüssel authentifiziert wurden: die damit gesendeten Chatnachrichten und die damit gestarteten Läufe.

Ist ein Limit erreicht, lehnt Tale die nächste Anfrage vor der Ausführung ab und nennt das Limit. Ein Zug eines verwalteten Agenten wird beim Start abgelehnt; ein bereits laufender Zug behält den Rahmen, den er bekommen hat. [So werden Regeln kombiniert](/de/platform/admin/governance/policies-and-limits#how-rules-combine) beschreibt den Fall, dass mehrere Regeln für eine Person gelten.

## Drei Situationen, die du kennen solltest

**Ein Teammitglied erwähnt deinen Agenten in einem Aufgabenkommentar.** Der Kommentar startet einen Lauf, und dieser zählt für das Teammitglied, das den Kommentar geschrieben hat, nicht für dich als Ersteller des Agenten.

**Eine geplante Automatisierung gibt jede Nacht Geld aus.** Ihre Läufe erscheinen in der Zeile **Automatisierungen (Trigger)**. Sie erhöhen weder die persönliche Nutzung von jemandem noch die Zahl der aktiven Benutzer, und nur die Organisationslimits können sie stoppen. Lege ein Kosten- oder Anfragelimit für die Organisation fest, wenn du eine Obergrenze dafür brauchst.

**Eine Integration nutzt einen API-Schlüssel im Namen eines Mitglieds.** Die persönlichen und Team-Limits des Mitglieds sehen den Lauf, und das Limit des Schlüssels ebenfalls. Zwei Obergrenzen gelten, und die strengere lehnt zuerst ab.

## Was Mitglieder sehen

**Einstellungen > Nutzung** zeigt jedes Limit, das für das angemeldete Mitglied gilt, mit dem aktuellen Verbrauch: die gesendeten Chats, die angeforderten Sprachausgaben und die gestarteten Agentenläufe, egal auf welchem Weg sie gestartet wurden. Geteilte Team- und Organisationslimits stehen ebenfalls dort, weil sie vor einem persönlichen Limit erreicht sein können.
