# Handover Document: Supabase Integration & Deployment Complete

Dear Codex (or any developer companion resuming this project),

This document provides a full summary of the Supabase integration and Netlify deployment completed on June 8, 2026 by Antigravity.

---

## 1. Database Schema & Supabase Setup
- **Remote Project ID**: `fmpzdmmmqwqxxgeytmkr`
- **SQL Migration**: Successfully pushed the initial schema (`supabase/migrations/202606020001_jobvisto_schema.sql`) using the Supabase CLI. 
  - *Fix Note*: Explicitly updated the pgcrypto calls to use `extensions.gen_random_bytes(24)` in the migration file because the remote Supabase PostgreSQL setup isolates extensions inside the `extensions` schema.
- **Environment Settings**:
  - Main configuration values are saved in the root `.env` file (`DATABASE_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`).
  - Active frontend configuration is located in [website/supabase-config.js](file:///c:/JobVisto/website/supabase-config.js).

---

## 2. Frontend Connection (`website/`)

### A. HTML Setup (`website/app.html`)
- Loaded the official Supabase JS SDK via CDN: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`.
- Loaded the global configuration script `<script src="./supabase-config.js"></script>` before loading the main `app.js`.

### B. State Sinking & Sourcing (`website/app.js`)
- **`loadStateFromSupabase()`**:
  - Fetches the authenticated user session.
  - Loads the User Profile (`profiles`), active Organization (`organizations`), Clients (`clients`), Client Addresses (`client_addresses`), Cleaners (`cleaners`), Job Evidence (`job_evidence`), Client/Site Signatures (`client_signatures`), Jobs (`jobs`), and Payment Receipts (`payment_receipts`).
  - Correctly maps database columns to the local `state` structure and renders all dashboard panels.
- **`asyncSaveToSupabase()`**:
  - Automatically runs in the background (fire-and-forget) whenever the synchronous `save()` is invoked in the app.
  - Performs clean ups: Automatically deletes database rows for clients, cleaners, jobs, evidence, and receipts that are no longer present in the local arrays (deletions propagate instantly).
  - Syncs client/site signatures directly to `client_signatures` and evidence records to `job_evidence`.
- **`ensureValidUuids()`**:
  - Converts local mock text IDs (like `"c1"`, `"cl1"`, `"j1"`) into valid, persistent UUID formats on the fly before syncing them to Supabase to prevent Postgres constraints validation errors.
- **`enterApp(mode)`**:
  - Updated to ensure that if a Supabase authenticated session exists, the `state.user` object is not overridden or corrupted by local demo variables.

---

## 3. Storage Strategy (Photos & Signatures)
- To avoid public/private token expiration issues with Supabase Storage, both **Client Signatures** (`client_signatures.signature_data`) and **Job Evidence Photos** (`job_evidence.file_path`) are stored directly inside database text columns as compressed Base64 data URLs.
- The existing client-side canvas and image-compressor pipelines in `app.js` handle base64 encoding and payload compression automatically, keeping database storage performance efficient.

---

## 4. Git & Netlify Deployment
- **Git Repo**: Initialized local Git repository at `C:\JobVisto` and committed all files.
- **Remote Origin**: Linked and pushed `main` branch to the GitHub repository:
  `https://github.com/altioradigitalsolutions-source/JobVisto.git`
- **Netlify Site**: Connected Netlify to the GitHub repository.
  - **Publish directory**: `website`
  - **Domain**: Currently deployed and live at `https://keen-pudding-5a78d0.netlify.app`.
  - **Auto-Deploy**: Every future `git push` to the GitHub repository will trigger a production update on Netlify automatically.

---
*Document prepared by Antigravity on 2026-06-08.*
