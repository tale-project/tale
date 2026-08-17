---
title: Catalogue de modèles
description: Quels modèles ton organisation peut choisir, d’où vient la liste de chaque fournisseur, et quoi vérifier quand un modèle attendu manque dans le sélecteur.
---

Chaque sélecteur de modèle dans Tale propose la même chose — les modèles que ton organisation peut réellement joindre à cet instant. Cet ensemble se construit par fournisseur, à partir de la liste de modèles du connecteur et des identifiants que tu détiens en face, puis se resserre selon tes règles de gouvernance. Cette page explique d’où vient chaque morceau, pour que « pourquoi ce modèle manque-t-il » ait une réponse sur laquelle agir plutôt qu’une hypothèse.

## Le catalogue appartient au fournisseur

Il n’existe pas de liste globale unique. Chaque connecteur de fournisseur déclare d’où viennent ses modèles, et le badge de sa section sous **Paramètres > Fournisseurs IA** nomme la source :

- **Catalogue intégré** — la liste est livrée avec la plateforme et évolue avec elle. C’est le cas d’OpenAI, Anthropic, Gemini, DeepSeek, Moonshot AI (Kimi), Qwen (Alibaba), SpaceXAI et Z.ai (GLM).
- **Catalogue OpenRouter** — récupéré depuis le catalogue d’OpenRouter et normalisé à l’arrivée. C’est le cas d’OpenRouter, ce qui explique que sa liste soit de loin la plus longue.
- **Endpoint models du fournisseur** — récupéré depuis la liste de modèles du fournisseur lui-même. C’est le cas de Vercel AI Gateway.
- **Pas de catalogue** — le fournisseur ne publie rien qui vaille la peine d’être livré, donc les modèles viennent de chaque identifiant. C’est le cas d’Azure OpenAI et de Nous Portal (Hermes).

Le compte à côté du badge est la liste actuelle de ce connecteur. Il ne dit rien de ce que ton organisation peut appeler, seulement de ce que le fournisseur propose.

## Ce qui décide de la disponibilité

Un modèle atteint un sélecteur après avoir franchi deux barrières, dans cet ordre.

La première, ce sont les identifiants. Un connecteur sans identifiant est un fournisseur que tu ne peux pas appeler, catalogue ou pas. Un identifiant dont les **Modèles autorisés** sont vides offre tout le catalogue de son connecteur ; un identifiant avec une liste n’offre que les modèles qui y figurent. L’union sur tous les identifiants actifs est ce que ton organisation peut techniquement joindre.

La seconde, c’est la gouvernance. Les règles d’accès aux modèles sous [Contenu et modèles](/fr/platform/admin/governance/content-models) autorisent ou bloquent des modèles par organisation, équipe, rôle ou personne, et s’appliquent par-dessus la première. Un modèle qui franchit les identifiants mais pas la règle reste invisible pour ce périmètre, et la résolution refuse de s’y lier même si un agent l’a épinglé.

<Note>

Quand un modèle attendu est absent, parcours les deux barrières dans cet ordre. Vérifie qu’un identifiant existe pour son fournisseur et qu’il est actif, regarde si la liste de cet identifiant l’exclut, puis contrôle les règles d’accès aux modèles pour le périmètre depuis lequel tu regardes. Presque tous les « modèles manquants » sont l’un de ces trois cas.

</Note>

## Les fournisseurs sans catalogue livré

Certains fournisseurs ne peuvent pas publier une liste que Tale pourrait livrer. Pour ces connecteurs, les **Modèles autorisés** d’un identifiant cessent d’être un filtre et deviennent la disponibilité elle-même : le champ accepte du texte libre, tu y saisis des ids de modèles séparés par des virgules, et ces ids sont les seuls modèles que cet identifiant peut joindre.

<Info>

Sur Azure OpenAI, ces ids sont les noms de déploiement que tu as choisis dans ta ressource Azure, pas les noms publics du fournisseur. Un identifiant dont la liste est vide n’y rend aucun modèle disponible, ce qui est la cause habituelle d’un connecteur Azure qui a l’air configuré et ne propose rien.

</Info>

## Actualiser un catalogue en ligne

Les catalogues récupérés chez un fournisseur sont mis en cache et ne se rafraîchissent que sur demande. La carte **Catalogues de modèles**, en haut de **Paramètres > Fournisseurs IA**, porte un bouton **Actualiser les catalogues** qui recharge chaque source en ligne et rend une ligne par connecteur : le nombre de modèles trouvés, ou l’erreur qui l’a arrêté.

Il n’y a ni synchronisation en arrière-plan ni tâche planifiée, donc un modèle publié ce matin apparaît à la prochaine actualisation et pas avant. Quand chaque connecteur de ton instance livre un catalogue intégré, il n’y a rien à récupérer et la carte le dit.

## Choisir un modèle

Le chat s’ouvre sur **Auto** : Tale lit chaque message et lui choisit un modèle — une heuristique légère sur la longueur, le code, le sujet et les documents joints, jamais un appel IA de plus — puis exécute exactement ce modèle et l’inscrit sur la réponse, où les détails du message le nomment. Choisis plutôt un modèle dans le menu et le choix reste le tien jusqu’à ce que tu le rendes à Auto ; épingler un modèle est le remède quand la sélection automatique est lente, chère ou mal adaptée.

Partout ailleurs, le modèle est toujours nommé explicitement : sur un agent, sur toute étape de workflow qui appelle un modèle, et sur chaque requête API. Là, rien ne route à ta place — pas de sélection selon la complexité de la tâche, pas de paliers de qualité. Et nulle part — chat compris — il n’y a de bascule silencieuse : le modèle qui commence une réponse est celui qui la termine, ou tu vois l’erreur. Une exécution reste reproductible et une facture attribuable, parce que le modèle qui a tourné est enregistré, jamais deviné.

<Tip>

Quand plusieurs modèles pourraient plausiblement faire le travail, le [Mode Arène](/fr/platform/chat/arena-mode) envoie le même prompt à plusieurs d’entre eux côte à côte, ce qui transforme le choix en comparaison plutôt qu’en intuition.

</Tip>

## Où cela s’inscrit

Le catalogue est la moitié visible de la configuration des fournisseurs : ce qu’un Administrateur connecte sous [Fournisseurs IA](/fr/platform/admin/providers) est ce que tout le monde voit ici dans un sélecteur. Élargir l’ensemble revient à ajouter un identifiant ou à relâcher une liste ; le rétrécir revient à poser une liste de modèles autorisés ou une règle d’accès sous [Contenu et modèles](/fr/platform/admin/governance/content-models). Pour savoir comment le modèle se place à côté des instructions, des connaissances et des outils dans un agent, lis [Concepts d’agent](/fr/platform/agents/concepts).
