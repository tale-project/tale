---
title: Agent-Webhook-Trigger
description: Der Workers-Tab — ein pro-Agent-HTTP-Endpunkt, an den externe Systeme POSTen, um den Agent ohne den Umweg über den Chat aufzurufen.
---

Der **Workers**-Tab eines Agents zeigt einen HTTP-Endpunkt, an den ein anderes System POSTen kann. Das POST führt den Agent gegen die Payload aus und gibt die Antwort zurück; die UI ist nicht involviert. Greif danach, wenn etwas ausserhalb von Tale eine Frage vom Agent beantwortet braucht — ein Slack-Bot, ein Formular-Handler, ein geplanter Job.

Diese Seite deckt nur die Workers-Oberfläche ab. Für das entwickler-zugewandte Äquivalent (Tale aus beliebigen Skripten aufrufen) siehe [Develop → API-Referenz](/de/develop/api-reference); für eingehende Automatisierungs-Trigger, die einen Workflow statt eines Agents ausführen, siehe [Automatisierungen → Trigger](/de/platform/automations/triggers).

## Ein durchgespielter Worker

Öffne den Agent und wechsle zu **Workers**. Die Seite zeigt eine pro-Agent-URL und ein Beispiel-`curl`. POST eine JSON-Payload mit einem `message`-Feld; Tale empfängt sie, führt den Agent gegen die Nachricht aus und gibt die Antwort des Agents als Response-Body zurück. Dieselbe Payload zweimal gesendet produziert zwei unabhängige Läufe — Workers entduplizieren nicht.

## Authentifizierung

Worker-Endpunkte erfordern einen API-Key. Der Endpunkt zeigt die URL, aber nicht ein funktionierendes `curl`, bis ein Key angehängt ist; der **Authorization**-Header trägt den Key als Bearer-Token. Den Key zu rotieren ungültigt jeden laufenden Aufrufer — versorg neue Keys, bevor du alte ausser Betrieb nimmst. API-Keys werden unter [API-Keys](/de/platform/admin/api-keys) verwaltet.

## Payload-Form

Die Default-Payload ist `{"message": "…"}`. Zusätzliche Felder, die die Instructions des Agents referenzieren, können hinzugefügt werden; sie gehen als strukturierter Input in den Modell-Kontext durch. Die Antwort des Agents wird als JSON-Objekt mit dem Antworttext, jeglichen Tool-Aufrufen und jeglichen Zitaten zurückgegeben. Streaming ist unterstützt, wenn der Aufrufer den Header `Accept: text/event-stream` setzt.

## Wo das hineinpasst

Workers sind das leichtgewichtige, pro-Agent-Äquivalent der API. Sie sind nützlich, wenn die Integration „dieser eine Agent macht diese eine Sache" ist; für reichere Flüsse modellier den Aufruf als [Automatisierung](/de/platform/automations/concepts) und richt die Integration auf den Webhook-Trigger der Automatisierung. Das Tutorial [Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) führt die Automatisierungs-Form von Anfang bis Ende.
