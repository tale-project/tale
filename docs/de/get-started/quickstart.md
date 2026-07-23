---
title: Quickstart
description: Von null zur ersten Agent-Antwort — Instanz besorgen, anmelden und die erste Nachricht senden. Fünf Minuten auf einer bereiten Instanz, fünfzehn, wenn du selbst eine aufstellst.
---

Das ist der kürzeste Weg zu einem funktionierenden Chat mit einem Agent: Instanz besorgen, anmelden, Nachricht senden, der Antwort beim Streamen zusehen. Auf einer bereiten Instanz dauert das rund fünf Minuten, auf deiner eigenen Maschine fünfzehn — und es endet mit dem Bildschirm unten, einer echten Antwort eines Agents über deinen Arbeitsbereich.

<Frame caption="Wo dieser Quickstart endet: eine gestreamte Agent-Antwort im Chat.">

![Ein Chat-Verlauf mit einer Nutzerfrage zu Onboarding-Feedback und einer Assistenten-Antwort, die eine Markdown-Tabelle mit drei Themen enthält.](/images/platform/chat-thread-reply.webp)

</Frame>

Lieber als Video? Episode 1 geht denselben Weg in gut drei Minuten — Untertitel inklusive.

<Video src="/videos/de/tutorials/ep1-welcome/ep1-welcome.de.mp4" poster="/videos/de/tutorials/ep1-welcome/ep1-welcome.de.webp" captions="/videos/de/tutorials/ep1-welcome/ep1-welcome.de.vtt" lang="de" title="Episode 1 — Willkommen bei Tale" caption="Episode 1 — Willkommen bei Tale (3:25)">

</Video>

## Hol dir eine Instanz

Beide Editionen sind dasselbe Produkt — entscheide danach, wer den Stack betreiben soll.

<Tabs>

<Tab title="Selbst gehostet">

Mit laufendem [Docker](https://www.docker.com/products/docker-desktop) stellen drei Befehle den ganzen Stack auf deiner Maschine auf:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

Der erste Lauf zieht die Images — rechne mit fünf bis zehn Minuten. Sobald der Browser aufgeht, registriere dich: Das erste Konto übernimmt die Rolle **Inhaber** und erstellt deine Organisation. Der [selbst gehostete Quickstart](/de/self-hosted/install/quickstart) erklärt jeden Schritt in der Tiefe, samt Windows und Fehlersuche.

</Tab>

<Tab title="Cloud">

Cloud-Instanzen werden für dich aufgesetzt: Füll das [Demo-Formular](https://tale.dev/de/request-demo) aus, und das Tale-Team stellt deine eigene Instanz bereit. Sobald sie steht, öffne sie und registriere dich — das Formular fragt nach Name, E-Mail und Passwort; bestätige den E-Mail-Link, sobald er ankommt, benenne deine Organisation, und du landest im Dashboard. Der Setup-Assistent bietet direkt an, einen KI-Anbieter zu verbinden — füge dort einen [OpenRouter](https://openrouter.ai)-Schlüssel ein, und der Chat funktioniert sofort. Der [Einstieg für Admins](/de/get-started/admins) geht denselben Assistenten mit Screenshots durch, wenn du mehr willst als den Happy Path.

</Tab>

</Tabs>

## Schick deine erste Nachricht

<Steps>

<Step title="Öffne einen neuen Chat">

Klicke in der Sidebar auf **Neuer Chat**. Der Chat am unteren Bildschirmrand ist der Ort, an dem alles beginnt: links die Agent-Auswahl, daneben die Modell-Auswahl und rechts das Nachrichtenfeld mit dem Senden-Knopf. Wartet der Chat mit vorausgewähltem **Assistent** und einem bereits gewählten Modell, bist du bereit zu senden.

</Step>

<Step title="Stell eine echte Frage">

Lass den Agent auf **Assistent** und wähl in der Modell-Auswahl irgendein Chat-Modell — jede Antwort kommt von genau dem Modell, das du benannt hast, hinter den Kulissen wird nichts für dich entschieden. Tippe eine Frage und sende sie. Die Antwort streamt Token für Token herein; wenn der Agent vor dem Antworten nachdenkt, erscheint über der Antwort eine aufklappbare Denk-Zeile.

<Check>

Eine gestreamte Antwort, die deine Frage beantwortet, heißt: Die ganze Kette funktioniert — Anbieter-Zugangsdaten, Modell und Agent. Du hast einen funktionierenden Arbeitsbereich.

</Check>

</Step>

</Steps>

## Wo du jetzt stehst

Du hast eine laufende Instanz und einen Agent, der antwortet. Die nächsten fünfzehn Minuten hängen von deiner Rolle ab: Der [Einstieg für Mitglieder](/de/get-started/members) behandelt Dokumente und Projekte, der [Einstieg für Redakteure](/de/get-started/editors) veröffentlicht deinen ersten Spezialisten-Agent, der [Einstieg für Admins](/de/get-started/admins) richtet Team und Anbieter ein, und der [Einstieg für Entwickler](/de/get-started/developers) bringt dir einen API-Schlüssel und deine erste Anfrage.
