# Privacy model

PromptNook is local-first. It has no account system, telemetry SDK, analytics endpoint, advertising identifier, or required cloud database.

## Data kept locally

The desktop database can contain prompts, translations, notes, categories, favorites, generation parameters, model metadata, filesystem paths, and backup history. Imported images are stored in a content-addressed local object directory. On Windows this data is under `%LOCALAPPDATA%\PromptNook\vault` unless a backup or export destination is selected.

## Network access

Translation is off by default. If the user enables translation and requests it, PromptNook sends the selected source text and translation instructions to the configured endpoint. Provider behavior and retention are governed by that provider, not by PromptNook. Use a local Ollama-compatible endpoint when text must not leave the computer.

PromptNook does not upload model files during translation. Scanning a model directory is a local filesystem operation.

## Credentials

Provider API keys are stored through the operating-system credential manager under the PromptNook service identifier. They are not written to SQLite, exports, logs, or settings JSON by design.

## Exports and reports

JSON, CSV, `.promptnook`, screenshots, logs, and issue attachments are user-controlled disclosures. Inspect them before sharing. Never attach a real database or credential to a public GitHub issue.

## Maintainer checklist for network features

Any proposed network feature must document what is sent, why it is needed, when it is triggered, where credentials live, how users disable it, and whether a local alternative exists. Network behavior must remain explicit and testable.
