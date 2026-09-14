---
title: Einen Arbeitsbereich fürs Team einrichten
description: Einen Modellanbieter verbinden, Mitglieder hinzufügen und den Arbeitsbereich mit deren Zugriffsrechten prüfen.
---

Ein nutzbarer Arbeitsbereich braucht eine Organisation, einen funktionierenden Modellanbieter und Konten mit passenden Rechten. Richte diese Grundlagen ein und ergänze danach die Kontrollen für eure geplante Arbeit.

## Was du brauchst

Melde dich auf der richtigen Instanz als Inhaber oder Admin an. Die Ersteinrichtung erstellt das erste Konto und die Organisation. Siehst du deine Organisation bereits im Dashboard, öffne ihre Einstellungen, statt eine weitere anzulegen.

Halte die Anbieter-Zugangsdaten im Passwortmanager bereit. Der Anbieter muss das gewünschte Modell und die vorgesehenen Aufgaben unterstützen. [KI-Anbieter](/de/platform/admin/providers) erklärt Zugangsdaten, Kataloge und Agentenlaufzeiten.

## Einen Anbieter verbinden und Chat testen

<Steps>

<Step title="Zugangsdaten hinzufügen">

Öffne **Einstellungen > KI-Anbieter**, wähle **Zugangsdaten hinzufügen** und dann den Anbieter. Fülle die Felder seiner Anmeldemethode aus und speichere. Wähle einen Namen, an dem andere Admins den Verwendungszweck erkennen.

<Frame caption="Verbundene Zugangsdaten stellen die Modelle des Anbieters im Arbeitsbereich bereit.">

![Die Einstellungen für KI-Anbieter zeigen die verbundenen Anbieter-Zugangsdaten.](/images/get-started/settings-providers.webp)

</Frame>

</Step>

<Step title="Das Modell in einem neuen Chat prüfen">

Öffne **Chat**, beginne ein neues Gespräch und wähle ein verfügbares Modell. Sende einen eigenständigen Prompt wie „Schreibe eine Checkliste mit drei Punkten für eine Besprechung“. Warte auf die vollständige Antwort. Gespeicherte Zugangsdaten allein belegen noch keinen Zugriff auf das gewählte Modell.

Bleibt die Modellauswahl leer oder lehnt der Anbieter die Anfrage ab, folge der Fehlersuche unter [KI-Anbieter](/de/platform/admin/providers).

</Step>

</Steps>

## Personen mit passenden Rechten hinzufügen

Öffne **Einstellungen > Mitglieder** und wähle **Mitglied hinzufügen**. Für ein neues Konto legst du im Formular ein erstes Passwort fest. Ein vorhandenes Konto behält seine Zugangsdaten. Dieser Ablauf versendet keine Einladung per E-Mail. [Mitglieder und Rollen](/de/platform/admin/members-and-roles) erklärt die Felder und die sichere Übergabe der ersten Zugangsdaten.

<Frame caption="Prüfe die Rolle jedes Mitglieds, bevor du den Zugang übergibst.">

![Die Mitgliederseite zeigt die Personen der Organisation und ihre zugewiesenen Rollen.](/images/get-started/settings-organization-members.webp)

</Frame>

Wähle die Rolle nach der Aufgabe: Mitglieder nutzen den Arbeitsbereich, Bearbeiter pflegen gemeinsame Inhalte, Entwickler arbeiten an Integrationen und Automatisierungen, Admins verwalten die Organisation. Bei Grenzfällen hilft die genaue Berechtigungstabelle. Teams und Projektfreigaben bestimmen zusätzlich, auf welche Projektarbeit eine Person zugreifen kann.

## Den ersten Teamablauf prüfen

Bitte ein Teammitglied, sich mit dem eigenen Konto anzumelden, eine Nachricht zu senden und das benötigte Projekt zu öffnen. Prüfe gemeinsame Quellen ebenfalls mit diesem Konto. Tests nur als Inhaber können fehlende Rechte oder zu weitgehenden Zugriff verdecken.

<Tip>

Beginne mit einem typischen Projekt und wenigen Quelldokumenten. Prüfe, ob das Team die Arbeit findet und die vorgesehenen Konten auf die Dateien zugreifen können, bevor du eine große Bibliothek importierst.

</Tip>

## Betriebsregeln festlegen

Prüfe je nach Bedarf [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits), [Audit-Logs](/de/platform/admin/governance/audit-logs) und [SSO](/de/platform/admin/enterprise-sso). Lege fest, wer Zugangsdaten pflegt, Rechte kontrolliert und fehlgeschlagene Aufträge bearbeitet. Im Eigenbetrieb braucht ihr außerdem einen getesteten Ablauf für [Sicherung und Wiederherstellung](/de/self-hosted/operate/backups-and-restore).
