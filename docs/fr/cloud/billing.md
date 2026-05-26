---
title: Facturation
description: Ce que Tale Cloud facture, comment les budgets coupent les coûts qui dérapent, et où la facture apparaît dans le produit.
---

La facturation sur Cloud est mesurée, pas au siège. Tu paies pour les tokens consommés par les chats et les agents, les minutes vocales, les générations d'images et le stockage ; la plateforme elle-même vient avec l'organisation. Cette page parcourt une ligne de facture, liste les composants mesurés, et pointe vers les contrôles de budget qui évitent les surprises.

La facture arrive chaque mois par e-mail et est aussi visible dans le produit sous **Paramètres > Facturation**. Cloud facture dans la devise de facturation de ton organisation, qui par défaut est USD à l'inscription et peut être changée avant la première facture.

## Une ligne de facture déroulée

Une ligne sur la facture lit `Models — Anthropic Claude Sonnet — 1.2M tokens — $4.32`. Tale l'a assemblée depuis le ledger d'usage par message : chaque réponse de chat enregistre le modèle utilisé, le compte de tokens, et le coût au tarif actif quand l'appel s'est terminé. Les lignes s'agrègent par fournisseur et par modèle par période de facturation. Le détail est téléchargeable en CSV depuis le même écran.

## Plans

Cloud propose trois plans — **Starter**, **Team** et **Enterprise** — qui diffèrent par le SLA de support, la rétention des journaux d'audit, et l'accès aux fonctionnalités entreprise (SSO, DPA, région au-delà du défaut). Tous les plans partagent le même tarif mesuré pour les tokens, la voix et le stockage ; le plan affecte les frais fixes mensuels et les barrières fonctionnelles, pas le coût par appel.

## Composants mesurés

| Composant  | Unité             | Compté comme                                               | Où le voir                                                                |
| ---------- | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Modèles    | Tokens (in + out) | Par appel fournisseur ; marge en plus du tarif fournisseur | [Analytique d'utilisation](/fr/platform/admin/governance/usage-analytics) |
| Voix (TTS) | Caractères parlés | Par réponse d'agent rendue en audio                        | Analytique d'utilisation                                                  |
| Voix (STT) | Secondes audio    | Par message utilisateur enregistré                         | Analytique d'utilisation                                                  |
| Images     | Générations       | Par image retournée par le modèle                          | Analytique d'utilisation                                                  |
| Stockage   | Go-mois           | Usage du stockage objet moyenné sur la période             | Page de facturation                                                       |

## Budgets et dépassements

Règle les budgets sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Une **Budget rule** plafonne la dépense mensuelle par utilisateur, par équipe, par rôle ou par organisation. Atteindre un budget se lit comme un toast clair — **Limite d'utilisation atteinte** — et met en pause la portée affectée jusqu'à ce que le budget soit relevé ou que la période bascule. La précédence par défaut est `utilisateur > équipe > rôle > défaut` — la règle la plus spécifique l'emporte.

Un **Warning threshold (%)** sur la même règle émet une notification quand l'usage franchit le seuil sans bloquer. Va vers l'avertissement quand tu veux savoir sans interrompre ; va vers les limites dures quand les dépassements sont une urgence.

## Où trouver l'usage

La vue la plus riche est [Analytique d'utilisation](/fr/platform/admin/governance/usage-analytics) sous Gouvernance — elle décompose l'usage par **Top Assistants**, **Top Models**, **Top Voice Models** et **Per-User Usage**, tous filtrables par plage de dates. La page Facturation dans Paramètres montre la vue niveau facture ; Analytique d'utilisation montre la vue opérationnelle.

## Où ça s'inscrit

La facturation est la page phare de l'opérateur ; [Analytique d'utilisation](/fr/platform/admin/governance/usage-analytics) est la page quotidienne. Si le coût de ton organisation est surtout des tokens, la page à mettre en favori est la table Top Models — elle fait remonter quels modèles l'équipe a adoptés et te dit si un basculement vers une alternative moins chère ferait la différence. Pour les utilisateurs auto-hébergés, le concept de facturation ne s'applique pas (tu paies ton fournisseur directement) ; la page de visibilité des coûts, si.
