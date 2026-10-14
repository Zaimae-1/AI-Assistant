# Phase 3 — Repository & Development Foundation

Sumber struktur: [Struktur Project — Jarvis](https://app.notion.com/p/3ec499df915c81d4b57bcbac4142d515). Folder utama tetap `apps/`, `services/`, `core/`, `domains/`, `integrations/`, `packages/`, `infrastructure/`, `tests/`, `docs/`, `scripts/`, dan `.github/`.

## Yang disiapkan

- npm workspaces untuk frontend desktop, backend, dan protocol.
- React + TypeScript + Vite sebagai UI desktop; Tauri v2 sebagai shell native.
- Flutter Android app sebagai kerangka mobile. iOS memerlukan Mac saat tahap pengembangan iOS.
- Backend TypeScript dengan endpoint kesehatan lokal. Ini hanya pemeriksaan proses, bukan API produk.
- Rust workspace untuk agent lokal, masih berisi crate inti minimal.
- Lint, format, typecheck, tes kontrak dan backend, serta CI untuk Node dan Flutter.
- `.env.example`, aturan Git, dan [strategi secret pengembangan](../security/development-secrets.md) untuk menjaga konfigurasi lokal tetap di luar repo.

## Batas setup

Domain, izin, command agent, integrasi AI, autentikasi, dan fitur aplikasi belum diimplementasikan. Folder kosong yang mengikuti peta Notion tidak berarti fitur tersebut sudah selesai. Tauri native perlu Rust toolchain dan validasi build terpisah.
