---
type: 'always_apply'
description: 'Project overview and general guidelines for the CRM platform (migrated from legacy .augmentrules)'
---

# Augment Rules for Customer Relationship Management Platform

## Project Overview

This is a Next.js 15+ application built for customer relationship management, product recommendations, and automated email marketing. The platform helps businesses manage customer relationships, generate personalized product recommendations, and automate email campaigns.

### Core Technologies

- **Frontend**: Next.js 15+ with App Router, React 19, TypeScript
- **Backend**: Next.js API routes, Server Actions, Supabase
- **Database**: PostgreSQL via Supabase with Row Level Security (RLS)
- **Styling**: Tailwind CSS with shadcn/ui components
- **AI Integration**: Vercel AI SDK with OpenRouter
- **Package Manager**: npm
- **Authentication**: Better Auth
- **Email**: Resend for transactional emails
- **CMS**: Payload CMS for content management

## Critical Guidelines

### 🌐 Language Requirements (MANDATORY)

- **ALL user-facing content MUST be in English only**
- This includes UI components, labels, buttons, dialogs, forms, toast messages, error messages
- Comments, documentation, variable names, function names, type names must be in English
- Exception: Only use other languages when explicitly requested for translation content

### 🤖 AI Integration (MANDATORY)

- **ALWAYS use Vercel AI SDK** - never import OpenAI directly
- Use OpenRouter as the provider for AI models
- Follow established patterns in `/actions/` and `/utils/ai/` directories

### 🗄️ Database Rules (CRITICAL)

- **NEVER run database reset commands automatically**
- Always ask for explicit user permission before any destructive database operations
- Use `pnpm supabase:generate-types` after schema changes
- Extend types in `supabase/types.extend.ts`, never edit `types.ts` manually

## Architecture Patterns

### File Organization

```
app/                    # Next.js App Router pages
├── (app)/             # Main application routes
├── (payload)/         # CMS admin routes
└── api/               # API routes and webhooks

actions/               # Server Actions (preferred for mutations)
components/            # React components
├── ui/               # Reusable UI components (shadcn/ui)
└── [feature]/        # Feature-specific components

lib/                   # Utility libraries and configurations
service/               # Business logic services
utils/                 # Helper functions and utilities
types/                 # TypeScript type definitions
```

### Component Patterns

- **Server Components by default** - use `'use client'` only when necessary
- **Server Actions preferred** over API routes for mutations
- **TypeScript strict mode** - all code must be properly typed
- **Consistent naming**: kebab-case files, PascalCase components, camelCase functions

### Data Flow

1. **Server Actions** for form submissions and mutations
2. **Server Components** for data fetching and rendering
3. **Client Components** only for interactivity and browser APIs
4. **Supabase** for all database operations with proper RLS policies

## Business Domain Context

### Core Features

- **Customer Management**: Import, segment, and manage customer data
- **Product Recommendations**: AI-powered personalized product suggestions
- **Email Automation**: Automated email campaigns and templates
- **Churn Prevention**: Identify and engage at-risk customers
- **Analytics**: Customer lifecycle and engagement metrics

### Key Entities

- **Business**: Multi-tenant organization structure
- **Customer**: End users of the business
- **Product**: Items available for recommendation
- **ProductRecommendation**: AI-generated suggestions for customers
- **Email**: Automated email communications
- **MessageTemplate**: Reusable email templates

## Development Workflow

### Making Changes

1. **Understand the context** - use codebase retrieval to understand existing patterns
2. **Follow established patterns** - don't reinvent existing solutions
3. **Maintain type safety** - ensure all TypeScript types are correct
4. **Test thoroughly** - write and run tests for new functionality
5. **Use package managers** - never manually edit package.json

### Code Quality

- Use ESLint and Prettier configurations
- Follow existing naming conventions
- Write descriptive commit messages
- Keep functions small and focused
- Use proper error handling and logging

## Integration Guidelines

### Supabase

- Use typed queries with generated types
- Implement proper RLS policies for new tables
- Use admin client for server-side operations
- Regular client for user-facing operations

### AI Features

- Use Vercel AI SDK with OpenRouter provider
- Implement proper error handling for AI operations
- Cache AI responses when appropriate
- Follow rate limiting best practices

### Email System

- Use Resend for all email operations
- Implement proper email templates
- Handle email delivery failures gracefully
- Respect user email preferences

## Security Considerations

- All database tables must have RLS policies
- Validate all user inputs
- Use environment variables for secrets
- Implement proper authentication checks
- Follow GDPR compliance for customer data

## Performance Guidelines

- Use Next.js Image component for all images
- Implement proper caching strategies
- Use React.memo for expensive components
- Optimize database queries
- Use dynamic imports for code splitting

Remember: This is a production application handling real customer data. Always prioritize data integrity, security, and user experience in all changes.
