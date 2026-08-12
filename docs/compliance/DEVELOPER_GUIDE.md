# Compliance Module — Developer Guide

> Last updated: 2026-08-12  
> Author: session log + Claude Sonnet 4.6  
> Module path: `apps/web/src/compliance/` · `packages/ai-kit/src/compliance/`

---

## Overview

The Compliance module analyses official Russian government documents (demands, warnings, notices, bailiff orders) using a multi-stage AI pipeline and returns:
- a plain-language legal advisory with recommended actions,
- a list of documents the system can draft,
- the drafted documents themselves.

Two document classes exist:

| Class | Trigger | Flow |
|---|---|---|
| `requirement` | Checklist of requested docs (e.g. tax audit list) | classify → extract → registry → clarify → produce package |
| `advisory` | Substantive legal act (warning, enforcement notice, court order) | classify → extract → advise → Q&A → produce documents |

This guide covers the **advisory branch** which was built in the Aug 2026 sprint.

---

## Architecture

```
apps/web/src/compliance/
  ComplianceV2.tsx          ← orchestrator (state machine + handlers)
  ComplianceUploadLanding.tsx  ← upload screen (instructions, privacy, dropzone)
  AdvisoryView.tsx          ← advisory display + Q&A + document selection
  PackageResult.tsx         ← requirement branch result (unchanged)
  ClarifyDialog.tsx         ← clarification modal (requirement branch)
  RequestSummary.tsx        ← authority / document-class summary row
  RequisitesForm.tsx        ← company details form

packages/ai-kit/src/compliance/
  classify.ts               ← classifies uploaded file → DocumentClass + authority
  advise.ts                 ← produces Advisory JSON from document text
  produce.ts                ← drafts legal documents from advisory + client answers
  extract.ts                ← extracts text from PDF/image for requirement branch
  index.ts                  ← re-exports everything

packages/schemas/src/compliance.ts
  ← ComplianceCase Zod schema (Firestore document)

apps/worker/src/routes/compliance/
  classify.ts               ← POST /compliance/classify
  advise.ts                 ← POST /compliance/advise (creates/polls case)
  advise-extract-text.ts    ← POST /compliance/advise/extract-text (file → text)
  produce.ts                ← POST /compliance/produce
```

---

## State Machine (`ComplianceV2.tsx`)

```
idle
 └─ upload ──────────────────────────────────────────────────────┐
     └─ classifying                                              │
         ├─ [requirement] → extracting → extracted              │
         │   └─ clarifying → producing → result                 │
         └─ [advisory]    → advising → advised ─────────────────┘
             └─ advisory_producing → advisory_produced
```

Key state fields:

```typescript
type State = {
  step: Step;
  caseId: string | null;
  advisory: Advisory | null;
  advisoryIsRefined: boolean;   // true after client answers submitted
  advisoryVersion: number;      // incremented each time advisory arrives → key for AdvisoryView
  producedDocs: ProducedDoc[];  // title + content for each drafted document
  // ...
}
```

---

## AI Pipeline — Advisory Branch

### 1. Classify (`classify.ts`)

Input: raw file (PDF or image).  
Output: `{ documentClass: "advisory" | "requirement", authority: RequestingAuthority, extractedText: string }`

- Uses `claude-haiku` for speed.
- Reads PDF pages via `pdfjs-dist`, images via base64.
- Returns `extractedText` so the next step doesn't need to re-read the file.

### 2. Advise (`advise.ts`)

Input: `documentText`, `authority`, `documentClass`, company name/INN, optional `clientAnswers[]`.

Output: `Advisory`:

```typescript
type Advisory = {
  essence: string;         // plain summary
  legalGround: string;     // applicable law + conditions
  notApplicable: string[]; // grounds for challenging the measure
  consequences: string;    // real-world impact
  options: string[];       // concrete next steps with deadlines
  questions: string[];     // 3-5 questions that change the legal conclusion
  offeredDocuments: string[]; // documents the system can draft
  disclaimer: string;
  verdict?: string;        // final position (only in refined answer)
}
```

Uses `claude-sonnet-4-6` with `thinking: { type: "enabled", budget_tokens: 4000 }`.  
Extended system prompt is appended when `clientAnswers` contains at least one non-empty answer — triggers `verdict` field and empties `questions[]`.

### 3. Produce (`produce.ts`)

Input: `documentText`, `advisory`, `clientAnswers`, `selectedTitles` (subset of `offeredDocuments`).  
Output: `{ documents: [{ title, content }] }`

Single Claude call generating all selected documents in one JSON response.  
Content is plain legal text (no HTML), suitable for copy/paste or `.doc` download.

---

## Worker Endpoints

### `POST /compliance/advise`

Creates a Firestore case (`status: "advisory_pending"`), runs classify + advise, updates to `status: "advisory_done"`.

Poll from frontend every 2 s, check `data.status === "done" && data.advisory`.

> **Note:** Cloudflare Workers are synchronous — no `ctx.waitUntil`. The entire pipeline runs in the request handler. Keep total latency under 30 s (thinking budget + response time).

### `POST /compliance/advise/extract-text`

Accepts `multipart/form-data` with a file attachment.  
Returns `{ text: string }` — used when the user attaches a supporting document to a specific question in the advisory Q&A.

### `POST /compliance/produce`

Accepts JSON: `{ caseId, selectedTitles }`.  
Reads the case from Firestore, runs `produceDocuments`, returns `{ documents: [{ title, content }] }`.

---

## Frontend Components

### `ComplianceUploadLanding`

The upload screen shown when no case is loaded. Sections:
- Left column: service description, 4-step instruction, download links (open in new tab as printable HTML from ООО «ОпенТрейдГрупп» letterhead).
- Right column: drag-and-drop zone.
- Bottom: collapsible privacy policy.

Download links use `URL.createObjectURL` + `window.open(..., "_blank")` → Blob is revoked after 10 s.  
No new npm dependencies — print-to-PDF done natively by browser.

### `AdvisoryView`

Props: `advisory`, `onAnswers`, `onUploadFile?`, `onProduce?`, `isRefined?`.

Key prop `key={${caseId}-${advisoryVersion}}` forces full remount when a new advisory arrives — **do not remove this**, it prevents stale local state (checkbox selections, answer inputs) from carrying over.

Modes:
- `isRefined=false` (default): shows full analysis + Q&A form + file upload per question.
- `isRefined=true`: collapses primary analysis into `<details>`, shows green `verdict` block on top, hides Q&A form, shows document checklist.

### Download utilities (in `ComplianceV2.tsx`)

```typescript
safeFileName(title, ext)      // strips special chars, adds extension
downloadTxt(content, filename) // text/plain blob
downloadDoc(title, content, filename) // Word-compatible HTML blob (application/msword)
```

---

## Problems Encountered and Fixes

### 1. `hasAnswers` semantic bug

**Symptom:** System treated an advisory as "refined" even when the user hadn't typed any answers — AdvisoryView always passed `buildQA()` which sends all questions with empty strings.

**Root cause:** `advise.ts` checked `(meta.clientAnswers ?? []).length > 0` — truthy whenever `buildQA` sent an array, even of empty strings.

**Fix:** Changed to `.some(qa => qa.answer.trim().length > 0)`.

**Lesson:** When a client always sends a full array (for structural reasons), check content not length.

---

### 2. `advisoryIsRefined` not reset across cases

**Symptom:** Uploading a second document after getting a refined advisory showed the new advisory in "refined mode" immediately (collapsed, green verdict block) even though no Q&A had happened.

**Root cause:** `advisoryIsRefined: true` persisted in state. Neither `handleFile` nor `handleSelectCase` reset it.

**Fix:** Explicit `advisoryIsRefined: false` added to both handlers.

**Lesson:** In a multi-step state machine, every "restart" point must enumerate all derived state fields and reset them explicitly.

---

### 3. Stale `selectedDocs` in `AdvisoryView`

**Symptom:** After submitting Q&A answers (which refreshes the advisory), previously checked document checkboxes remained checked — including documents that no longer appeared in the new `offeredDocuments` list.

**Root cause:** `selectedDocs` is local component state. React re-renders `AdvisoryView` with new props but keeps local state unless the component is unmounted and remounted.

**Fix:** Added `advisoryVersion: number` to parent state, incremented each time a new advisory arrives. Passed as part of the `key` prop: `key={${caseId}-${advisoryVersion}}`. React destroys and recreates the component on key change.

**Lesson:** For complex sub-components with meaningful local state, control lifecycle explicitly via `key` rather than trying to sync state through props.

---

### 4. `produceDocuments` not exported

**Symptom:** Worker typecheck failed: `Module '"@crm/ai-kit"' has no exported member 'produceDocuments'`.

**Root cause:** `packages/ai-kit/src/index.ts` had explicit named exports but `produceDocuments`, `ProducedDoc`, and `AdvisoryQA` were missing from both value and type export lines.

**Fix:** Added to `index.ts`:
```typescript
export { ..., produceDocuments } from "./compliance/index.js";
export type { ..., ProducedDoc, AdvisoryQA } from "./compliance/index.js";
```

**Lesson:** When adding a new function to a package, always update the package's `index.ts` immediately — stale exports cause confusing typecheck failures downstream.

---

### 5. ENFILE — macOS system file table overflow

**Symptom:** `vite build` fails intermittently with `ENFILE: file table overflow, open '...'`.

**Root cause:** macOS has a kernel-level `kern.maxfiles` limit (not just per-process `ulimit`). Vite opens hundreds of files during module graph traversal. With many browser tabs, dev tools, and other apps open, the system-wide limit is hit.

**Fix:** Close resource-heavy applications (browsers with many tabs, IDEs, Docker) before building.  
Per-process `ulimit -n 65536` in the shell does **not** solve this — the bottleneck is `kern.maxfiles`, not `RLIMIT_NOFILE`.

**Build command used:**
```bash
bash -c 'ulimit -n 65536 && /path/to/crm/node_modules/.pnpm/node_modules/.bin/vite build'
```
(must be run from `apps/web/` as working directory)

---

### 6. Advisory `verdict` field ignored by TypeScript

**Symptom:** After adding `verdict?: string` to the `Advisory` type in `advise.ts`, the field wasn't available in `AdvisoryView` — TS error or runtime `undefined`.

**Root cause:** `Advisory` type was defined in `advise.ts` but re-exported through `compliance/index.ts` → `ai-kit/index.ts`. The old compiled type (from `packages/ai-kit/dist/`) was cached.

**Fix:** Run `pnpm build` in `packages/ai-kit` after any type change, or use `workspace:*` with source-only imports (which this project does via `tsconfig paths`). Ensure the type export chain includes the new field.

---

### 7. Cloudflare Worker `wrangler` version incompatibility (Mac)

**Symptom:** `wrangler deploy` hangs or gives `service stopped` on Mac with wrangler 4.x.

**Root cause:** Wrangler 4.x has a known instability on Apple Silicon under some zsh configurations.

**Fix:** Deploy worker changes via VPS (5.129.234.111) where wrangler 3.x is installed and stable. Mac is used only for frontend builds + FTP deploys.

---

## Deployment Workflow

```
Frontend (apps/web):
  typecheck → vite build → FTP to citycar36.ru:/www/opentgp.ru/kairos/app/

Worker (apps/worker):
  typecheck → SSH to VPS → wrangler deploy (from VPS, NOT from Mac)

After any Firestore Rules change:
  firebase deploy --only firestore:rules   ← mandatory, do not skip
```

FTP credentials: see memory `reference_ftp.md`. Remote path: `/www/opentgp.ru/kairos/app/`.

---

## Key Invariants

- `documentText` is always passed to `advise` — never pass the raw file again (already extracted at classify step).
- `buildQA()` in `AdvisoryView` always returns an array with all questions (empty answers included) — check content, not length.
- `advisoryVersion` must be incremented every time `state.advisory` is set to a new value (both initial and refined).
- `key` on `AdvisoryView` must include both `caseId` and `advisoryVersion` to handle multiple refinement rounds on the same case.
- Worker endpoints are synchronous — no background processing, entire pipeline in one request.
- `LEGAL_BASIS` in `@crm/core` is the single source of truth for norms, deadlines, exceptions. Never pass norms not in this registry to Claude.
