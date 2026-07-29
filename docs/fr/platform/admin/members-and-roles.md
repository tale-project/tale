---
title: Membres et rôles
description: Les six rôles que Tale ship et la matrice de permissions au niveau ressource qui dit qui peut faire quoi. Les Administrateurs et Propriétaires lisent ceci quand ils montent une équipe ou quand un audit demande qui a quel accès.
---

Les membres sont les personnes de ton organisation qui peuvent se connecter à Tale. Les rôles contrôlent ce que chaque membre peut faire — lire, écrire, configurer, gouverner. Cette page est la référence canonique pour les six rôles et les permissions par ressource que chaque rôle porte.

Six rôles couvrent presque chaque équipe à laquelle Tale est livré. Les Administrateurs et Propriétaires lisent cette page quand ils montent une équipe pour la première fois, quand un audit demande qui a quel accès, ou quand ils doivent décider entre Éditeur et Développeur pour un nouveau venu.

Tu préfères regarder d’abord ? L’épisode 8 parcourt l’effectif, l’échelle des rôles et les murs d’équipe en deux minutes — sous-titres compris.

<Video src="/videos/fr/tutorials/ep8-people/ep8-people.fr.mp4" poster="/videos/fr/tutorials/ep8-people/ep8-people.fr.webp" captions="/videos/fr/tutorials/ep8-people/ep8-people.fr.vtt" lang="fr" title="Épisode 8 — Personnes, rôles & équipes" caption="Épisode 8 — Personnes, rôles & équipes (2:06)">

</Video>

<Frame caption="La section Membres sous Paramètres > Organisation — chaque compte et le rôle qui le borne.">

![La page de paramètres Organisation avec sa section Membres listant le propriétaire de l’espace de travail et un bouton Ajouter un membre.](/images/get-started/settings-organization-members.webp)

</Frame>

## Ajouter un membre

Pour ajouter une personne à ton organisation, ouvre **Paramètres > Organisation**, fais défiler jusqu’à la section **Membres** et clique sur **Ajouter un membre**. Renseigne son **Nom**, son **E-mail** et son **Rôle**, puis définis un **Mot de passe** — Tale n’envoie pas d’invitation par e-mail, un mot de passe est donc requis pour créer un nouveau compte. (Si l’e-mail correspond déjà à un compte Tale, aucun mot de passe n’est demandé : la personne se connecte avec ses identifiants existants et est simplement ajoutée à cette organisation.)

Lors de l’**Ajouter un membre**, Tale affiche les nouveaux identifiants **une seule fois**, en rappelant de les enregistrer maintenant : ils ne seront plus affichés. Transmets-les au nouveau membre par un autre canal ; il n’y a pas d’e-mail de réinitialisation. Quiconque oublie ensuite son mot de passe contacte un administrateur, qui peut en définir un nouveau depuis la même section Membres.

Choisis le rôle dans le formulaire avant de valider ; le promouvoir ou le changer ensuite est une modification en un clic dans la même section Membres.

## Les six rôles

**Propriétaire** a chaque permission qu’a Admin, plus celle qui manque à Admin : transférer la propriété et supprimer l’organisation. La plupart des équipes ont exactement un Propriétaire ; certaines en gardent deux pour la continuité.

**Admin** gouverne l’organisation : membres, fournisseurs, branding, politiques de gouvernance, connectors, le journal d’audit. Les Administrateurs font tout ce que fait Éditeur et tout ce que fait Développeur, plus la surface de configuration. Ils ne peuvent pas transférer la propriété.

**Développeur** construit : agents, automatisations, connectors, clés API, serveurs MCP. Les Développeurs peuvent lire chaque ressource et écrire dans la plupart, y compris les politiques de gouvernance (lecture seule). Va vers Développeur quand quelqu’un a besoin du plan API et de l’outillage d’connector.

**Éditeur** organise et opère : agents, base de connaissances (documents, contacts, produits, fournisseurs, sites web), boîte de réception des conversations, approbations, bibliothèque de skills. Les Éditeurs peuvent lire les workflows mais pas les modifier ; ils peuvent lire les connectors mais pas les configurer. Va vers Éditeur quand quelqu’un fait le travail produit quotidien sans toucher au plan API ou connectors.

**Membre** exécute : chat, parcourt la base de connaissances, et lit les conversations et approbations. La lecture des conversations est organisationnelle par défaut ; active **Contrôle selon l’assignation des conversations** sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits#controle-selon-lassignation-des-conversations) quand les Membres ne doivent voir que les fils non assignés plus ceux qui leur sont assignés ou à leurs équipes. Les Membres n’écrivent que dans le feedback de message (pouce en haut / en bas). Va vers Membre comme défaut — la plupart des utilisateurs dans la plupart des organisations sont Membres.

**Désactivé** n’a aucune permission. Utilise ça pour révoquer l’accès sans supprimer le compte ; les transcriptions et l’historique d’audit restent intacts, et réactiver restaure le rôle précédent.

## La matrice de permissions

| Ressource                 | Propriétaire | Admin | Développeur | Éditeur | Membre | Désactivé |
| ------------------------- | ------------ | ----- | ----------- | ------- | ------ | --------- |
| Agents                    | R / W        | R / W | R / W       | R / W   | R      | —         |
| Documents                 | R / W        | R / W | R / W       | R / W   | R      | —         |
| Produits                  | R / W        | R / W | R / W       | R / W   | R      | —         |
| Contacts                  | R / W        | R / W | R / W       | R / W   | R      | —         |
| Fournisseurs              | R / W        | R / W | R / W       | R / W   | R      | —         |
| Projets                   | R / W        | R / W | R / W       | R / W   | R      | —         |
| Sites web                 | R / W        | R / W | R / W       | R / W   | R      | —         |
| Conversations             | R / W        | R / W | R / W       | R / W   | R      | —         |
| Messages de conversation  | R / W        | R / W | R / W       | R / W   | R      | —         |
| Approbations              | R / W        | R / W | R / W       | R / W   | R      | —         |
| Exécutions workflow       | R / W        | R / W | R / W       | R       | R      | —         |
| Traitement workflow       | R / W        | R / W | R / W       | R       | R      | —         |
| Connectors                | R / W        | R / W | R / W       | R       | R      | —         |
| Configs OneDrive sync     | R / W        | R / W | R / W       | R       | R      | —         |
| Templates de prompts      | R / W        | R / W | R / W       | R / W   | R      | —         |
| Journaux d’audit          | R / W        | R / W | R / W       | R / W   | R      | —         |
| Politiques de gouvernance | R / W        | R / W | R           | R       | R      | —         |
| Feedback de messages      | R / W        | R / W | R / W       | R / W   | R / W  | —         |
| Serveurs MCP              | R / W        | R / W | R / W       | R       | R      | —         |

R = lecture, W = écriture, — = aucun accès. La matrice est la description faisant autorité de ce que chaque rôle peut faire sur les ressources que Tale piste ; les lignes sont l’ensemble qu’utilise le système de permissions interne au produit à la requête.

## La surface Paramètres et le menu

Les Membres, Éditeurs et utilisateurs Désactivés ne voient pas la surface de configuration — seulement leurs propres paramètres personnels. Les Développeurs voient les paramètres d’organisation mais pas le sous-arbre gouvernance (sauf vues en lecture). Les Administrateurs et Propriétaires voient tout. Le menu des paramètres est groupé en **Personnel** (Compte, Préférences, Environnement — chaque rôle), **Organisation** (Équipes, la section Membres, Fournisseurs IA, Branding, Gouvernance et le reste — Admin et Propriétaire, les Développeurs en voyant un sous-ensemble) et **Développement** (la surface API et résidence des données). La gouvernance est un élément dans le groupe Organisation, pas un groupe à part, et demande l’accès Admin.

## Cas limites

**Transférer la propriété** demande qu’un Propriétaire existant nomme un Admin ou Propriétaire actuel ; le nouveau rôle Propriétaire prend effet immédiatement. Le Propriétaire précédent devient Admin sauf rétrogradation explicite.

**Avertissement « dernier Admin ».** La section Membres avertit quand on retire ou rétrograde le dernier Admin ou Propriétaire. L’action est autorisée — Tale ne te verrouille pas dehors — mais tu devrais garder au moins deux comptes Admin-ou-Propriétaire pour la continuité.

**Réinitialiser la 2FA** se trouve sur la ligne du membre dans la section Membres. Réinitialiser efface le second facteur ; le sign-in suivant réenrôle.

## Où cela s’inscrit

Les rôles sont la surface d’accès que touche chaque autre page admin : le SSO les authentifie, les clés API leur appartiennent, les journaux d’audit les nomment, les politiques de gouvernance scopent le comportement par rôle. La lecture suivante dépend de ce que tu fais ensuite. Si tu câbles le sign-in à ton fournisseur d’identité, [authentification](/fr/self-hosted/configuration/authentication) couvre les quatre modes. Si tu scopes l’accès par équipe plutôt que par rôle seul, [Équipes](/fr/platform/admin/teams) couvre la couche par équipe.
