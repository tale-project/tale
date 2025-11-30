# Tone of Voice Module Implementation

## Overview

The Tone of Voice module enables organizations to define and maintain their brand voice through example messages and AI-generated tone descriptions.

## Schema Design

### Tables

#### 1. `toneOfVoice`

Stores the organization's tone of voice configuration.

**Fields:**

- `organizationId`: ID reference to organizations table
- `generatedTone`: AI-generated tone description (optional)
- `lastUpdated`: Timestamp of last update
- `metadata`: Flexible metadata field

**Indexes:**

- `by_organizationId`: Query tone of voice by organization

#### 2. `exampleMessages`

Stores example messages used to generate tone of voice.

**Fields:**

- `organizationId`: ID reference to organizations table
- `toneOfVoiceId`: ID reference to toneOfVoice table
- `content`: Message content
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp
- `metadata`: Flexible metadata field

**Indexes:**

- `by_organizationId`: Query examples by organization
- `by_toneOfVoiceId`: Query examples by tone of voice
- `by_organizationId_and_toneOfVoiceId`: Combined index for efficient queries

---

## API Reference

### Tone of Voice APIs (`convex/tone_of_voice.ts`)

#### Queries

##### `getToneOfVoice`

Get tone of voice for an organization.

```typescript
const toneOfVoice = await useQuery(api.tone_of_voice.getToneOfVoice, {
  organizationId: 'j9...',
});
```

**Returns:** Tone of voice object or null

##### `getExampleMessages`

Get example messages for a tone of voice.

```typescript
const examples = await useQuery(api.tone_of_voice.getExampleMessages, {
  organizationId: 'j9...',
  toneOfVoiceId: 'j9...', // Optional
});
```

**Returns:** Array of example messages

##### `getToneOfVoiceWithExamples`

Get tone of voice with all example messages.

```typescript
const data = await useQuery(api.tone_of_voice.getToneOfVoiceWithExamples, {
  organizationId: 'j9...',
});
```

**Returns:** Object with `toneOfVoice` and `examples` or null

#### Mutations

##### `upsertToneOfVoice`

Create or update tone of voice.

```typescript
const toneId = await useMutation(api.tone_of_voice.upsertToneOfVoice, {
  organizationId: 'j9...',
  generatedTone: 'Friendly and professional...',
  metadata: {}, // Optional
});
```

**Returns:** Tone of voice ID

##### `addExampleMessage`

Add an example message.

```typescript
const messageId = await useMutation(api.tone_of_voice.addExampleMessage, {
  organizationId: 'j9...',
  content: 'Thank you for your purchase!',
  metadata: {}, // Optional
});
```

**Returns:** Example message ID

##### `updateExampleMessage`

Update an example message.

```typescript
await useMutation(api.tone_of_voice.updateExampleMessage, {
  messageId: 'j9...',
  content: 'Updated content', // Optional
  metadata: {}, // Optional
});
```

##### `deleteExampleMessage`

Delete an example message.

```typescript
await useMutation(api.tone_of_voice.deleteExampleMessage, {
  messageId: 'j9...',
});
```

#### Actions

##### `generateToneOfVoice`

Generate tone of voice from example messages using AI.

```typescript
const result = await useAction(api.tone_of_voice.generateToneOfVoice, {
  organizationId: 'j9...',
});

if (result.success) {
  console.log('Generated tone:', result.tone);
} else {
  console.error('Error:', result.error);
}
```

**Returns:** Object with `success`, `tone` (if successful), and `error` (if failed)

**Requirements:**

- At least one example message must exist
- `OPENAI_API_KEY` environment variable must be set

##### `regenerateToneOfVoice`

Regenerate tone of voice (same as generate).

```typescript
const result = await useAction(api.tone_of_voice.regenerateToneOfVoice, {
  organizationId: 'j9...',
});
```

---

## Usage Examples

### Example 1: Setting up tone of voice

```typescript
'use client';

import { useMutation, useQuery, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

function ToneOfVoiceSetup({ organizationId }) {
  const toneData = useQuery(api.tone_of_voice.getToneOfVoiceWithExamples, {
    organizationId,
  });
  const addExample = useMutation(api.tone_of_voice.addExampleMessage);
  const generateTone = useAction(api.tone_of_voice.generateToneOfVoice);

  const handleAddExample = async (content: string) => {
    await addExample({
      organizationId,
      content,
    });
  };

  const handleGenerateTone = async () => {
    const result = await generateTone({ organizationId });
    if (result.success) {
      console.log('Generated tone:', result.tone);
    } else {
      console.error('Error:', result.error);
    }
  };

  return (
    <div>
      {/* UI implementation */}
    </div>
  );
}
```

---

## Environment Variables

### Required

- `OPENAI_API_KEY`: OpenAI API key for AI tone generation

### Setup

Add to your `.env.local` file:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

---

## AI Model Configuration

The tone generation uses OpenAI with GPT-4o:

```typescript
const result = await generateObject({
  model: openai('gpt-4o'),
  // ...
});
```

You can change the model by modifying the `model` parameter in `convex/tone_of_voice.ts`.

---

## Best Practices

1. **Example Messages**: Add at least 3-5 diverse examples for better tone generation
2. **Content Quality**: Use authentic messages that truly represent your brand voice
3. **Regular Updates**: Regenerate tone periodically as your brand voice evolves

---

## Troubleshooting

### Issue: "No example messages found"

**Solution:** Add at least one example message before generating tone

### Issue: "OpenAI API key not configured"

**Solution:** Ensure `OPENAI_API_KEY` is set in environment variables

---

## Future Enhancements

- Support for more AI models
- Tone versioning and history
- Tone comparison tools
- Export/import functionality
