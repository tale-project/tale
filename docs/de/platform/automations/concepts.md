---
title: Automatisierungskonzepte
description: Eine Automatisierung ist das installierbare Bündel aus Integrationen, Agents, Skills, einem Workflow und mitgelieferten Ansichten — und der Workflow darin ist ihr Antrieb. Diese Seite benennt die Bestandteile, die Laufzeit darum herum und wann du zu einer Automatisierung greifst statt zu einem einzelnen Agent.
---

Eine Automatisierung ist die Einheit, zu der Tale greift, wenn eine Aufgabe mehr als ein bewegliches Teil braucht, das zusammengeschaltet werden muss — eine Integration, ein oder mehrere Agents, ein Workflow, manchmal eine eigene Seite —, und du das Ganze lieber in einem Schritt installiert und verbunden haben willst, statt es von Hand zusammenzusetzen. Inhaber, Admins und Entwickler installieren Automatisierungen aus dem Automatisierungen-Katalog; einmal installiert, nutzen Redakteure und Mitglieder, was mitgeliefert wurde — ein Posteingang-Tab, ein Backlog-Eintrag, ein Chat-Agent —, ohne wissen zu müssen, was darunterliegt. Diese Seite benennt die Bestandteile, die eine Automatisierung bündelt, den Workflow, der sie antreibt, und wann eine Automatisierung die richtige Einheit ist statt eines einzelnen Agents.

## Was eine Automatisierung bündelt

Das Manifest einer Automatisierung benennt bis zu fünf Arten von Bestandteilen, und die meisten Automatisierungen nutzen nur einen Teil davon.

**Integrationen** sind die Anmeldedaten, die ihre Schritte und Agents brauchen — Gmail, GitHub, eine SQL-Datenbank. Eine Automatisierung speichert nie eine eigene Kopie einer Anmeldung; sie benennt nur, welche Integration sie braucht, und die Organisation verbindet diese Integration einmal — dieselbe Verbindung, die sich jede andere Automatisierung und jeder Agent teilt.

**Agents** sind die Chat- oder Aufgaben-Agents, die die Automatisierung installiert — ein Sichter, ein PR-Prüfer, ein Zusammenfasser. Einmal installiert, sind es ganz normale Agents: erwähnbar im Chat, zuweisbar auf einem Projekt-Board, editierbar im Agent-Editor.

**Ein Workflow** ist die eine gebündelte Trigger-und-Schritte-Definition der Automatisierung — das, was tatsächlich nach einem Zeitplan, über einen Webhook oder per Klick läuft. Nicht jede Automatisierung liefert einen mit: Die E-Mail-Automatisierungen auf [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) haben keinen, weil Mail lesen und beantworten eine Seite ist, kein geplanter Lauf.

**Mitgelieferte Ansichten** sind Seiten, die die Automatisierung in die geteilte Ansichts-Registry der Plattform einträgt, etwa den Posteingang — die Plattform rendert die Seite selbst, die Automatisierung benennt nur, welche und worauf sie begrenzt ist.

**Konfiguration** ist keine separate Einstellungsdatei. Eine Automatisierung, die einen Betriebswert braucht, liest ihn aus der Anmeldung einer Integration oder aus einer Trigger- oder Node-Variable des Workflows; der Tab **Konfiguration** der Automatisierung ist eine schreibgeschützte Zusammenfassung der obigen Bestandteile, kein Ort, um neue Einstellungen anzulegen.

## Der Workflow darin

Eine eigenständige Workflow-Oberfläche gibt es in Tale nicht — ein Workflow lebt und läuft in seiner Automatisierung, und ihr Tab **Editor** ist der Ort, an dem du ihm begegnest. Die Definition ist ein Graph aus typisierten Schritten: **LLM**-Schritte rufen einen Agent oder ein Modell auf, **Aktion**-Schritte erledigen konkrete Arbeit wie den Aufruf einer Integration oder das Anlegen und Aktualisieren von Aufgaben auf dem Projekt-Board, **Bedingung**-Schritte verzweigen den Graphen an einem Ja oder Nein, **Schleife**-Schritte wiederholen über eine Menge, und **Sandbox**-Schritte führen Code aus. Jedes Speichern legt eine Version an, die du über **Verlauf** wiederherstellen kannst. [Der Workflow-Editor](/de/platform/automations/editor) ist das Betriebshandbuch zu dieser Oberfläche.

**Trigger** entscheiden, wann der Workflow läuft. Drei Arten hängen am Tab **Trigger**: **Zeitpläne** (Cron), **Webhooks** (ein externer POST) und **Ereignisse** (etwas passiert innerhalb von Tale, etwa `task.created`) — und einen Lauf kannst du immer von Hand starten, über das Panel **Workflow testen** im Editor. Die [Trigger-Referenz](/de/platform/automations/triggers) behandelt jede Art.

**Ausführungen** sind die Laufhistorie. Jeder Lauf schreibt einen Datensatz — Status, Zeiten, die empfangene Eingabe und ein Journal pro Schritt mit dem, was jeder Schritt konsumiert und produziert hat. Der Tab **Ausführungen** ist Audit-Spur und Debugging-Oberfläche in einem; [Ausführungsprotokolle](/de/platform/automations/execution-logs) liest einen Lauf von Anfang bis Ende.

## Wo Menschen mitentscheiden

Automatisierungen laufen ohne dich, aber sie ändern und starten sich nur mit dir: Die vorgeschlagenen Änderungen des KI-Editors an einem Workflow landen als Genehmigungskarten, bevor sie greifen; ein Agent, der einen Workflow ausführen will, braucht zuerst deine Genehmigung; und ein Lauf, der eine Antwort braucht, pausiert als **Wartet auf Eingabe**. [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) behandelt alle drei. Läuft eine Schleife erneut durch dasselbe Review-Gate — eine Aufgabe, die für eine weitere Runde zurückgeht —, öffnet sie jede Runde eine frische Anfrage, statt die bereits entschiedene Karte wiederzuverwenden.

## Bundles und versteckte Automatisierungen

Ein Bundle fasst mehrere Automatisierungen zusammen, die nur gemeinsam installiert einen Sinn ergeben. [GitHub-Issues lösen](/de/platform/automations/builtin) installiert vier Automatisierungen — einen Sichter, einen Abgleicher, einen PR-Ersteller und einen PR-Prüfer — über einen gebündelten Assistenten, gebunden an das Projekt, das du wählst. Die meisten Mitglieder eines Bundles sind versteckt: Sie tauchen nie als eigene Karte im Katalog auf, weil eine Installation für sich allein ohne ihre Geschwister bedeutungslos wäre. Versteckt heisst nicht weg — der [Automatisierungs-Assistent](/de/platform/automations/assistant) findet und erklärt sie trotzdem; nur das Raster des Katalogs blendet sie aus.

## Alles zusammen — zwei Kombinationen

**Auf Gmail-E-Mails antworten** kombiniert die kleinstmögliche Menge: eine Integration (Gmail) und eine mitgelieferte Ansicht (Posteingang) — kein Agent, kein Workflow. Verbinde Gmail, und der Posteingang-Tab ist die ganze Automatisierung.

**GitHub-Issues lösen** kombiniert jeden Bestandteil auf einmal: eine Integration (GitHub), vier Agents verteilt über seine vier versteckten Mitglieder, vier Workflows und keine mitgelieferte Ansicht — es arbeitet stattdessen über das bestehende Board und Backlog des Projekts statt über eine eigene Seite. Die Installation des Bundles verdrahtet alle vier in einem gebündelten Assistenten, gebunden an das Projekt, das du wählst.

## Wann du danach greifst

| Nutz … wenn                                                                  | Automatisierung | Agent | Agent-Webhook |
| ---------------------------------------------------------------------------- | --------------- | ----- | ------------- |
| Du willst ein fertig integriertes Feature in einem Schritt installieren      | ✓               |       |               |
| Die Arbeit hat mehrere Schritte, Verzweigungen, Zeitpläne oder Genehmigungen | ✓               |       |               |
| Dieselbe Frage kehrt im Chat einfach wieder, kein externes System beteiligt  |                 | ✓     |               |
| Eine Agent-Antwort pro eingehendem POST reicht                               |                 |       | ✓             |

Prüf den Katalog, bevor du irgendetwas baust — die Automatisierung, die du brauchst, wird vielleicht schon mitgeliefert. Wenn nichts Fertiges passt, baust du trotzdem eine Automatisierung: Beschreib den Workflow dem [KI-Editor](/de/platform/automations/editor) oder lade ein Paket hoch, statt lose Teile zusammenzusetzen. Ein [Agent-Webhook](/de/platform/agents/webhook-triggers) ist die eine Naht ausserhalb dieses Modells — greif dazu, wenn eine einzelne Agent-Antwort pro eingehender Nachricht alles ist, was die Aufgabe braucht.

## Bau eine

Eine Automatisierung ist das ganze Bündel, das ein echtes Feature braucht — die Integration, die es aufruft, die Agents, die die Arbeit erledigen, der Workflow, der sie ausführt, die Ansicht, die es rendert —, zusammengeschaltet und in einem Schritt installiert, mit der Laufzeit des Workflows (Trigger, Ausführungen, Genehmigungen) auf den eigenen Tabs der Automatisierung. Die natürliche nächste Lektüre ist [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) — sie geht den Katalog, das Seitenpanel und den Installations-Assistenten von Anfang bis Ende durch; [Der Workflow-Editor](/de/platform/automations/editor) übernimmt danach für die Oberfläche, auf der der Antrieb der Automatisierung gebaut und justiert wird.
