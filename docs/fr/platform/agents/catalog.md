---
title: Catalogue d'agents
description: Parcours la main-d'œuvre IA préinstallée par service et installe, active ou désactive les agents de ton organisation.
---

Une organisation toute neuve démarre avec une équipe d'agents déjà au travail — une direction et, sous elle, les exécutants, organisés par service. Le **catalogue** (Agents → Catalogue) est l'endroit où tu parcours cette main-d'œuvre et décides quels agents sont actifs.

La configuration JSON de chaque agent fait foi pour son nom, sa description et ses libellés de service ; le catalogue les lit et affiche par-dessus l'état d'installation.

## États et actions

Chaque carte affiche son état de roster et l'action correspondante :

- **Non installé** — pas de badge d'état ; **Installer** l'ajoute à ton organisation (activé).
- **Activé** — installé et actif : il peut être mentionné, recevoir du routage et des tâches. **Désactiver** conserve l'installation mais le met hors service ; **Désinstaller** le retire.
- **Désactivé** — installé mais hors service (badge rouge). **Activer** le remet en service.

Les cartes sont regroupées par service (leur libellé principal — Ingénierie, Marketing, Ventes, Finance, etc.), et un champ de recherche filtre par nom, description ou service.

## Provenance et agents liés à une intégration

Certains agents sont installés pour toi lorsque tu connectes une intégration — connecter GitHub, par exemple, installe le relecteur de pull requests et le trieur d'issues. Ceux-là portent un badge **Installé par &lt;intégration&gt;**, et le catalogue ne te laisse pas les désactiver ni les désinstaller à la main (déconnecte plutôt l'intégration). Un agent qui requiert encore une intégration affiche un badge **Requiert &lt;intégration&gt;** jusqu'à ce que tu la connectes.

## Permissions

Installer, activer, désactiver et désinstaller sont des actions d'administrateur (admin, développeur ou propriétaire). Modifier le modèle, les instructions ou la configuration complète d'un agent se fait dans l'éditeur d'agent (Agents → Tous les agents → un agent), pas dans le catalogue.
