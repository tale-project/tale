---
title: Automatisierungskonzepte
description: Eine Automatisierung ist das installierbare Bündel aus Integrationen, Agents, Skills, einem Workflow und mitgelieferten Ansichten, das der Katalog in einem Schritt installiert. Diese Seite benennt die Bestandteile und wann du dazu statt zu einem einzelnen Agent oder Workflow greifst.
---

Eine Automatisierung ist die Einheit, zu der Tale greift, wenn eine Aufgabe mehr als ein bewegliches Teil braucht, das zusammengeschaltet werden muss — eine Integration, ein oder mehrere Agents, ein Workflow, manchmal eine eigene Seite —, und du das Ganze lieber in einem Schritt installiert und verbunden haben willst, statt es von Hand zusammenzusetzen. Inhaber, Admins und Entwickler installieren Automatisierungen aus dem Automatisierungen-Katalog; einmal installiert, nutzen Redakteure und Mitglieder, was mitgeliefert wurde — ein Posteingang-Tab, ein Backlog-Eintrag, ein Chat-Agent —, ohne wissen zu müssen, was darunterliegt. Diese Seite benennt die Bestandteile, die eine Automatisierung bündelt, wie ein Bundle mehrere Automatisierungen zusammenfasst, und wann eine Automatisierung die richtige Einheit ist statt eines einzelnen Agents oder Workflows.

## Die Bestandteile

Das Manifest einer Automatisierung benennt bis zu fünf Arten von Bestandteilen, und die meisten Automatisierungen nutzen nur einen Teil davon.

**Integrationen** sind die Anmeldedaten, die ihre Schritte und Agents brauchen — Gmail, GitHub, eine SQL-Datenbank. Eine Automatisierung speichert nie eine eigene Kopie einer Anmeldung; sie benennt nur, welche Integration sie braucht, und die Organisation verbindet diese Integration einmal — dieselbe Verbindung, die sich jede andere Automatisierung und jeder Agent teilt.

**Agents** sind die Chat- oder Aufgaben-Agents, die die Automatisierung installiert — ein Sichter, ein PR-Prüfer, ein Zusammenfasser. Einmal installiert, sind es ganz normale Agents: erwähnbar im Chat, zuweisbar auf einem Projekt-Board, editierbar im Agent-Editor.

**Ein Workflow** ist die eine gebündelte Trigger-und-Schritte-Definition der Automatisierung — das, was tatsächlich nach einem Zeitplan, über einen Webhook oder per Klick läuft. Nicht jede Automatisierung liefert einen mit: Die E-Mail-Automatisierungen auf [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) haben keinen, weil Mail lesen und beantworten eine Seite ist, kein geplanter Lauf.

**Mitgelieferte Ansichten** sind Seiten, die die Automatisierung in die geteilte Ansichts-Registry der Plattform einträgt, etwa den Posteingang — die Plattform rendert die Seite selbst, die Automatisierung benennt nur, welche und worauf sie begrenzt ist.

**Konfiguration** ist keine separate Einstellungsdatei. Eine Automatisierung, die einen Betriebswert braucht, liest ihn aus der Anmeldung einer Integration oder aus einer Trigger- oder Node-Variable des Workflows; der Tab **Konfiguration** der Automatisierung ist eine schreibgeschützte Zusammenfassung der obigen Bestandteile, kein Ort, um neue Einstellungen anzulegen.

## Bundles und versteckte Automatisierungen

Ein Bundle fasst mehrere Automatisierungen zusammen, die nur gemeinsam installiert einen Sinn ergeben. [GitHub-Issues lösen](/de/platform/automations/builtin) installiert vier Automatisierungen — einen Sichter, einen Abgleicher, einen PR-Ersteller und einen PR-Prüfer — über einen gebündelten Assistenten, gebunden an das Projekt, das du wählst. Die meisten Mitglieder eines Bundles sind versteckt: Sie tauchen nie als eigene Karte im Katalog auf, weil eine Installation für sich allein ohne ihre Geschwister bedeutungslos wäre. Versteckt heisst nicht weg — der [Automatisierungs-Assistent](/de/platform/automations/assistant) findet und erklärt sie trotzdem; nur das Raster des Katalogs blendet sie aus.

## Alles zusammen — zwei Kombinationen

**Auf Gmail-E-Mails antworten** kombiniert die kleinstmögliche Menge: eine Integration (Gmail) und eine mitgelieferte Ansicht (Posteingang) — kein Agent, kein Workflow. Verbinde Gmail, und der Posteingang-Tab ist die ganze Automatisierung.

**GitHub-Issues lösen** kombiniert jeden Bestandteil auf einmal: eine Integration (GitHub), vier Agents verteilt über seine vier versteckten Mitglieder, vier Workflows und keine mitgelieferte Ansicht — es arbeitet stattdessen über das bestehende Board und Backlog des Projekts statt über eine eigene Seite. Die Installation des Bundles verdrahtet alle vier in einem gebündelten Assistenten, gebunden an das Projekt, das du wählst.

## Wann du danach greifst

| Nutz … wenn                                                                           | Automatisierung | Agent | Workflow |
| ------------------------------------------------------------------------------------- | --------------- | ----- | -------- |
| Du willst ein fertig integriertes Feature in einem Schritt installieren               | ✓               |       |          |
| Dieselbe Frage kehrt im Chat einfach wieder, kein externes System beteiligt           |                 | ✓     |          |
| Du verdrahtest eine brandneue Integration und einen Trigger selbst                    |                 |       | ✓        |
| Du brauchst Genehmigungen oder Zeitpläne zwischen Schritten und nichts Fertiges passt |                 |       | ✓        |

Greif zuerst zu einer Automatisierung — prüf den Katalog, bevor du die Bestandteile selbst baust. Greif zu einem einzelnen Agent oder Workflow, wenn die Aufgabe wirklich neu ist und nichts Mitgeliefertes sie abdeckt.

## Bau eine

Eine Automatisierung ist das ganze Bündel, das ein echtes Feature braucht — die Integration, die es aufruft, die Agents und der Workflow, die die Arbeit erledigen, die Ansicht, die es rendert —, zusammengeschaltet und in einem Schritt installiert; greif zu einem einzelnen Agent oder Workflow nur, wenn du das Stück selbst baust. Die natürliche nächste Lektüre ist [Automatisierungen durchsuchen und installieren](/de/platform/automations/catalog) — sie geht den Katalog, das Seitenpanel und den Installations-Assistenten von Anfang bis Ende durch.
