---
title: Automatisierungs-Assistent
description: Einen Chat-Agent, der auf eine Automatisierung fixiert ist, gibt es in dieser Version nicht — eine Automatisierung bearbeitest du auf ihrer eigenen Seite, und ein Modell verfasst sie über den MCP-Endpoint.
---

Diese Seite beschrieb einmal den **Automatisierungs-Assistenten**: einen Chat-Agent, der auf eine einzelne Automatisierung ausgerichtet war, deren Dokument, Agents, Skills und Connectors im Kontext hatte und für dich Nodes editieren, Versionen speichern und Mocks laufen lassen konnte. In dieser Version von Tale gibt es ihn nicht. Der Chat kennt keinen Agent, der auf irgendetwas ausgerichtet wäre — der Chat-Assistent trägt drei nur lesende Retrieval-Tools und kann eine Automatisierung weder lesen noch bearbeiten —, und der Canvas hat kein Assistenten-Panel. Was bleibt, sind die zwei Wege, auf denen eine Automatisierung tatsächlich gebaut und verstanden wird: ihre eigene Seite und der MCP-Endpoint.

<Note>

Der Automatisierungs-Assistent ist in dieser Version nicht verfügbar. Es gibt keinen an eine Automatisierung gebundenen Chat-Agent und keinen Agent-Editor, dem er JSON übergeben könnte; die Agent-Seite einer Automatisierung ist ihre **Agent**-Node, die du im Panel bearbeitest wie jede andere Node.

</Note>

## Eine Automatisierung heute verstehen und bearbeiten

Öffne die Automatisierung unter **Automatisierungen**. Ihr Canvas zeigt den ganzen Graphen auf einmal — den Trigger, die Nodes und die Kanten dazwischen —, und wählst du eine Node, zeigt das Panel daneben ihre Konfiguration; dort bearbeitest du, speicherst mit **Speichern** eine Version mit Notiz, lässt sie mit **Testlauf** gegen Mocks laufen und schaltest sie mit **Diese Version live schalten** live, wenn sie stimmt. [Der Workflow-Editor](/de/platform/automations/editor) ist das Betriebshandbuch dieser Seite, samt dem Deploy-Gate, das die eigenen Tests einer Automatisierung bilden. Die Teile, die der alte Assistent für dich entwarf, bearbeitest du dort, wo sie leben: Zugangsdaten unter **Einstellungen > Connectors** ([Zugangsdaten für Connectors](/de/platform/admin/connectors)), einen Trigger auf der eigenen Seite der Automatisierung ([Automatisierungs-Trigger](/de/platform/automations/triggers)).

## Ein Modell eine verfassen lassen

Der Weg für Modelle ist der [MCP-Endpoint](/de/develop/mcp-endpoint): Richte einen Coding-Agent, eine IDE oder deine eigene Schleife mit einem API-Schlüssel der Organisation darauf, und sie hält die Authoring-Tools, die der Assistent einmal trug — `get_docs` für die Grammatik, `validate_automation`, `save_automation`, `run_automation` im Mock- oder Live-Modus, `test_automation` und `deploy_automation` — dazu `list_automations` und `search_capabilities`, um zu finden, was schon existiert, bevor ein Duplikat entsteht. Ein Speichern über den Endpoint hängt genau wie die Seite eine Version an, und nichts geht live, bevor etwas es live schaltet. Was ein Schlüssel speichern und live schalten darf, folgt der Rolle seines Inhabers: Entwickler-Rechte, genau wie auf der Seite.

## Wo das hingehört

Eine Automatisierung wird in dieser Version an zwei Orten gelesen und geändert — auf ihrer Seite durch Menschen, über den MCP-Endpoint durch Modelle —, und keiner davon ist ein Chat. [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Vokabular, das beide voraussetzen; [Automatisierungen in deine Organisation bringen](/de/platform/automations/catalog) ist der Ort, von dem die mitgelieferten Pakete, Entwürfe und Uploads kommen.
