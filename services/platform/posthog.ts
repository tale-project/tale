import { PostHog } from 'posthog-node';

let posthogClientInstance: PostHog | null = null;

export default function PostHogClient() {
  if (posthogClientInstance) {
    return posthogClientInstance;
  }

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    throw new Error('PostHog API key is not defined in environment variables');
  }

  posthogClientInstance = new PostHog(apiKey, {
    host: 'https://eu.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return posthogClientInstance;
}
