---
title: Fragen im Chat stellen
description: Sende eine Nachricht, wähle ein Modell, prüfe die Quellen und bewahre hilfreiche Gespräche auf.
---

Nutze den Chat, um Fragen zu stellen, ein Dokument zu verstehen oder Informationen in Tale zu recherchieren. Der Assistent kann zugängliches Wissen durchsuchen und öffentliche Seiten lesen. Beginne mit einer konkreten Frage und grenze die Antwort anschließend mit Rückfragen ein.

<Frame caption="Der Chat hält deine Frage, die Schritte des Assistenten und seine Antwort zusammen.">

![Ein Chat zu Onboarding-Rückmeldungen zeigt die Frage und eine Antwort mit drei Themen in einer Tabelle.](/images/platform/chat-thread-reply.webp)

</Frame>

## Die erste Nachricht senden

Öffne **Start**. Am Computer öffnet sich dabei der Chat, den du zuletzt gelesen hast, falls es einen gibt. Für ein neues Thema wählst du **Neuer Chat** oben in der Liste von **Start** oder klickst am Computer erneut auf **Start**, während der Bereich aktiv ist. Schreibe in das Nachrichtenfeld. Mit **Enter** sendest du, mit **Shift+Enter** fügst du einen Zeilenumbruch ein. Ein vorgeschlagener Gesprächseinstieg funktioniert wie eine eigene erste Frage. Ergänze Quelle, Thema und die Art der Antwort, die du brauchst.

Zum Beispiel: „Finde die Onboarding-Rückmeldungen und fasse die drei häufigsten Probleme zusammen. Nenne die Dokumente als Quellen und trenne gemeldete Probleme von deinen Vorschlägen.“

Hat deine Organisation einen Vertraulichkeitshinweis eingeschaltet, steht er unter dem Nachrichtenfeld und erinnert dich daran, was du im Chat nicht teilen solltest.

Während die Antwort erscheint, wird aus der Sende- eine Stopp-Schaltfläche. Beim Stoppen bleibt der bereits empfangene Text erhalten, auch wenn er mitten im Satz endet. Stelle eine Rückfrage, um dein Anliegen zu präzisieren oder fehlende Details anzufordern.

## Ein Modell gezielt auswählen

Sind mehrere nutzbare Modelle verfügbar, startet die Auswahl mit **Auto**. Auto wählt für jede Nachricht ein Modell aus dem verfügbaren Angebot deiner Organisation. Organisationsregeln können ein Standardmodell festlegen oder die Auswahl einschränken. In den [Antwortdetails](#reply-details) siehst du, welches Modell tatsächlich geantwortet hat.

Wähle ein bestimmtes Modell, wenn du Antworten vergleichen möchtest oder weißt, welches Modell zur Arbeit passt. Die Auswahl bleibt bestehen, bis du sie änderst – auch der Anbieter, der das Modell bereitstellt, wenn zwei Anbieter dasselbe Modell anbieten. Unterstützt das Modell einen einstellbaren Denkaufwand, erscheint auch diese Einstellung. Mehr Denkaufwand kann länger dauern und ersetzt keine Prüfung der Antwort.

<Frame caption="Die Modellauswahl steht neben dem Anhangsmenü und den Sprachfunktionen.">

![Das Nachrichtenfeld zeigt das Plus-Menü, die Modellauswahl Auto, ein Mikrofon und die Sende-Schaltfläche.](/images/platform/chat-composer.webp)

</Frame>

Sind keine Modelle verfügbar, bitte einen Admin, aktive Zugangsdaten und den Modellzugriff zu prüfen. Der Chat bietet nur Modelle an, die Zugangsdaten per API-Schlüssel oder Umgebungsvariable bereitstellen: Ein Abo läuft nur in Aufgaben und Automatisierungen, und die Modellliste nennt die Abos, die sie auslässt. Unter [Modelle](/de/platform/models) steht, wie der Katalog entsteht.

## Die passenden Quellen bereitstellen

Wähle den Ort des Chats, bevor du Fragen zu Dateien stellst:

| Ort der Frage | Abrufbare Dateien |
| --- | --- |
| Allgemeiner Chat der Organisation | Zugängliche Dokumente der Wissensbibliothek und die Anhänge dieses Chats. |
| Chat in einem Projekt | Dateien dieses Projekts, zugängliche Dokumente der Wissensbibliothek und eigene Chat-Anhänge. |
| Link zu einem geteilten Chat | Eine schreibgeschützte Momentaufnahme; dort lassen sich keine Rückfragen stellen. |

Ein Projektchat erhält außerdem die festen Projektanweisungen. Tale erzwingt den Dateizugriff: Die Aufforderung, ein anderes Projekt zu lesen, erweitert die Berechtigung nicht. Dateien im Papierkorb oder mit abgelaufener Aufbewahrung sind nicht durchsuchbar.

Nutze [Anhänge](/de/platform/chat/attachments) für dieses Gespräch, [Projektdateien](/de/platform/projects/manage-files) für wiederkehrende Projektarbeit und [Wissen](/de/platform/knowledge/overview) für gemeinsame Referenzquellen. Der Assistent ruft Inhalte nach Bedarf ab. Ein hochgeladenes Dokument wurde deshalb nicht automatisch für jede Antwort gelesen.

Für Fragen zu Tale selbst musst du nichts hochladen: Der Assistent schlägt in der öffentlichen Dokumentation auf docs.tale.dev nach, bevor er erklärt, wie eine Ansicht oder Einstellung funktioniert. Kann der Server docs.tale.dev nicht erreichen, etwa bei einer selbst gehosteten Installation ohne Internetzugang, zeigt der Ablauf einen fehlgeschlagenen Leseschritt, und die Antwort stützt sich nicht auf die Dokumentation. Die Dokumentation beschreibt die neueste Version; der Assistent weist darauf hin, wenn dein Arbeitsbereich davon abweichen kann.

## Die verwendeten Quellen prüfen

Über der Antwort zeigt der Ablauf die Such- und Leseschritte. Bei einem fehlgeschlagenen Schritt erfährst du, was nicht gelesen werden konnte. Das hilft bei unvollständigen Antworten. Klappe die Denkansicht auf, sofern vorhanden, aber prüfe Tatsachen anhand der Quellen und nicht anhand einer überzeugenden Erklärung.

Unter **Quellen** stehen die geladenen Dokumente und Seiten. Öffne eine Quelle und prüfe, ob sie die jeweilige Aussage stützt. Eine Quellenangabe zeigt verwendetes Material, garantiert aber keine richtige Schlussfolgerung. Ohne Abrufschritt kann eine Antwort auf dem Vorwissen des Modells beruhen.

Der Assistent durchsucht unter anderem Dokumente, Wissenseinträge, Websites, Kontakte, Produkte, zugängliche Aufgaben und die Inbox-Konversationen, die du sehen darfst. Dabei findet er auch den Text der E-Mails, die in diesen Konversationen eingegangen sind, und den ihrer Anhänge. Eine Aufgabe lässt sich über ihren Schlüssel nennen, etwa `DOCS-12`, wie das Board ihn anzeigt. Er kann Details zu einem Ergebnis abrufen und öffentliche Webseiten lesen. Code ausführen, verbundene Systeme ändern, Bilder erzeugen, Dateiergebnisse erstellen oder [Skills](/de/platform/workspace/skills) nutzen gehört nicht zum Chat. Lege dafür eine [Projektaufgabe](/de/platform/projects/tasks) an. Jeder, der das Projekt öffnen kann, kann sie anlegen und einem der Agenten des Projekts übergeben; [Aus einem Chat eine Aufgabe machen](#create-task-from-chat) zeigt, wie du sie direkt aus dem Gespräch anlegst. Ein Projektagent, der an der Aufgabe arbeitet, kann Bilder erstellen, wenn ein Admin die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet hat.

## Sehen, wie eine Antwort entstanden ist {#reply-details}

Wähle unter einer Antwort **Info anzeigen**, um die **Nachrichteninformation** zu öffnen. Sie nennt das Modell, das geantwortet hat, und seinen **Anbieter**, zeigt, wie lange die Antwort gedauert und wie viele Tokens sie verbraucht hat, und sagt, wo sie verarbeitet wurde, sofern das bekannt ist.

- **Zeit bis zum ersten Token** ist die Zeit, bis die ersten Wörter der Antwort entstanden sind. **Ausgabetempo** gibt an, wie schnell das Modell geschrieben hat, in Tokens pro Sekunde, und **Gesamtzeit**, wie lange die ganze Antwort gedauert hat. Der Balken darunter teilt diese Zeit in Vorbereitung, Warten auf das Modell, Denken und Schreiben auf. Hat die Antwort Tools verwendet, etwa eine Dokumentsuche, zählt deren Laufzeit zur Zeit bis zum ersten Token. Der Balken zeigt die Arbeit des Modells und die Tools dann als einen Anteil, Modell und Tools, und danach das Schreiben, sofern die Antwort erst nach den Tools kam. **Ausgabetempo** fehlt in diesem Fall, weil sich das Schreiben des Modells mit diesen Messwerten nicht von den Tools trennen lässt. Der Server misst ab dem Moment, in dem er mit der Antwort begonnen hat. Die Zeit, bis die ersten Wörter auf deinem Bildschirm erschienen, steht unter dem Balken und kann deshalb länger sein.
- **Verarbeitet von** nennt das Unternehmen, das das Modell ausgeführt hat, wenn dein Anbieter Anfragen weitergibt. OpenRouter kann zum Beispiel dasselbe Claude-Modell über Anthropic, Amazon Bedrock oder Google Vertex bereitstellen.
- **Region** gibt an, wo die Antwort verarbeitet wurde, aber nur, wenn der Anbieter sie gemeldet hat, wie es Azure OpenAI tut (zum Beispiel Switzerland North), oder wenn die Anfrage an einen regionalen Endpoint ging, dessen Anbieter die Verarbeitung in einer Region zusichert, etwa `eu.openrouter.ai` oder `eu.api.openai.com`. Sonst steht dort **Nicht gemeldet**: Tale leitet keinen Standort aus dem Namen oder dem Sitz eines Anbieters ab. Bei Azure kann eine Bereitstellung vom Typ Global eine Anfrage in jeder Region verarbeiten, unabhängig davon, welche Region die Antwort nennt. Eine Datenzonen-Bereitstellung verarbeitet innerhalb ihrer Datenzone, etwa der EU, eine regionale Bereitstellung innerhalb ihrer Geografie.
- **Modellversion** erscheint, wenn der Anbieter ein genaueres Modell meldet als das angefragte, etwa eine datierte Version hinter einem Alias oder das Modell hinter dem Namen einer Azure-Bereitstellung.

## Aus einem Chat eine Aufgabe machen {#create-task-from-chat}

Endet ein Gespräch in Arbeit, die eine Datei braucht, etwa eine Präsentation, einen Bericht oder eine Tabelle, übergib sie einem Projekt-Agenten. Wähle im Kopf des Gesprächs **Aufgabe erstellen**; auf einem schmalen Bildschirm findest du **Aufgabe aus Chat erstellen** im Menü **⋯**. Liegt der Chat in einem Projekt, entsteht die Aufgabe dort. Sonst wählst du zuerst das Projekt: Unter **Mit Agent** stehen die Projekte, die du öffnen kannst und die Agenten haben, samt ihrer Anzahl. Ein Projekt ohne eigene Agenten steht dort mit **Standard-Agent**: Seine Aufgabe geht an den [Standard-Agenten](/de/platform/projects/project-agents#standard-agent) der Organisation. Kann der Standard-Agent für dich nicht laufen, etwa weil ein Admin ihn ausgeschaltet hat, stehen solche Projekte stattdessen unter **Noch ohne Agent**, jeweils mit dem Hinweis, wer einen hinzufügen kann.

Der Aufgabendialog öffnet sich mit deiner letzten Anfrage als Beschreibung, einem Link zurück zum Chat und den Dateien, die du im Gespräch angehängt hast. Hat das Projekt genau einen Agenten oder nutzt es den Standard-Agenten, ist er unter **Zuständig** schon eingetragen; sonst wählst du einen. Passe alles nach Bedarf an und wähle dann **Erstellen und Agent starten**: Die Aufgabe entsteht, und der Agent beginnt sofort damit. **Nur erstellen** legt sie an, ohne den Agenten zu starten; das holst du später mit **Agent starten** in der Aufgabe nach.

<Frame caption="Aufgabe erstellen öffnet den Aufgabendialog mit der Anfrage, einem Link zurück zum Chat und dem Agenten, der sie übernimmt.">

![Der Dialog zum Erstellen einer Aufgabe enthält als Titel und Beschreibung „Plan the quarterly business review agenda for Friday“, unter der Anfrage einen Link mit der Beschriftung From the chat, Content editor als zuständigen Agenten und die Schaltflächen Create only und Create and start agent.](/images/platform/chat-create-task.webp)

</Frame>

Danach steht die Aufgabe über dem Nachrichtenfeld des Chats, mit dem, was sie gerade tut: **Der Agent arbeitet**, **Wartet auf einen Sandbox-Platz**, **Wird erneut versucht…**, **Bereit zur Prüfung** mit der Zahl der gelieferten Dateien oder **Der Agent konnte sie nicht fertigstellen**. **Öffnen** führt dich zur Aufgabe. Du wirst außerdem benachrichtigt, wenn sie zur Prüfung bereit ist und wenn der Agent nicht fertig wird; [Wenn der Agent nicht fertig wird](/de/platform/projects/task-automation#wenn-der-agent-nicht-fertig-wird) erklärt, wie es weitergeht.

<Frame caption="Die Aufgabe, die ein Chat übergeben hat, zeigt ihren Fortschritt über dem Nachrichtenfeld.">

![Über dem Nachrichtenfeld nennt eine Zeile die Aufgabe „Plan the quarterly business review agenda for Friday“ mit Ready for review · Website relaunch und einem Link Open.](/images/platform/chat-task-tray.webp)

</Frame>

Bittest du den Assistenten um eine solche Datei, beantwortet er, was in eine Antwort passt, und führt dich dann für deine eigenen Projekte durch diese Schritte, mit den Beschriftungen, die du siehst.

Bietet kein Projekt, das du öffnen kannst, einen Agenten an? Dann kann der Standard-Agent für dich nicht laufen: Ein Admin hat ihn vielleicht unter [Richtlinien > Modelle](/de/platform/admin/governance/content-models#standard-agent) ausgeschaltet, oder kein Modell, das du nutzen darfst, kann ihn ausführen. Frag einen Admin danach, oder bitte einen Redakteur oder Admin, im Tab **Agenten** des Projekts einen Agenten hinzuzufügen. Als Redakteur kannst du auch direkt in der Aufgabe einen hinzufügen: Wähle unter **Zuständig** **Agent erstellen …**.

Dateien kommen nur aus deinem eigenen Gespräch mit. Eine Aufgabe nimmt nur die Uploads der Person an, die sie erstellt; eine Aufgabe aus einem Chat, den jemand in ein Projekt geteilt hat, beginnt deshalb ohne sie.

## Ein Gespräch fortsetzen oder aufbewahren

Über die Antwortleiste kopierst du Text, gibst Feedback, öffnest Details oder zweigst das Gespräch an dieser Stelle ab. Mit einer Abzweigung probierst du eine andere Richtung aus und behältst den bisherigen Austausch.

Frühere Chats findest du im Bereich [Start](/de/platform#home); die Ansicht **Chats** über der Liste zeigt nur deine Chats. Pinne häufig benötigte Chats, gib ihnen erkennbare Titel oder verschiebe sie in ein Projekt, wenn das Thema längerfristig wird: Zieh sie auf das Projekt oder wähle **In Projekt verschieben…** in ihrem Menü. [Geteilte Chats](/de/platform/chat/shared-threads) erklärt die schreibgeschützte Freigabe für Kollegen.

Sehr lange Gespräche können das Kontextfenster des Modells überschreiten. Tale zeigt einen Hinweis, wenn ältere Nachrichten nicht mehr mitgegeben werden. Wiederhole wichtige Anforderungen oder beginne einen neuen Chat mit den benötigten Quellen, statt die vollständige Historie vorauszusetzen.

## Eine unvollständige Antwort verbessern

| Problem | Nächster Schritt |
| --- | --- |
| Die Antwort bleibt zu allgemein | Stelle eine Frage, benenne die Zielgruppe und gib Länge oder Format vor. |
| Eine Datei wurde nicht verwendet | Prüfe Projektzuordnung, Indexierungsstatus und Abrufschritte. Nenne die Datei ausdrücklich. |
| Die Suche meldet eine nicht verfügbare Quelle | Bitte einen Admin, den genannten Dienst oder die Embedding-Konfiguration zu prüfen. Ein leeres Ergebnis beweist nicht, dass die Information fehlt. |
| Eine Antwort endet mit einem Fehler | Lies die Fehlermeldung, prüfe das gewählte Modell und versuche es nach Behebung erneut. Tale wechselt nicht still den Anbieter. |
| Eine Antwort bleibt leer | Der Hinweis an ihrer Stelle nennt den Grund: Das Modell hat nichts geliefert, es hat sein Limit für Ausgabe-Tokens vor dem Schreiben aufgebraucht, oder der Inhaltsfilter des Anbieters hat die Antwort zurückgehalten. Wähle **Erneut versuchen**, oder verringere vorher den Denkaufwand, kürze die Anfrage oder wähle ein anderes Modell. |

Ein angeleitetes Beispiel mit Quellenprüfung findest du unter [Bessere Fragen im Chat](/de/tutorials/member/chat-effectively).
