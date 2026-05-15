---
title: Den ersten Agent end-to-end bauen
description: Einen gezielten Agent anlegen, Wissen anhängen, testen und eine Version veröffentlichen.
---

Generischer Chat beantwortet Fragen mit dem, womit das Modell trainiert wurde; ein zweckgebauter Agent antwortet mit dem Wissen deiner Organisation, in deinem Ton, eingegrenzt auf eine Aufgabe — „Produkt-Support", „HR-Richtlinien", „Sales-Enablement". Dieses Tutorial führt dich von einer leeren Agent-Seite zu einem versionierten Agent, den dein Team in der Chat-Agent-Auswahl wählen kann. Feature-Referenz liegt unter [Agent-Konzepte](/de/platform/agents/concepts) und [Einen Agent erstellen](/de/platform/agents/create); diese Seite verbindet die Schritte zu einem konkreten Ergebnis.

Das Ergebnis am Ende ist ein veröffentlichter Agent mit einer Aufgabe, dem richtigen Wissens-Scope und einem Rauchtest, den du selbst gefahren bist.

## Bevor du beginnst

Du brauchst Redakteur-Zugriff oder höher in deiner Tale-Instanz — Inhaber, Admin, Entwickler und Redakteur qualifizieren sich; Mitglied und Deaktiviert nicht. Prüfe die Rolle auf deiner Profilseite, wenn du unsicher bist. Du brauchst außerdem mindestens einen Ordner in der [Wissensdatenbank](/de/platform/workspace/knowledge-base), der zur Aufgabe des Agents passt; ist das Wissen deiner Organisation noch nicht in Ordnern strukturiert, lege einen mit drei oder vier repräsentativen Dokumenten an, bevor du weitermachst — ein Agent ohne relevantes Wissen lässt sich nicht ehrlich testen.

Kein externes Konto, kein API-Schlüssel, kein Feature-Flag.

## Schritt 1 — Entscheide, wofür der Agent da ist

Das Schwierigste an einem Agent ist zu benennen, was er **nicht** tut. Bevor du irgendwo klickst, schreib einen Satz auf Papier oder in ein Notizfeld: „Dieser Agent beantwortet X mit Y und macht Z nicht." Zum Beispiel: „Dieser Agent beantwortet Produkt-Support-Fragen mit dem Help-Center-Ordner und gibt keinen rechtlichen oder Abrechnungs-Rat." Dieser Satz wird zum Rückgrat deiner Systemanweisungen — ohne ihn driftet der Agent in Richtung dessen, was der Nutzer fragt, auch wenn die Antwort außerhalb seines Scopes liegt.

Der Schritt hat funktioniert, wenn der Satz Aufgabe und Ablehnungsfälle des Agents beide explizit macht.

## Schritt 2 — Den Agent erstellen

Öffne **Agents** in der Seitenleiste und klicke **Agent erstellen**. Gib einen **Anzeigenamen** ein („Produkt-Support"), einen **Internen Namen** — einen URL-tauglichen Slug, der in API-Aufrufen und der Chat-URL benutzt wird (`product-support`), und eine kurze Beschreibung. Speichern.

Der interne Name ist faktisch dauerhaft: Agents werden per Slug aus Automatisierungen, der API und der Chat-URL adressiert, also bricht ein späteres Umbenennen jeden Link, der auf den alten Namen zeigt. Wähle etwas, mit dem du leben kannst.

Der Schritt hat funktioniert, wenn die Konfigurationsseite des Agents mit ihren Tabs (Anweisungen, Wissen, Tools, Konversationsstarter, Webhook, Versionen) oben angeordnet öffnet.

## Schritt 3 — Die Anweisungen schreiben

Öffne den **Anweisungen**-Tab und füge einen Systemprompt ein, der auf dem Satz aus Schritt 1 aufbaut. Das Skelett unten deckt die vier Dinge ab, die jeder Agent-Prompt braucht — Identität, Scope, Regeln, Output-Form:

```text
Du bist <Rolle> für <Organisation>.

Deine Aufgabe ist es, <Aufgabe> zu tun, mit <Scope des Wissens>.

Regeln:
- Antworte immer in der Sprache des Nutzers.
- Zitiere das Quelldokument, wenn du aus der Wissensdatenbank antwortest.
- Liegt eine Frage ausserhalb des Scopes, sag das und schlage vor, wo gefragt werden kann.

Ton: <Ton>.
Format: <Format>.
```

Wähle ein **Modell-Preset** (Fast / Standard / Advanced), das zur Aufgabe passt: Fast für kurze Lookups, Advanced für mehrstufiges Reasoning. Die Zuordnung von Preset zu tatsächlichem Modell liegt in [Agent-Konzepte — Modell](/de/platform/agents/concepts#model).

Änderungen speichern automatisch; ein Indikator oben rechts zeigt den Speicher-Stand.

Der Schritt hat funktioniert, wenn der Speicher-Indikator auf „gespeichert" steht und die Prompt-Vorschau den eingefügten Text ungekürzt rendert.

## Schritt 4 — Das Wissen eingrenzen

Öffne den **Wissen**-Tab. Die Voreinstellung ist die ganze Wissensdatenbank der Organisation, was fast immer zu breit ist — irrelevante Suchtreffer verdrängen die relevanten, und die Antworten des Agents werden unscharf. Hake alles ab, was nicht zur Aufgabe des Agents gehört, und lass nur die passenden Ordner aktiv.

Ein enger Scope produziert schärfere Antworten. Ein Support-Agent, der nur `Help Center` liest, schlägt einen Support-Agent, der jeden Ordner der Organisation liest, jedes Mal.

Der Schritt hat funktioniert, wenn der Wissen-Tab einen oder zwei Ordner aktiv listet und der Rest abgehakt ist.

## Schritt 5 — Tools abschalten, die du nicht brauchst

Öffne den **Tools**-Tab und deaktiviere alles, was der Agent nicht nutzen soll. Ein Support-Agent braucht wahrscheinlich keine Websuche; ein Recherche-Agent braucht wahrscheinlich keine Abrechnungs-Integration. Weniger Tools bedeutet weniger Überraschungen in Produktion — und weniger Tools, über die das Modell nachdenken muss, was die Antwort beschleunigt.

Der Schritt hat funktioniert, wenn nur die Tools eingeschaltet sind, die der Agent wirklich nutzt.

## Schritt 6 — Konversationsstarter hinzufügen

Öffne den **Konversationsstarter**-Tab und füge zwei oder drei Beispiel-Prompts hinzu. Die Starter erscheinen auf dem leeren Bildschirm, wenn ein Nutzer eine neue Konversation mit dem Agent öffnet, und dienen als Rauchtest-Liste für Schritt 7: antwortet ein Starter gut, zeigt der Agent zumindest in die richtige Richtung.

Der Schritt hat funktioniert, wenn die Starter unter dem Composer erscheinen, sobald du einen neuen Chat mit dem Agent öffnest.

## Schritt 7 — Aus dem Chat testen

Öffne **Chat** in der Seitenleiste, wähle den neuen Agent in der Agent-Auswahl und probier jeden Konversationsstarter plus ein oder zwei Fragen, die du von einem Kollegen erwarten würdest. Achte auf drei Dinge: zitiert der Agent die richtigen Dokumente, lehnt er Out-of-Scope-Fragen sauber ab, und passt der Ton zu dem, was du in den Anweisungen geschrieben hast.

Iteriere, indem du zurück in den Anweisungen-Tab gehst, den Prompt straffst und erneut testest. Diese Schleife ist der Großteil des Agent-Bauens — die meisten Agents brauchen drei oder vier Runden, bevor sie gut sind.

Der Schritt hat funktioniert, wenn der Agent eine repräsentative In-Scope-Frage mit Zitat beantwortet und eine Out-of-Scope-Frage mit einer Satz-langen Umleitung ablehnt.

## Schritt 8 — Eine Version veröffentlichen

Jede Änderung bis hierhin hat einen **Entwurf** aktualisiert; die Live-Version (sofern es eine vorherige gibt) serviert weiter den Chat, bis du veröffentlichst. Klicke **Veröffentlichen** im Versions-Header. Zukünftige Änderungen starten einen neuen Entwurf — Nutzer treffen weiter die veröffentlichte Version, bis du erneut veröffentlichst.

Der Schritt hat funktioniert, wenn der Versions-Header eine frische Versionsnummer und ein „Veröffentlicht"-Badge zeigt und der Entwurf-Tab des Agents leer ist.

## Fehlerbehebung

- **Der Agent zitiert auf jede Frage das falsche Dokument** — der Scope des Wissen-Tabs ist immer noch zu breit, oder ein Ordner dominiert nach Dokumentenanzahl. Engere weiter ein oder teile in zwei Agents (`support-public` und `support-internal`) mit unterschiedlichem Scope.
- **Der Agent lehnt In-Scope-Fragen ab** — der „Regeln"-Abschnitt des Systemprompts ist zu restriktiv, oder die Aufgabenbeschreibung passt nicht dazu, wie Nutzer Fragen wirklich formulieren. Lockere die Regeln und formuliere die Aufgabe in der Sprache des Nutzers.
- **Konversationsstarter erscheinen nicht** — der Agent hat mindestens eine veröffentlichte Version, aber du siehst eine Entwurfsvorschau, oder die Starter wurden auf einem anderen Agent-Entwurf gespeichert. Wechsle in die Vorschau der veröffentlichten Version.
- **Veröffentlichen schlug mit Validierungsfehler fehl** — Pflichtfelder (Anzeigename, Slug, Systemanweisungen) sind leer oder der Slug kollidiert mit einem bestehenden Agent. Der Fehler-Toast nennt das Feld.

## Wo das einsetzt

Was du gebaut hast, ist ein versionierter, wissensgescopter Agent, den dein Team aus der Chat-Auswahl wählen kann — und derselbe Agent ist auch aus Automatisierungen, der öffentlichen API und dem Webhook-Tab erreichbar, ohne zusätzliche Verdrahtung. Die vier Entscheidungen, die du gerade getroffen hast (Anweisungen, Wissen, Tools, Modell), halten über jede Oberfläche, auf der der Agent läuft — das ist der ganze Sinn der Agent-Abstraktion.

Zwei natürliche nächste Schritte von hier: lass Skripte den Agent direkt aufrufen mit [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script), oder binde denselben Agent mit [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) in einen mehrstufigen Workflow ein.
