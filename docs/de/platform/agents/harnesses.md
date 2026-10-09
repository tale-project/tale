---
title: Eine Agent-Laufzeit wählen
description: Stimme Agent-Laufzeit, Zugangsdaten, Werkzeuge und Sandbox-Verhalten auf die Aufgabe ab.
---

Eine Agent-Laufzeit ist das Coding-Programm, das die Sitzung eines Agenten in einer Sandbox ausführt. Sie fragt das Modell nach nächsten Schritten, liest und schreibt Dateien, führt Befehle aus und liefert einen Bericht. Du wählst sie für Projektagenten oder eine `agent`-Node einer Automatisierung. Die normale Modellauswahl im Chat wählt keine Agent-Laufzeit.

## Laufzeit wählen und Zugriff prüfen

Öffne im Tab **Agenten** eines Projekts einen Agenten und wähle die **Agent-Laufzeit**. Bei einer Agent-Node heißt das Feld ebenfalls **Agent-Laufzeit**. Wähle danach Modell und Provider. Unter **Einstellungen > KI-Anbieter** zeigt **Agent-Laufzeiten**, welche Ausführungswege der Organisation derzeit zur Verfügung stehen.

Die Laufzeit braucht passende Zugangsdaten und [Sandbox-Kapazität](/de/platform/admin/sandboxes). Ein funktionierendes Chat-Modell genügt nicht. Fehlt die Laufzeit oder bietet sie keine Modelle an, prüfe ihren Status und die Provider-Zugangsdaten, bevor du den Aufgabenauftrag änderst. Ein Modell, das Tools nur über die Responses-API von OpenAI aufruft, etwa GPT-6 Astra oder GPT-6.1 Sol, läuft nur auf Codex; für andere Laufzeiten bietet die Modellauswahl es deshalb nicht an.

## Unterstützte Laufzeiten vergleichen

„Verwaltet“ bedeutet, dass die Laufzeit Tale über das Modell-Gateway aufruft. „Direkt“ bedeutet, dass die Sitzung Zugangsdaten für die Werkzeuge des Providers erhält. Die mitgelieferten Definitionen unterstützen die folgenden Kombinationen; tatsächlich verfügbar ist, was Deployment und Zugangsdaten erlauben.

| Agent-Laufzeit | Zugangsweg | Neue Anweisungen im laufenden Prozess | MCP-Kanal von Tale |
| --- | --- | --- | --- |
| Claude Code | Verwaltet oder direkt | Ja | Ja |
| Codex | Verwaltet oder direkt | Nein | Ja |
| Cursor | Nur direkt | Nein | Nein |
| Gemini CLI | Verwaltet oder direkt | Nein | Ja |
| Hermes | Verwaltet oder direkt | Nein | Nein |
| OpenClaw | Verwaltet oder direkt | Nein | Ja |
| OpenCode | Nur verwaltet | Nein | Ja |
| Pi | Verwaltet oder direkt | Nein | Nein |
| Qwen Code | Verwaltet oder direkt | Nein | Ja |

**Claude Code (compact prompt)** ist eine zusätzliche Wahl für klar abgegrenzte Workflows mit vollständigen Aufgabenanweisungen. Die Variante kürzt die eingebauten Anweisungen und einige Werkzeugbeschreibungen. Werkzeuge, Hooks, MCP und die von Tale ergänzten Hinweise bleiben erhalten. Prüfe Ergebnisse und Laufzeit mit deinem Modell, bevor du die Variante einsetzt; ein kürzerer Prompt garantiert keinen schnelleren Durchlauf. Mit **Claude Code** verwendest du beim nächsten neuen Durchlauf wieder den vollständigen Prompt. Ein auf Claude Code beschränktes Provider-Abonnement unterstützt die kompakte Variante nicht automatisch.

Kommentiere eine Projektaufgabe und erwähne ihren Agenten, um die Arbeit zu lenken. Claude Code erhält den Hinweis beim nächsten Werkzeugübergang. Bei den anderen Laufzeiten beendet Tale den aktuellen Prozess und setzt dieselbe Unterhaltung mit dem Kommentar in einem neuen Prozess fort. Deshalb kann ein laufender Prozess nach einer neuen Anweisung neu starten.

Gemini CLI ist die Ausnahme: Tale setzt eine seiner Unterhaltungen nie fort. Ein späterer Kommentar, ein automatischer neuer Versuch oder die Antwort auf eine Frage des Agenten beginnt eine neue Unterhaltung im selben Arbeitsbereich, in der die Aufgabenbeschreibung und die bisherigen Runden erneut mitgegeben werden, weil die Laufzeit eine Unterhaltung mit einem Werkzeugaufruf nicht wiederaufnehmen kann. Dateien und Ausgaben bleiben erhalten; nur die Unterhaltung beginnt von vorn.

## Zugangsdaten und Kosten verstehen

Bei einem gespeicherten API-Schlüssel oder einer Deployment-Umgebungsvariable stellt Tale einen sitzungsgebundenen Gateway-Schlüssel bereit. Der ursprüngliche Modell-Provider-Schlüssel bleibt bei der Plattform. Gateway-Aufrufe werden gemessen und unterliegen den geltenden Ausgabenregeln. Bereits an andere laufende Durchläufe vergebene Beträge werden berücksichtigt.

Provider-Abonnements verwenden ihre unterstützte Agent-Laufzeit und erhalten den Abonnement-Zugang in der Sitzungsumgebung. Gemini ist die Ausnahme: Seine Google-Anmeldung wird für den Durchlauf als Datei im Home-Ordner der Sitzung abgelegt und am Ende des Durchlaufs wieder entfernt. Sie dienen weder als normale Chat-Zugangsdaten noch für inkompatible Agent-Laufzeiten, weil die Anbieter Abo-Tokens nur in ihrer eigenen Laufzeit erlauben; mehr dazu unter [KI-Anbieter](/de/platform/admin/providers#abos-in-aufgaben-nutzen-nicht-im-chat). Ihre direkten Aufrufe umgehen die Kostenmessung und Ausgabengrenzen des Tale-Gateways. Prüfe die Nutzung beim Abonnement-Provider.

Diese Regeln für Modellzugänge bedeuten nicht, dass die Sandbox keinerlei Geheimnisse enthält. Ausdrücklich vergebene **Secrets** sowie ein Token für einen zugeordneten GitHub-Zugang können darin verfügbar sein. Vergib nur den für die Aufgabe nötigen Zugriff.

## Dateien und verbundene Werkzeuge verstehen

Ein Projektagent verwendet seinen dauerhaften Workspace über mehrere Aufgaben hinweg. Aufgabenanhänge liegen schreibgeschützt unter `/agent/inputs/<task>/attachments/`. Dateien aus `/agent/output/<task>/` werden am Ende des Durchlaufs als **Ergebnisdateien** an die Aufgabe angehängt. Agent-Nodes sammeln ihre Ausgabe aus `/agent/output/`.

Zugeordnete Skill-Bundles liegen als Dateien vor und werden in den Laufanweisungen genannt. Prüfe ihre Anweisungen und Skripte vor der Freigabe. [Skills für Agenten](/de/platform/agents/skills) erklärt Bereitstellung und Sichtbarkeit.

Jede Laufzeit findet außerdem den integrierten Skill `visual-aspect-analyzer` unter ihren eigenen Skills, ohne dass du ihn zuordnen musst. Er steuert einen echten Browser über eine fertige UI-Änderung und meldet Layoutverschiebungen, Flackern und andere visuelle Regressionen. Ein gleichnamiger Skill in den Ordnern `.claude/skills` und `.agents/skills` des Repositorys im Workspace ersetzt ihn in jeder Laufzeit, die Skills aus einem Repository liest.

Der Connector-Broker hält gewöhnliche Connector-Zugangsdaten bei Tale und gibt Aktionsergebnisse zurück. Er bietet Agenten Leseaktionen an und lehnt Schreibaktionen über diesen Weg ab. Verwende für einen kontrollierten Connector-Schreibvorgang eine entsprechende Automatisierungs-Node. GitHub-Werkzeuge und ausdrücklich vergebene Secrets haben eigene Zugangswege. Die Lesebeschränkung des Brokers verbietet deshalb nicht allgemein Schreibzugriffe aus der Shell.

Agenten mit dem MCP-Kanal von Tale können außerdem abfragen, welches Tale-Release die Plattform meldet. Neben den Plattform-Tools, die dem Agenten vergeben wurden, liefert `workspace_status` den Wert `platform.version`: die Release-Nummer, die der Build des antwortenden Backends trägt, zum Beispiel `0.5.64` für das Release mit dem Tag `v0.5.64`. Für diesen Wert liest das Backend nichts aus der Anfrage. Ein Build ohne Release-Nummer, etwa ein Entwicklungsbuild, liefert stattdessen `null` mit einem kurzen Hinweis. Behandle den Wert als Kennzeichnung, nicht als Nachweis, denn jeder Build kann eine Release-Nummer tragen. Er beschreibt zudem nur dieses Backend und zeigt nicht, ob der Rest des Deployments funktioniert. Wie es um die Dienste des Deployments steht, zeigt die [Statusseite](/de/develop/status-page).

Ausgehender Netzwerkzugriff erlaubt normalerweise Paketinstallationen und das Klonen von Repositorys, blockiert aber private Adressen und Cloud-Metadatenziele. Betreiber können die erlaubten Hosts weiter begrenzen. Prüfe bei einem unerreichbaren Dienst die Netzwerkregeln, statt unmittelbar falsche Zugangsdaten anzunehmen.

Die integrierten Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf` finden die Bibliotheken, die sie aufrufen, in der Sandbox bereits installiert vor. Ein Agent, dem sie zugeordnet sind, erstellt und liest Word-, PowerPoint-, Excel- und PDF-Dateien deshalb auch dort, wo Paketinstallationen gesperrt sind. Ihre Anweisungen enthalten weiterhin Installationsbefehle wie `npm install -g docx`; ist die Registry gesperrt, schlägt dieser Schritt fehl, die vorinstallierte Bibliothek bleibt aber verfügbar. Texterkennung (OCR) für gescannte PDFs ist nicht enthalten.

## Das Ergebnis prüfen

Die Laufzeit entscheidet, wann ihr Durchlauf fertig ist; Tale sammelt Bericht und Ausgabe. Lies beides, bevor du die Aufgabe abschließt. Prüfe, welche Tests tatsächlich liefen und welche Dienste in der Sandbox fehlten. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) erklärt die Prüfung von Projektarbeit; [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklärt Ergebnisse einer Agent-Node.

Kann die Laufzeit gar nicht starten — eine Konfiguration, die sie ablehnt, ein Zustandsverzeichnis, das sie nicht findet —, schlägt der Lauf sofort fehl, und seine Begründung zitiert die letzten Zeilen, die die Laufzeit geschrieben hat: Die Ursache wird benannt, nicht nur ein Exit-Code. Ein solcher Lauf wird nicht automatisch wiederholt; behebe die Ursache und wiederhole ihn dann.
