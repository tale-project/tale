/**
 * Build multi-modal content from registered files.
 */

import type {
  RegisteredFile,
  MessageContentPart,
  MultiModalContent,
} from './types';

/**
 * Builds multi-modal content parts from registered files.
 *
 * - Images are included directly as AIImagePart for the AI to see
 * - Non-image files are referenced as URLs with instructions for the AI to use tools
 *
 * @param registeredFiles - Files registered with the agent component
 * @param userText - The user's text message (defaults to "Please analyze the attached files.")
 * @returns Content parts array suitable for AI model consumption
 */
export function buildMultiModalContent(
  registeredFiles: RegisteredFile[],
  userText: string = 'Please analyze the attached files.',
): MultiModalContent {
  const contentParts: MessageContentPart[] = [];

  // Separate images from other files
  const imageFiles = registeredFiles.filter((f) => f.isImage);
  const nonImageFiles = registeredFiles.filter((f) => !f.isImage);

  // Start with the user's text
  contentParts.push({ type: 'text', text: userText });

  // For non-image files (PDF, etc.), provide the URL and let AI use tools
  if (nonImageFiles.length > 0) {
    const fileReferences = nonImageFiles
      .map(
        (f) =>
          `- **${f.attachment.fileName}** (${f.attachment.fileType}): ${f.fileUrl}`,
      )
      .join('\n');

    contentParts.push({
      type: 'text',
      text: `\n\n[ATTACHMENTS] The user has attached the following files. Use the appropriate tool to read them:\n${fileReferences}`,
    });
  }

  // For images, include them directly in the prompt for the AI to see
  if (imageFiles.length > 0) {
    if (nonImageFiles.length === 0) {
      contentParts.push({
        type: 'text',
        text: '\n\n[IMAGES] The user has attached the following images:',
      });
    } else {
      contentParts.push({
        type: 'text',
        text: '\n\n[IMAGES] The user has also attached the following images:',
      });
    }

    for (const regFile of imageFiles) {
      if (regFile.imagePart) {
        contentParts.push(regFile.imagePart);
      }
    }
  }

  return {
    contentParts,
    hasImages: imageFiles.length > 0,
    hasNonImageFiles: nonImageFiles.length > 0,
  };
}

