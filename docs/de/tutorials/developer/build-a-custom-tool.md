---
title: Ein eigenes Tool bauen
description: Ein Panel für eigene Tools in den Einstellungen gibt es in dieser Version nicht — diese Seite zeigt die drei Stellen, an denen dein eigener Code heute einen Agenten erreicht.
---

Diese Anleitung hat früher ein Tool in einem Panel **Einstellungen > Eigene Tools** definiert, es an einen HTTPS-Endpoint gehängt und für einen Agenten eingeschaltet. Nichts davon existiert in dieser Version von Tale: Es gibt keine Registry für eigene Tools, keinen Tool-Schalter pro Agent, und die Tools des Chat-Assistenten stehen fest. Was du tun kannst: deinen Code dorthin legen, wo Agenten ohnehin hinschauen — in eine Connector-Aktion, in einen Automatisierungs-Knoten oder in ein Secret, mit dem ein Projekt-Agent deine API aufruft.

<Note>

Eigene Tools sind in dieser Version nicht verfügbar. Der Chat-Assistent trägt genau drei Lese-Tools — `rag_search`, `rag_fetch` und `web_fetch` — und kein Bildschirm fügt ein viertes hinzu.

</Note>

## Wo dein Code einen Agenten erreicht

Entscheide danach, wer ihn ausführen soll. Ein **Projekt-Agent** arbeitet Board-Aufgaben in seiner eigenen Sandbox ab; rüste ihn auf dem Tab **Agenten** des Projekts unter **Skills, Connectors & Tools** aus und leg ein **Secret** an — einen API-Schlüssel, der als Umgebungsvariable ankommt —, wenn der Dienst, den er aufrufen soll, keinen Connector hat. Der Agent liest die Dokumentation des Anbieters und ruft die API selbst auf. [Projekt-Agenten](/de/platform/projects/project-agents) führt durch den Dialog.

Eine **Automatisierung** läuft ohne Menschen in der Schleife; ihre Knoten rufen Connector-Aktionen auf und führen dein eigenes JavaScript in `transform`-Knoten aus, nach Zeitplan oder per Webhook; baue sie auf dem Canvas oder [lade sie als Paket hoch](/de/platform/automations/catalog). [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Modell darunter.

Ein **Connector** ist die mitgelieferte, herstellerspezifische Brücke — GitHub, Gmail, Outlook, Slack und die übrigen. Greif zuerst danach, wenn es einen für dein Ziel gibt; der [Connectors-Überblick](/de/platform/connectors/overview) listet, was mitkommt und was jeder braucht.

## Wo das hingehört

Die Naht zwischen einem Agenten und deiner Domäne ist von einer Tool-Registry pro Organisation dorthin gewandert, wo Arbeit ohnehin läuft: Ausrüstung und Secrets eines Projekt-Agenten, die Knoten einer Automatisierung und die mitgelieferten Connectors. Ein Modell außerhalb von Tale, das all das steuern soll, bekommt den [MCP-Endpoint](/de/develop/mcp-endpoint); das REST-Gegenstück ist die [API-Referenz](/de/develop/api-reference).
