---
title: Agent-Kategorien
description: Ein kurzes Tag am Agent, das ihn im Chat-Picker und in der Agent-Liste der Org gruppiert — pro Org definiert, pro Agent optional.
---

Eine **Kategorie** ist ein kurzes Tag am Agent — `Sales`, `Support`, `Marketing`, `Engineering` — das ihn im Chat-Picker und in der Agent-Liste der Org gruppiert. Kategorien sind ein organisatorisches Sortierwerkzeug, keine Berechtigungsgrenze; der rollen-basierte Zugriff eines Agents bleibt von der getragenen Kategorie unberührt.

Diese Seite ist absichtlich kurz — Kategorien sind ein kleiner Mechanismus. Die reichere Maschinerie sitzt einen Tab weiter in den Settings der Org.

## Eine Kategorie setzen

Öffne den Agent und schau auf dem **Instructions & model**-Tab nach; das Kategorie-Feld ist ein Single-Select-Dropdown. Wähl eine Kategorie und speichere; der Agent erscheint unter dieser Kategorie im Picker, sobald jemand ihn das nächste Mal öffnet. Ein Agent ohne Kategorie sitzt in einem Default-Bucket unten in der Liste.

## Wo Kategorien definiert sind

Die Kategorie-Liste ist org-weit und lebt unter den Settings der Org. Admins können Kategorien hinzufügen oder umbenennen; eine Kategorie umzubenennen wirkt sich auf jeden Agent aus, der sie genutzt hat. Eine Kategorie zu entfernen lässt Agents, die sie genutzt haben, im Default-Bucket — keine Agents werden gelöscht.

## Wo das hineinpasst

Kategorien sind die leichteste verfügbare Gruppierung für Agents — sie sortieren den Picker, mehr nicht. Grössere Trennungen (Projekt-Agents gegenüber Org-Agents, Pro-Team-Allowlists) leben in [Projekt-Agents](/de/platform/projects/project-agents) bzw. [Policies and limits](/de/platform/admin/governance/policies-and-limits).
