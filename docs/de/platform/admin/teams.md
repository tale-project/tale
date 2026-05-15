---
title: Teams
description: Mitglieder in Teams organisieren und die Sichtbarkeit der Wissensdatenbank beschränken.
---

Teams erlauben dir, Mitglieder zu gruppieren — Engineering, Sales, Support, Legal — und zu steuern, welches Wissen jede Gruppe sieht. Ein Team ist eine weiche Gruppierung: Login, Rollen und Berechtigungen werden nicht beeinflusst. Es _wirkt_ sich aber darauf aus, welche Dokumente und Konversationen in den gefilterten Ansichten jedes Mitglieds erscheinen.

Die Team-Verwaltung liegt unter **Einstellungen > Teams** und ist Admin-only.

## Ein Team anlegen

1. Gehe zu **Einstellungen > Teams** und klicke auf **Team erstellen**.
2. Gib einen Team-Namen ein — kurz, er erscheint in Filtermenüs durch die ganze UI.
3. Optional eine Beschreibung hinzufügen.
4. Klicke auf **Erstellen**.

Mitglieder fügst du separat über die Detailseite des Teams hinzu. Dieselbe Person kann beliebig vielen Teams angehören.

## Was Teams beeinflussen

| Bereich                      | Team-Scope                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dokumente**                | Ein Dokument kann beim Upload einem oder mehreren Teams zugeordnet werden. Mitglieder sehen bei aktivem Team-Filter nur Dokumente ihrer Teams.                 |
| **Konversationen**           | Konversationen lassen sich einem Team zuordnen. Team-basierte Inboxes erlauben Support, Support-Threads zu sehen, und Sales, Sales-Threads — ohne Vermischung. |
| **Agents**                   | Der Wissen-Tab eines Agents kann auf team-getaggtes Wissen beschränkt werden, sodass ein Support-Agent nur Support-Inhalte durchsucht.                         |
| **Budgets und Model Access** | Governance-Richtlinien (siehe [Governance](/de/platform/admin/governance)) lassen sich pro Team scopen.                                                        |

## Team-Manager

Teams haben keine formalen Manager-Rollen — Berechtigungen kommen aus der Organisations-Rolle (Admin, Entwickler, Redakteur, Mitglied). Für eine delegierte Team-Administration nutze die Redakteur-Rolle und beschränke den Redakteur-Zugriff auf dessen Team.

## Externe Identity Anbieter

Wenn SSO oder Trusted Kopfzeilen genutzt werden, ist der externe IdP die einzige Quelle der Wahrheit für Teams. Tale liest bei jedem Login den Teams-Kopfzeile und aktualisiert die Teams-Liste des Nutzers. Siehe [Authentifizierung](/de/self-hosted/admin/authentication).

## Wo das einsetzt

Teams sind die Wissen-und-Konversationen-Scoping-Schicht. Sie ändern keine Rollen oder Berechtigungen — die leben unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles). Nutze Teams, um zu entscheiden, wer welche Dokumente und welche Konversations-Kanäle standardmäßig sieht; greif zu Rollen, um zu entscheiden, was jedes Mitglied tun darf. Die meisten Organisationen landen bei drei bis zehn Teams; mehr wird schwer zu pflegen.
