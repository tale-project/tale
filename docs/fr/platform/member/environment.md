---
title: Variables d’environnement et secrets
description: Tes variables d’environnement et secrets personnels, injectés dans chaque sandbox que tu lances dans une organisation, et que personne d’autre ne peut lire.
---

Variables d’environnement et secrets est ton magasin personnel de variables que Tale injecte dans chaque sandbox que tu lances dans cette organisation. Quand un [agent sandbox](/fr/platform/agents/external-agent) démarre son conteneur, chaque entrée que tu as enregistrée ici est posée dans l’environnement avant que l’agent tourne, pour qu’une commande lancée par l’agent — ou l’agent lui-même — puisse la lire. Sers-t’en quand le travail réclame quelque chose de toi que personne d’autre ne doit détenir : un jeton API personnel pour un service que l’organisation n’a pas connecté, un point d’accès qui diffère chez toi, une clé attachée à ton propre compte. C’est une page de niveau membre que chaque rôle peut ouvrir, et les entrées sont cantonnées à toi et à l’organisation actuelle, donc elles ne fuient jamais vers tes coéquipiers et ne te suivent jamais dans une autre org.

Cette page couvre les deux types d’entrée, comment les secrets sont protégés, les règles qu’un nom et une valeur doivent respecter, et où les valeurs finissent.

<Frame caption="Paramètres > Environnement — les entrées enregistrées, chacune avec l’interrupteur Secret qui décide si sa valeur peut être relue.">

![La page de paramètres Environnement listant trois entrées enregistrées — ANALYTICS_ORG et CRM_BASE_URL avec leurs valeurs en clair, et CRM_API_TOKEN masquée en points avec sa case Secret cochée — au-dessus de l’action Ajouter une variable.](/images/platform/settings-environment.webp)

</Frame>

## Variables et secrets

Ouvre **Paramètres > Environnement**. **Ajouter une variable** ouvre une boîte de dialogue pour une nouvelle entrée, avec la liste de ce que tu as enregistré en dessous. Chaque entrée est un **Nom** et une **Valeur**, plus une bascule **Secret** qui décide comment la valeur est stockée et affichée.

Une variable simple est stockée telle quelle et réaffichée en entier dans la liste — utilise-la pour la configuration non sensible que l’agent attend, un nom de région ou un endpoint. Un **secret** est chiffré dès l’instant où tu l’enregistres et devient en écriture seule à partir de là : la liste montre `••••••••` à la place de la valeur, et il n’y a aucun moyen de la relire. Active la bascule pour tout ce qui est sensible — une clé API, un jeton OAuth, un mot de passe. Le compromis, c’est que tu ne peux pas revoir la valeur d’un secret plus tard, donc si tu n’es pas sûr qu’elle soit bonne, supprime-le et ajoute-le à nouveau plutôt que de chercher un bouton d’affichage qui n’existe pas.

Chaque ligne porte le nom, la valeur ou son masque, et la date de dernière mise à jour. L’icône corbeille demande confirmation avant de retirer l’entrée, car en supprimer une la sort de chacune de tes sandboxes au prochain lancement.

## Noms, valeurs et limites

Un **nom** doit commencer par une lettre ou un tiret bas et ne contenir que des lettres, des chiffres et des tirets bas — la forme d’une variable d’environnement ordinaire, `MY_API_KEY` plutôt que `my-api.key`. Les noms sont plafonnés à 128 caractères et les valeurs à 8 192, ce qui laisse la place pour un long jeton ou une clé multiligne mais pas pour un fichier. Tu peux garder jusqu’à 100 entrées.

Tale rogne les espaces au début et à la fin d’une valeur quand tu l’enregistres, parce qu’un saut de ligne égaré venu d’un copier-coller est la cause la plus fréquente d’un jeton qui échoue silencieusement. Il ne rogne pas les espaces ni les sauts de ligne _à l’intérieur_ de la valeur, mais il te prévient quand il en trouve : un identifiant n’en a normalement aucun, donc un blanc intérieur signifie d’ordinaire un jeton qui s’est replié sur plusieurs lignes dans ton terminal au moment du collage. L’avertissement ne bloque pas l’enregistrement — un secret réellement multiligne comme une clé privée PEM garde ses sauts de ligne — donc lis-le et décide.

## Comment les valeurs atteignent la sandbox

Un secret ne voyage jamais en clair, sauf vers ta propre sandbox. Au repos il est chiffré dans le backend de Tale sous une clé que la plateforme détient, et la requête de liste ne renvoie que le masque, jamais le texte en clair. Quand un tour démarre, la plateforme déchiffre tes secrets et les pose, aux côtés de tes variables simples, dans l’environnement de ta sandbox pour ce lancement. Chaque fois qu’un secret est injecté pour un tour, cet accès est consigné dans le journal d’audit.

Cette dernière étape est la frontière à comprendre : les valeurs atterrissent à l’intérieur de ton conteneur sandbox, donc c’est l’isolement de la sandbox — et non le magasin de secrets — qui se tient entre tes identifiants et tout ce qui tourne là. C’est le même fonctionnement que le jeton GitHub dans la sandbox, et c’est pour cela que ces entrées sont cantonnées à toi seul plutôt que partagées avec l’org.

Ce qui ne vient pas d’ici, c’est l’identifiant avec lequel un tour atteint son modèle. Celui-là appartient aux fiches fournisseur de l’organisation, sous [Fournisseurs](/fr/platform/admin/providers), où il se fait tourner et auditer au même endroit — un agent ne détient aucune clé propre, et cette page non plus à sa place. Garde ces entrées pour ce dont ton propre travail a besoin, et laisse l’identifiant du modèle là où l’organisation peut le gouverner.

## Où cela s’inscrit

Variables d’environnement et secrets est l’unique page de niveau membre qui atteint la sandbox plutôt que le chat — c’est par elle que tes propres clés et ta configuration parviennent au travail que tu lances, sans qu’un Éditeur ou un Admin ne les pose à ta place. Lis-la en parallèle d’[Agents sandbox](/fr/platform/agents/external-agent), qui couvre ce que le conteneur détient d’autre et ce qu’il a le droit d’atteindre. Pour le reste de tes réglages personnels — nom d’affichage, mot de passe, instructions personnalisées — vois [Préférences](/fr/platform/member/preferences).
