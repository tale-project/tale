---
title: Paramètres de l’organisation
description: Renomme l’organisation, choisis la langue que ses agents utilisent par défaut, copie l’ID de l’organisation et supprime l’organisation.
---

**Paramètres > Organisation** présente l’organisation que tu as ouverte : son nom, la langue par défaut de ses agents et son ID sous **Détails de l'organisation**, et, pour les propriétaires, une **Zone de danger** qui sert à la supprimer. Les propriétaires et les admins peuvent ouvrir la page. Les membres qui ont un autre rôle ne voient pas **Organisation** dans le menu des paramètres ; s’ils ouvrent la page par un lien, ils voient **Tu dois disposer des permissions Admin pour accéder aux paramètres de l'organisation.**

## Renommer l’organisation {#rename-the-organization}

Modifie le champ **Nom de l'organisation**, puis choisis **Enregistrer** dans l’en-tête des paramètres. Le nom et le champ **Langue par défaut (pour les agents)** s’enregistrent ensemble ; **Abandonner** rétablit les valeurs enregistrées des deux. Si l’enregistrement échoue, **Impossible de mettre à jour l'organisation** s’affiche.

Le nom ne peut pas être vide : Tale supprime les espaces au début et à la fin, et refuse un nom vide avec le message **Le nom de l'organisation est requis** sous le champ. Contrairement au nom d’une nouvelle organisation, il peut contenir n’importe quel caractère, pas seulement des lettres, des chiffres, des espaces, des tirets et des tirets bas.

Le nouveau nom apparaît partout où Tale affiche le nom de l’organisation, par exemple dans le sélecteur d’organisation de ton menu de profil et à la fin du titre de l’onglet du navigateur. Renommer l’organisation ne change pas son slug, fixé à sa création : les adresses WebDAV et les scripts qui envoient le slug dans `X-Organization-Slug` continuent de fonctionner.

## Choisir la langue par défaut des agents {#default-language}

Sous **Langue par défaut (pour les agents)**, choisis **English**, **Deutsch** ou **Français**, puis **Enregistrer**. Une organisation créée dans l’application reçoit au départ la langue d’interface de la personne qui l’a créée, ou l’anglais si cette langue ne fait pas partie des trois.

Tale utilise cette langue dans les cas suivants :

- Les agents de projet et les étapes d’agent des automatisations ont pour consigne de traiter une tâche dans la langue de son titre et de sa description. Si ceux-ci ne permettent pas de trancher, ou si une exécution n’a pas de tâche, la consigne est d’utiliser la langue par défaut. [Déléguer une tâche à un agent](/fr/platform/projects/task-automation#preparer-et-demarrer-la-tache) explique la règle.
- Quand Tale met en place l’[agent standard](/fr/platform/projects/project-agents#standard-agent) dans un projet, l’agent reçoit un nom dans cette langue, par exemple **Standard-Agent** pour l’allemand. Changer de langue par la suite ne le renomme pas.
- Les e-mails de notification sont rédigés dans cette langue, quelle que soit la langue que leur destinataire utilise dans Tale. Un message qu’une automatisation envoie aux membres ([`notify.member`](/fr/platform/automations/notify-members)) nomme aussi l’automatisation dans cette langue, si elle a un nom dans cette langue.
- L’export des notifications par l’API l’utilise quand une requête n’indique pas de `locale` ([Choisir le destinataire et le flux](/fr/develop/api-reference#choisir-le-destinataire-et-le-flux)).

Ce réglage ne change pas la langue d’interface des membres : chacun choisit la sienne dans son menu de profil ([Changer de langue ou d’espace de travail](/fr/platform/member/preferences#changer-de-langue-ou-despace-de-travail)). L’assistant de chat ne tient pas compte de ce réglage non plus.

## Copier l’ID de l’organisation {#organization-id}

Le champ **ID de l'organisation** affiche l’identifiant que Tale a attribué à l’organisation à sa création ; renommer l’organisation ne le change pas. Sélectionne le champ pour copier l’ID. Une coche confirme la copie.

Utilise l’ID là où Tale demande l’ID de l’organisation ou `orgId` :

- dans les appels à `/api/app` effectués depuis une session ouverte, par exemple pour enregistrer une application où l’on [se connecte avec Tale](/fr/develop/api-reference#se-connecter-a-une-application-avec-tale) ;
- comme valeur de `--org` quand la CLI `tale` [configure la plateforme](/fr/self-hosted/install/cli-install#configurer-la-plateforme).

Le même ID suit `/dashboard/` dans l’adresse des pages de l’organisation, et `GET /api/v1/me` le renvoie dans `organization.id`. L’API REST identifie en revanche l’organisation par son slug : envoie le slug dans `X-Organization-Slug`, jamais l’ID. [Identifier le compte et l’organisation](/fr/get-started/developers#identifier-le-compte-et-lorganisation) montre comment un script trouve le slug ; tu peux aussi le copier depuis le champ **Slug de l'organisation** dans **Paramètres > API > MCP**.

## Supprimer l’organisation {#delete-the-organization}

<Warning>

Supprimer l’organisation efface tout ce qu’elle contient, pour tous ses membres. Cette action est irréversible.

</Warning>

Seuls les propriétaires voient la **Zone de danger** et peuvent supprimer l’organisation ; un admin qui veut la supprimer doit le demander à un propriétaire. Une organisation dont le slug est `default` n’a pas de **Zone de danger** : le déploiement stocke sous ce slug ses réglages par défaut pour toute la plateforme ; Tale ne la supprime donc jamais.

1. Vérifie dans le champ **Nom de l'organisation** que tu as ouvert la bonne organisation : la page concerne toujours celle dans laquelle tu te trouves.
2. Dans la **Zone de danger**, choisis **Supprimer l'organisation**.
3. Lis la boîte de dialogue. Elle affiche le nom de l’organisation et indique ce que la suppression efface.
4. Dans le champ **Tape le nom de l'organisation pour confirmer**, saisis le nom affiché dans la boîte de dialogue. Respecte les majuscules ; les espaces au début ou à la fin sont ignorés. Le bouton **Supprimer l'organisation** de la boîte de dialogue reste désactivé tant que le nom ne correspond pas.
5. Choisis **Supprimer l'organisation**. Pendant la suppression, une icône de chargement tourne sur le bouton et la boîte de dialogue ne peut pas être fermée.

Tale affiche **Organisation supprimée** et t’emmène dans une autre organisation dont tu es membre. Si c’était ta seule organisation, tu arrives sur la page de création d’une organisation. Si le déploiement limite qui peut créer des organisations, cette page affiche **Tu ne peux pas créer d'organisation sur ce déploiement. Contacte l'opérateur pour demander un espace de travail.**

### Ce que la suppression efface {#what-deletion-removes}

L’organisation disparaît avec ses équipes, ses invitations en attente, ses projets, ses tâches, ses documents, ses conversations, ses agents, ses automatisations et leurs exécutions, ses fournisseurs IA, ses connectors et leurs identifiants, ses agents de code connectés, les applications où l’on se connecte avec Tale ainsi que toutes ses [sandboxes et leurs fichiers](/fr/platform/admin/sandboxes#explain-why-a-workspace-disappeared). Les clés API créées ici pour un membre, une équipe, un projet ou l’organisation sont supprimées aussi ; celles que les membres ont créées pour eux-mêmes leur restent. Les membres gardent leur compte Tale et leurs autres organisations ; seule leur appartenance à celle-ci prend fin.

Les fichiers téléversés, l’index de connaissances et la configuration de l’organisation disparaissent lors d’un nettoyage qui suit la suppression. Ce nettoyage vide le stockage de fichiers et la base de connaissances que l’organisation utilise à ce moment-là. Si elle avait connecté son propre bucket ou sa propre base de connaissances dans **Paramètres > Résidence des données**, les fichiers jamais déplacés et les connaissances indexées avant le changement restent dans l’ancien stockage ([Choisir et déplacer les stockages](/fr/self-hosted/configuration/data-residency)).

Tant que ce nettoyage n’est pas terminé, tu ne peux pas créer d’organisation sous le nom que portait l’organisation supprimée à sa création, même avec d’autres majuscules : Tale affiche **Ce nom est déjà pris. Choisis-en un autre.** Réessaie plus tard.

Le journal d’audit reste : ses entrées sont conservées, y compris celle qui enregistre la suppression, mais plus personne ne peut les ouvrir dans l’application une fois l’organisation supprimée.

### Quand Tale refuse la suppression {#when-deletion-is-refused}

Une suppression refusée ne change rien. L’organisation reste telle quelle, la boîte de dialogue reste ouverte, et le message **Échec de la suppression de l'organisation** en indique la raison :

| Raison | Que faire |
| --- | --- |
| **Une conservation légale active préserve les données de cette organisation. Lève chaque conservation dans Gouvernance > Conservation légale, puis réessaie.** | Toute conservation, qu’elle porte sur l’organisation entière ou sur l’un de ses membres, bloque la suppression. Libère chaque conservation dans **Paramètres > Gouvernance > Conservation légale** ; une libération exige l’approbation d’un second admin et un délai d’attente. Réessaie quand **Conservations actives** affiche **Aucune conservation active**. [Comprendre une suppression bloquée](/fr/platform/admin/governance/legal-hold#comprendre-une-suppression-bloquee) explique la règle. |
| **Des exécutions d'automatisation restent bloquées car leurs actions externes antérieures n'ont pas encore été vérifiées. Ton organisation a été conservée. Une demande d'arrêt ne lève pas ces blocages.** | Des exécutions d’automatisation ont été [suspendues après une mise à jour](/fr/platform/automations/execution-logs#une-execution-suspendue-apres-une-mise-a-jour). Aucune action ne permet pour l’instant de lever ces blocages : tant qu’il en reste un, tu ne peux pas supprimer l’organisation. |
| **La confirmation ne correspond pas au nom de l'organisation. Recharge la page et réessaie.** | Le nom de l’organisation a changé après le chargement de la page : quelqu’un l’a renommée dans une autre fenêtre, ou tu as enregistré un nouveau nom sur cette page. Recharge la page, puis tape le nom affiché dans la boîte de dialogue. |
