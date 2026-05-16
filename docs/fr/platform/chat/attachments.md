---
title: Pièces jointes du chat
description: Attache des fichiers aux messages du chat pour que l'IA lise les images, parse les documents et transcrive l'audio ou la vidéo avant de répondre.
---

Les pièces jointes du chat sont des fichiers que tu envoies à côté d'un message pour que l'IA puisse les analyser dans le même tour. Tale traite chaque téléversement avant que le message atteigne le modèle — les images et les documents sont extraits en tokens visuels ou en texte brut, l'audio et la vidéo sont transcrits côté serveur, et le résultat est ajouté au corps du message pour que l'agent voie une entrée cohérente. La page s'adresse à tous les rôles du produit : les Membres attachent du matériel de référence à une question, les Éditeurs curent des documents scannés, les Développeurs testent des intégrations avec des charges utiles d'exemple.

Les pièces jointes vivent avec la conversation, pas avec la base de connaissances partagée. La pipeline ci-dessous couvre ce qui part où, les limites de taille et de nombre, les règles de rétention, et le chemin du scan de sécurité.

## Attacher un fichier

Pour attacher un fichier, clique sur l'icône **trombone** dans la barre d'outils du composeur et choisis des fichiers sur l'appareil, ou glisse-dépose les fichiers directement sur la fenêtre de chat. Le message ne part que lorsque chaque pièce jointe est prête — chaque fichier affiche un indicateur de progression pendant le téléversement, plus une pastille de statut de transcription pour l'audio et la vidéo.

## Types de fichiers pris en charge

Les formats acceptés se rangent en cinq catégories, chacune avec son chemin de traitement avant que le message atteigne le modèle :

| Catégorie     | Extensions                                               | Ce qui se passe avant que le modèle voie le fichier                                                                |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Images**    | `PNG`, `JPEG`, `GIF`, `WebP`                             | Envoyé en tokens visuels — le modèle regarde la mise en page, les graphiques, les photos et le texte dans l'image. |
| **Documents** | `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`, `Markdown`         | Le texte et les tableaux sont extraits ; le modèle lit le texte extrait, pas le fichier binaire.                   |
| **Code**      | `JS`, `TS`, `Python` et la plupart des formats sources   | Lu comme texte brut avec conscience de la syntaxe.                                                                 |
| **Audio**     | `MP3`, `M4A`, `WAV`, `OGG`, `WebM` audio                 | Transcrit côté serveur ; seule la transcription atteint le modèle de chat.                                         |
| **Vidéo**     | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `MPEG`, `3GP`, `M4V` | La piste audio est extraite, transcrite et transmise à l'agent. Le contenu visuel n'est **pas** envoyé.            |

## Transcription audio et vidéo

Les téléversements audio et vidéo passent par une pipeline de transcription côté serveur avant que le modèle de chat voie quoi que ce soit. La pipeline compresse le fichier en Opus et le découpe en tranches s'il dépasse la limite d'entrée du modèle de transcription, envoie chaque tranche au modèle `transcription` configuré par l'organisation chez le fournisseur (OpenAI Whisper ou un serveur auto-hébergé compatible Whisper comme faster-whisper-server, vLLM ou LocalAI), et attache la transcription renvoyée au message sous forme de texte.

Une pastille de statut sur la pièce jointe suit la progression — _Transcription en cours…_, _Transcrit_ ou _Transcription impossible_. Tu peux ignorer la transcription par pièce jointe ou réessayer en cas d'échec. Un message avec une pièce jointe audio en attente ne peut pas partir tant que chaque pièce jointe n'est pas transcrite, ignorée ou marquée comme échouée.

La transcription a besoin d'un modèle de fournisseur taggé `transcription` — les Admins configurent ça une fois dans [Fournisseurs IA](/fr/platform/admin/providers). Les appels de transcription sont facturés à la minute d'audio et enregistrés dans le registre d'usage à côté des tokens de chat.

## Limites de taille et de nombre

Les plafonds par défaut pour les pièces jointes par message :

- **Taille par fichier :** 100 Mo par défaut. Les Admins peuvent fixer un plafond plus bas par type MIME (par exemple 25 Mo pour l'audio) dans la [politique de téléversement](/fr/platform/admin/governance#upload-policy).
- **Durée audio :** les téléversements audio et vidéo sont plafonnés à 4 heures d'audio. Les fichiers plus longs sont rejetés au téléversement — découpe l'enregistrement en segments plus courts.
- **Fichiers par message :** 10. Pour l'ingestion en masse, la [base de connaissances](/fr/platform/workspace/knowledge-base) est la bonne surface — elle indexe le contenu une fois et chaque agent de l'organisation peut le chercher.

## Ce qui arrive au fichier après

Les fichiers attachés au chat restent avec la conversation — ils ne sont pas ajoutés automatiquement à la base de connaissances partagée. Supprimer une conversation supprime aussi ses pièces jointes, sauf si la [politique de rétention](/fr/platform/admin/governance) de ton organisation les garde plus longtemps.

## Sécurité et données personnelles

Chaque téléversement est scanné pour les virus et les types MIME bloqués avant d'atteindre le modèle. Si ton organisation a activé la [détection de données personnelles](/fr/platform/admin/governance), le texte extrait des pièces jointes passe par les mêmes règles que les messages saisis — les entités signalées sont expurgées avant que l'agent ne voie l'entrée.

## Où ça s'inscrit

Les pièces jointes sont le chemin ponctuel : un fichier que tu veux montrer à l'IA pour cette conversation, puis oublier. Pour des fichiers que l'IA doit pouvoir retrouver entre conversations, la [base de connaissances](/fr/platform/workspace/knowledge-base) indexe le contenu une fois et chaque agent de l'organisation peut le chercher. Les deux chemins utilisent la même pipeline de parsing ; la différence porte sur la durée de vie et le public.
