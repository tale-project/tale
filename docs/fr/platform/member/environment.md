---
title: Variables d’environnement et secrets
description: Ton magasin personnel de variables et de secrets sous Paramètres > Environnement — ce qu’il contient, comment les secrets sont protégés, et le fait qu’aucune exécution ne le lit dans cette version.
---

Variables d’environnement et secrets est un magasin personnel sous **Paramètres > Environnement** : des valeurs nommées, cantonnées à toi et à l’organisation courante, avec une bascule **Secret** qui rend une valeur accessible en écriture seule. Chaque rôle peut ouvrir la page, et personne d’autre dans l’organisation ne peut lire tes entrées. Ce que la page ne fait pas dans cette version est la partie à connaître avant de la remplir : rien n’injecte ces entrées dans une exécution. Aucun tour d’agent de projet, aucun nœud agent d’automatisation, aucun script ne les lit — le magasin est conservé, mais la voie qui les poserait dans l’environnement d’une sandbox n’est pas câblée.

Cette page couvre ce que tu peux enregistrer, les règles qu’un nom et une valeur doivent respecter, et d’où viennent, à la place, les valeurs qu’une exécution reçoit vraiment.

<Note>

Les variables d’environnement personnelles sont stockées mais injectées dans aucune sandbox dans cette version. La description de la page parle encore d’injection ; considère le magasin comme sans effet tant qu’une note de version ne dit pas le contraire. Une valeur dont un agent de projet a besoin va dans ses **Secrets** — voir plus bas.

</Note>

<Frame caption="Paramètres > Environnement — les entrées enregistrées, chacune avec la bascule Secret qui décide si sa valeur peut être relue.">

![La page de paramètres Environnement listant trois entrées enregistrées — ANALYTICS_ORG et CRM_BASE_URL avec leurs valeurs en clair, et CRM_API_TOKEN masquée en points avec sa case Secret cochée — au-dessus de l’action Ajouter une variable.](/images/platform/settings-environment.webp)

</Frame>

## Variables et secrets

Ouvre **Paramètres > Environnement**. **Ajouter une variable** ajoute une ligne à la liste — un nom, une valeur et la bascule **Secret** — et le bouton **Enregistrer** de la page écrit toutes les modifications en attente d’un coup. Une variable simple est stockée telle quelle et réaffichée en entier. Un secret est chiffré dès l’enregistrement et devient accessible en écriture seule : la liste montre `••••••••` à sa place, et il n’y a aucun moyen de le relire. Si tu doutes de la valeur d’un secret, remplace-le plutôt que de chercher un bouton d’affichage qui n’existe pas. **Supprimer** sur une ligne demande confirmation — _Supprimer la variable ?_ — et prend effet quand tu enregistres.

## Noms, valeurs et limites

Un nom doit commencer par une lettre ou un tiret bas et ne contenir que des lettres, des chiffres et des tirets bas — la forme d’une variable d’environnement ordinaire, `MY_API_KEY` plutôt que `my-api.key`. Un nom qui enfreint la règle est refusé à l’enregistrement, un doublon aussi. Les noms sont plafonnés à 128 caractères et les valeurs à 8 192, et tu peux garder jusqu’à 100 entrées. Les valeurs sont stockées exactement comme tu les saisis : rien ne rogne un espace ou un saut de ligne égaré dans un jeton collé — vérifie le collage avant d’enregistrer.

## Ce qu’une exécution reçoit à la place

Les valeurs qu’une sandbox détient vraiment viennent de trois endroits, et aucun n’est cette page. Un **agent de projet** porte les **Secrets** de l’organisation — une clé API remise à l’agent comme variable d’environnement, injectée à chaque exécution et disparue à la fin ; c’est la voie pour un jeton qu’un service sans connecteur réclame, et [Agents de projet](/fr/platform/projects/project-agents) la couvre. Un jeton GitHub arrive à chaque exécution tant que l’agent a le connecteur GitHub équipé. Et l’identifiant avec lequel un tour atteint son modèle appartient aux fiches fournisseur de l’organisation sous [Fournisseurs IA](/fr/platform/admin/providers), où il se fait tourner et auditer au même endroit — un agent ne détient aucune clé propre.

## Où cela s’inscrit

Variables d’environnement et secrets est, dans cette version, un magasin sans consommateur : les entrées sont gardées par membre et par organisation, les secrets sont chiffrés et en écriture seule, et aucune exécution ne les lit. Mets ce dont un agent de projet a besoin dans ses **Secrets**, et lis [Harnesses](/fr/platform/agents/harnesses) pour ce que le conteneur détient d’autre et ce qu’il peut atteindre. Pour le reste de tes réglages personnels — nom d’affichage, mot de passe, instructions personnalisées — vois [Préférences](/fr/platform/member/preferences).
