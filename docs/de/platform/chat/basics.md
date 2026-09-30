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

Sind mehrere nutzbare Modelle verfügbar, startet die Auswahl mit **Auto**. Auto wählt für jede Nachricht ein Modell aus dem verfügbaren Angebot deiner Organisation. Organisationsregeln können ein Standardmodell festlegen oder die Auswahl einschränken. In den Antwortdetails siehst du, welches Modell tatsächlich geantwortet hat.

Wähle ein bestimmtes Modell, wenn du Antworten vergleichen möchtest oder weißt, welches Modell zur Arbeit passt. Die Auswahl bleibt bestehen, bis du sie änderst – auch der Anbieter, der das Modell bereitstellt, wenn zwei Anbieter dasselbe Modell anbieten. Unterstützt das Modell einen einstellbaren Denkaufwand, erscheint auch diese Einstellung. Mehr Denkaufwand kann länger dauern und ersetzt keine Prüfung der Antwort.

<Frame caption="Die Modellauswahl steht neben dem Anhangsmenü und den Sprachfunktionen.">

![Das Nachrichtenfeld zeigt das Plus-Menü, die Modellauswahl Auto, ein Mikrofon und die Sende-Schaltfläche.](/images/platform/chat-composer.webp)

</Frame>

Sind keine Modelle verfügbar, bitte einen Admin, aktive Zugangsdaten und den Modellzugriff zu prüfen. Unter [Modelle](/de/platform/models) steht, wie der Katalog entsteht.

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

Der Assistent durchsucht unter anderem Dokumente, Wissenseinträge, Websites, Kontakte, Produkte, zugängliche Aufgaben und die Inbox-Konversationen, die du sehen darfst. Dabei findet er auch den Text der E-Mails, die in diesen Konversationen eingegangen sind, und den ihrer Anhänge. Eine Aufgabe lässt sich über ihren Schlüssel nennen, etwa `DOCS-12`, wie das Board ihn anzeigt. Er kann Details zu einem Ergebnis abrufen und öffentliche Webseiten lesen. Code ausführen, verbundene Systeme ändern, Bilder erzeugen, Dateiergebnisse erstellen oder [Skills](/de/platform/workspace/skills) nutzen gehört nicht zum Chat. Lege dafür eine [Projektaufgabe](/de/platform/projects/tasks) an. Jeder, der das Projekt öffnen kann, kann sie anlegen und einem der Agenten des Projekts übergeben; [Aufgabe aus Chat erstellen](#create-task-from-chat) legt sie aus dem Gespräch an. Ein Projektagent, der an der Aufgabe arbeitet, kann Bilder erstellen, wenn ein Admin die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet hat.

## Aus einem Chat eine Aufgabe machen {#create-task-from-chat}

Endet ein Gespräch in Arbeit, die eine Datei braucht, etwa eine Präsentation, einen Bericht oder eine Tabelle, übergib sie einem Projekt-Agenten. Öffne das Menü **⋯** des Gesprächs und wähle **Aufgabe aus Chat erstellen**. Liegt der Chat in einem Projekt, entsteht die Aufgabe dort; sonst wählst du zuerst das Projekt. Der Aufgabendialog öffnet sich mit deiner letzten Anfrage als Beschreibung, einem Link zurück zum Chat und den Dateien, die du im Gespräch angehängt hast. Passe alles nach Bedarf an, wähle den Agenten unter **Zuständig** und klicke auf **Aufgabe erstellen**. **Aufgabe öffnen** in der Bestätigung führt dich zur Aufgabe, wo **Agent starten** sie ausführt.

<Frame caption="Aufgabe aus Chat erstellen öffnet den Aufgabendialog mit der Anfrage und einem Link zurück zum Chat.">

![Der Dialog zum Erstellen einer Aufgabe enthält als Titel und Beschreibung „Plan the quarterly business review agenda for Friday“ und unter der Anfrage einen Link mit der Beschriftung From the chat.](/images/platform/chat-create-task.webp)

</Frame>

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
