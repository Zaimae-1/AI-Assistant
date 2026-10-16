# Referensi dari proyek Jarvis lama

Pemilik proyek menunjukkan `C:\Users\LENOVO\Documents\Codex\AI-Asistant` sebagai bahan belajar untuk Jarvis yang dibangun ulang. Proyek lama adalah referensi perilaku dan pengalaman, bukan spesifikasi atau sumber kode untuk disalin. Arah produk tetap mengikuti PRD, roadmap, dan arsitektur Jarvis saat ini.

## Bagian yang berguna saat fase berikutnya

- **Pembatalan respons AI.** `backend/src/modules/chat/chat.controller.ts`, `backend/src/modules/ai/ai.chat.service.ts`, dan `backend/tests/cancellation.test.ts` menunjukkan aliran sinyal batal dari koneksi HTTP ke provider. Tesnya mencakup putus sebelum dan sesudah chunk pertama serta larangan menyimpan jawaban asisten yang terpotong. Terapkan ide ini saat menyambungkan UI dan streaming OpenAI di proyek baru.
- **Penanganan error streaming.** Controller chat lama menunggu chunk pertama sebelum mengirim header SSE; error awal tetap bisa menjadi respons JSON dengan status yang tepat. `backend/src/core/errors/api-error.ts` mengubah error provider menjadi pesan aman untuk pengguna. Ini patut dijadikan kriteria uji, tanpa menyalin kontrak respons lama.
- **Pemisahan data pengguna.** `backend/tests/access-control.test.ts` dan catatan `backend/PROGRESS.md` menguji akses dua akun pada AI, chat, dan memori. Saat frontend dan integrasi bertambah, ulangi pola uji lintas akun pada endpoint Jarvis baru.
- **Tool dan provider.** `backend/src/modules/ai/ai.chat.service.ts` membatasi putaran tool dan menolak respons kosong. `backend/src/modules/ai/providers/provider.interface.ts` memisahkan provider dari alur chat. Konsep ini sudah sejalan dengan backend baru, tetapi format Gemini/OpenRouter/Grok lama berbeda dari adapter OpenAI sekarang.
- **Pengalaman Flutter.** `frontend/lib/screens/chat_page.dart` dan `frontend/lib/services/nexa_service.dart` memberi contoh alur daftar asisten, riwayat, pilihan memori, keadaan loading/error, dan panggilan API. Gunakan sebagai masukan UX ketika Phase 9 dimulai; kontrak endpoint lama (`/api`) berbeda dari API baru (`/v1`).

## Perbedaan yang perlu dijaga

- Proyek lama memakai Express, Prisma/PostgreSQL, JWT, dan beberapa provider AI. Jarvis baru saat ini memakai server Node, SQLite lokal, token sesi opaque, dan OpenAI sebagai provider pertama. Migrasi teknologi memerlukan keputusan tersendiri; tidak ada alasan untuk mengimpor skema atau dependensi lama secara otomatis.
- Memori lama memiliki ekstraksi otomatis berbasis frasa. Jarvis baru memakai memori opt-in yang ditambahkan manual. Setiap perluasan memori perlu keputusan produk dan kontrol pengguna yang jelas.
- `backend/PROGRESS.md` adalah riwayat pengerjaan lama, bukan bukti bahwa semua perilaku masih ada pada kode terbaru. Misalnya, catatan menyebut tombol Stop, tetapi layanan Flutter yang dibaca saat ini memakai panggilan pesan biasa. Verifikasi kode dan tes saat mengambil pola tertentu.
- Jangan membawa secret, database, data pengguna, hasil build, atau konfigurasi lingkungan dari proyek lama ke repo baru.

Catatan ini dibuat dari pembacaan file sumber, tanpa menjalankan atau mengubah proyek lama.
