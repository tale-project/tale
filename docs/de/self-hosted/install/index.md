---
title: Installation
description: Wähl den richtigen Tale-Installationsweg — einen Laptop-Trial mit der CLI, eine gehärtete Produktions-Installation auf einem Linux-Host oder die rohe Docker-Compose-Referenz für volle Kontrolle.
---

Tale zu installieren hat drei Formen, und die richtige hängt davon ab, was du mit dem Ergebnis vorhast. Diese Seite leitet dich zum passenden Weg — ein schneller lokaler Trial, eine Produktions-Installation hinter TLS oder die rohe Compose-Referenz, wenn du jeden Knopf besitzen willst — damit du keinen Härtungs-Spaziergang beginnst, wenn du nur herumklicken wolltest.

Alle drei Wege landen auf demselben Produkt; der Unterschied ist, wie viel vom Stack du betreibst und wie haltbar das Ergebnis sein muss. Die CLI umhüllt Docker Compose für die ersten beiden, sodass es nichts von Hand zu editieren gibt, während der Referenz-Weg für Teams ist, die Compose selbst fahren.

## Tale auf einem Laptop ausprobieren

Willst du eine laufende Instanz zum Durchklicken — auf deiner eigenen Maschine, ohne Domäne und ohne Härtung — ist der [Quickstart](/de/self-hosted/install/quickstart) der Weg. Installier die CLI, lauf `tale init` und dann `tale dev`, und du bist in Minuten in deiner eigenen Org angemeldet. Die CLI stellt Docker bereit, falls es fehlt, generiert jedes Secret und mountet deine Konfiguration, sodass Edits live nachladen. Das ist der richtige Weg für eine Evaluierung, eine Demo oder lokale Entwicklung gegen einen echten Stack.

Wenn du dem Laptop entwächst und dasselbe Projekt auf einem echten Host willst, trägt das Trial-Projekt sich mit — `tale deploy` bringt es auf eine Domäne, ohne neu zu initialisieren.

## Tale in Produktion betreiben

Wenn echter Verkehr auf der Instanz landet, ist der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang der Weg. Er deckt TLS, eine Firewall, einen Non-root-User, den Reverse-Proxy und die operativen Haken ab, die du willst, bevor du eine Domäne darauf richtest. Die CLI macht weiterhin die Schwerarbeit — `tale deploy` fährt einen Blue-Green-Rollout ohne Ausfallzeit mit Health-Checks und Rollback — aber dieser Spaziergang fügt das Host-Level-Setup hinzu, das ein Trial überspringt.

Nach dem ersten Deploy erklärt [Erster Admin](/de/self-hosted/install/first-admin) den einmaligen Setup-Wizard, der das erste Konto zum **Owner** macht — alle danach kommen per Einladung dazu, es gibt also keine offene Anmeldung zu schließen — und [CLI installieren](/de/self-hosted/install/cli-install) richtet die CLI auf einer Workstation ein, um eine entfernte Instanz zu deployen und zu upgraden.

## Die Compose-Schicht besitzen

Willst du den Stack lieber aus einem Klon des Repositories fahren und Compose selbst verwalten — für Transparenz, Air-gapped-Builds oder deine eigene Automation — ist die [Docker-Compose-Referenz](/de/self-hosted/install/docker-compose-reference) der Weg. Sie dokumentiert die Basisdatei und die Overlays, die die CLI im Hintergrund generiert, sodass du sie von Hand reproduzieren oder erweitern kannst. Das ist die meiste Kontrolle und die meiste Arbeit; die meisten Teams sind mit den CLI-Wegen oben besser bedient.

Dieser Weg paart sich mit dem [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang für die Host-Level-Teile (TLS, Firewall, User), die Compose allein nicht abdeckt.

## Wo das hingehört

Die drei Installationswege tauschen Komfort gegen Kontrolle: der [Quickstart](/de/self-hosted/install/quickstart) ist der schnellste Weg zu einer laufenden Instanz, der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang härtet sie für echten Verkehr, und die [Docker-Compose-Referenz](/de/self-hosted/install/docker-compose-reference) reicht dir jeden Knopf, wenn die Defaults der CLI nicht genügen. Wähl nach Haltbarkeit: ein Trial, den du wegwirfst, will den Quickstart; eine Instanz, von der dein Team abhängt, will den Produktions-Spaziergang.

Einmal installiert, sind die [Konfigurations](/de/self-hosted/configuration/environment-reference)-Seiten die Quelle der Wahrheit für jede Umgebungsvariable und Provider-Datei, und der [Betreiben](/de/self-hosted/operate/container-architecture)-Abschnitt deckt Upgrades, Backups und Observability für den laufenden Stack ab.
