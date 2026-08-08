---
title: KI-Anbieter
description: Verbinde deine Organisation mit den Modellen, die sie aufrufen darf — die mitgelieferten Anbieter-Connectoren, die Zugangsdaten, die du dagegen hinterlegst, und die Standards, erlaubten Modelle und Kataloge, die bestimmen, was alle anderen auswählen können.
---

Bevor deine Organisation nicht für mindestens einen KI-Anbieter funktionierende Zugangsdaten hat, beantwortet Tale keinen einzigen Prompt. **Einstellungen > KI-Anbieter** ist der Ort, an dem diese Zugangsdaten leben, und der einzige, an dem du neue anlegst. Admins und Developer öffnen die Seite; alle anderen begegnen ihrem Ergebnis später — als der Liste von Modellen, die sie im Chat, auf einem Agenten oder in einem Workflow-Schritt auswählen können.

## Connectoren und Zugangsdaten

Auf dieser Seite treffen zwei verschiedene Dinge aufeinander, und wer sie auseinanderhält, versteht den Rest sofort.

Ein **Connector** ist das mitgelieferte Wissen der Plattform über einen Anbieter: welchen Wire-Dialekt er spricht, auf welchem Endpunkt er antwortet, woher seine Modellliste kommt und welche Arten von Authentifizierung er akzeptiert. Connectoren kommen mit der Plattform. Du kannst keinen über die UI anlegen, ändern oder entfernen, und ein Upgrade der Plattform kann weitere mitbringen.

**Zugangsdaten** sind deine Hälfte — der Teil, der einen Aufruf tatsächlich autorisiert. Du hinterlegst so viele davon pro Connector, wie du brauchst: einen Produktions- neben einem Staging-Schlüssel, einen Schlüssel pro Abteilung, eine von Ops verwaltete Variable neben einem, den du von Hand rotierst. Jeder Eintrag trägt einen Namen, eine Authentifizierungsmethode, optional eine Liste erlaubter Modelle und einen Aktiv-Zustand — und einer davon ist der Standard.

Diese Connectoren werden heute mitgeliefert:

| Connector            | Wire-Format            | Modellkatalog                 |
| -------------------- | ---------------------- | ----------------------------- |
| OpenRouter           | OpenAI-kompatible API  | OpenRouter-Katalog            |
| OpenAI               | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Anthropic            | Anthropic-Messages-API | Mitgelieferter Katalog        |
| Gemini               | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Azure OpenAI         | OpenAI-kompatible API  | Kein Katalog                  |
| DeepSeek             | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Moonshot AI (Kimi)   | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Qwen (Alibaba)       | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| SpaceXAI             | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Z.ai (GLM)           | OpenAI-kompatible API  | Mitgelieferter Katalog        |
| Vercel AI Gateway    | OpenAI-kompatible API  | Models-Endpunkt des Anbieters |
| Nous Portal (Hermes) | OpenAI-kompatible API  | Kein Katalog                  |

## Was die Seite zeigt

**Zugangsdaten** ist eine Tabelle dessen, was deine Organisation tatsächlich hält — eine Zeile pro gespeichertem Eintrag, nicht eine pro ausgeliefertem Anbieter. Eine Zeile zeigt den Namen, den Anbieter, gegen den sie sich authentifiziert, die Authentifizierungsmethode und die Koordinaten: eine maskierte Vorschau des gespeicherten Schlüssels oder den Namen der Umgebungsvariable dahinter, dazu die eigene Endpoint-URL dort, wo der Anbieter eine braucht, und wie viele Modelle die Liste erlaubt. Ein **Standard**-Badge markiert den Eintrag, auf den Anfragen zurückfallen, ein **Deaktiviert**-Badge jeden abgeschalteten. Alles Weitere steckt im Aktionsmenü der Zeile.

Zwei Warnungen erscheinen hier statt in einem Dialog. Ein Anbieter, dessen Modellkatalog nicht geladen werden konnte, sagt das auf jeder Zeile, die von ihm abhängt — ein funktionierender Schlüssel nützt nichts, solange Tale nicht weiß, welche Modelle der Anbieter bedient. Und ein Anbieter mit Zugangsdaten, aber ohne Standard, wird über der Tabelle genannt: Anfragen können nicht automatisch wählen, solange du keinen Eintrag zum Standard machst.

Unter der Tabelle zeigt **Harnesses**, wie sich jede Coding-Harness für deine Organisation auflöst. Der Abschnitt ist nur lesbar; geändert wird er über die Zugangsdaten darüber.

## Zugangsdaten hinzufügen

<Steps>

<Step title="Den Anbieter wählen">

**Zugangsdaten hinzufügen** öffnet den mitgelieferten Katalog. Anbieter, für die du schon Zugangsdaten hältst, stehen zuerst unter **In Verwendung**; alles andere folgt darunter, alphabetisch. Jeder Eintrag nennt seine Wire-Fakten — das API-Format und den Endpunkt-Host, etwa `OpenAI-kompatible API · openrouter.ai`, oder `Endpunkt pro Eintrag` — und wie viele Modelle sein Katalog hält. Die Suche grenzt die Liste ein; eine Auswahl führt zum Formular, **Zurück zum Katalog** wieder heraus.

Weil das Formular zum gewählten Anbieter gehört, bietet es nur an, was dieser akzeptiert — nach einer Basis-URL, die die Plattform längst kennt, wirst du nie gefragt.

</Step>

<Step title="Die Authentifizierungsmethode wählen">

Die Methode schaltet den Rest des Formulars um: ein Secret-Feld für **API-Schlüssel** und **Abo-Schlüssel**, einen Variablennamen für **Umgebungsvariable**, das vollständige Broker-Formular für **Abo-Broker**.

</Step>

<Step title="Für die nächsten Leser benennen">

**Name** ist das, was jeder spätere Bildschirm anstelle des Secrets zeigt. Benenne den Eintrag nach seinem Zweck — `Produktionsschlüssel`, `Team Finanzen`, `Von Ops verwaltet` —, denn genau dieses Label wählt Monate später jemand aus einer Liste.

</Step>

<Step title="Entscheiden, ob du einschränkst">

**Erlaubte Modelle** ist optional. Lässt du das Feld leer, darf der Eintrag alles aus dem Katalog des Connectors nutzen; füllst du es, bleibt er auf deine Auswahl beschränkt.

</Step>

</Steps>

### API-Schlüssel

Füg das Secret in **API-Schlüssel** ein. Tale speichert es verschlüsselt und zeigt es nie wieder — die Zeile zeigt eine maskierte Vorschau, nicht den Schlüssel. Zum Rotieren öffnest du das Menü der Zeile und wählst **API-Schlüssel ersetzen**; der Austausch greift sofort überall dort, wo diese Zugangsdaten verwendet werden.

### Umgebungsvariable

Hier gelangt der Schlüssel gar nicht erst in Tale. Er bleibt auf dem Deployment, und die Zugangsdaten merken sich nur den Namen der Variable, die ihn hält. Du tippst nur das Suffix; das reservierte Präfix `TALE_PROVIDER_KEY_` steht fest und lässt sich nicht wegeditieren.

<Note>

Jeder Name ausserhalb dieses Präfixes wird abgelehnt, das Feld kann also nie auf ein fremdes Deployment-Geheimnis zeigen. Namen sind auf 40 Zeichen begrenzt. Die Variable selbst stellt bereit, wer das Deployment betreibt — die Operator-Seite steht in [Anbieter](/de/self-hosted/configuration/providers).

</Note>

### Abo-Schlüssel und Broker

Zwei Methoden decken Abonnements statt abgerechneter API-Schlüssel ab. **Abo-Schlüssel** speichert das Abo-Secret eines Anbieters direkt; ein Nous-Portal-Abo ist einer der mitgelieferten Fälle. **Abo-Broker** zeigt auf einen Endpunkt, der einen Pool rotierender OAuth-Tokens ausgibt — die Form, die ein Claude-Abo nutzt.

Das Broker-Formular fragt nach **Broker-Endpunkt** und **HTTP-Methode**, dann unter **Broker-Authentifizierung** danach, wie Tale sich beim Broker ausweist: Keine, Bearer-Token oder Eigener Header, mit **Header-Name** und **Broker-Secret** — oder **Secret aus Umgebungsvariable**, wenn dein Ops-Team es hält. Der Rest beschreibt die Antwort: **Pfad zum Token-Array**, **Token-Feld**, die **Ziel-Umgebungsvariable**, in die das gewählte Token injiziert wird, und eine **Token-Auswahl** aus Zufällig, Erstes nutzbares oder Round-Robin. Unter **Erweitert** liegt die Feinjustierung: **Status-Feld**, **Wert für aktiv**, **Ablauf-Feld**, **Anfrage-Timeout (ms)**, **Maximale Antwortgröße (Bytes)** und **Sicherheitsabstand zum Ablauf (ms)**.

<Info>

Beide Arten werden im eigenen Tooling des Anbieters verbraucht statt über einen einfachen API-Aufruf, deshalb sagt es der Dialog offen: **Läuft in der Sandbox auf dem Harness des Anbieters.** Ein Anthropic-Abo-Broker läuft auf dem Harness `claude-code`, ein Nous-Portal-Abo-Schlüssel auf `hermes`. Direkte API-Aufrufe gibt es für diese Zugangsdaten nicht.

</Info>

## Connectoren mit Endpunkt pro Eintrag

Azure OpenAI hat keinen festen Endpunkt, weil jede Azure-Ressource ihren eigenen bedient, in der Form `https://<resource>.openai.azure.com/openai/v1`. Die Kopfzeile des Abschnitts sagt, dass der Endpunkt pro Eintrag gesetzt wird, und der Dialog ergänzt ein Feld **Endpoint-URL**, damit jeder Eintrag die Ressource trägt, zu der er gehört.

Azure liefert auch keinen Modellkatalog mit, und der Grund lohnt sich, bevor du das Formular ausfüllst: Bei Azure ist die Modell-ID in einer Anfrage der Deployment-Name, den du in der Ressource vergeben hast — den kann Tale unmöglich vorher kennen. Trag diese Namen bei **Erlaubte Modelle** als kommagetrennte Liste ein. Ohne sie stellt der Eintrag überhaupt kein Modell bereit.

## Die Standard-Zugangsdaten wählen

Eine Anfrage, die keine Zugangsdaten nennt, nimmt den Standard des Connectors. Das trifft auf den grössten Teil des Verkehrs zu, also ist der Standard der Eintrag, auf dem die alltägliche Arbeit landen soll — der gemeinsame Produktionsschlüssel, nicht das Experiment.

Öffne das Menü einer Zeile und wähl **Zum Standard machen**. Pro Connector hält genau ein Eintrag diese Rolle, und wer sie einem anderen gibt, verschiebt sie. Ein deaktivierter Eintrag kann nicht Standard werden. Lässt du einen Connector ohne Standard, wählt die Plattform nicht für dich: Die Seite sagt es offen, und Anfragen ohne benannte Zugangsdaten haben nichts, worauf sie auflösen könnten.

## Einschränken, was ein Eintrag aufrufen darf

**Erlaubte Modelle** begrenzt einen Eintrag auf einen Teil der Modelle seines Connectors. Mit Katalog dahinter ist das Feld eine durchsuchbare Mehrfachauswahl, ohne Katalog eine freie Liste von IDs. Lässt du es leer, steht der ganze Katalog offen. Füllst du es, zeigt die Zeile die Anzahl, und alles ausserhalb der Liste löst über diesen Eintrag nicht mehr auf.

<Tip>

Eine solche Liste schränkt genau einen Eintrag ein. Um über alle Anbieter hinweg zu bestimmen, was eine Person, ein Team oder eine Rolle wählen darf, nimm die Modellzugriffs-Regeln unter [Inhalte und Modelle](/de/platform/admin/governance/content-models). Beides greift zusammen: Ein Modell muss durch beide Schranken, bevor es in einer Auswahl auftaucht.

</Tip>

## Die Modellkataloge aktuell halten

**Kataloge aktualisieren** sitzt in der Kopfzeile der Seite und holt jeden Live-Katalog neu und meldet eine Zeile pro Connector — die Anzahl gefundener Modelle oder den Fehler, der dazwischenkam, damit ein ausgefallener Anbieter benannt und nicht stillschweigend übersprungen wird.

Mitgelieferte Kataloge brauchen dafür nichts: Wenn jeder Connector einen hat, sagt die Meldung, dass es nichts zu aktualisieren gibt. Live-Kataloge werden zwischen zwei Aktualisierungen zwischengespeichert, einen Hintergrundabgleich gibt es nicht — ein heute Morgen veröffentlichtes Modell taucht auf, sobald jemand den Knopf drückt.

## Zugangsdaten deaktivieren und löschen

**Deaktivieren** schaltet einen Eintrag ab und behält Konfiguration und erlaubte Modelle. Greif dazu, wenn ein Schlüssel im Verdacht steht, ein Kontingent aufgebraucht ist oder eine Abteilung pausiert — Wiedereinschalten ist ein Klick, und nichts muss neu eingegeben werden.

<Warning>

Löschen wirkt sofort und vollständig. Agenten und Anfragen, die diese Zugangsdaten verwenden, verlieren augenblicklich den Zugriff auf den Anbieter, also häng vorher alles um, was davon abhängt. Löschst du den Standard, bleibt der Connector ohne einen, bis du einen anderen ernennst — die Bestätigung sagt dir das, bevor du es tust.

</Warning>

## Wo das hingehört

Diese Seite ist der Boden, auf dem alles andere steht: Ein Agent, eine Chat-Antwort, ein Workflow-Schritt, ein Embedding für die Wissensdatenbank lösen alle auf ein Modell auf, und ein Modell ist nur erreichbar, wenn Zugangsdaten von dieser Seite es aufrufen können. Welche Modelle dabei herauskommen, steht im [Modellkatalog](/de/platform/models), die Governance-Schicht, die sie weiter einschränkt, unter [Inhalte und Modelle](/de/platform/admin/governance/content-models), und die Deployment-Variablen, die ein Operator bereitstellt, in [Anbieter](/de/self-hosted/configuration/providers).
