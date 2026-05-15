---
title: Redakteur
description: Der Kuratierungs-Sitz — die Wissensdatenbank, Konversationen, Freigaben, strukturierte Daten und die Agents, die der Rest des Teams nutzt. Die aufgabenorientierte Landung des Redakteurs für den Alltag.
---

Ein **Redakteur** in Tale ist der Kuratierungs-Sitz. Du bist die Person, die entscheidet, was die KI weiß und welche ausstehenden Aktionen durchgehen — die Dokumente, die Produkte, die Kunden, die Websites, aus denen der Rest der Organisation liest, plus die Kunden-Konversationen und Freigaben, die einen Menschen im Loop brauchen. Alles, was ein Mitglied kann, kannst du auch; obendrein schreibst du in die Wissensdatenbank, bearbeitest Agents und handelst auf Freigaben. Du veröffentlichst keine Automatisierungen, konfigurierst keine Integrationen und änderst keine Organisations-Einstellungen — das ist Entwickler- und Admin-Territorium.

Der Sinn eines dedizierten Redakteurs ist, dass Wissenskuratierung eine eigene Aufgabe ist. Ein vom Entwickler gebauter Agent ist nur so gut wie die Dokumente, gegen die er grounden kann; eine Automatisierung, die einen Entwurf produziert, ist nur so nützlich wie der Redakteur, der ihn prüft und sendet. Diese Seite ist ein aufgabenorientierter Index für den Redakteur-Tag; die kanonische Berechtigungsmatrix lebt unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

## Ein Redakteur-Tag

Ein typischer Tag startet in **Konversationen**, um die nächtlichen Kunden-Threads zu klären — die, für die die KI eine Antwort entworfen hat, und die, die die KI zur Prüfung markiert hat. Von dort wandert die Arbeit zu **Freigaben**: Ausgaben aus Automatisierungen, die auf ein menschliches Urteil warten. Am Vormittag übergibt ein Entwickler einen frisch gebauten Agent, der einen Wissens-Tag und ein paar Starter-Prompts braucht; du öffnest den Agent in **Agents**, richtest sein Wissen auf den richtigen team-getaggten Ordner aus und ergänzt die Prompts. Später lässt ein Produkt-Team ein neues Preis-PDF im Team-Chat fallen; du lädst es in die **Dokumente**-Ansicht hoch und taggst es so, dass der richtige Agent es bei der nächsten Nachricht aufgreift.

Die Seiten unten stehen in der Reihenfolge, die der Tag verlangt — zuerst Wissen, weil jede andere Oberfläche davon abhängt, dann die Human-in-the-Loop-Oberflächen, dann Agents, weil sie zu tunen die Stelle ist, an der Kuratierung auf Verhalten trifft.

## Seiten in diesem Bereich

- **[Wissensdatenbank](/de/platform/workspace/knowledge-base)** — Dokumente hochladen, bearbeiten, taggen und entfernen; die Oberfläche, aus der jede gegroundete Antwort stammt.
- **[Website-Crawling](/de/platform/knowledge/crawling)** — Tale auf eine Website richten, Recrawls planen, dem Indexer beim Füllen der Wissensdatenbank zusehen.
- **[Strukturierte Daten](/de/platform/knowledge/structured-data)** — Produkte, Kunden, Lieferanten; die Zeilen, gegen die Agents grounden, wenn eine Antwort mehr als ein Dokument braucht.
- **[Konversationen](/de/platform/workspace/conversations)** — geteilte Kunden-Threads. Antworten, schließen, erneut öffnen, archivieren oder als Spam markieren.
- **[Freigaben](/de/platform/workspace/approvals)** — Ausgaben aus Automatisierungen, die auf ein menschliches Urteil warten; freigeben oder ablehnen, und der Workflow läuft weiter.
- **[Agents](/de/platform/agents/create)** — die Agents erstellen, bearbeiten und veröffentlichen, die der Rest des Teams im Chat wählt.
- **[Agent-Versionen](/de/platform/agents/versions)** — an einem laufenden Agent arbeiten, ohne die Konversationen und Automatisierungen zu brechen, die ihn schon nutzen.

## Was Redakteure nicht können

Automatisierungen erstellen oder bearbeiten, Integrationen und MCP-Server konfigurieren, API-Schlüssel erzeugen und jede organisationsweite Einstellung (Mitglieder, Branding, Richtlinien, Anbieter) sind Entwicklern und Admins vorbehalten. Brauchst du eines davon erledigt, frage jemanden mit der richtigen Rolle — einen Agent ohne Redakteur im Team zu bauen ist schwieriger als umgekehrt.

## Wo anfangen

Steigst du heute in den Sitz ein, ist die kleinste nützliche erste Bewegung, die [Wissensdatenbank](/de/platform/workspace/knowledge-base) zu öffnen, ein Dokument hochzuladen, das das Team täglich referenziert, und zu prüfen, dass die KI eine Frage daraus beantworten kann. Von da aus schließt [Den ersten Agent von Anfang bis Ende bauen](/de/tutorials/editor/first-agent-end-to-end) den Kreis zwischen kuratierten Wissen und einer KI-Oberfläche, die es nutzt.
