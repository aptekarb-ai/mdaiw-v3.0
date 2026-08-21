# MDAIW Module 3 — Feature-Wise Claude Code Prompts and UI/UX Design Specification

## Module Name
**AI-Powered Landing Page Builder, Generator, Validator & Fixer**

## Goal
Create a complete desktop-first, responsive UI/UX and implementation plan for Module 3 of the MarketOne Digital AI Workspace (MDAIW). The module must help authenticated users validate and fix landing-page code, build pages manually, generate pages with AI, manage media, save projects in a private gallery, and launch production-style previews.

---

# 1. Shared Product and Design Instructions for Claude Code

Use the following instructions for every screen and feature.

## Claude Code Role
Act as a **Principal Product Designer, Senior React Engineer, Senior Python Engineer, AI Application Architect, Accessibility Specialist, and QA Lead**.

## Product Stack
- Frontend: React + TypeScript
- Styling: Tailwind CSS
- State: Zustand or Redux Toolkit
- Code editor: Monaco Editor
- Drag and drop: dnd-kit
- Backend: Django + Django REST Framework
- AI services: FastAPI + LangGraph/LangChain
- Database: PostgreSQL
- Cache/jobs: Redis
- Local file storage for MVP with an abstraction layer for future S3/Azure Blob/MinIO migration

## Global Navigation
Use a fixed left navigation with:
- Dashboard
- Module 3 Overview
- LP Validator & Fixer
- LP Builder
- AI LP Generator
- Landing Page Gallery
- Media Assets
- Settings
- Help & Documentation

## Brand Style
Use a professional enterprise SaaS style.

### Brand Colours
- Primary dark teal/navy: `#002D38`
- Vibrant blue/cyan: `#0082AD`
- Bright accent green: `#A8D600`
- Primary action blue: `#3157F5`
- AI accent purple: `#6C4DFF`
- Success: `#22A06B`
- Warning: `#F5A524`
- Error: `#D92D20`
- App background: `#F5F7FB`
- Panel background: `#FFFFFF`
- Main text: `#172033`
- Secondary text: `#667085`
- Border: `#DCE2EA`

## Typography
- Use Inter or a similar modern sans-serif font.
- Page title: 26–32px, semibold/bold.
- Section title: 18–22px, semibold.
- Body: 14–16px.
- Helper text: 12–13px.
- Code: JetBrains Mono or similar.

## Shared UI Rules
- Desktop-first layout, responsive down to tablet.
- Use 8px spacing system.
- Use 10–14px border radius.
- Use subtle shadows and clear focus states.
- All destructive actions require confirmation.
- All async actions must show loading, success, failure, and retry states.
- Use toast messages for completed actions.
- Support keyboard navigation and WCAG 2.2 AA contrast.
- Persist unsaved work locally and show an unsaved-changes indicator.
- Provide empty, loading, error, offline, permission-denied, and first-use states.

## Shared Top Bar
Include:
- Breadcrumb
- Page title
- Save status
- Notifications
- Help
- User profile
- Primary context-sensitive CTA

## Output Expected from Claude Code
For each screen:
1. Route and page component
2. Component hierarchy
3. State model
4. API contracts
5. Interaction logic
6. Validation rules
7. Accessibility requirements
8. Responsive behaviour
9. Empty/loading/error states
10. Unit and integration tests
11. Production-quality React/TypeScript code

---

# 2. Screen 01 — Module 3 Overview Dashboard

## Purpose
Provide a single entry point for all Module 3 tools and show recent activity, usage statistics, saved pages, and quick actions.

## Main User Operations
- Open LP Validator & Fixer
- Open Manual LP Builder
- Open AI LP Generator
- Create a new landing page
- Continue a recent page
- Open Gallery
- Open Media Assets
- View module statistics

## UI Layout

### Header
- Title: `Module 3: AI-Powered Landing Page Suite`
- Subtitle: `Validate, build, generate and manage responsive landing pages with AI.`
- Primary CTA: `Create New`
- Create menu options:
  - Validate Existing Code
  - Build Manually
  - Generate with AI

### Main Feature Cards
Create three large cards in priority order:

1. **LP Validator & Fixer — Priority 1**
   - Code validation illustration
   - Features: syntax validation, accessibility checks, AI repair, code comparison
   - CTA: `Open Validator`

2. **LP Builder — Priority 2**
   - Drag-and-drop builder illustration
   - Features: reusable sections, responsive controls, property editor, export
   - CTA: `Open Builder`

3. **AI LP Generator — Priority 3**
   - Multiple generated page thumbnails
   - Features: document analysis, five variations, brand awareness, production-ready code
   - CTA: `Open Generator`

### Right Sidebar
- Quick stats: total pages, AI-generated pages, validated pages, media assets, storage used
- Recent pages with thumbnail and last-edited timestamp
- View All link

### Bottom Section
- Recent validation reports
- Recent AI generations
- Helpful onboarding checklist

## Claude Code Prompt
Build the Module 3 Overview screen at `/module-3`. Create reusable cards for the three main tools, usage statistics, recent projects, onboarding checklist, and Create New dropdown. Use mock data first, then connect to APIs. Every card must have hover, keyboard-focus, loading, empty, and permission states. Add responsive behaviour: three-column desktop, stacked tablet/mobile. Include tests for navigation, create-menu actions, recent page selection, and empty-state rendering.

---

# 3. Screen 02 — LP Validator & Fixer: Code Input and Validation Results

## Purpose
Allow the user to paste or upload complete landing-page code and receive line-level validation results.

## Main User Operations
- Paste HTML, CSS, JavaScript, TypeScript, ES6+ code
- Upload source files or ZIP
- Add/edit CDN links
- Run validation
- Filter issues
- Jump to an issue line
- Ask AI for explanation
- Start AI repair
- Preview current code
- Save draft

## UI Layout

### Top Action Bar
- `Validate Code`
- `Fix These Errors`
- `Ask AI to Review & Fix`
- `Preview`
- `Save Draft`
- `Copy`
- `Download`
- More menu

### Left Main Panel — Monaco Editor
Tabs:
- HTML
- CSS
- JavaScript
- TypeScript
- CDN

Editor features:
- Line numbers
- Syntax highlighting
- Minimap
- Error markers
- Search and replace
- Auto-format
- Expand to full screen
- Upload file
- Paste full document mode

### Right Panel — Validation Issues
Tabs:
- All
- Errors
- Warnings
- Information
- Accessibility
- SEO
- Security
- Performance

Each issue card shows:
- Severity icon
- Rule name
- Description
- File/tab
- Line and column
- Suggested fix
- `Go to Line`
- `Explain with AI`
- `Ignore Rule`

### Bottom Status Bar
- Current file
- Cursor position
- Encoding
- Framework detected
- Validation duration
- Issue counts

## Validation Categories
- Missing/unclosed tags
- Invalid HTML nesting
- HTML/CSS/JS/TS syntax errors
- Duplicate IDs
- Missing alt text
- Missing form labels
- SEO metadata
- Responsive problems
- Unsafe scripts
- Broken local paths
- Broken or unsupported CDN references
- Deprecated APIs
- Performance concerns
- Cross-browser concerns

## Claude Code Prompt
Build the LP Validator page at `/module-3/validator`. Use Monaco Editor with HTML, CSS, JavaScript, TypeScript, and CDN tabs. Create a resizable split layout with the code editor on the left and validation results on the right. Implement issue filtering, issue counts, severity badges, line navigation, editor markers, keyboard shortcuts, autosave, code upload, and validation progress. Create strongly typed validation result interfaces and mock API adapters for `/api/lp/validate`. Include empty, validating, success, partial failure, parser error, and server error states. Add tests for line navigation, filters, validation requests, keyboard shortcuts, and unsaved changes.

---

# 4. Screen 03 — LP Validator & Fixer: AI Repair, Original vs Fixed and Diff Review

## Purpose
Let the user safely review AI-proposed code repairs before applying or saving them.

## Main User Operations
- Review AI repair summary
- Compare original and fixed code
- Open unified or side-by-side diff
- Accept all fixes
- Accept/reject individual fixes
- Undo accepted fix
- Revalidate fixed code
- Copy fixed code
- Save as a new page/version
- Download repaired page
- Preview repaired page

## UI Layout

### Repair Summary Header
- Issues found
- Issues fixed
- Remaining warnings
- Files changed
- Confidence score
- AI explanation summary

### Comparison Modes
- Original Code
- Fixed Code
- Side-by-Side Diff
- Unified Diff

### Change Navigation
- Previous change
- Next change
- Accept current
- Reject current
- Accept all safe fixes
- Reset

### Right AI Review Panel
- Change rationale
- Risk level
- Related rule
- Before/after snippet
- User instruction input: `Change this fix...`
- CTA: `Regenerate Selected Fix`

### Bottom Actions
- Revalidate
- Preview Fixed Page
- Save New Version
- Replace Original
- Copy Complete Code
- Download ZIP

## Safety Rules
- Never overwrite original code automatically.
- Create a version before replacement.
- Flag changes to scripts, tracking code, forms, and external URLs as higher risk.
- Require confirmation before applying security-sensitive changes.

## Claude Code Prompt
Build the AI Repair Review page at `/module-3/validator/:projectId/repair`. Use Monaco Diff Editor for original and fixed code. Support side-by-side and unified diff modes, individual change acceptance/rejection, risk badges, AI rationale, revalidation, preview, and version creation. Keep the original immutable until the user confirms replacement. Integrate mock endpoints for repair generation, change regeneration, validation, save version, copy, and ZIP export. Add tests for accept/reject workflows, immutable originals, risk confirmations, version creation, and revalidation.

---

# 5. Screen 04 — Manual LP Builder: Drag-and-Drop Editing Workspace

## Purpose
Provide an Elementor-style visual editor for creating landing pages manually.

## Main User Operations
- Start with full-width or centered layout
- Drag sections and components to canvas
- Reorder, duplicate, hide, lock, or delete elements
- Edit content inline
- Configure styles and responsive behaviour
- Add custom code and CDN dependencies
- Upload and insert assets
- Preview desktop/tablet/mobile
- Undo/redo
- Save, copy, export, or download

## UI Layout

### Top Toolbar
- Back to Gallery
- Page name
- Save status
- Undo
- Redo
- Desktop, tablet, mobile view
- Zoom
- Preview
- Save
- Export
- More menu

### Left Panel
Tabs:
- Elements
- Sections
- Templates
- Layers

Element groups:
- Layout: full-width, container, grid, columns, spacer, divider
- Basic: heading, text, image, button, icon, video
- Forms: text input, email, phone, select, checkbox, radio, textarea, submit
- Marketing: hero, feature cards, testimonial, logo cloud, pricing, FAQ, CTA
- Navigation: header, nav menu, breadcrumb, footer
- Advanced: custom HTML, CSS, JavaScript, embed, countdown, modal

### Center Canvas
- Page canvas with ruler and breakpoint width
- Drop indicators
- Selection outline
- Inline text edit
- Section controls: move, duplicate, save as block, delete
- Element breadcrumb at bottom

### Right Properties Panel
Tabs:
- Content
- Style
- Advanced
- Responsive

Controls:
- Text/content
- Width/height
- Flex/grid settings
- Margin/padding
- Typography
- Colour/background
- Border/radius/shadow
- Position/z-index
- Visibility by breakpoint
- Classes and ID
- Custom CSS
- Custom JS
- Conditions
- Animations

## Claude Code Prompt
Build the Manual LP Builder at `/module-3/builder/:projectId`. Use dnd-kit for drag and drop, a normalized component tree, undo/redo history, breakpoint-specific settings, inline text editing, layer management, reusable blocks, autosave, and code generation. Separate editor state from generated HTML/CSS/JS output. Create a left component palette, center canvas, right property inspector, top toolbar, and bottom breadcrumb. Include keyboard controls, component locking, duplication, delete confirmation, and responsive previews. Add tests for drag/drop, reorder, duplication, undo/redo, property editing, breakpoint overrides, autosave, and code export.

---

# 6. Screen 05 — AI LP Generator: Input, Upload and Requirement Analysis

## Purpose
Collect user requirements, business documents, brand assets, and generation preferences before AI creates page variations.

## Main User Operations
- Enter business objective and page goal
- Upload requirements, briefs, documents, screenshots, wireframes, brand files, images, and logos
- Add website/reference URLs
- Select audience, tone, framework, layout, CTA, and campaign type
- Review AI-extracted content
- Correct or approve extracted information
- Start generation

## UI Layout

### Four-Step Progress Bar
1. Upload / Input
2. AI Analysis
3. Generation Settings
4. Results

### Left Input Form
- Project name
- Business type
- Campaign goal
- Target audience
- Primary CTA
- Tone/style
- Page sections required
- Framework: Bootstrap or Tailwind
- Custom JavaScript/TypeScript support
- CDN dependencies
- Reference URL input

### Upload Area
Support:
- PDF
- DOCX
- PPTX
- TXT/Markdown
- PNG/JPG/WebP
- ZIP brand package

Show upload progress, file type, size, remove, retry, preview, and validation messages.

### AI Analysis Panel
Display extracted:
- Business objective
- Target audience
- Key messages
- Product/service benefits
- CTA text
- Brand colours
- Fonts
- Logo/assets
- Required sections
- Compliance notes

Every extracted field must be editable and have confidence status.

## Claude Code Prompt
Build the AI Generator Input screen at `/module-3/generator/new`. Implement a four-step wizard with document upload, requirement form, URL references, extraction progress, editable AI analysis, brand token extraction, and generation settings. Use a file queue with validation, retry, progress, remove, and preview. Create typed APIs for upload, parse, analyze, and approve analysis. Prevent generation until required fields are complete. Add tests for file validation, extraction state, editable AI fields, confidence badges, wizard navigation, and blocked generation.

---

# 7. Screen 06 — AI LP Generator: Five Variations, Comparison and Selection

## Purpose
Present five AI-generated landing-page designs and allow the user to compare, preview, customize, regenerate, save, and export.

## Main User Operations
- View five generated variations
- Preview a variation
- Compare two or more variations
- Inspect design rationale
- Regenerate one variation
- Select preferred variation
- Customize selected variation in the builder
- Save to gallery
- Copy code
- Download code

## UI Layout

### Results Header
- Project name
- Generation summary
- Framework
- Brand match score
- Accessibility score
- Generation time
- `Generate Again`

### Variation Grid
Five cards, each with:
- Thumbnail
- Variation name
- Layout style
- Main differentiator
- Brand score
- Accessibility score
- Responsive badge
- Preview
- Select
- Regenerate
- More menu

### Compare Mode
- Select 2–3 variations
- Side-by-side preview
- Compare section order, branding, content density, CTA emphasis, accessibility, and code complexity

### Selected Variation Actions
- Preview Full Page
- Customize in Builder
- Save to Gallery
- Copy Complete Code
- Download ZIP

## Claude Code Prompt
Build the AI Generator Results page at `/module-3/generator/:generationId/results`. Render exactly five variation cards with thumbnail, style metadata, quality scores, preview, select, regenerate, and compare actions. Support a full-screen preview modal, multi-select comparison, per-variation regeneration, selected-state persistence, and conversion into an editable builder project. Add APIs for status polling, retrieve variations, regenerate one, select one, save, copy, and export. Include tests for five-card rendering, regeneration, selection, comparison, preview, and builder conversion.

---

# 8. Screen 07 — Private Landing Page Gallery

## Purpose
Allow each authenticated user to manage only their own saved landing pages.

## Main User Operations
- Search and filter pages
- Sort pages
- Preview page
- Launch in new tab
- Edit
- Rename
- Duplicate
- Copy code
- Download
- Archive
- Delete
- Create a new page

## UI Layout

### Header
- Title: `My Landing Pages`
- Search
- Filters
- Sort
- Grid/list toggle
- `New Landing Page`

### Filter Tabs
- All
- Builder
- AI Generated
- Validated / Fixed
- Draft
- Published / Ready
- Archived

### Page Card
Show:
- Thumbnail
- Page name
- Page type badge
- Framework
- Status
- Creation date
- Last modified
- Validation status
- Quick actions

### Bulk Operations
- Select multiple
- Archive
- Delete
- Export metadata

### Empty States
- No pages created
- No search results
- No pages in selected filter

## Claude Code Prompt
Build the private Landing Page Gallery at `/module-3/gallery`. Use paginated grid and list views, search, type/status filters, sort, bulk selection, quick actions, and user-specific authorization. Card actions must include preview, launch new tab, edit, rename, duplicate, copy code, download ZIP, archive, and delete with confirmation. Use optimistic updates with rollback for rename/archive and safe confirmation for delete. Add tests for user isolation, filters, sort, bulk actions, pagination, and empty states.

---

# 9. Screen 08 — Media Assets Gallery

## Purpose
Manage user-specific images, logos, videos, documents, and reusable brand assets.

## Main User Operations
- Upload one or multiple files
- Create folders or collections
- Search and filter media
- Preview media
- Copy asset path
- Insert into builder
- Replace asset
- Rename
- Download
- Delete
- View usage references

## UI Layout

### Header
- Title: `Media Assets`
- Search
- Type filters
- Storage indicator
- `Upload Assets`

### Tabs
- All
- Images
- Logos
- Videos
- Documents
- Brand Assets

### Asset Card
- Thumbnail/icon
- File name
- Type
- Size
- Dimensions/duration
- Upload date
- Used in page count
- Quick actions

### Asset Details Drawer
- Large preview
- Metadata
- Alt text
- Asset path
- Usage references
- Replace file
- Rename
- Delete

## Claude Code Prompt
Build the Media Assets screen at `/module-3/media`. Support multi-file drag-and-drop upload, file validation, progress, retry, folders/collections, search, filters, grid/list views, preview drawer, metadata editing, alt text, usage references, insert-into-builder flow, replace, copy path, download, and delete protection when an asset is in use. Add tests for uploads, validation, filtering, metadata edits, usage protection, and user isolation.

---

# 10. Screen 09 — Production-Style Preview and New-Tab Launch

## Purpose
Show the saved landing page as a real page without editor controls.

## Main User Operations
- Open preview in new tab
- Switch desktop/tablet/mobile viewport in internal preview
- Refresh preview
- Copy preview URL
- Return to editor
- Open page source
- View validation status

## Preview Behaviour
- Render generated `index.html`, CSS, JS, and local assets.
- Load approved CDN dependencies.
- Do not show MDAIW builder controls inside the page frame.
- Use sandboxed iframe for internal preview.
- Use a protected preview route for the new tab.
- Show safe warnings for blocked scripts or missing assets.
- Cache-bust after every save.

## UI Layout

### Internal Preview Header
- Back to editor
- Page name
- Desktop/tablet/mobile
- Refresh
- Copy URL
- Open New Tab
- Validation status

### Canvas
- Sandboxed page preview
- Error overlay for failed assets/scripts

## Claude Code Prompt
Build the internal preview at `/module-3/pages/:projectId/preview` and protected external-style preview at `/preview/:previewToken`. Use a sandboxed iframe, cache-busting, asset-path resolution, approved CDN loading, error reporting, viewport controls, copy URL, and open-new-tab action. Ensure the preview token only permits access to the correct authenticated user unless an explicit share mode is later added. Add tests for preview isolation, asset loading, cache-busting, missing-asset errors, script restrictions, and new-tab launch.

---

# 11. Screen 10 — Download, Export and Code Package Dialog

## Purpose
Let users export complete production-ready source code safely.

## Main User Operations
- Choose export format
- Include or exclude source files
- Include assets
- Include README
- Include dependency list
- Minify CSS/JS
- Select framework configuration
- Download ZIP
- Copy combined code

## Export Options
- Complete ZIP
- Single HTML file with inline CSS/JS
- Separate HTML/CSS/JS files
- Builder project JSON
- Code only
- Assets only

## UI Layout
- Export format radio cards
- Include assets toggle
- Include README toggle
- Minify toggle
- Dependency summary
- Estimated package size
- `Generate Package`
- Progress and success state

## Claude Code Prompt
Build a reusable Export Dialog component used by Validator, Builder, Generator, and Gallery. Support complete ZIP, single HTML, separate source files, project JSON, code-only, and assets-only export. Include package options, dependency summary, estimated size, generation progress, retry, cancellation, and success state. Add tests for each export type, option combinations, failure recovery, and downloaded file naming.

---

# 12. Required Shared Components

Claude Code must create reusable components for:
- AppShell
- SidebarNavigation
- TopBar
- PageHeader
- FeatureCard
- StatCard
- ProjectCard
- MediaCard
- CodeEditorTabs
- ValidationIssueList
- SeverityBadge
- DiffReviewPanel
- DeviceSwitcher
- BuilderToolbar
- ComponentPalette
- BuilderCanvas
- PropertyInspector
- LayerTree
- UploadDropzone
- FileQueue
- AIAnalysisForm
- VariationCard
- CompareDrawer
- PreviewFrame
- ExportDialog
- ConfirmDialog
- EmptyState
- ErrorState
- LoadingSkeleton
- ToastProvider

---

# 13. Core Data Models for Frontend

```ts
export type LandingPageType = 'validator' | 'builder' | 'ai-generated';
export type LandingPageStatus = 'draft' | 'validating' | 'needs-fixes' | 'ready' | 'archived';
export type FrameworkType = 'bootstrap' | 'tailwind' | 'custom';

export interface LandingPageProject {
  id: string;
  userId: string;
  name: string;
  slug: string;
  type: LandingPageType;
  status: LandingPageStatus;
  framework: FrameworkType;
  thumbnailUrl?: string;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: 'syntax' | 'accessibility' | 'seo' | 'security' | 'performance' | 'responsive';
  ruleId: string;
  message: string;
  file: 'html' | 'css' | 'javascript' | 'typescript' | 'cdn';
  line: number;
  column?: number;
  suggestion?: string;
  autoFixable: boolean;
  risk: 'low' | 'medium' | 'high';
}

export interface GeneratedVariation {
  id: string;
  generationId: string;
  name: string;
  thumbnailUrl: string;
  previewUrl: string;
  designStyle: string;
  brandScore: number;
  accessibilityScore: number;
  selected: boolean;
}
```

---

# 14. Required API Groups

## Validator
- `POST /api/lp/validate`
- `POST /api/lp/fix`
- `GET /api/lp/validation-reports/:id`
- `POST /api/lp/revalidate`

## Builder
- `POST /api/lp/projects`
- `GET /api/lp/projects/:id`
- `PATCH /api/lp/projects/:id`
- `POST /api/lp/projects/:id/autosave`
- `POST /api/lp/projects/:id/generate-code`

## AI Generator
- `POST /api/lp/generator/uploads`
- `POST /api/lp/generator/analyze`
- `POST /api/lp/generator/generate`
- `GET /api/lp/generator/:id/status`
- `GET /api/lp/generator/:id/variations`
- `POST /api/lp/generator/:id/variations/:variationId/regenerate`
- `POST /api/lp/generator/:id/select`

## Gallery
- `GET /api/lp/projects`
- `POST /api/lp/projects/:id/duplicate`
- `PATCH /api/lp/projects/:id/rename`
- `POST /api/lp/projects/:id/archive`
- `DELETE /api/lp/projects/:id`

## Media
- `POST /api/lp/media/upload`
- `GET /api/lp/media`
- `PATCH /api/lp/media/:id`
- `POST /api/lp/media/:id/replace`
- `DELETE /api/lp/media/:id`

## Preview and Export
- `POST /api/lp/projects/:id/preview-token`
- `POST /api/lp/projects/:id/export`
- `GET /api/lp/exports/:exportId/status`

---

# 15. Security and Permission Requirements

- All routes require authentication.
- Enforce object-level ownership on every project, media item, report, variation, preview, and export.
- Sanitize pasted HTML and custom scripts before preview.
- Run custom scripts only inside a sandboxed preview environment.
- Block directory traversal and unsafe file names.
- Validate MIME type and extension.
- Apply file-size limits.
- Scan uploaded archives before extraction.
- Maintain audit logs for delete, export, AI fix, and overwrite actions.
- Never expose another user’s local storage paths.
- Use signed preview tokens with expiry.
- Require confirmation for high-risk AI fixes.

---

# 16. Final Master Prompt for Claude Code

Use this complete instruction after reviewing the screen-level prompts:

> Build MDAIW Module 3 as a production-quality, enterprise SaaS feature set. Start by creating the shared AppShell, design tokens, routes, reusable components, typed interfaces, mock services, and test setup. Implement screens in this order: Module Overview, LP Validator Input, AI Repair Diff Review, Landing Page Gallery, Media Assets, Manual LP Builder, AI Generator Input, AI Generator Results, Preview, and Export Dialog. Keep every user’s projects and assets private. Use React, TypeScript, Tailwind, Monaco Editor, dnd-kit, Django REST Framework, FastAPI AI services, PostgreSQL, and Redis. Use local asset storage for the MVP through a storage abstraction layer. Do not use placeholder-only code. Every screen must include responsive behaviour, accessibility, validation, loading, empty, error, permission, autosave, and test coverage. Complete Priority 1 Validator & Fixer before implementing Builder and Generator business logic.

