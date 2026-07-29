---
title: Ton premier jour d’administration
description: Le parcours admin — crée l’espace de travail, connecte un fournisseur d’IA, fais entrer l’équipe et sache où vit la gouvernance.
---

Ce parcours s’adresse à la personne responsable de l’espace de travail. En quinze minutes, tu crées l’organisation, tu connectes le fournisseur qui fait répondre le chat, tu fais entrer tes premiers collègues et tu apprends où vivent les contrôles de gouvernance avant d’en avoir besoin.

Il te faut un compte sur une instance qui tourne ([démarrage rapide](/fr/get-started/quickstart)) ; sur une instance toute neuve, le premier compte est automatiquement **Propriétaire**, ce qui porte toutes les permissions ci-dessous.

<Steps>

<Step title="Crée l’espace de travail">

Si tu arrives du démarrage rapide, ton organisation existe déjà — passe directement à la connexion d’un fournisseur. Une première connexion sans organisation atterrit sur l’assistant de création : le **Nom de l'organisation** est le nom affiché que ton équipe voit dans le coin de chaque page — choisis-en un qui survit à un rebranding. L’assistant propose ensuite de connecter un fournisseur d’IA et se termine sur le dashboard.

<Frame caption="L’étape espace de travail de l’assistant de création.">

![L’assistant de création d’organisation à son étape espace de travail, avec Northlight Labs saisi dans le champ Nom de l’organisation et le bouton Suivant actif.](/images/get-started/org-create-wizard.webp)

</Frame>

</Step>

<Step title="Connecte un fournisseur d’IA">

Rien ne répond tant qu’aucun fournisseur n’est connecté. Si tu as sauté l’étape fournisseur de l’assistant, ouvre **Paramètres > Fournisseurs IA** et clique sur **Ajouter un identifiant** sur un connecteur — une clé [OpenRouter](https://openrouter.ai) atteint le catalogue de modèles le plus large, et chaque fournisseur direct apporte son propre connecteur à côté. Un identifiant est utilisable dès qu’il est enregistré ; à partir de là, chaque agent de l’espace de travail peut répondre avec n’importe quel modèle que ce connecteur expose.

<Frame caption="Un fournisseur connecté avec son catalogue de modèles.">

![La page des paramètres des fournisseurs d’IA listant un seul fournisseur connecté, OpenRouter, avec son URL de base et ses 52 modèles.](/images/get-started/settings-providers.webp)

</Frame>

</Step>

<Step title="Fais entrer l’équipe">

Pour ajouter des personnes, ouvre **Paramètres > Organisation**, descends jusqu’à la section **Membres** et clique sur **Ajouter un membre**. Chaque personne arrive avec un rôle qui borne ce qu’elle peut faire : **Membre** lit et discute, **Éditeur** construit agents et connaissances, **Développeur** câble workflows, automatisations et accès API, **Admin** gère l’espace de travail. Commence bas — monter un rôle plus tard prend un clic, et reprendre un accès qui a fuité, non.

<Frame caption="La section Membres — chaque compte et son rôle.">

![La page des paramètres de l’organisation avec sa section Membres listant le propriétaire de l’espace de travail Alex Rivera et un bouton Ajouter un membre.](/images/get-started/settings-organization-members.webp)

</Frame>

<Check>

Un collègue qui se connecte et obtient une réponse dans le chat prouve toute la chaîne — compte, rôle, fournisseur — sans que tu sois à côté de lui.

</Check>

</Step>

<Step title="Sache où vit la gouvernance">

Tu n’auras pas besoin de politiques le premier jour, mais tu dois connaître la porte : **Paramètres > Gouvernance** regroupe journaux d’audit, analyses d’usage, politiques de contenu, garde-fous et rétention. La seule habitude qui vaut d’être prise aujourd’hui est de parcourir les [journaux d’audit](/fr/platform/admin/governance/audit-logs) après la première semaine — ils montrent ce que ton espace de travail fait vraiment.

</Step>

</Steps>

## Où tu en es

L’espace de travail tient debout : un fournisseur répond, l’équipe est entrée avec des rôles bornés et tu sais où vivent les contrôles. La matrice complète des permissions est [Membres et rôles](/fr/platform/admin/members-and-roles) ; la [vue d’ensemble admin](/fr/platform/admin/overview) cartographie chaque panneau que tu possèdes désormais ; et quand la conformité te sollicite, la [gouvernance](/fr/platform/admin/governance/audit-logs) est la section à lui montrer.
