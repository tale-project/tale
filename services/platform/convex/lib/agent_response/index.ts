/**
 * Generic Agent Response Generator
 *
 * This module provides a unified implementation for generating agent responses.
 * All agents use this shared implementation with their specific configuration.
 *
 * Features:
 * - Supports both generateText (sub-agents) and streamText (chat agent)
 * - Hooks system for customizing the pipeline
 * - Automatic tool call extraction and sub-agent usage tracking
 */

export * from './types';
export { generateAgentResponse } from './generate_response';
