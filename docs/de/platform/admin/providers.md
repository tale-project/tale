---
title: KI-Anbieter
description: Einstellungen > Anbieter ist der Ort, an dem Admins OpenAI, Anthropic, Azure OpenAI und ein lokales Ollama anbinden, wählen, welche Modelle jeder davon freigibt, und das Standardmodell der Organisation setzen. Jede Antwort, die Tale streamt, kommt aus einem Modell, das über diese Seite aufgelöst wird.
---

Einstellungen > Anbieter ist die Oberfläche, an der Tale auf die LLMs trifft, die es bedient. Admins binden die Anbieter an, die die Organisation nutzen will — OpenAI, Anthropic, Azure OpenAI oder ein lokales Ollama — wählen, welche der jeweiligen Modelle die Organisation aufrufen darf, und setzen das Standardmodell für neue Chats und neue Agents. Jede Antwort, die Tale streamt, läuft durch diese Seite; sie zu berühren ändert, was der Rest des Produkts kann.

Diese Seite behandelt die Oberfläche: wie du einen Anbieter hinzufügst, was die Modell-Allowlist steuert, wie der Default aufgelöst wird und wie du einen Anbieter ausser Dienst stellst, ohne bestehende Chats zu brechen. Der Anbieter-Katalog selbst und die tiefere Konfigurationsdatei-Form derselben Oberfläche liegen einen Tab weiter unter [Modelle](/de/platform/models) für den Katalog und dem Self-hosted-Konfigurations-Tab für die Datei-Form.

## Was die Liste zeigt

Öffne **Einstellungen > Anbieter** und du landest auf der Liste der Anbieter, die die Organisation angebunden hat. Jede Zeile nennt den Anbieter, zeigt seinen Anmeldedaten-Status (verbunden, Fehler, ungetestet), die Zahl der Modelle, die der Anbieter freigibt, und die Zahl jener, die die Organisation in die Allowlist aufgenommen hat. Ein Verbindungsfehler zeigt die Upstream-Meldung neben der Zeile — meist ein falscher Schlüssel oder ein fehlender Scope.

Die Zeile klappt in den Modell-Picker des Anbieters auf. Tale holt die volle Modell-Liste des Anbieters zur Anmelde-Verifikations-Zeit; der Picker zeigt diese Liste mit einer Checkbox neben jedem Modell, plus einem Per-Modell-Tag (Chat, Bild, Embedding, Audio), das steuert, wo das Modell stromabwärts eingesetzt werden kann.

## Einen Anbieter hinzufügen

Klick auf **Anbieter hinzufügen** und wähl den Anbieter-Typ. Jeder Anbieter-Typ verlangt die nötige Anmeldung:

- **OpenAI** — API-Schlüssel von `platform.openai.com`. Der Schlüssel erbt Quote und Rate-Limits des OpenAI-Kontos.
- **Anthropic** — API-Schlüssel von `console.anthropic.com`. Gleiche Form wie OpenAI.
- **Azure OpenAI** — Endpoint-URL plus Schlüssel; Tale löst Modelle gegen das Azure-Deployment auf, nicht den OpenAI-Modellnamen.
- **Ollama** — Base-URL des Ollama-Servers (typischerweise `http://ollama:11434` im Tale-Netzwerk). Kein Schlüssel; Erreichbarkeit ist die Auth.

Sobald die Anmeldedaten ankommen, ruft Tale den Modell-Listen-Endpoint des Anbieters auf, zeigt jedes gefundene Modell und wartet, bis du die Allowlist auswählst, bevor irgendein Agent sie aufrufen kann. Eine leere Allowlist zu speichern ist erlaubt, aber kein Modell dieses Anbieters ist aufrufbar, bis du mindestens eines in die Allowlist nimmst.

## Die Allowlist und Per-Modell-Tags

Die Allowlist ist der Vertrag der Organisation mit sich selbst darüber, welche Modelle ihre Agents nutzen dürfen. Ein Modell, das nicht auf der Allowlist steht, erscheint in keinem Picker, selbst wenn der Upstream-Anbieter es freigibt. Füg Modelle hinzu, wenn du dem Preis des Anbieters für sie vertraust; entferne Modelle, wenn du sie nicht mehr aufrufbar willst.

Jedes Modell trägt ein oder mehrere Tags, die Tale beim Holen anhand der Metadaten des Anbieters zuweist: `chat` (Text rein, Text raus), `image` (Text rein, Bild raus), `embedding` (Text rein, Vektor raus), `audio` (Audio rein oder raus). Agents binden an Chat-getaggte Modelle; die Bildgenerierungs-Tool-Familie nutzt Bild-getaggte Modelle; Dokument-Indexierung nutzt Embedding-getaggte Modelle. Das einzige in der Allowlist befindliche Modell einer Tag-Klasse zu entfernen, bricht die Funktionen, die davon abhängen; die Zeile warnt, wenn du gerade dabei bist, das zu tun.

## Der Organisations-Standard

Der Organisations-Standard ist das Modell, das neue Chats und neue Agents nehmen, wenn kein anderes Modell benannt wird. Setz ihn aus der Zeile **Standardmodell** oben in der Anbieter-Liste. Den Standard zu ändern, wirkt nur auf neue Objekte — bestehende Chats und Agents behalten das Modell, an das sie gebunden waren. Greif zum Standard, wenn du eine neue Modell-Generation organisationsweit ausrollst, ohne jeden Agent neu zu bearbeiten.

## Einen Anbieter ausmustern

Klick auf die Zeile, dann auf **Trennen**. Ein getrennter Anbieter erscheint nicht mehr in Pickern; Agents, die an eines seiner Modelle gebunden sind, melden einen Konfigurationsfehler und fallen auf den Organisations-Standard zurück, wenn der Agent Fallback aktiv hat. Die Zeile bleibt mit einem Getrennt-Badge für den Audit-Pfad in der Liste. Trennen ist umkehrbar — ein Klick auf **Erneut verbinden** geht den Anmeldungs-Fluss neu — aber die Per-Modell-Allowlist muss neu gewählt werden, weil sich die zugrundeliegende Modell-Liste upstream verschoben haben kann.

## Wo das hingehört

Anbieter sind der Boden des Stacks — jeder Agent, jeder Chat, jeder Workflow-Schritt, der Text produziert, löst über sie auf. Die natürliche nächste Lektüre ist [Modelle](/de/platform/models) für den Katalog dessen, was jeder Anbieter aktuell liefert und welche Tags sie tragen, und [Agent-Konzepte](/de/platform/agents/concepts) dafür, wie der Modell-Knopf in das Vier-Knöpfe-Modell passt, aus dem ein Agent gebaut ist.
