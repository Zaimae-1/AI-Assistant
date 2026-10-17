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

Salin `.env.example` ke `.env` untuk konfigurasi lokal. `.env` diabaikan Git; jangan simpan secret di file contoh, kode, atau commit. Backend membuka API hanya pada `127.0.0.1:3001` secara bawaan. Data lokal disimpan di `.data/jarvis.db` (juga diabaikan Git).

## Phase 4–5 — backend dan AI

Backend sekarang menyediakan akun lokal, profil, agent dan grup, percakapan, task dan workflow sederhana, perangkat, izin tindakan, audit, serta event real time. Gemini menjadi provider bawaan; OpenAI tetap bisa dipilih. Keduanya memakai pilihan model otomatis/cepat/mendalam, respons streaming, dua tool aman (`current_time` dan `calculate`), konteks percakapan, memori manual yang bisa dihapus, dan pencatatan token. Lihat [panduan API dan cakupan](docs/architecture/phase-4-5-backend-ai.md).

Untuk konfigurasi baru di Windows PowerShell, salin file contoh bila `.env` belum ada:

```powershell
Copy-Item .env.example .env
notepad .env
```

Jika `.env` sudah ada, cukup jalankan `notepad .env` tanpa menyalin ulang. Tambahkan `JARVIS_AI_PROVIDER=gemini` dan `GEMINI_API_KEY=` beserta kuncimu. Key Gemini dapat dibuat melalui [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key). Jangan tempelkan key ke chat. Jalankan `npm run dev:backend` dari root. `GET /health` dapat dibuka tanpa akun. Key OpenAI yang tetap ada di `.env` tidak dipakai saat Gemini dipilih.

Google menyediakan [free tier Gemini API](https://ai.google.dev/gemini-api/docs/pricing) dengan batas penggunaan. Menurut [ketentuan Google](https://ai.google.dev/gemini-api/terms), konten pada layanan gratis dapat dipakai untuk meningkatkan produknya; perhatikan hal ini sebelum mengirim data sensitif.

Sesudah build, jalankan `npm run start:backend` dari root untuk memakai hasil kompilasi.

## Phase 6 — local agent

Fondasi agent Rust dan jalur perintah perangkat tersedia untuk operasi baca Git/file, informasi sistem, dan profil tes lokal. Lihat [cakupan dan cara menyiapkan agent](docs/architecture/phase-6-local-agent.md). Integrasi UI serta kemampuan kontrol OS yang lebih luas masih berlanjut.

Status: Phase 0–2 adalah desain awal. Phase 0 belum final sampai wawancara pengguna dan keputusan produk selesai. Phase 3 sudah memiliki kerangka repo dan tes dasar. Phase 4–5 memiliki fondasi backend yang diuji otomatis; Gemini juga sudah lulus uji respons langsung dengan key lokal. Uji OpenAI langsung tertahan karena kredit habis.
