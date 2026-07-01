---
title: Konversationen
description: Konversationen ist der vereinte Inbox für alles, was aus einem Kundenkanal ankommt — Slack-Nachrichten, E-Mails, Web-Chats, SMS. Redakteure und Mitglieder arbeiten hier; Agents triagieren und antworten; Admins beobachten die Gesundheit der Warteschlange.
---

Konversationen ist der vereinte Inbox von Tale. Jede Kundenkanal-Nachricht, die ankommt — eine Slack-DM, eine eingehende E-Mail, eine Web-Chat-Sitzung, eine SMS — taucht hier als Konversations-Thread auf, den ein Agent lesen, beantworten und routen kann. Während der Chat-Tab der Ort ist, an dem ein interner Benutzer mit einem Agent spricht, ist Konversationen der Ort, an dem die Aussenwelt mit der Organisation und ihren Agents spricht. Redakteure und Mitglieder sind die täglichen Betreiber des Inbox; Admins beobachten die Warteschlange.

Dieser Bereich behandelt, was eine Konversation ist, wie Routing und Status funktionieren, wie ein Agent triagiert und antwortet und wie der Inbox an Genehmigungen und die Wissensdatenbank anschliesst. Die Übersicht nennt die Teile und verweist auf die Per-Teil-Seiten; das konzeptuelle Modell liegt einen Klick weiter.

## Was eine Konversation ist

Eine Konversation ist der Thread, den Tale um einen einzelnen externen Teilnehmer auf einem einzelnen Kanal baut. Sie trägt jede ausgetauschte Nachricht, jede Agent-Antwort, jede Routing-Entscheidung, jede Genehmigung, die währenddessen feuerte, und jeden Link in die Wissensdatenbank, den der Agent zitierte. Die Konversation ist die Audit-Einheit und die Arbeits-Einheit — sie zu schliessen beendet den Thread; sie wieder zu öffnen knüpft an, wo es aufgehört hat.

Konversationen durchlaufen drei Lebenszyklus-Zustände: **offen** (aktiv, wartet auf jemanden, der handelt), **zurückgestellt** (geparkt bis zu einer Erinnerungszeit) und **geschlossen** (erledigt). Jeder Zustand filtert die Inbox-Sicht anders; der Standardfilter ist Offen, was ein Operator sehen will, wenn er sich an den Inbox setzt.

## Kanäle, die Konversationen erzeugen

Die Kanäle, die Konversationen speisen, sind dieselben Kanäle, die unter [Integrationen](/de/platform/integrations/overview) in der Kommunikations-Gruppe gelistet sind: Slack, Microsoft Teams, Discord, Gmail, Outlook, IMAP/SMTP (beliebiges privates Postfach), Twilio (SMS und WhatsApp). Eine installierte Kanal-Integration routet eingehenden Verkehr in den Inbox; die Routing-Regeln unter **Einstellungen > Konversationen** entscheiden, an welches Team oder welchen Agent jeder eingehende Thread landet.

Der Web-Chat-Kanal ist eingebaut und benötigt keine Integration; er erscheint als einbettbares Widget, das die Organisation auf ihre eigene Seite legen kann.

## Routing, Status und Zuweisung

Jede Konversation hat einen Beauftragten (ein Team, einen Agent oder nicht zugewiesen), einen Status (offen, zurückgestellt, geschlossen) und eine optionale Priorität. Routing-Regeln unter **Einstellungen > Konversationen** entscheiden den anfänglichen Beauftragten anhand des Kanals und des Nachrichteninhalts; der Beauftragte kann jederzeit aus der Konversations-Sicht neu zugewiesen werden.

Agents in der Beauftragten-Rolle triagieren automatisch — sie lesen die neueste Nachricht, entscheiden, ob sie antworten können, und antworten entweder direkt oder geben die Konversation an einen Menschen zurück. Die Übergabe wird protokolliert: der Konversations-Verlauf zeigt jede Agent-Entscheidung neben jeder Mensch-Antwort.

## Seiten in diesem Bereich

Dieser Bereich ist kurz — der Inbox ist mechanisch einfach, sobald das Modell klar ist. Die volle Konversations-Konzeptseite und die per-Funktions-Seiten sind die nächste Schicht darunter.

## Wo das hingehört

Konversationen ist der Geschwister von Chat: derselbe Agent-und-Modell-Stack darunter, anderes Publikum darüber. Die natürliche nächste Lektüre hängt von der Rolle ab — Mitglieder lesen [Chat](/de/platform/chat/overview) für die interne Konversations-Oberfläche, Redakteure lesen [Genehmigungs-Konzepte](/de/platform/approvals/concepts) dafür, wie der Inbox mit menschlicher Prüfung zusammenspielt, Admins lesen [Integrationen (Admin-Sicht)](/de/platform/admin/integrations) für die Kanal-Anmeldedaten, die die Warteschlange speisen.
