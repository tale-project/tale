import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { CanvasCodeRenderer } from './canvas-code-renderer';

const SAMPLE_JAVASCRIPT = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const results = Array.from({ length: 10 }, (_, i) => fibonacci(i));
console.log('Fibonacci sequence:', results.join(', '));

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return this;
  }

  emit(event, ...args) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(...args));
  }
}

const emitter = new EventEmitter();
emitter.on('data', (value) => console.log('Received:', value));
emitter.emit('data', { id: 1, name: 'example' });`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 2rem;
      background: #f5f5f5;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      margin-bottom: 1rem;
    }
    .card h2 {
      margin: 0 0 0.5rem;
      color: #1a1a1a;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-warning { background: #fef9c3; color: #854d0e; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Server Status</h2>
    <p>All systems operational <span class="badge badge-success">Online</span></p>
  </div>
  <div class="card">
    <h2>Deployment</h2>
    <p>Build #4521 in progress <span class="badge badge-warning">Building</span></p>
  </div>
</body>
</html>`;

const SAMPLE_BASH = `#!/bin/bash
set -euo pipefail

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

log_info() { echo -e "\${GREEN}[INFO]\${NC} $1"; }
log_warn() { echo -e "\${YELLOW}[WARN]\${NC} $1"; }
log_error() { echo -e "\${RED}[ERROR]\${NC} $1"; }

# Check dependencies
for cmd in git node npm; do
  if ! command -v "$cmd" &> /dev/null; then
    log_error "$cmd is not installed"
    exit 1
  fi
done

log_info "All dependencies found"

# Deploy workflow
BRANCH=\${1:-main}
ENVIRONMENT=\${2:-staging}

log_info "Deploying branch '$BRANCH' to '$ENVIRONMENT'"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

npm ci --production
npm run build

if [ "$ENVIRONMENT" = "production" ]; then
  log_warn "Production deployment - running migrations"
  npm run db:migrate
fi

npm run deploy -- --env "$ENVIRONMENT"

log_info "Deployment complete!"`;

const SAMPLE_MARKDOWN = `# Project README

## Overview

This is a **full-stack application** built with React and Node.js.
It provides a _real-time collaborative_ editing experience.

## Installation

\`\`\`bash
npm install
npm run dev
\`\`\`

## Features

- Real-time collaboration via WebSockets
- Markdown preview with syntax highlighting
- File upload with drag-and-drop support
- Dark mode / light mode toggle

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/api/docs\` | GET | List all documents |
| \`/api/docs/:id\` | GET | Get document by ID |
| \`/api/docs\` | POST | Create new document |
| \`/api/docs/:id\` | PUT | Update document |

## Configuration

Set the following environment variables:

- \`DATABASE_URL\` — PostgreSQL connection string
- \`REDIS_URL\` — Redis connection for caching
- \`JWT_SECRET\` — Secret for auth tokens

> **Note:** Never commit secrets to version control.

## License

MIT`;

function InteractiveRenderer({
  initialCode,
  language,
  isEditing,
}: {
  initialCode: string;
  language: string;
  isEditing: boolean;
}) {
  const [code, setCode] = useState(initialCode);

  return (
    <CanvasCodeRenderer
      code={code}
      language={language}
      isEditing={isEditing}
      onContentChange={setCode}
    />
  );
}

const meta: Meta<typeof CanvasCodeRenderer> = {
  title: 'Features/Canvas/CanvasCodeRenderer',
  component: CanvasCodeRenderer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    isEditing: { control: 'boolean' },
    language: {
      control: 'select',
      options: [
        'javascript',
        'html',
        'bash',
        'markdown',
        'python',
        'typescript',
        'json',
        'plaintext',
      ],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: 500 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CanvasCodeRenderer>;

export const JavaScript: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_JAVASCRIPT}
      language="javascript"
      isEditing={false}
    />
  ),
};

export const JavaScriptEditing: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_JAVASCRIPT}
      language="javascript"
      isEditing={true}
    />
  ),
};

export const HTML: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_HTML}
      language="html"
      isEditing={false}
    />
  ),
};

export const HTMLEditing: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_HTML}
      language="html"
      isEditing={true}
    />
  ),
};

export const Bash: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_BASH}
      language="bash"
      isEditing={false}
    />
  ),
};

export const BashEditing: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_BASH}
      language="bash"
      isEditing={true}
    />
  ),
};

export const Markdown: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_MARKDOWN}
      language="markdown"
      isEditing={false}
    />
  ),
};

export const MarkdownEditing: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={SAMPLE_MARKDOWN}
      language="markdown"
      isEditing={true}
    />
  ),
};

export const LongContent: Story = {
  render: () => (
    <InteractiveRenderer
      initialCode={Array.from(
        { length: 200 },
        (_, i) => `const line${i + 1} = ${i + 1};`,
      ).join('\n')}
      language="javascript"
      isEditing={false}
    />
  ),
};
