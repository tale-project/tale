---
title: Einen Agent erstellen
description: Den Dialog zum Anlegen und den Editor für Agenten gibt es in dieser Version nicht — Agenten, die du in der UI anlegst, sind Projekt-Agenten, und Chat-Personas sind Konfigurationsdateien.
---

Diese Seite hat früher einen Agenten-Editor Tab für Tab durchgespielt: einen Dialog zum Anlegen, **Allgemein**, **Anweisungen**, **Tools**, **Skills**, **Wissen** und einen Button **Verlauf**. Diesen Editor gibt es in dieser Version von Tale nicht, und auch keine Agenten-Auswahl im Chat-Composer. Zwei Dinge sind real, und auf die zeigt diese Seite: Projekt-Agenten, die du tatsächlich in der UI anlegst, und Agent-Personas, die Konfigurationsdateien sind.

<Note>

Der Agenten-Editor ist in dieser Version nicht verfügbar. Es gibt keinen Agenten-Eintrag in der Seitenleiste und keinen Dialog zum Anlegen von Chat-Personas.

</Note>

## Leg stattdessen einen Projekt-Agenten an

Die Agenten, die du in der UI anlegst, gehören zu einem Projekt und arbeiten dessen Board-Aufgaben ab. Öffne den Tab **Agenten** des Projekts, klick auf **Neuer Agent**, trag unter **Name** ein, wie er heißen soll, wähl seine **Agent-Laufzeit** — das Coding-Harness, auf dem er läuft — und sein **Modell**, rüste ihn unter **Skills, Connectors & Tools** aus, leg **Secrets** an, wenn er einen Dienst ohne Connector aufrufen muss, schreib seine **Anweisungen** und klick auf **Agent erstellen**. Weis ihm eine Aufgabe zu und klick auf **Agent starten**, damit er loslegt. [Projekt-Agenten](/de/platform/projects/project-agents) geht jedes Feld durch; [Harnesses](/de/platform/agents/harnesses) erklärt die Laufzeiten, aus denen du wählst.

## Personas bleiben Konfiguration

Eine Persona — Name, Anweisungen, je eine Erlaubnisliste für Tools und Skills, ein Wissensbereich und eine Sichtbarkeit von privat oder geteilt — existiert in dieser Version als YAML-Datei in der Konfiguration der Organisation, mitgeliefert als `coding-agent`. Kein Bildschirm legt eine an oder bearbeitet sie, und der Chat bietet keine zur Auswahl: Der Chat-Assistent antwortet mit einem festen Satz von Such-Tools. [Agent-Konzepte](/de/platform/agents/concepts) erklärt, was eine Persona trägt, [Agents (Admin-Sicht)](/de/platform/admin/agents), wer sie wie ändern darf, und [AI-gestützte Entwicklung](/de/develop/ai-assisted-development), wo die Dateien liegen.

## Wo das hingehört

Einen Agenten anzulegen heißt in dieser Version, ein Projekt zu besetzen: ein benannter Agent auf einem Harness, ausgerüstet für die Arbeit, gestartet aus einer Aufgabe und geprüft von einem Menschen. Geh [Projekt-Agenten](/de/platform/projects/project-agents) durch, um einen zu bauen, und [Aufgaben-Automatisierung](/de/platform/projects/task-automation), um zu sehen, was nach der Zuweisung passiert.
