# Phase 4–5: backend dan AI

Sumber: [Alur Pengerjaan Jarvis](https://app.notion.com/p/3eb499df915c81d5b31fd0f25bb770af), [PRD Jarvis](https://app.notion.com/p/3ed499df915c813aa30ed73253e837cc), dan [desain sistem](phase-1-system-design.md).

## Yang dapat dipakai sekarang

- Akun email dan kata sandi disimpan sendiri di backend. Kata sandi di-hash dengan scrypt; token sesi acak disimpan sebagai hash. `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET/PATCH /v1/me`, dan manajemen sesi ada di `/v1/sessions`.
- Agent, grup agent, percakapan, pesan, mention ke anggota grup, task, progres, dan workflow sederhana tersedia melalui `/v1/agents`, `/v1/groups`, `/v1/conversations`, dan `/v1/tasks`.
- Perangkat dan permintaan izin tersedia di `/v1/devices` dan `/v1/permissions`. Izin berisiko tinggi membutuhkan persetujuan baru untuk setiap tindakan; nonce hanya dapat dipakai sekali. Audit bisa dibaca lewat `/v1/audit`; event langsung lewat `/v1/events` (Server-Sent Events).
- `POST /v1/conversations/:id/respond` menggunakan provider AI yang disuntikkan ke backend. Pilihan bawaan sekarang Gemini (`@google/genai`); OpenAI Responses API dengan `store: false` tetap tersedia jika `JARVIS_AI_PROVIDER=openai`. Parameter `stream: true` menghasilkan event `delta`, `tool`, dan `done`. `GET /v1/models` menampilkan provider aktif dan mode pemilihan model. Router v1 memilih model cepat atau mendalam menurut panjang pesan; konfigurasi model dapat diubah lewat `.env`.
- Tool AI yang boleh berjalan di backend saat ini hanya waktu UTC dan kalkulator. Eksekusi dibatasi empat putaran dan delapan panggilan. Konteks memakai 20 pesan terakhir. Memori bersifat opt-in per agent, ditambahkan manual, punya masa simpan, bisa dihapus, dan hanya dimasukkan ke prompt bila cocok dengan kata pada pesan baru. `GET /v1/usage` mengumpulkan token dan estimasi biaya bila tarif diatur.
- Perpindahan tugas dalam grup melalui `POST /v1/tasks/:id/handoff` hanya diizinkan antar dua anggota yang berbeda, membutuhkan alasan, dan dibatasi dua perpindahan per tugas. Permintaan dibuat lewat sesi pengguna dan dicatat di audit.

Semua endpoint `/v1` selain register dan login membutuhkan header `Authorization: Bearer <token>`. Data dibatasi berdasarkan pemilik akun. Database SQLite ada pada `JARVIS_DB_PATH`, bawaan `.data/jarvis.db`. Backend hanya bind ke loopback.

`JARVIS_AI_PROVIDER=gemini` memakai `GEMINI_API_KEY`, `GEMINI_MODEL_FAST` (bawaan `gemini-3.5-flash-lite`), dan `GEMINI_MODEL_DEEP` (bawaan `gemini-3.8-flash`). Provider dipilih secara eksplisit; key OpenAI tidak menjadi fallback ketika Gemini belum dikonfigurasi. Adapter Gemini mempertahankan giliran model termasuk thought signature saat melanjutkan pemanggilan tool. Tarif opsional untuk estimasi biaya menggunakan awalan environment variable sesuai provider (`GEMINI_` atau `OPENAI_`).

## Contoh alur API

1. Daftar akun (`POST /v1/auth/register`) dan simpan token dari respons di klien.
2. Buat agent (`POST /v1/agents`, misalnya `{"name":"Tutor","role":"membantu belajar"}`).
3. Buat percakapan (`POST /v1/conversations` dengan `title` dan `agent_id`).
4. Kirim pesan (`POST /v1/conversations/:id/messages` dengan `content`).
5. Minta jawaban (`POST /v1/conversations/:id/respond` dengan `{"stream":true}`).

## Batas saat ini

- Antarmuka desktop dan mobile belum memakai API ini. Akun, chat, dan izin masih endpoint backend, belum alur pengguna yang lengkap.
- Registrasi perangkat saat ini hanya mencatat perangkat dari sesi pengguna. Pairing kriptografis dan pemeriksaan izin oleh agent lokal perlu dibuat pada fase agent perangkat. Tidak ada operasi file, Git, test runner, atau pengiriman keluar yang dijalankan AI di backend.
- Workflow hanya dapat menjalankan dua tool aman di atas. Perpindahan tugas lintas agent sudah ditegakkan di backend, tetapi orkestrasi percakapan otomatis antar agent belum tersedia.
- Streaming event belum menyediakan pemutaran ulang saat koneksi putus. Model Router v1 memakai aturan sederhana, tanpa pengukuran kualitas. Biaya hanya estimasi bila tarif diisi, bukan tagihan resmi.
- Tes otomatis memakai provider tiruan agar tidak memakai biaya. Pada 16 Oktober 2026, `OPENAI_API_KEY` sudah terpasang di `.env` lokal dan permintaan langsung mencapai API OpenAI, tetapi ditolak dengan HTTP 429 `credit_balance_exhausted`. Akun API perlu kredit tersedia sebelum respons model dapat diuji. Backend sekarang memetakan kondisi ini ke error `provider_quota_exhausted` tanpa menyimpan jawaban asisten parsial. Jangan ulangi panggilan sampai saldo API tersedia.
- Adapter Gemini telah diuji dengan klien tiruan untuk respons biasa, streaming, penggunaan token, dan kelanjutan tool. Uji langsung Gemini menunggu `GEMINI_API_KEY` di `.env` lokal. [Free tier Google](https://ai.google.dev/gemini-api/docs/pricing) memiliki batas dan [ketentuan penggunaan data](https://ai.google.dev/gemini-api/terms) tersendiri.

Checklist Notion sebaiknya diberi centang hanya untuk komponen yang telah diimplementasikan dan lolos tes, bukan untuk alur end-to-end yang masih memerlukan aplikasi klien atau agent lokal.
