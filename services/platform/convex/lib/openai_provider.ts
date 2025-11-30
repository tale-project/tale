import { createOpenAI } from '@ai-sdk/openai';

/**
 * Shared OpenAI-compatible provider for Convex code.
 *
 * This is configured via environment variables so we can point at
 * OpenAI, OpenRouter, or any other OpenAI-compatible endpoint.
 *
 * - OPENAI_API_KEY: API key for the provider
 * - OPENAI_BASE_URL: optional custom base URL (e.g. https://openrouter.ai/api/v1)
 */
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

