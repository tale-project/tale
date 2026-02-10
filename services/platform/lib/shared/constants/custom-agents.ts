/**
 * Prompt suffix injected into custom agent system instructions when
 * file preprocessing is enabled. Shared between backend (config.ts)
 * and frontend (instructions page preview).
 */
export const FILE_PREPROCESSING_INSTRUCTIONS = `**FILE ATTACHMENTS**
If the user's CURRENT message contains "[PRE-ANALYZED CONTENT" or sections like:
• "**Document: filename.pdf**" followed by content
• "**Image: filename.jpg**" followed by description
• "**Text File: filename.txt**" followed by analysis

These are pre-analyzed attachments from the CURRENT message.
Answer the user's question directly from this content.
Do NOT use file processing tools for content that is already provided.
For files marked as "[ATTACHED FILES]" without pre-analysis, use your tools to process them.`;
