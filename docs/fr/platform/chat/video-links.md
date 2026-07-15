---
title: Liens vidéo
description: Colle une URL de vidéo dans le chat et Tale récupère sa transcription pour l’agent — les plateformes prises en charge, le déroulé de l’ingestion et ce que signifie chaque état d’échec.
---

Colle un lien vidéo dans le composeur et Tale récupère la transcription de la vidéo pour que l’agent puisse la lire, la citer et y répondre — pas de téléchargement manuel, pas de copier-coller d’une transcription. C’est le moyen le plus rapide d’amener une conférence, un tutoriel ou une réunion enregistrée dans une réponse.

Cette page couvre la puce de lien vidéo du composeur de chat. Pour coller des fichiers plutôt que des liens, voir [Pièces jointes](/fr/platform/chat/attachments).

## Un exemple déroulé

Colle une URL YouTube dans le composeur. Tale la reconnaît comme un lien vidéo et dépose une puce sous le message, avec le titre de la vidéo et un spinner. Derrière la puce, Tale récupère les sous-titres (ou, à défaut, l’audio, qu’il transcrit), indexe la transcription et fait passer la puce à **Prêt**. Envoie le message et l’agent répond à partir de la transcription, en citant les passages qu’il a utilisés. Une longue vidéo continue de s’indexer en arrière-plan ; la puce affiche sa progression et la transcription devient consultable dès que l’indexation se termine.

## Plateformes prises en charge

Tale ingère les liens de **YouTube** (y compris `youtu.be`, `m.youtube.com` et Music), **Vimeo**, **Dailymotion**, **Twitch** et **Bilibili**. Un lien vers tout autre hôte reste du texte ordinaire dans ton message — aucune puce n’apparaît. Seules les vidéos publiques fonctionnent ; tout ce qui est derrière une connexion, un paywall ou un blocage régional ne peut pas être récupéré.

## Ce que Tale extrait

Tale préfère les sous-titres de la plateforme quand ils existent — ils sont exacts et peu coûteux à récupérer. Quand une vidéo n’a pas de sous-titres, Tale télécharge l’audio et le transcrit par reconnaissance vocale, si bien qu’une vidéo sans sous-titres devient elle aussi une transcription consultable. Dans les deux cas, le résultat est indexé comme n’importe quelle autre connaissance : l’agent récupère les passages pertinents au moment de la réponse et les citations renvoient à la transcription.

## États d’échec

La puce devient rouge quand l’ingestion ne peut pas aboutir, avec une brève raison :

<AccordionGroup>

<Accordion title="La plateforme a bloqué l’accès automatisé">

Les plateformes vidéo — YouTube le plus agressivement — soumettent les requêtes venant d’un serveur plutôt que d’un appareil personnel à un mur « confirme que tu n’es pas un robot ». Quand cela arrive à la récupération de Tale, la puce indique que la plateforme a empêché l’accès. Réessaie dans une minute (le blocage est souvent passager), ou essaie la même vidéo sur une autre plateforme. Les opérateurs en auto-hébergement peuvent réduire ces blocages — voir [plus bas](#pour-les-operateurs-auto-heberges).

</Accordion>

<Accordion title="Trop de requêtes">

La plateforme limite les récupérations de Tale. Attends un moment et utilise le **Réessayer** de la puce ; des ingestions successives depuis le même déploiement en sont la cause habituelle.

</Accordion>

<Accordion title="Vidéo indisponible">

La vidéo est privée, supprimée, restreinte par âge ou par région, ou l’URL est mal formée. Tale ne peut ingérer qu’une vidéo publique ; pour une vidéo sous restriction, il n’y a pas de contournement.

</Accordion>

</AccordionGroup>

Chaque puce en échec porte un **Réessayer**, et réessayer est sans risque — Tale n’indexe jamais deux fois une vidéo déjà réussie.

## Pour les opérateurs auto-hébergés

Un déploiement **Cloud** managé gère les mesures anti-bot à ta place. Si tu héberges toi-même et que l’ingestion vidéo bute sans cesse sur la vérification anti-robot, le déploiement embarque par défaut un fournisseur de tokens de preuve d’origine, et tu peux ajouter un proxy de sortie ou un pool de sessions préchauffées en escalade. La configuration se trouve dans [Ingestion vidéo](/fr/self-hosted/configuration/video-ingestion).

## Où ça s’inscrit

Les liens vidéo sont un moyen limité au chat d’ancrer une réponse dans un enregistrement, comme les [Pièces jointes](/fr/platform/chat/attachments) l’ancrent dans un fichier. Les deux alimentent la récupération de l’agent ; ni l’un ni l’autre ne persiste au-delà du chat. Pour rendre la transcription d’une vidéo réutilisable entre plusieurs chats, copie le texte ingéré dans un document [Connaissances](/fr/platform/knowledge/documents).
