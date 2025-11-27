# MyAI3 - Portfolio Analysis AI Chatbot

## Overview
MyAI3 is an AI-powered portfolio analysis chatbot built with Next.js 16, React 19, and the AI SDK. The application helps users analyze their investment portfolios by providing insights on holdings, sector exposures, risk assessments, and market impact analysis.

**Created by:** Sejal & Karthik  
**AI Assistant Name:** Maya  
**Current Status:** Development - Configured for Replit environment  
**Import Date:** November 27, 2025

## Recent Changes (November 27, 2025)
- Configured Next.js to run on port 5000 with 0.0.0.0 host for Replit environment
- Updated package.json scripts to use `-p 5000 -H 0.0.0.0` flags
- Fixed Next.js config to use proper CORS headers instead of invalid experimental options
- Set up workflow "Start application" to run `npm run dev` with webview on port 5000
- Application successfully running in Replit environment

## Project Architecture

### Technology Stack
- **Framework:** Next.js 16.0.0 (with Turbopack)
- **React:** 19.2.0
- **Language:** TypeScript 5
- **AI SDK:** Vercel AI SDK with multiple provider support (OpenAI, Fireworks, Groq, DeepSeek, xAI)
- **UI Components:** Radix UI + custom components
- **Styling:** Tailwind CSS 4
- **File Processing:** PapaParse (CSV), XLSX (Excel)
- **Vector Database:** Pinecone (optional)
- **Web Search:** Exa API (optional)

### Key Features
1. **Portfolio Analysis:** Users can upload CSV/Excel files or manually enter holdings
2. **AI-Powered Recommendations:** Provides BUY/HOLD/SELL recommendations with confidence scores
3. **Web Search Integration:** Can fetch real-time market data and news
4. **Vector Database Search:** Optional Pinecone integration for knowledge base
5. **Content Moderation:** OpenAI moderation API integration
6. **File Upload:** Supports CSV and Excel portfolio files
7. **Persistent Chat:** Messages stored in browser localStorage

### Project Structure
```
myAI3/
├── app/
│   ├── api/chat/              # Chat API endpoint
│   │   ├── route.ts           # Main chat handler
│   │   └── tools/             # AI tools (web search, vector search)
│   ├── page.tsx               # Main chat interface
│   ├── layout.tsx             # Root layout
│   ├── parts/                 # Header components
│   └── terms/                 # Terms of Use page
├── components/
│   ├── ai-elements/           # AI-specific UI components
│   ├── messages/              # Message display components
│   └── ui/                    # Reusable UI components
├── lib/
│   ├── moderation.ts          # Content moderation logic
│   ├── pinecone.ts            # Vector database integration
│   ├── sources.ts             # Source/citation handling
│   └── utils.ts               # General utilities
├── types/                     # TypeScript type definitions
├── config.ts                  # Main configuration file
├── prompts.ts                 # AI behavior configuration
└── package.json               # Dependencies and scripts
```

## Configuration Files

### config.ts
Main application configuration including:
- AI model selection (currently: gpt-4.1)
- AI name and owner settings
- Welcome message customization
- Moderation denial messages
- Pinecone settings
- Frontend-only mode toggle

### prompts.ts
AI system prompt configuration including:
- Identity prompt (who the AI is)
- Instruction prompt (what the AI does)
- Tone and style guidelines
- Safety guardrails
- Citation rules
- File handling instructions

### next.config.ts
Next.js configuration:
- CORS headers for Replit proxy support
- Custom headers to allow all origins

## Environment Variables (Required)

### Required
- `OPENAI_API_KEY` - OpenAI API key for AI model and moderation

### Optional
- `FIREWORKS_API_KEY` - Fireworks AI API key (alternative provider)
- `EXA_API_KEY` - Exa API key for web search functionality
- `PINECONE_API_KEY` - Pinecone API key for vector database search

## Development Setup

### Running Locally
The application is configured to run on **port 5000** with host **0.0.0.0** for Replit compatibility:
```bash
npm run dev
```

### Build for Production
```bash
npm run build
npm run start
```

## Replit-Specific Configuration

### Workflow
- **Name:** Start application
- **Command:** `npm run dev`
- **Port:** 5000
- **Host:** 0.0.0.0
- **Output Type:** webview

### Host Configuration
The development server is configured to:
1. Listen on 0.0.0.0 (all network interfaces)
2. Use port 5000 (Replit's webview port)
3. Allow CORS from all origins (for Replit proxy)

This ensures users can access the application through Replit's iframe proxy without host verification issues.

## User Preferences
(None recorded yet)

## Known Issues
- LSP may show type errors on initial load (these resolve after the dev server starts)
- Application uses localStorage for chat persistence (data is client-side only)

## API Endpoints

### POST /api/chat
Main chat endpoint that:
1. Accepts JSON or multipart/form-data (for file uploads)
2. Performs content moderation on user messages
3. Processes CSV/Excel files to extract portfolio holdings
4. Streams AI responses with tool calls
5. Supports web search and vector database search tools

## Customization Guide
Most customizations can be made by editing:
1. **config.ts** - Change AI name, messages, model settings
2. **prompts.ts** - Modify AI behavior, tone, instructions

See README.md for detailed customization instructions.

## Deployment Notes
- Original deployment target: Vercel
- Can be published on Replit using the deployment configuration
- Requires environment variables to be set in deployment settings
- Frontend-only mode available via `FRONTEND_ONLY` config flag
