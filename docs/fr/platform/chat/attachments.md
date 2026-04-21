---
title: Pièces jointes du chat
description: Attache des fichiers à tes messages pour que l'IA lise images, documents et code.
---

Tu peux joindre des fichiers à n'importe quel message afin que l'agent IA les analyse en même temps que ta question. Les pièces jointes sont traitées avant l'envoi du message et leur contenu est inclus dans la conversation.

## Comment joindre

- Clique l'icône **trombone** dans la barre d'outils du chat et choisis des fichiers.
- Ou glisse-dépose des fichiers directement sur la fenêtre de chat.

Tu peux joindre plusieurs fichiers à la fois. Chaque fichier affiche un indicateur de progression ; le message ne part qu'une fois chaque fichier prêt.

## Types de fichiers pris en charge

| Catégorie     | Extensions                                      | Ce que fait l'IA                                                                                                 |
| ------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Images**    | PNG, JPEG, GIF, WebP                            | regarde le contenu visuel — mise en page, graphiques, photos, texte dans l'image.                                |
| **Documents** | PDF, DOCX, XLSX, PPTX, TXT, Markdown            | lit le contenu textuel, y compris tableaux et titres.                                                            |
| **Code**      | JS, TS, Python et la plupart des formats source | lit le code source avec conscience syntaxique.                                                                   |
| **Audio**     | MP3, M4A, WAV, OGG, WebM audio                  | transcrit la piste audio et transmet le texte à l'agent. Les octets bruts n'atteignent jamais le modèle de chat. |
| **Vidéo**     | MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V        | extrait la piste audio, la transcrit et transmet le texte à l'agent. Le contenu visuel n'est **pas** envoyé.     |

### Transcription audio et vidéo

Quand tu joins un fichier audio ou vidéo, une pipeline de transcription côté serveur s'exécute avant l'envoi du message :

1. Le fichier est compressé en Opus (et découpé en tranches si besoin) pour tenir dans la limite d'entrée du modèle de transcription.
2. Chaque tranche part vers le modèle avec le tag `transcription` configuré pour l'organisation (par exemple OpenAI Whisper ou un serveur auto-hébergé compatible Whisper comme faster-whisper-server, vLLM ou LocalAI).
3. La transcription renvoyée est ajoutée au message sous forme de texte.

Une pastille de statut sur la pièce jointe indique la progression — _Transcription en cours…_, _Transcrit_ ou _Transcription impossible_. Tu peux ignorer la transcription d'une pièce jointe ou réessayer en cas d'échec. Un message avec un audio en cours ne peut pas être envoyé tant que chaque pièce jointe n'est pas transcrite, ignorée ou échouée.

Un admin doit configurer un modèle de fournisseur taggé `transcription` pour que cela fonctionne — voir [Fournisseurs IA](/fr/platform/admin/providers). Les appels de transcription sont facturés par minute d'audio et enregistrés dans le registre d'utilisation aux côtés des tokens de chat.

## Limites de taille et de nombre

- **Taille maximale :** 100 Mo par fichier par défaut. Les admins peuvent définir une limite plus stricte par type MIME (par exemple 25 Mo pour l'audio) dans la [politique d'upload](/fr/platform/admin/governance#upload-policy).
- **Durée audio :** les uploads audio et vidéo sont plafonnés à 4 heures d'audio. Les fichiers plus longs sont rejetés au téléversement — découpe l'enregistrement en segments plus courts.
- **Nombre maximal par message :** 10. Pour l'ingestion en masse, utilise la [base de connaissances](/fr/platform/workspace/knowledge-base).

## Où vivent les pièces jointes

Les fichiers attachés au chat restent avec la conversation — ils ne sont pas automatiquement ajoutés à la base de connaissances partagée. Si tu veux que l'IA s'en souvienne pour des conversations futures, téléverse-les séparément dans la base.

Supprimer une conversation supprime aussi ses pièces jointes, sauf si la [politique de rétention](/fr/platform/admin/governance) de ton organisation les conserve plus longtemps.

## Sécurité

Les téléversements sont scannés pour virus et types MIME bloqués avant d'atteindre le modèle. Si ton admin a activé la [détection DCP](/fr/platform/admin/governance), les textes extraits des pièces jointes passent par les mêmes règles que les messages saisis.
