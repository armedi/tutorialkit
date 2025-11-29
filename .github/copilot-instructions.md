# TutorialKit Copilot Instructions

## Project Overview
TutorialKit is a monorepo for creating interactive coding tutorials. It uses Docker containers to provide runtime environments where users run code in their browser. Built on Astro with React components for interactivity.

## Architecture

### Package Structure (`packages/`)
- **`astro`** - Astro integration that injects routes, handles content collection, and configures the build
- **`react`** - UI components (editor, terminal, preview panels) using nanostores for state
- **`runtime`** - Docker runtime client, TutorialStore state management, lesson file fetching
- **`backend`** - Express + WebSocket server managing Docker containers via docker-compose
- **`types`** - Zod schemas for content frontmatter (lessons, chapters, parts) and TypeScript types
- **`theme`** - CSS variables and UnoCSS theme tokens
- **`cli`** - `tutorialkit eject` command for customization
- **`create-tutorial`** - `npm create tutorial` scaffolding

### Data Flow
1. Tutorial content lives in `src/content/tutorial/` as Markdown with YAML frontmatter
2. Astro content collections validate against schemas in `@tutorialkit/types`
3. `TutorialStore` (runtime) manages lesson state, file syncing, and Docker communication
4. Backend server receives files via HTTP, manages docker-compose lifecycle, streams terminal via WebSocket

## Development Commands
```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (required before dev)
pnpm dev              # Start dev server at localhost:4321
pnpm test             # Run unit tests across packages
pnpm test:e2e         # Run Playwright E2E tests
pnpm docs             # Start documentation site
pnpm demo             # Start demo tutorial
```

## Key Conventions

### Commit Messages
Follow Angular convention: `type(scope): message`
- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`
- Example: `feat(runtime): add terminal resize support`

### Content Frontmatter
Lessons use YAML frontmatter with these key fields:
```yaml
type: lesson
title: "Lesson Title"
focus: /src/index.js          # File to open in editor
previews: [8080]              # Ports to show in preview
terminal:
  panels: ['terminal', 'output']
prepareCommands:              # Run before lesson loads
  - ['npm install', 'Installing...']
mainCommand: ['npm run dev', 'Starting server']
```

### File Organization for Tests
E2E tests in `e2e/test/` have corresponding content in `e2e/src/content/tutorial/tests/{test-name}/`:
```
e2e/
├── test/navigation.test.ts
└── src/content/tutorial/tests/navigation/
    ├── page-one/
    ├── page-two/
    └── page-three/
```

### Store Pattern
Use nanostores for reactive state. The `TutorialStore` class is the single source of truth:
```typescript
// packages/runtime/src/store/docker-store.ts
export class TutorialStore {
  readonly lessonFullyLoaded = atom<boolean>(false);
  // Subscribe in React with useStore(tutorialStore.lessonFullyLoaded)
}
```

### Adding New Frontmatter Fields
1. Add Zod schema in `packages/types/src/schemas/common.ts`
2. Update `default-localization.ts` if i18n text needed
3. Consume in `packages/runtime` or `packages/react`

## Testing Against Local Changes
Use pnpm overrides in external project's `package.json`:
```json
{
  "pnpm": {
    "overrides": {
      "@tutorialkit/astro": "file:../tutorialkit/packages/astro"
    }
  }
}
```

## Docker Backend

The backend runs locally and manages Docker containers for tutorial execution:

```bash
# Start the backend server (required for tutorials to run)
cd packages/backend && pnpm start
# Or with options: tutorialkit-backend start --port 3002 --host 0.0.0.0
```

Frontend prompts for backend URL on first load (default: `http://localhost:3001`), stored in localStorage at `tutorialkit:backendUrl`.

### Backend API
- `POST /sessions` - Create session with files, starts docker-compose
- `GET /sessions/:id/ports` - Get exposed port mappings
- `DELETE /sessions/:id` - Stop and cleanup container
- WebSocket at `/terminal/:sessionId` for terminal I/O

## Template Structure

Each tutorial template in `src/templates/` requires:

**`Dockerfile`** - Container image:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
```

**`docker-compose.yml`** - Service configuration with volume mounts for hot reload:
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app              # Bind mount for file sync
      - /app/node_modules   # Preserve container's node_modules
```

## Important Files
- `packages/types/src/schemas/common.ts` - All content frontmatter schemas
- `packages/runtime/src/store/docker-store.ts` - Main state management
- `packages/react/src/Panels/WorkspacePanel.tsx` - Main workspace layout
- `packages/backend/src/sessions.ts` - Docker container lifecycle
- `e2e/src/content/tutorial/` - Test fixtures for E2E tests
