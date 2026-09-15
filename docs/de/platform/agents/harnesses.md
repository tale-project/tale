---
title: Eine Agent-Laufzeit wählen
description: Stimme Harness, Zugangsdaten, Werkzeuge und Sandbox-Verhalten auf die Aufgabe ab.
---

Ein Harness ist das Coding-Programm, das die Sitzung eines Agenten in einer Sandbox ausführt. Es fragt das Modell nach nächsten Schritten, liest und schreibt Dateien, führt Befehle aus und liefert einen Bericht. Du wählst es für Projektagenten oder eine `agent`-Node einer Automatisierung. Die normale Modellauswahl im Chat wählt keinen Harness.

## Laufzeit wählen und Zugriff prüfen

Öffne im Tab **Agenten** eines Projekts einen Agenten und wähle die **Agent-Laufzeit**. Bei einer Agent-Node heißt das Feld **Harness**. Wähle danach Modell und Provider. Unter **Einstellungen > KI-Anbieter** zeigt **Agent-Laufzeiten**, welche Ausführungswege der Organisation derzeit zur Verfügung stehen.

Die Laufzeit braucht passende Zugangsdaten und [Sandbox-Kapazität](/de/platform/admin/sandboxes). Ein funktionierendes Chat-Modell genügt nicht. Fehlt die Laufzeit oder bietet sie keine Modelle an, prüfe ihren Status und die Provider-Zugangsdaten, bevor du den Aufgabenauftrag änderst.

## Unterstützte Laufzeiten vergleichen

„Verwaltet“ bedeutet, dass die Laufzeit Tale über das Modell-Gateway aufruft. „Direkt“ bedeutet, dass die Sitzung Zugangsdaten für die Werkzeuge des Providers erhält. Die mitgelieferten Definitionen unterstützen die folgenden Kombinationen; tatsächlich verfügbar ist, was Deployment und Zugangsdaten erlauben.

| Harness | Zugangsweg | Neue Anweisungen im laufenden Prozess | MCP-Kanal von Tale |
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

Kommentiere eine Projektaufgabe und erwähne ihren Agenten, um die Arbeit zu lenken. Claude Code erhält den Hinweis beim nächsten Werkzeugübergang. Bei den anderen Laufzeiten beendet Tale den aktuellen Prozess und setzt dieselbe Unterhaltung mit dem Kommentar in einem neuen Prozess fort. Deshalb kann ein laufender Prozess nach einer neuen Anweisung neu starten.

## Zugangsdaten und Kosten verstehen

Bei einem gespeicherten API-Schlüssel oder einer Deployment-Umgebungsvariable stellt Tale einen sitzungsgebundenen Gateway-Schlüssel bereit. Der ursprüngliche Modell-Provider-Schlüssel bleibt bei der Plattform. Gateway-Aufrufe werden gemessen und unterliegen den geltenden Ausgabenregeln. Bereits an andere laufende Durchläufe vergebene Beträge werden berücksichtigt.

Provider-Abonnements verwenden ihren unterstützten Harness und erhalten den Abonnement-Zugang in der Sitzungsumgebung. Sie dienen weder als normale Chat-Zugangsdaten noch für inkompatible Harnesses. Ihre direkten Aufrufe umgehen die Kostenmessung und Ausgabengrenzen des Tale-Gateways. Prüfe die Nutzung beim Abonnement-Provider.

Diese Regeln für Modellzugänge bedeuten nicht, dass die Sandbox keinerlei Geheimnisse enthält. Ausdrücklich vergebene **Secrets** sowie ein Token für einen zugeordneten GitHub-Zugang können darin verfügbar sein. Vergib nur den für die Aufgabe nötigen Zugriff.

## Dateien und verbundene Werkzeuge verstehen

Ein Projektagent verwendet seinen dauerhaften Workspace über mehrere Aufgaben hinweg. Aufgabenanhänge liegen schreibgeschützt unter `/agent/inputs/<task>/attachments/`. Dateien aus `/agent/output/<task>/` werden am Ende des Durchlaufs als **Ergebnisdateien** an die Aufgabe angehängt. Agent-Nodes sammeln ihre Ausgabe aus `/agent/output/`.

Zugeordnete Skill-Bundles liegen als Dateien vor und werden in den Laufanweisungen genannt. Prüfe ihre Anweisungen und Skripte vor der Freigabe. [Skills für Agenten](/de/platform/agents/skills) erklärt Bereitstellung und Sichtbarkeit.

Der Connector-Broker hält gewöhnliche Connector-Zugangsdaten bei Tale und gibt Aktionsergebnisse zurück. Er bietet Agenten Leseaktionen an und lehnt Schreibaktionen über diesen Weg ab. Verwende für einen kontrollierten Connector-Schreibvorgang eine entsprechende Automatisierungs-Node. GitHub-Werkzeuge und ausdrücklich vergebene Secrets haben eigene Zugangswege. Die Lesebeschränkung des Brokers verbietet deshalb nicht allgemein Schreibzugriffe aus der Shell.

Ausgehender Netzwerkzugriff erlaubt normalerweise Paketinstallationen und das Klonen von Repositorys, blockiert aber private Adressen und Cloud-Metadatenziele. Betreiber können die erlaubten Hosts weiter begrenzen. Prüfe bei einem unerreichbaren Dienst die Netzwerkregeln, statt unmittelbar falsche Zugangsdaten anzunehmen.

## Das Ergebnis prüfen

Die Laufzeit entscheidet, wann ihr Durchlauf fertig ist; Tale sammelt Bericht und Ausgabe. Lies beides, bevor du die Aufgabe abschließt. Prüfe, welche Tests tatsächlich liefen und welche Dienste in der Sandbox fehlten. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) erklärt die Prüfung von Projektarbeit; [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklärt Ergebnisse einer Agent-Node.
