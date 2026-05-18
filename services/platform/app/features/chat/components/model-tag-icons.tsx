import {
  AudioLines,
  Brain,
  Image,
  ImagePlus,
  MessageCircle,
  Pencil,
  Volume2,
  type LucideIcon,
} from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';

const TAG_CONFIG: Record<string, { icon: LucideIcon; labelKey: string }> = {
  chat: { icon: MessageCircle, labelKey: 'modelSelector.tags.chat' },
  vision: { icon: Image, labelKey: 'modelSelector.tags.vision' },
  embedding: { icon: Brain, labelKey: 'modelSelector.tags.embedding' },
  'image-generation': {
    icon: ImagePlus,
    labelKey: 'modelSelector.tags.imageGeneration',
  },
  'image-edit': {
    icon: Pencil,
    labelKey: 'modelSelector.tags.imageEdit',
  },
  transcription: {
    icon: AudioLines,
    labelKey: 'modelSelector.tags.transcription',
  },
  'text-to-speech': {
    icon: Volume2,
    labelKey: 'modelSelector.tags.textToSpeech',
  },
};

interface ModelTagIconsProps {
  tags: string[];
  t: (key: string) => string;
}

export function ModelTagIcons({ tags, t }: ModelTagIconsProps) {
  if (tags.length === 0) return null;

  return (
    <div className="mt-0.5 flex shrink-0 items-start gap-1">
      {tags.map((tag) => {
        const config = TAG_CONFIG[tag];
        if (!config) return null;
        const Icon = config.icon;
        return (
          <Tooltip key={tag} content={t(config.labelKey)} side="top">
            <span className="text-muted-foreground flex items-center">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
