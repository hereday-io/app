# SYSTEM_ARCHITECTURE.md

## Philosophy

This system is designed for:
- A solo founder
- Fast iteration
- Clean, maintainable code
- Minimal complexity

We optimize for:
- Clarity over abstraction
- Speed over perfection
- Modular growth over premature architecture

---

## High-Level Architecture

Frontend:
- Next.js (App Router)
- React (functional components + hooks)
- Tailwind CSS

Backend:
- Supabase (Auth, Postgres, Storage)

Map:
- Mapbox GL JS

---

## Project Structure

/app
  /route-editor
  /event/[slug]
  /dashboard

/components
  /map
  /editor
  /ui

/hooks
  useRouteEditorMap.ts
  useEventData.ts

/lib
  supabase.ts
  mapbox.ts

/types
  index.ts

---

## Core Modules

### 1. Route Editor

Responsibilities:
- Map rendering
- Route drawing
- POI creation/editing
- Interaction handling

Key rule:
👉 All map logic should live in hooks (NOT in page files)

Example:
- useRouteEditorMap
- usePOIManager

---

### 2. Public Event Page

Responsibilities:
- Render event data
- Display routes + POIs
- Mobile-first UI

Key rule:
👉 Read-only, fast, optimized

---

### 3. Dashboard

Responsibilities:
- Event CRUD
- Navigation
- Basic management

---

## Data Flow

1. User interacts with UI
2. Hook manages state + logic
3. Supabase handles persistence
4. UI re-renders

---

## State Management

Use:
- React state
- Custom hooks

Avoid:
- Global state libraries unless necessary

---

## Map Architecture

Separate:
- Map initialization
- Route rendering
- POI rendering
- Event listeners

Avoid:
- Mixing UI logic with map logic

---

## File Design Rules

- Keep files under ~300 lines when possible
- Extract reusable logic early
- Avoid deeply nested components
- Prefer composition over inheritance

---

## When Scaling

Introduce only when needed:
- Zustand (for shared state)
- API routes (for complex logic)
- Caching strategies

---

## Performance Principles

- Minimize re-renders
- Lazy load map where possible
- Optimize mobile experience first for public pages
- Avoid unnecessary map redraws

---

## Deployment

- Vercel (frontend)
- Supabase (backend)

---

## Non-Goals (for now)

- Microservices
- Complex backend logic
- Heavy abstractions

---

## Default Rule

If a solution feels too complex:
👉 It probably is — simplify it