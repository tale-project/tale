---
title: Meeting-Transkripte in die Wissensdatenbank pipen
description: Verdrahte Meetily (oder ein ähnliches lokales Meeting-Transkriptions-Tool) mit der Wissensdatenbank eines Tale-Projekts, damit Transkripte als Dokumente von selbst landen, ohne dass jemand eine Datei hochlädt.
---

Ein Meeting-Transkript ist eines der wertvollsten Dokumente, die ein Projekt führen kann — Namen, Entscheidungen, Follow-ups, alles an einem durchsuchbaren Ort. Dieser Walk integriert Meetily, ein lokales Meeting-Transkriptions-Tool, mit einem Tale-Projekt, damit jedes Transkript, das Meetily erzeugt, in der Wissensdatenbank des Projekts als Dokument von selbst landet. Der Walk richtet sich an einen Admin auf einer selbst gehosteten Tale-Instanz, der sie mit einem Meetily-Install im selben Netzwerk paart.

Du brauchst die Admin-Rolle in Tale, einen Meetily-Install, der vom `tale-platform`-Container erreichbar ist, und ein Projekt in Tale mit einer Wissensdatenbank, in die die Transkripte geroutet werden. Das Wissensdatenbank-Konzept lebt unter [Wissensdatenbank](/de/platform/knowledge/overview); diese Seite ist der Connector-Walk, nicht die Konzept-Seite.

## Bevor du beginnst

Bestätige vier Dinge. Deine Rolle ist Admin oder Inhaber in Tale — das **Connectors**-Panel ist darunter versteckt. Meetily läuft und produziert Transkripte in einem Format, das Tale akzeptiert (Markdown, Klartext oder VTT). Der Meetily-Host ist von `tale-platform` über seinen Webhook- oder Shared-Folder-Pfad erreichbar. Und das Zielprojekt existiert in Tale bereits mit einer angehängten Wissensdatenbank — die Connector schreibt _in_ eine Wissensdatenbank, sie erstellt keine.

## Schritt 1 — Den Auslieferungspfad wählen

Meetily kann Transkripte in zwei Formen an Tale übergeben, und sie haben unterschiedliche operative Eigenschaften. Die Wahl legt fest, wie der Rest des Walks zu lesen ist.

Der **Webhook**-Pfad lässt Meetily jedes fertige Transkript an einen Tale-Ingest-Endpunkt POSTen, sobald das Meeting endet; das Transkript ist Sekunden nach Schließen des Meetings in der Wissensdatenbank. Der **Shared-Folder**-Pfad lässt Meetily Transkripte als Dateien in ein Verzeichnis schreiben, das die Tale-Plattform jede Minute pollt; die Latenz beträgt bis zu eine Minute, aber der Pfad braucht keine öffentliche URL und übersteht Meetily-Neustarts ohne Retry-Logik.

Wähl Webhook, wenn beide Dienste im selben Netzwerk laufen und du schnelles Indizieren willst; wähl Shared Folder, wenn Meetily auf einer Workstation läuft, die unregelmäßig aufwacht, oder wenn das Operations-Team einen dateibasierten Audit-Trail bevorzugt.

## Schritt 2 — Den Ingest-Endpunkt oder Ordner in Tale erstellen

Tale muss wissen, wo Transkripte landen werden und zu welchem Projekt sie gehören. Ohne diese Bindung kommen Transkripte an, aber keine Wissensdatenbank beansprucht sie.

Öffne **Einstellungen > Connectors**, klick **Connector hinzufügen** und wähl **Meeting-Transkripte**. Wähl das Projekt aus dem Dropdown — die Wissensdatenbank, die das Projekt nutzt, ist das Ziel. Wähl den Auslieferungspfad, den du in Schritt 1 gewählt hast.

Hast du Webhook gewählt, generiert Tale eine URL der Form `https://<dein-host>/connectors/transcripts/<token>` und zeigt sie einmal. Kopier die URL; sie funktioniert auch als Bearer-Credential, also behandle sie wie ein Geheimnis.

Hast du Shared Folder gewählt, fragt Tale nach dem Pfad auf der Disk, den `tale-platform` beobachten soll (typisch `/data/transcripts/<project-slug>`). Erstell das Verzeichnis auf dem Host, gib ihm Gruppen-Eigentum, das dem `tale-platform`-Container-User entspricht, und bestätig.

## Schritt 3 — Meetily auf Tale zeigen lassen

Meetily muss jetzt wissen, wohin jedes Transkript zu liefern ist. Die Einstellungen leben in der eigenen Config von Meetily.

Für den Webhook-Pfad öffnest du die Einstellungen von Meetily und fügst ein Webhook-Ziel mit der URL aus Schritt 2 hinzu. Wähl das Transkript-Format — Markdown ist das, was sich in einer Tale-Dokument-Vorschau am besten liest, aber VTT und Klartext werden beide korrekt indiziert.

Für den Shared-Folder-Pfad setz das Transkript-Ausgabe-Verzeichnis von Meetily auf den Pfad, den du in Schritt 2 erstellt hast. Stell sicher, dass Meetily eine Datei pro Meeting schreibt, benannt nach Meeting-Titel und Zeitstempel.

Beende ein kurzes Test-Meeting in Meetily und beobachte das Tale-Connectors-Panel. Die Connector-Zeile zeigt einen **Letzte Auslieferung**-Zeitstempel, der innerhalb einer Minute (Folder-Modus) oder weniger Sekunden (Webhook-Modus) aktualisiert.

## Schritt 4 — Verifizieren, dass das Dokument landet und indiziert

Der Beweis, dass die Verdrahtung funktioniert, ist ein Transkript, das in der Wissensdatenbank als durchsuchbares Dokument sichtbar ist. Ohne diesen Schritt weißt du nicht, ob Tale die Datei empfangen _und_ indiziert hat.

Öffne das Zielprojekt, navigiere zu seiner Wissensdatenbank und such das neue Transkript oben in der Dokumentenliste. Klick in die Vorschau — das Transkript rendert als Dokument mit dem Meeting-Titel als Dokumentnamen und dem Meeting-Datum als Created-at. Wart, bis das Indizier-Badge sich klärt (wenige Sekunden für ein kurzes Transkript, bis zu eine Minute für ein langes), dann lauf eine Suche nach einem Namen oder einer Phrase, die du aus dem Test-Meeting erinnerst. Das Transkript sollte das erste Ergebnis mit der hervorgehobenen Phrase sein.

Liegt das Dokument vor, bleibt das Indizier-Badge aber orange, ist die Indexierung im Rückstand — die Seite [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting) nennt die Symptome.

## Vertrauensgrenze

Die Connector überquert in jede Richtung ein Netzwerk und die Datenform zählt.

- **Meetily → Tale.** Der Transkript-Body geht rüber, plus Meeting-Titel, Zeitstempel und alle Sprecher-Labels, die Meetily angehängt hat. Audio geht nicht rüber — Meetily transkribiert lokal und nur der Text wird ausgeliefert. Der Webhook-Pfad nutzt HTTPS mit dem Bearer-Token in der URL; der Folder-Pfad nutzt einen Dateisystem-Pfad ohne Netzwerk überhaupt.
- **Tale → Meetily.** Nichts. Die Connector ist einseitig; Tale ruft nie zurück in Meetily.
- **Tale → externe Dienste.** Der Transkript-Text geht zu dem Embedding-Anbieter, der an die Wissensdatenbank gebunden ist. Ist der Embedding-Anbieter ein lokaler (Ollama, LM Studio, vLLM über [Einen lokalen LLM-Anbieter anbinden](/de/tutorials/admin/connect-local-provider)), verlässt kein Transkript-Text den Host. Ist der Embedding-Anbieter OpenAI, Anthropic oder ein anderer gehosteter Endpunkt, wird der Transkript-Text gemäß der Daten-Handhabungs-Policy dieses Anbieters zur Vektorisierung dorthin geschickt.

Enthalten Transkripte Inhalte, die die Org nicht an einen Cloud-Anbieter senden kann, ist das unterstützte Pattern, die Wissensdatenbank des Projekts an ein lokales Embedding-Modell zu binden. Die Anbieter-Bindung passiert in den Wissensdatenbank-Einstellungen, nicht in dieser Connector.

## Wo das hingehört

Die Meeting-Transkriptions-Connector ist das sauberste Beispiel für „Tale indiziert, was deine anderen Tools schon produzieren" — kein Copy-Paste, kein manueller Upload, kein zusätzlicher Schritt im Meeting-Workflow. Die natürlichen nächsten Lesungen sind [Wissensdatenbank](/de/platform/knowledge/overview) dafür, wofür das indizierte Transkript dann in einem Agent verwendet werden kann, und [Einen lokalen LLM-Anbieter anbinden](/de/tutorials/admin/connect-local-provider), wenn der Abschnitt oben dich dazu drängt, den Embedding-Schritt auf dem Host zu behalten.
