---
title: Politiques et limites
description: Définis les budgets, règles d’import, durées de rétention, contrôles de fonctionnalités, l’avis de confidentialité du chat et le routage des conversations entrantes.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Politiques et limites** pour contrôler les ressources et le traitement des données. Choisis la section adaptée au problème : dépenses, imports, rétention, fonctionnalités, avis affiché dans le chat ou destinataires des conversations entrantes.

<Frame caption="Gouvernance > Politiques et limites — le tableau des règles de budget, au-dessus de la politique d’import et des contrôles de rétention.">

![La page de gouvernance Politiques et limites montrant trois règles de budget mensuelles — une pour l’organisation entière, une par défaut pour tous les utilisateurs et une pour le rôle Développeur, chacune plafonnant les tokens, le coût et les requêtes — au-dessus des champs de politique d’import pour les types de fichiers autorisés, les tailles et le volume.](/images/platform/governance-policies-limits.webp)

</Frame>

## Ajouter un budget

1. Dans les règles de budget, choisis **Ajouter une règle**.
2. Choisis la portée et sa cible : un rôle pour un groupe comme les rédacteurs, une équipe pour un travail commun, une personne pour une limite individuelle, une clé API pour un identifiant, ou l’organisation pour un plafond partagé.
3. Sélectionne une période quotidienne, hebdomadaire ou mensuelle. Renseigne au moins une limite positive de tokens, de coût ou de requêtes. Le coût est en USD ; un champ vide ne plafonne pas cette dimension par cette règle.
4. Définis si besoin le seuil d’alerte entre 0 et 100 pour avertir avant d’atteindre le plafond.
5. Choisis **Confirmer**, enregistre les changements de la page et vérifie la portée, la cible, la période et les limites enregistrées.

Par exemple, une règle mensuelle de rôle peut donner aux rédacteurs un budget personnel de 50 USD, tandis qu’une règle d’organisation plafonne les dépenses cumulées à 500 USD. Ce sont des exemples, pas des valeurs recommandées.

Les budgets concernent les nouveaux travaux facturables, dont le chat, la sortie vocale et les exécutions d’agents gérés. Tale vérifie chaque requête de chat avant son exécution — un message envoyé, une réponse régénérée ou modifiée, les deux côtés d’une comparaison de modèles, un message en attente d’une pièce jointe et un envoi par l’API REST — et la refuse dès qu’un plafond applicable est atteint, en indiquant ce plafond et le moment de sa réinitialisation. Les réponses en cours de rédaction réservent ce qu’elles peuvent dépenser, afin que des requêtes envoyées au même moment ne franchissent pas ensemble un plafond presque atteint. La génération d’images exige des limites de coût ou de requêtes, car elle n’est pas mesurée en tokens de texte. Examine les alertes dans l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics).

## Comprendre les plafonds applicables

Pour chaque dimension, la limite personnelle vient de la règle la plus précise qui la définit : personne, équipe, rôle, puis valeur par défaut. Si une personne appartient à plusieurs équipes dotées d’une règle, le plafond le plus strict s’applique à elle. Les plafonds de l’organisation s’ajoutent. Un budget d’équipe plafonne aussi l’usage cumulé des membres actuels de l’équipe, même si un membre a une règle personnelle plus précise : l’usage d’un nouveau membre sur la période en cours compte aussitôt, et celui d’un membre parti ne compte plus. Les limites de clé API plafonnent séparément les requêtes authentifiées par cette clé, dont l’usage est imputé à la clé, pas les autres actions dans l’interface.

Les exécutions d’agents gérés comptent pour la personne qui les a lancées. Une exécution que tu démarres depuis une tâche, un commentaire, l’API REST ou le point d’accès MCP consomme tes plafonds personnels et d’équipe, et une exécution lancée avec une clé API compte aussi pour cette clé. Les exécutions démarrées par une planification, un webhook ou un événement n’ont personne derrière elles : seules les limites de l’organisation s’y appliquent, et l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics) les regroupe sous **Automatisations (déclencheurs)**. [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) explique la règle pour chaque type de travail.

Si une requête est refusée de façon inattendue, vérifie tous les plafonds applicables et leurs périodes. Augmenter une limite personnelle ne retire pas un plafond d’organisation, d’équipe ou de clé API.

Les membres consultent leur propre situation sous [Paramètres > Utilisation](/fr/platform/member/preferences#usage-limits). Chaque plafond personnel, d’équipe ou d’organisation qui les concerne y figure avec l’utilisation actuelle et la prochaine réinitialisation, sans que les règles elles-mêmes soient affichées.

### Comment les règles se combinent {#how-rules-combine}

Chaque politique de cette page et de [Contenu et modèles](/fr/platform/admin/governance/content-models) lit ses règles de la même façon. La portée la plus précise l’emporte : une règle individuelle avant une règle d’équipe, une règle d’équipe avant une règle de rôle, une règle de rôle avant la valeur par défaut. Lorsqu’une personne appartient à plusieurs équipes dotées d’une règle, les règles d’équipe se combinent selon leur nature :

- Une limite, comme un plafond de budget ou de fenêtre de contexte, prend la valeur la plus stricte. Rejoindre une équipe généreuse n’augmente jamais le plafond de quelqu’un.
- Une liste d’autorisations, comme l’accès aux modèles, se combine par l’union des modèles autorisés ; un blocage dans l’une des règles reste prioritaire pour ce modèle.
- Un choix unique, comme le modèle par défaut, suit l’ordre des règles dans le tableau : la première règle d’équipe correspondante l’emporte.

## Contrôler les imports

La politique d’import définit les extensions autorisées et bloquées, les types MIME autorisés, la taille maximale par fichier en Mo et le volume total par personne en Go. Choisis les types nécessaires et teste un fichier autorisé et un fichier refusé après l’enregistrement.

L’extension, le type de contenu et la taille sont des vérifications distinctes. En cas d’échec, compare les trois avec la règle. Vérifie le stockage déjà utilisé si les fichiers respectent individuellement les limites mais que les nouveaux imports sont refusés.

## Définir la rétention et la récupération

Dans la règle de rétention, choisis **Modifier** et configure les catégories nécessaires. Le résumé montre les valeurs effectives, les catégories désactivées et le nettoyage des fichiers temporaires. Désactiver la rétention planifiée d’une catégorie n’empêche pas une suppression explicite ni une demande d’effacement.

Vérifie les bornes minimales et maximales du déploiement avant de modifier une durée. Les changements qui demandent une revue ou un délai apparaissent comme propositions ou changements en attente. Lis leur date d’effet sans supposer une application immédiate.

Le délai de grâce est la fenêtre de récupération des enregistrements supprimés provisoirement pris en charge. Une valeur positive laisse du temps pour les restaurer dans la [Corbeille](/fr/platform/admin/governance/trash) ; zéro permet un nettoyage définitif immédiat. Toutes les catégories ne sont pas restaurables. Une [conservation juridique](/fr/platform/admin/governance/legal-hold) protège les données couvertes du nettoyage.

Pour les déploiements autohébergés, la [configuration de rétention](/fr/self-hosted/configuration/retention) explique les contrôles opérateur et le comportement par catégorie. Ne déduis pas une garantie d’archivage d’une règle désactivée ou d’une durée affichée seule.

## Examiner les contrôles de fonctionnalités

Les contrôles comprennent les limites de fenêtre de contexte par portée et le commutateur de sortie vocale pour l’organisation. Une limite de contexte détermine la quantité de contexte transmise à une réponse d’IA ; elle diffère d’un budget. Une limite inférieure à 200 000 tokens s’applique aussi aux exécutions d’agents Claude Code, selon la limite de la personne qui a lancé l’exécution : l’agent condense sa conversation en un résumé avant qu’elle ne dépasse la limite, et Claude Code traite toute limite inférieure à 100 000 tokens comme 100 000. Désactiver la sortie vocale empêche les membres de l’activer par leurs réglages personnels ou leurs conversations.

Le commutateur par défaut des instructions personnalisées enregistre la valeur d’organisation pour les instructions personnelles des membres : tant qu’il est activé, les instructions personnalisées de chaque membre s’appliquent à ses réponses de chat, sauf si le membre a désactivé la fonction lui-même sous **Paramètres > Personnalisation**. Les instructions obligatoires de l’organisation sont un réglage séparé sous [Garde-fous](/fr/platform/admin/governance/guardrails).

## Afficher un avis de confidentialité dans le chat

**Avis de confidentialité** ajoute une courte ligne sous le champ de message du chat pour tous les membres de ton organisation, par exemple pour rappeler de ne pas partager de données sensibles. L’avis reste désactivé tant que tu ne l’actives pas.

1. Active le commutateur **Avis de confidentialité**. Les membres voient aussitôt l’avis dans le chat, dans leur langue, et les chats ouverts se mettent à jour sans rechargement.
2. Si tu le souhaites, saisis ton propre texte dans les onglets de langue **English**, **Deutsch** et **Français**, jusqu’à 280 caractères par langue. Enregistre ensuite les changements de la page.

<Frame caption="Gouvernance > Politiques et limites — l’avis de confidentialité activé, avec un texte anglais, une traduction allemande et le français encore non traduit.">

![La section Avis de confidentialité, commutateur activé et onglet English sélectionné, demande de ne pas coller de noms de clients, de montants de contrats ni de noms de code de projets non publiés dans le chat ; l’onglet Français est marqué non traduit.](/images/platform/governance-confidentiality-notice.webp)

</Frame>

Chaque membre voit le texte de sa langue. Un onglet marqué **non traduit** n’a pas de texte propre : les membres qui lisent cette langue voient ton texte anglais, ou l’avis par défaut si l’anglais est vide lui aussi, et le champ vide présente ce texte en aperçu. Un point rouge signale une langue dont le texte est trop long ; l’enregistrement reste impossible tant que tu ne l’as pas raccourci. Désactiver l’avis conserve tes textes pour la prochaine activation.

L’avis n’est qu’un rappel : il ne vérifie, ne bloque ni ne modifie les messages envoyés. Pour agir sur les contenus sensibles, configure les [Garde-fous](/fr/platform/admin/governance/guardrails).

## Routage des conversations

Utilise le **Routage des conversations** pour attribuer les nouvelles conversations selon leur point d’arrivée. Ajoute une règle, remplis ses champs, puis enregistre :

- **Arrive par** : **N'importe quelle boîte**, une boîte précise sous son nom, ou une app API. Une app API apparaît dès qu’elle a synchronisé une conversation.
- **Envoyé à** : l’adresse à laquelle la conversation a été envoyée. Elle est obligatoire pour **N'importe quelle boîte**, facultative pour une boîte précise et absente pour une app API. La comparaison des adresses ignore la casse.
- **Assigner à** : une équipe, une personne ou les deux.

Une règle pour `support@example.com` couvre aussi le courrier étiqueté comme `support+facturation@example.com`, et une règle pour l’adresse étiquetée l’emporte pour cette adresse. Si plusieurs règles correspondent, la plus précise s’applique : une boîte avec son adresse exacte, puis une boîte avec l’adresse de base, puis une adresse sur n’importe quelle boîte, enfin une boîte seule.

Une attribution d’équipe rend la conversation visible à ses membres ; une attribution individuelle la rend visible à cette personne. Avec les deux, l’une ou l’autre appartenance donne accès. Les conversations non attribuées sont réservées au triage des admins et propriétaires.

Les règles s’appliquent à l’arrivée d’une nouvelle conversation. Elles ne réattribuent pas une conversation existante lorsqu’une réponse la rejoint. Si une règle vise une personne, une équipe ou une boîte supprimée, la conversation arrive quand même sans cette attribution. Teste avec un nouveau message et vérifie la personne ou l’équipe obtenue.

## Configurer les limites de connexion séparément

Les exigences de mot de passe, limites de tentatives, délais d’inactivité de session et [règles de double facteur](/fr/platform/admin/two-factor-authentication) se trouvent dans **Paramètres > Gouvernance > Sécurité**. Le délai d’inactivité de l’organisation peut renforcer celui du déploiement. Avec l’authentification par en-têtes de confiance, coordonne l’expiration avec le proxy ou l’IdP, qui peut authentifier le membre à nouveau.
