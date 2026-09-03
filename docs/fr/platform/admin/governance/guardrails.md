---
title: Garde-fous
description: Les trois couches de filtres — sécurité du contenu, détection PII et un fournisseur de modération — qui filtrent les entrées et sorties de chat avant et après le modèle. Les Administrateurs et Propriétaires lisent ceci quand un régulateur nomme une règle de contenu ou quand une fuite justifie une politique plus stricte.
---

Garde-fous est la surface où tu configures les trois couches de filtres que Tale applique à chaque message de chat dans ton organisation. Chaque message traverse la sécurité du contenu (listes de mots et regex administrateur), puis la détection PII (motifs intégrés plus personnalisés), puis un fournisseur de modération externe optionnel — dans cet ordre fixe, à l’entrée et à la sortie. Les Administrateurs et Propriétaires lisent cette page quand un régulateur nomme une règle de contenu, quand une fuite justifie une politique plus stricte, ou quand les réponses d’un agent doivent être assainies avant de quitter le modèle.

<Frame caption="Gouvernance > Garde-fous — les trois cartes de statut des couches de filtres (sécurité du contenu, détection PII, fournisseur de modération), au-dessus du journal des événements récents.">

![La page de gouvernance Garde-fous montrant trois cartes de statut — la sécurité du contenu appliquée à l’entrée et à la sortie sur deux catégories, la détection PII en mode mask sur quatre motifs intégrés, et le fournisseur de modération marqué Désactivé, sans API externe configurée — au-dessus du flux des événements récents, qui n’en signale encore aucun.](/images/platform/governance-guardrails.webp)

</Frame>

## Un layering mis en pratique

Pour configurer les couches, ouvre **Paramètres > Gouvernance > Garde-fous**. L’aperçu affiche trois cartes de statut, une par couche — sécurité du contenu, détection PII, modération — et l’éditeur de chaque couche se trouve plus bas sur la même page ; tu y choisis si la couche tourne sur l’entrée, sur la sortie ou les deux, et ce qu’elle fait à un match. Les instructions personnalisées obligatoires de l’organisation vivent ici aussi — elles contraignent chaque agent, donc elles siègent avec les autres contrôles de contenu. Le tableau des événements récents sous l’aperçu affiche les 50 dernières détections, blocages et erreurs fournisseur avec leur couche, leur direction et leur catégorie de match.

## Sécurité du contenu

La sécurité du contenu est la couche que tu possèdes toi-même. Définis une ou plusieurs catégories — discours haineux, profanité, une regex personnalisée pour un nom de code interne — et choisis un mode par catégorie : **Bloquer** refuse le message, **Masquer** remplace les matches par un placeholder, **Marquer** consigne la détection sans changer le message. Bloquer l’emporte sur Masquer l’emporte sur Marquer quand plusieurs catégories matchent.

Les listes de mots et motifs de cette couche ne quittent jamais le déploiement. Le texte trouvé n’est pas stocké — seule la catégorie, la direction (entrée ou sortie) et le nombre de matches finissent dans l’événement d’audit.

## Détection PII

La détection PII embarque des motifs pour les e-mails, téléphones, IDs gouvernementaux, numéros de paiement et une longue traîne de formats régionaux. Ajoute des motifs personnalisés si ton régulateur nomme un format que les motifs intégrés ratent. Choisis un mode — Bloquer, Masquer avec un placeholder, ou Tokeniser, qui échange les PII contre des jetons indexés à l’aller et les restaure dans la réponse du modèle. Masquer est le choix typique quand le modèle a eu accès à des enregistrements contenant des PII qu’il ne doit pas répéter.

## Fournisseur de modération

La couche modération est un classifieur externe — OpenAI Moderation, Azure Content Safety, Perspective API, ou un endpoint HTTP personnalisé. Configure l’endpoint du fournisseur, une clé API et le mapping catégorie-vers-action (chaque fournisseur renvoie sa propre taxonomie ; le mapping décide quelles catégories bloquent, masquent ou marquent). La couche est optionnelle — laisse-la désactivée et seules les deux premières couches tournent.

Le fournisseur se trouve sur le chemin d’egress réseau. Les pannes sont configurables par direction : fail-open laisse passer le message, fail-closed le refuse. La vue des événements récents affiche les erreurs fournisseur, les statuts HTTP et les événements circuit-open quand la couche est rate-limited.

## Événements récents

Chaque détection, blocage et erreur fournisseur atterrit dans le tableau des événements récents — gardé 90 jours par défaut, ajustable sur la page de politique de rétention. Filtre par couche ou par type ; chaque ligne porte les catégories trouvées, l’acteur et l’horodatage. Le texte brut trouvé n’est jamais stocké — les événements sont une surface de réglage, pas une archive de contenu.

## Où cela s’inscrit

Garde-fous est le filtre runtime entre l’utilisateur et le modèle dans les deux sens. Associe-le à [contenu et modèles](/fr/platform/admin/governance/content-models), pour qu’un modèle approuvé soit aussi soumis aux règles de contenu approuvées. La page compagnon est le [journal d’audit](/fr/platform/admin/governance/audit-logs) — chaque blocage et chaque masquage que les couches garde-fous appliquent y atterrit comme enregistrement permanent.
