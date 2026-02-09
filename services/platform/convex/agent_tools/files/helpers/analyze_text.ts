/**
 * Helper for analyzing text files using the fast model.
 * Handles encoding detection, chunking for large files, and LLM analysis.
 * Uses ctx.storage.get() for direct Convex storage access (like analyze_image.ts).
 * Uses Agent framework with saveMessages: 'none' to avoid creating visible thread messages.
 */

import { Agent } from '@convex-dev/agent';

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { components } from '../../../_generated/api';
import { createAgentConfig } from '../../../lib/create_agent_config';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_TEXT_ANALYSIS', '[TextAnalysis]');

const LLM_CHUNK_SIZE = 80 * 1024; // 80KB chunks for LLM processing
const MAX_TEXT_BYTES = 10 * 1024 * 1024; // 10MB max file size
const MAX_CONCURRENT_CHUNKS = 5; // Limit concurrent LLM requests to avoid rate limiting
const MAX_TOTAL_CHUNK_OUTPUT_CHARS = 30000; // Total chars budget for all chunk outputs combined
const MAX_FINAL_RESPONSE_CHARS = 10000; // Max chars for final aggregated response

/**
 * Process items with controlled concurrency (like p-map).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
const SUPPORTED_ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'gbk',
  'gb2312',
  'big5',
  'shift_jis',
  'iso-8859-1',
];

export interface AnalyzeTextParams {
  fileId: string;
  filename: string;
  userInput: string;
}

export interface AnalyzeTextResult {
  success: boolean;
  result: string;
  charCount: number;
  lineCount: number;
  encoding: string;
  chunked: boolean;
  chunkCount?: number;
  error?: string;
}

function decodeWithEncoding(buffer: ArrayBuffer): {
  text: string;
  encoding: string;
} {
  for (const encoding of SUPPORTED_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(buffer);
      if (text.length > 0 && !text.includes('\uFFFD')) {
        return { text, encoding };
      }
    } catch {
      continue;
    }
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  return { text: decoder.decode(buffer), encoding: 'utf-8 (fallback)' };
}

function isBinaryContent(text: string): boolean {
  const sampleSize = Math.min(1000, text.length);
  const sample = text.substring(0, sampleSize);

  let nullCount = 0;
  let controlCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0) nullCount++;
    // Control chars (except tab, newline, carriage return)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controlCount++;
  }

  const nullRatio = nullCount / sampleSize;
  const controlRatio = controlCount / sampleSize;

  return nullRatio > 0.01 || controlRatio > 0.1;
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at a line boundary if not at the end
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start + chunkSize * 0.5) {
        end = lastNewline + 1;
      }
    }

    chunks.push(text.substring(start, end));
    start = end;
  }

  return chunks;
}

const TEXT_ANALYSIS_INSTRUCTIONS = `You are a text analysis assistant. Your job is to analyze text content and answer the user's question accurately.

Guidelines:
- Focus on answering the user's specific question
- Extract relevant information from the text
- Be concise but thorough
- If the text doesn't contain relevant information, say so clearly
- For large texts processed in chunks, focus on the most relevant parts`;

function createTextAnalysisAgent(): Agent {
  const config = createAgentConfig({
    name: 'text-analyzer',
    instructions: TEXT_ANALYSIS_INSTRUCTIONS,
    useFastModel: true,
  });

  return new Agent(components.agent, config);
}

/**
 * Generate unique userId for one-off analysis (messages won't be saved).
 */
function generateEphemeralUserId(): string {
  return `text-analyzer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function analyzeChunk(
  ctx: ActionCtx,
  agent: Agent,
  text: string,
  userInput: string,
  chunkIndex?: number,
  totalChunks?: number,
  maxResponseChars?: number,
): Promise<string> {
  const chunkInfo =
    totalChunks && totalChunks > 1
      ? `\n\n[Processing chunk ${chunkIndex! + 1} of ${totalChunks}]`
      : '';

  // Dynamic limit based on chunk count, or use full budget for single chunk
  const charLimit = maxResponseChars ?? MAX_FINAL_RESPONSE_CHARS;

  const prompt = `User Question: ${userInput}${chunkInfo}

Text Content:
---
${text}
---

Please analyze the text above and answer the user's question.
IMPORTANT: Keep your response under ${charLimit} characters. Be concise and focus on key findings.`;

  const result = await agent.generateText(
    ctx,
    { userId: generateEphemeralUserId() },
    { prompt },
    { storageOptions: { saveMessages: 'none' } },
  );

  return result.text || '';
}

async function aggregateChunkResults(
  ctx: ActionCtx,
  agent: Agent,
  chunkResults: string[],
  userInput: string,
): Promise<string> {
  if (chunkResults.length === 1) {
    return chunkResults[0];
  }

  const combinedResults = chunkResults
    .map((r, i) => `[Chunk ${i + 1} Analysis]\n${r}`)
    .join('\n\n---\n\n');

  const prompt = `The following are analysis results from different parts of a large text file.
User's original question: ${userInput}

Analysis Results:
${combinedResults}

Please synthesize these results into a coherent, comprehensive answer to the user's question.
Remove any redundancy and present the key findings clearly.
IMPORTANT: Keep your final response under ${MAX_FINAL_RESPONSE_CHARS} characters. Prioritize the most important information.`;

  try {
    const result = await agent.generateText(
      ctx,
      { userId: generateEphemeralUserId() },
      { prompt },
      { storageOptions: { saveMessages: 'none' } },
    );

    return result.text || '';
  } catch (error) {
    debugLog('aggregateChunkResults error', {
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Analyze text file content using fast model.
 * Uses ctx.storage.get() for direct Convex storage access (like analyze_image.ts).
 * For large files, splits into chunks and processes each with the user's question.
 * Uses Agent framework with saveMessages: 'none' to avoid creating visible thread messages.
 */
export async function analyzeTextContent(
  ctx: ActionCtx,
  params: AnalyzeTextParams,
): Promise<AnalyzeTextResult> {
  const { fileId, filename, userInput } = params;

  debugLog('analyzeTextContent starting', {
    fileId,
    filename,
    userInput:
      userInput.length > 50 ? userInput.substring(0, 50) + '...' : userInput,
  });

  try {
    // Get the text file blob from storage (like analyze_image.ts)
    // Cast to Id<'_storage'> here - the public API accepts string for serialization boundaries
    const textBlob = await ctx.storage.get(fileId as Id<'_storage'>);
    if (!textBlob) {
      throw new Error(`Text file not found in storage: ${fileId}`);
    }

    debugLog('analyzeTextContent got blob', { size: textBlob.size });

    // Check file size limit
    if (textBlob.size > MAX_TEXT_BYTES) {
      const sizeMB = (textBlob.size / (1024 * 1024)).toFixed(2);
      const maxMB = (MAX_TEXT_BYTES / (1024 * 1024)).toFixed(0);
      return {
        success: false,
        result: '',
        charCount: 0,
        lineCount: 0,
        encoding: 'unknown',
        chunked: false,
        error: `Text file is too large (${sizeMB}MB). Please upload a file smaller than ${maxMB}MB.`,
      };
    }

    const buffer = await textBlob.arrayBuffer();
    debugLog('analyzeTextContent loaded', { bytes: buffer.byteLength });

    const { text, encoding } = decodeWithEncoding(buffer);

    if (isBinaryContent(text)) {
      return {
        success: false,
        result: '',
        charCount: 0,
        lineCount: 0,
        encoding,
        chunked: false,
        error:
          'The file appears to be binary, not a text file. Please upload a valid text file (.txt).',
      };
    }

    const charCount = text.length;
    const lineCount = text.split('\n').length;

    debugLog('analyzeTextContent decoded', { charCount, lineCount, encoding });

    const agent = createTextAnalysisAgent();

    // For smaller content, process in one pass
    if (charCount <= LLM_CHUNK_SIZE) {
      const result = await analyzeChunk(ctx, agent, text, userInput);

      return {
        success: true,
        result,
        charCount,
        lineCount,
        encoding,
        chunked: false,
      };
    }

    // For larger content, split into chunks and process with controlled concurrency
    const chunks = splitIntoChunks(text, LLM_CHUNK_SIZE);

    // Dynamic per-chunk output limit: divide total budget by chunk count
    const perChunkMaxChars = Math.floor(
      MAX_TOTAL_CHUNK_OUTPUT_CHARS / chunks.length,
    );

    debugLog('analyzeTextContent chunking', {
      chunkCount: chunks.length,
      chunkSizes: chunks.map((c) => c.length),
      perChunkMaxChars,
      concurrency: MAX_CONCURRENT_CHUNKS,
    });

    // Process chunks with controlled concurrency to avoid rate limiting
    const startTime = Date.now();
    const chunkResults = await mapWithConcurrency(
      chunks,
      async (chunk, i) => {
        debugLog('analyzeTextContent processing chunk', {
          chunk: `${i + 1}/${chunks.length}`,
          chunkSize: chunk.length,
        });
        const result = await analyzeChunk(
          ctx,
          agent,
          chunk,
          userInput,
          i,
          chunks.length,
          perChunkMaxChars,
        );
        debugLog('analyzeTextContent chunk completed', {
          chunk: `${i + 1}/${chunks.length}`,
          resultLength: result.length,
          elapsedMs: Date.now() - startTime,
        });
        return result;
      },
      MAX_CONCURRENT_CHUNKS,
    );
    debugLog('analyzeTextContent all chunks completed', {
      chunkCount: chunkResults.length,
      totalElapsedMs: Date.now() - startTime,
    });

    debugLog('analyzeTextContent aggregating results', {
      chunkCount: chunkResults.length,
    });
    const aggregatedResult = await aggregateChunkResults(
      ctx,
      agent,
      chunkResults,
      userInput,
    );
    debugLog('analyzeTextContent aggregation completed', {
      resultLength: aggregatedResult.length,
    });

    return {
      success: true,
      result: aggregatedResult,
      charCount,
      lineCount,
      encoding,
      chunked: true,
      chunkCount: chunks.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugLog('analyzeTextContent error', { filename, error: errorMessage });

    return {
      success: false,
      result: '',
      charCount: 0,
      lineCount: 0,
      encoding: 'unknown',
      chunked: false,
      error: errorMessage,
    };
  }
}
