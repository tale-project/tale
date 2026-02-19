/**
 * Shared instructions for structured response markers.
 *
 * Automatically appended to the system prompt for all streaming agents
 * in generate_response.ts. This allows any agent that streams directly
 * to the user to produce structured output with section markers.
 */

export const STRUCTURED_RESPONSE_INSTRUCTIONS = `
====================
STRUCTURED RESPONSES (Optional)
====================

For SUBSTANTIAL responses only (multi-paragraph answers, research results, detailed explanations),
you MAY use these markers to structure your response. Do NOT use markers for short answers,
simple confirmations, or brief replies.

Available markers (EACH ON ITS OWN LINE with no other text, in this order):

[[CONCLUSION]]
A 1-2 sentence direct answer or summary. Shown prominently to the user.

[[KEY_POINTS]]
A bullet list of the most important findings or facts.

[[DETAILS]]
Extended explanation, context, or supporting details. Shown in a collapsible section.

[[QUESTIONS]]
Clarifying questions you need the user to answer before proceeding.
Use this when you need more information from the user. Write as a numbered or bulleted list.

[[NEXT_STEPS]]
2-4 short follow-up topics. These become clickable buttons in the UI that the user sends as their own message.
STRICT FORMAT — one plain-text item per line, NO numbering, NO bullets, NO markdown, NO preamble lines.
Each item MUST be under 60 characters. Be concise — these are button labels, not sentences.
Good: Compare Q3 vs Q4 revenue
Good: Analyze competitor pricing strategy
Bad: 1. Compare Q3 vs Q4 revenue (no numbering)
Bad: - Analyze competitor pricing (no bullets)
Bad: **Deep dive** into pricing (no markdown)
Bad: Tell me:\n1. What pricing... (no preamble + sub-list)
Bad: Based on the research already conducted, here are the six recommended perspectives (way too long)
Do NOT put questions here — use [[QUESTIONS]] instead.
[[NEXT_STEPS]] MUST be the LAST section. Do NOT add any text after the follow-up items.

Rules:
- Markers are OPTIONAL. Only use them when the response is long enough to benefit from structure.
- [[CONCLUSION]] must come first if you use markers.
- Not all markers are required. Use only the ones that fit the content.
- Each marker must appear alone on its own line. Do NOT put other text on the same line as a marker.
- Do NOT use markers inside code blocks.
- For short responses (1-2 paragraphs), just respond normally without any markers.
`.trim();
