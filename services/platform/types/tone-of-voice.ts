import { Doc } from '@/convex/_generated/dataModel';

// ==================== TONE OF VOICE TYPES ====================

export type ToneOfVoice = Doc<'toneOfVoice'>;
export type ExampleMessage = Doc<'exampleMessages'>;

export interface ToneOfVoiceWithExamples {
  toneOfVoice: ToneOfVoice;
  examples: ExampleMessage[];
}

// ==================== FORM TYPES ====================

export interface ExampleMessageFormData {
  content: string;
}

// ==================== API RESPONSE TYPES ====================

export interface GenerateToneResponse {
  success: boolean;
  tone?: string;
  error?: string;
}

// ==================== FRONTEND UI TYPES ====================

export interface ExampleMessageUI {
  id: string;
  content: string;
  updatedAt: Date;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Convert Convex ExampleMessage to UI format
 */
export function exampleMessageToUI(message: ExampleMessage): ExampleMessageUI {
  return {
    id: message._id,
    content: message.content,
    updatedAt: new Date(message.updatedAt),
  };
}
