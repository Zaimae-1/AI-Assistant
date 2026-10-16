# Jarvis

Struktur monorepo ini mengikuti catatan [Struktur Project — Jarvis](https://app.notion.com/p/3ec499df915c81d4b57bcbac4142d515).

Urutan awal pengerjaan: `docs/`, `core/protocol/`, dan `domains/`. Aplikasi, layanan, serta integrasi diisi bertahap sesuai [Alur Pengerjaan — Jarvis](https://app.notion.com/p/3eb499df915c81d5b31fd0f25bb770af).

## Fondasi Phase 0–2

- [Product foundation dan batas MVP](docs/product/phase-0-foundation.md)
- [Riset pembanding](docs/product/competitor-research.md) dan [rencana validasi pengguna](docs/product/user-validation.md)
- [System design](docs/architecture/phase-1-system-design.md) dan [Architecture Decision Records](docs/decisions/)
- [Jarvis Protocol v1](docs/protocol/protocol-v1.md) dan [JSON Schema](core/protocol/schemas/envelope.schema.json)

## Phase 3 — setup pengembangan

Kerangka yang bisa dijalankan sekarang: React + TypeScript untuk desktop (`apps/desktop/frontend/`), Tauri shell (`apps/desktop/src-tauri/`), Flutter Android (`apps/mobile/`), backend TypeScript (`services/backend/`), dan Rust workspace untuk agent lokal (`core/rust-agent/`). Folder domain, integrasi, dan layanan lain mengikuti struktur Notion dan diisi ketika fiturnya dibangun.

Prasyarat: Node.js 24+, npm, Flutter SDK untuk mobile, serta Rust toolchain dan komponen Windows Tauri untuk desktop native. Jalankan dari root:

```sh
npm ci
npm run dev:desktop
npm run dev:backend
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

`dev:desktop` membuka UI melalui Vite. Setelah Rust tersedia, `npm run dev:tauri` menjalankan aplikasi desktop native. Untuk mobile, jalankan `flutter run` dari `apps/mobile/` dengan perangkat atau emulator Android.

`npm run build:tauri` memeriksa build aplikasi Windows tanpa membuat installer. Ikon sumber desktop berada di `apps/desktop/app-icon.svg`.

Salin `.env.example` ke `.env` untuk konfigurasi lokal. `.env` diabaikan Git; jangan simpan secret di file contoh, kode, atau commit. Backend awal hanya membuka `GET /health` pada `127.0.0.1:3001`; belum ada akun atau fungsi AI.

Status: Phase 0–2 adalah desain awal. Phase 0 belum final sampai wawancara pengguna dan keputusan produk selesai. Phase 3 sudah memiliki kerangka repo dan tes dasar; fungsi produk pada fase berikutnya belum dibangun.
