---
title: KI-Anbieter
description: Einstellungen > KI-Anbieter ist der Ort, an dem Admins die OpenAI-kompatiblen Anbieter hinter jeder Antwort verbinden, wählen, welche Modelle die Organisation nutzen darf, und die Standards setzen. Jede Antwort, die Tale streamt, kommt von einem Modell, das über diese Seite aufgelöst wird.
---

Einstellungen > KI-Anbieter ist die Oberfläche, an der Tale auf die Modelle trifft, die es bedient. Eine frische Organisation bringt einen verbundenen Anbieter mit — **OpenRouter**, dessen einzelner Key Chat-, Vision-, Embedding-, Transkriptions-, Sprach- und Bildmodelle erreicht — und Admins fügen von hier Anbieter hinzu, bearbeiten oder mustern sie aus. Jede Antwort, die Tale streamt, wird über ein auf dieser Seite aufgelöstes Modell geroutet; sie anzufassen ändert, was der Rest des Produkts kann.

<Frame caption="Einstellungen > KI-Anbieter — die verbundenen Anbieter, jeder mit seinem Anmeldedaten-Status und seiner Modell-Liste.">

![Die KI-Anbieter-Einstellungsseite mit dem OpenRouter-Anbieter-Eintrag und seiner Modell-Liste.](/images/get-started/settings-providers.webp)

</Frame>

## Was die Liste zeigt

Öffne **Einstellungen > KI-Anbieter** und du landest auf den Anbietern, die die Organisation verbunden hat. Jede Zeile nennt den Anbieter und zeigt, ob sein API-Schlüssel konfiguriert ist. Ein Klick auf eine Zeile öffnet den Drawer des Anbieters: seine Basis-URL und seinen Schlüssel, seine **Standardmodelle** und die **Modelle**-Liste selbst — durchsuchbar, mit den Fähigkeits-Tags, die entscheiden, wo jedes Modell nutzbar ist.

Der Drawer ist der Ort, an dem die ganze Anbieter-Arbeit passiert. Die Listenansicht ist bewusst dünn; die Tiefe liegt einen Klick weiter.

## Einen Anbieter hinzufügen

Klick **Anbieter hinzufügen**. **Mit einem bekannten Anbieter starten** wählt OpenAI, Anthropic oder OpenRouter und trägt Anbietername und Basis-URL ein — übrig bleibt nur noch dein API-Schlüssel. Änderst du Name oder Basis-URL von Hand, springt die Auswahl zurück auf **Benutzerdefiniert**, den manuellen Weg: Ein Anbieter ist eine **Basis-URL** plus ein **API-Schlüssel** — der eigene Endpunkt eines Direkt-Anbieters, OpenRouter (`https://openrouter.ai/api/v1`) für den breitesten Katalog, oder ein lokaler Ollama- oder vLLM-Server in deinem Netz. Der Schlüssel wird verschlüsselt gespeichert und nur genutzt, um diesen Anbieter aufzurufen.

Sobald die Anmeldedaten sitzen, füll die Modell-Liste: **Modelle abrufen** zieht die Liste, die die API des Anbieters meldet, **Modell hinzufügen** deklariert eines von Hand, und — sobald der Modellkatalog der Organisation synchronisiert ist — füllt die Auswahl eines Modells aus dem Katalog in diesem Dialog dessen ID und bekannte Fähigkeiten (Kontextfenster, Pricing, Reasoning), statt sie einzutippen. Kein Modell ist aufrufbar, bevor es mit dem richtigen Fähigkeits-Tag in der Liste des Anbieters steht.

Bei OpenAI, Anthropic und OpenRouter bleibt die Basis-URL auch nach dem Anlegen des Anbieters auf den veröffentlichten Endpunkt gesperrt — öffne den Drawer der Zeile, klick auf **Details bearbeiten** unter **Allgemein**, und das Feld erscheint schreibgeschützt mit der Schaltfläche **Basis-URL überschreiben** daneben. Greif zur Überschreibung nur, wenn du den Slug dieses Anbieters auf einen kompatiblen Proxy oder einen anderen Endpunkt desselben Anbieters richten willst; die Basis-URL jedes anderen Anbieters bleibt direkt editierbar, ganz ohne Überschreibung.

## Die Modell-Liste und Fähigkeits-Tags

Jedes Modell trägt einen oder mehrere Fähigkeits-Tags — **Chat**, **Vision**, **Embedding**, **Transkription**, **Text-zu-Sprache**, **Bildgenerierung**, **Bildbearbeitung**. Die Tags sind tragend: sie entscheiden, in welchen Pickern ein Modell erscheint und welche Plattform-Fähigkeit es aufrufen darf. Ein Modell ohne passenden Tag erscheint nie dort, wo diese Fähigkeit gebraucht wird.

**In Modell-Auswahl ausgeblendet** nimmt ein Modell aus dem Chat-Composer und der Agent-Modellauswahl, lässt es aber für Agents und Workflows, die es schon referenzieren, voll nutzbar. So geht eine abgelöste oder veraltete Version in Rente, ohne die daran gebundenen Agents zu brechen.

## Standardmodelle

Die **Standardmodelle**-Karte nennt, welches Modell jede Fähigkeit nutzt, wenn nichts Spezifischeres gebunden ist — der Chat-Default für neue Chats und neue Agents, plus die Vision-, Embedding-, Bildgenerierungs- und Transkriptions-Defaults, die die Hintergrund-Dienste nutzen. Einen Default zu ändern wirkt nur auf neue Objekte; bestehende Chats und Agents behalten das Modell, an das sie gebunden waren. Greif zu den Defaults, wenn du eine neue Modell-Generation organisationsweit ausrollst, ohne jeden Agent neu zu bearbeiten.

## Den Katalog frisch halten

Zwei Steuerungen halten den Katalog aktuell, ohne von Hand zu editieren. Die **Modellkatalog**-Karte frischt die Fähigkeiten jedes Modells — Pricing, Kontextfenster, Reasoning, Vision — täglich aus OpenRouters öffentlichem Katalog auf. Der Schalter **Wöchentliche Auto-Synchronisierung der Anbieter-Konfiguration** mergt neu veröffentlichte Flaggschiff-Versionen einmal pro Woche in die Anbieter-Konfiguration der Organisation, blendet abgelöste aus und lässt jedes Feld, das du angepasst hast, unberührt.

## Wo das hingehört

Anbieter sind der Boden des Stacks — jeder Agent, jeder Chat, jeder Workflow-Schritt, der Text erzeugt, löst über sie auf. Der Katalog dessen, was jeder Anbieter ausliefert und welche Tags er trägt, liegt in [Modelle](/de/platform/models); die dateibasierte Form derselben Konfiguration liegt unter [Konfiguration → Provider](/de/self-hosted/configuration/providers); und [Agent-Konzepte](/de/platform/agents/concepts) behandelt, wie der Modell-Knopf in das Vier-Knöpfe-Modell passt, aus dem ein Agent gebaut wird.
