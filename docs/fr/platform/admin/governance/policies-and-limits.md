---
title: Politiques et limites
description: Plafonds par organisation sur le coût des tokens, le nombre de requêtes, la taille d’upload, la génération d’images et l’accès aux fonctionnalités.
---

Politiques et limites est la surface où tu plafonnes ce que tes membres et agents peuvent consommer. Les budgets plafonnent les tokens, le coût et les requêtes par période de facturation ; les contrôles de fonctionnalité plafonnent la fenêtre de contexte par scope ; la politique d’upload régit les types et tailles de fichiers qu’un membre peut joindre ; la politique de rétention décide combien de temps chaque type de donnée vit avant le nettoyage. Les Administrateurs et Propriétaires lisent cette page quand une charge dépasse le budget, quand un groupe doit travailler avec une fenêtre de contexte plus petite, ou quand un régulateur nomme une fenêtre de rétention différente du défaut.

<Frame caption="Gouvernance > Politiques et limites — le tableau des règles de budget, au-dessus de la politique d’upload et des contrôles de rétention.">

![La page de gouvernance Politiques et limites montrant trois règles de budget mensuelles — une pour l’organisation entière, une par défaut pour tous les utilisateurs et une pour le rôle developer, chacune plafonnant les tokens, le coût et les requêtes — au-dessus des champs de politique d’upload pour les types de fichiers autorisés, les tailles et le volume.](/images/platform/governance-policies-limits.webp)

</Frame>

## Un budget mis en pratique

Pour plafonner la dépense mensuelle d’un Éditeur, ouvre **Paramètres > Gouvernance > Politiques et limites** et clique sur **Ajouter une règle** sous **Règles de budget**. Choisis **Rôle** comme scope, **Éditeur** comme cible, règle la période sur **Mensuel** et entre un coût max en USD. Enregistre et dès que la dépense de période d’un Éditeur franchit le plafond, le composer de chat bloque les nouveaux envois avec un avis budget-dépassé — et les requêtes vocales sont refusées net. Un seuil d’avertissement sous le plafond affiche un bandeau avant que le plafond ne soit atteint. Les scopes plus étroits l’emportent sur les plus larges — une règle utilisateur bat une règle équipe bat une règle rôle — et les limites au niveau org s’appliquent toujours par-dessus comme plafond additionnel.

## Les quatre couches de politique

**Budgets** sont des plafonds de tokens, coût et requêtes par scope et période. Les scopes sont org, rôle, équipe, utilisateur ou clé API. Chaque règle porte un plafond de tokens, un plafond de coût en USD, un plafond de requêtes optionnel et un seuil d’avertissement exprimé en pourcentage du plafond. Une règle sur clé API vise une seule clé émise (choisis **Clé API** comme scope, puis la clé depuis **Paramètres > API**) et ne plafonne que le trafic authentifié avec cette clé — l’API REST — pour que tu mesures une connector précise sans toucher à l’usage in-app. La génération d’images est mesurée par coût et nombre de requêtes, pas par tokens — une requête d’image ne rapporte aucun token, alors plafonne les dépenses d’images avec le plafond de coût ou de requêtes, pas celui de tokens.

**Contrôles de fonctionnalité** plafonnent les tokens de contexte max pour les réponses AI par utilisateur, équipe ou rôle. Il n’y a pas d’interrupteur par fonctionnalité.

**Politique d'upload** régit les extensions de fichiers, types MIME et tailles qu’un membre peut joindre. Elle plafonne aussi le volume total par utilisateur — utile quand le stockage est mesuré. Désactive la politique pour un défaut permissif ; active-la pour appliquer les listes.

**Politique de rétention** décide combien de temps chaque type de donnée (historique de chat, documents, prompts, journaux d’audit, registre d’utilisation, exécutions de workflow et plus) reste avant que la passe de nettoyage ne retire la ligne. La page affiche les bornes imposées par l’opérateur, la surcharge par organisation dans ces bornes, et une fenêtre de grâce avant la suppression dure.

## Priorité

Les quatre couches partagent la même échelle de scope : utilisateur > équipe > rôle > org > défaut. La règle la plus étroite l’emporte. Là où une couche porte un plafond au niveau org (budgets), le plafond s’applique comme plafond additionnel au-dessus de toute règle plus étroite. Un budget sur clé API sort de l’échelle comme son propre bucket indépendant : il lie le trafic de la clé elle-même, indépendamment des plafonds utilisateur, équipe ou org de son propriétaire, si bien qu’une seule clé peut être tenue à une allocation plus serrée que la personne qui l’a émise.

## Bornes de rétention et approbations

La politique de rétention vit à l’intérieur de bornes imposées par l’opérateur — l’opérateur en self-hosted règle un plancher et un plafond par catégorie, et la valeur de l’organisation se clampe à cette plage. Quand l’opérateur propose un plancher plus serré ou un plafond plus bas, le changement remonte comme proposition que les Administrateurs peuvent appliquer ou rejeter. Les réductions de la politique atterrissent avec un bandeau de changement en attente et une fenêtre de grâce avant prise d’effet — la même grâce donne aux Administrateurs la chance d’annuler.

## Délai d’inactivité de session

Le délai d’inactivité de session déconnecte les membres après une période d’inactivité — le contrôle lié aux sessions que les référentiels de conformité demandent (SOC 2 CC6.1). Ouvre **Paramètres > Gouvernance > Sécurité**, active **Activer le délai d'inactivité de session** et règle **Délai d'inactivité (minutes)** (1–1440, 30 par défaut). Les membres voient un avertissement peu avant la coupure ; ensuite l’onglet actif se déconnecte et la page de connexion explique la déconnexion au lieu d’afficher un simple formulaire.

La fenêtre peut uniquement raccourcir la limite définie pour le déploiement, jamais l’allonger. Les opérateurs en self-hosted règlent ce plafond dur par variable d’environnement (voir la [référence d’environnement](/fr/self-hosted/configuration/environment-reference)) ; la politique d’organisation s’applique par-dessus, et la plus stricte des deux fenêtres l’emporte. Un membre de plusieurs organisations reçoit la fenêtre la plus stricte de toutes ses organisations.

L’application a deux moitiés. Le watchdog côté navigateur termine à la minute près les sessions ouvertes et visibles. Les onglets fermés et les appareils abandonnés sont rattrapés côté serveur par une passe de révocation qui tourne environ toutes les cinq minutes — une session peut donc survivre quelques minutes au-delà de la fenêtre ; quand tu présentes le contrôle à un auditeur, compte la fenêtre plus une demi-heure environ dans le pire cas. Chaque révocation côté serveur atterrit dans les [journaux d’audit](/fr/platform/admin/governance/audit-logs) comme `session.idle_revoked`. Une réserve pour les déploiements trusted headers : le reverse proxy y possède l’authentification, donc une session révoquée se rétablit dès que le membre confirme l’avis de connexion — associe la politique à un délai d’inactivité côté proxy ou IdP pour un vrai verrouillage.

## Routage des conversations

Le courrier entrant arrive non assigné tant qu’une règle de routage ne le revendique pas. Sous **Paramètres > Gouvernance > Politiques et limites**, ouvre **Routage des conversations** et ajoute une règle associant une adresse destinataire à une équipe, une personne, ou les deux : la prochaine conversation qui arrive à cette adresse est assignée dès sa création, avant que quiconque n’ouvre la boîte de réception. Une règle correspond à l’adresse à laquelle l’expéditeur a écrit — le `À` de la conversation — sans tenir compte de la casse ; une adresse sans règle reste non assignée.

La visibilité est intégrée : une conversation assignée à une équipe n’est visible que par ses membres, et une conversation assignée à une personne n’est visible que par elle (l’union quand les deux sont définis). Les conversations vraiment non assignées — ni personne ni équipe — ne sont visibles que par les administrateurs et propriétaires, qui les trient. Les Membres et Éditeurs ne voient que le travail routé ou assigné dans leur file personnelle ou d’équipe. Associe le routage au contrôle **Responsable** de l’en-tête pour que le courrier entrant atterrisse dans la bonne file dès l’arrivée. Le routage ne fait qu’assigner ; il ne réassigne jamais une conversation qui a déjà un responsable ou une équipe, de sorte qu’une réponse s’enchaînant dans un fil existant est laissée intacte. Une règle pointant vers une équipe ou une personne supprimée depuis est ignorée — la conversation arrive quand même, simplement non assignée pour le triage admin.

## Où cela s’inscrit

Politiques et limites est la couche budget et porte qui protège l’organisation des dépenses qui s’emballent et des accès non voulus. Associe-la à [contenu et modèles](/fr/platform/admin/governance/content-models), pour que le modèle plafonné par budget soit aussi celui que la liste d’accès autorise, et à [politique de rétention sur la même page](#bornes-de-retention-et-approbations), pour que les données que l’organisation garde soient aussi bornées. La page compagnon est [journaux d’audit](/fr/platform/admin/governance/audit-logs) — chaque changement de politique ici y atterrit comme enregistrement permanent.
