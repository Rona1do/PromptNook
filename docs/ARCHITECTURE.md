# Architecture

## Overview

PromptNook is a Tauri 2 desktop application with a React/TypeScript interface and a Rust/SQLite backend.

```text
React UI
  ├─ browser fallback (volatile sample data)
  └─ typed Tauri commands
       ├─ repository and search
       ├─ SQLite migrations and recovery mode
       ├─ content-addressed media storage
       ├─ model/LoRA folder scanning
       ├─ translation providers and credential manager
       └─ verified backup, restore, import, and export
```

## Frontend

- `src/App.tsx` owns navigation, loading, refreshes, workspace switching, and top-level dialogs.
- `src/components/` contains feature pages and shared editors.
- `src/lib/api.ts` is the single frontend boundary for desktop commands. Outside Tauri it provides a browser-local workspace seeded with deterministic sample data.
- `src/lib/promptModels.ts` normalizes arbitrary workspace IDs and supplies only a neutral `General` default.
- `src/types.ts` defines the shared frontend data contracts.

The browser fallback is a demo and test harness. It must not imply persistence or silently hide a failing Tauri command.

## Desktop backend

- `db.rs` owns paths, schema migrations, seed data, integrity checks, and safe recovery mode.
- `repository.rs` owns application CRUD and search.
- `storage.rs` stores media by content hash and validates object identity.
- `resources.rs` scans user-selected model directories and maintains availability metadata.
- `translation.rs` integrates local or OpenAI-compatible translation services and the OS credential manager.
- `backup.rs` creates verified snapshots and restores them through a staging area.
- `export.rs` produces JSON, CSV, and portable packages.

## Data and isolation

On Windows the live database is under `%LOCALAPPDATA%\PromptNook\vault`. Workspaces share one database but rows are scoped by a normalized workspace ID. Switching workspaces changes the active scope; it must never delete or rewrite another scope.

Migrations are forward-only and transactional. If the live database cannot be opened safely, PromptNook starts with a disposable recovery database and leaves the original file untouched.

## Trust boundaries

- Local prompt data and scanned paths are sensitive.
- Translation providers are external unless the endpoint is local.
- Imported packages, media metadata, and filesystem paths are untrusted input.
- The browser workspace stores structured data in that browser profile and never reads the desktop database. It cannot scan local folders or provide verified backups.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](../SECURITY.md).
