# Phase 6 — Local Agent (implementasi awal)

Sumber: [Alur Pengerjaan Jarvis](https://app.notion.com/p/3eb499df915c81d5b31fd0f25bb770af), [ADR-001](../decisions/ADR-001-local-execution-boundary.md), dan [ADR-003](../decisions/ADR-003-approval-authority.md).

## Yang sudah tersedia

- Backend menerbitkan token perangkat acak saat pendaftaran. Database hanya menyimpan hash token. Pengguna dapat merotasi token atau mencabut perangkat; token lama langsung ditolak.
- Agent Rust menyimpan token di Windows Credential Manager melalui OS keyring. File konfigurasi menyimpan alamat backend, identitas perangkat, folder yang diizinkan, dan profil perintah/aplikasi lokal; tidak menyimpan token.
- Agent menerima koneksi HTTPS atau HTTP loopback. Ia mengambil satu perintah dari backend, mengecek ulang otorisasi, versi protokol, perangkat, masa berlaku, capability, dan cakupan file/folder sebelum eksekusi.
- Capability awal: `git.status`, `git.diff` (ringkasan perubahan), `file.read` untuk satu file teks, `system.info` (OS, arsitektur, jumlah CPU), `process.list`, `test.run`, `terminal.run` (keduanya memakai profil lokal bernama), `app.open`/`app.close` (hanya aplikasi yang dibuka agent dalam sesi yang sama), serta `os.lock` di Windows. Tidak ada shell bebas yang bisa dikirim model.
- Perintah memiliki idempotency key dan persetujuan sekali pakai. Backend hanya mengklaim perintah satu kali. Hasil atau kegagalan dicatat, dan perintah yang habis waktu sebelum diambil diberi status `expired`.
- `jarvis-core run` melakukan polling terus. Skrip Windows dapat mendaftarkannya untuk berjalan otomatis saat pengguna login. Kesalahan sambungan dan ringkasan hasil dicatat di `%APPDATA%/Jarvis/agent.log` tanpa menyimpan output perintah atau token. Git pull/commit, pemulihan otomatis untuk perintah yang terputus, dan UI pengaturan masih belum selesai.

## Menyiapkan agent di Windows

1. Jalankan backend (`npm run dev:backend`) dan daftar/login melalui API Jarvis. UI untuk ini baru dikerjakan pada Phase 7.
2. Buat device melalui `POST /v1/devices` dengan capability yang dibutuhkan. Respons pendaftaran menampilkan `id` dan `device_token` satu kali. Simpan token secara pribadi; jangan taruh di `.env` atau Git.
3. Dari `core/rust-agent`, jalankan `cargo run -p jarvis-core -- enroll http://127.0.0.1:3001 <device-id> <folder-yang-diizinkan>`. Tempel token pada prompt tersembunyi. Agent memverifikasi token ke backend sebelum menyimpannya di Windows Credential Manager.
4. Jalankan `cargo run -p jarvis-core -- run`. Untuk satu polling saja, gunakan `once`; mode `once` menolak `app.open`/`app.close` karena tidak dapat melacak proses setelah keluar. Konfigurasi ada di `%APPDATA%/Jarvis/agent.json`. Profil `test_profiles`, `command_profiles`, dan `app_profiles` masing-masing memetakan nama ke `program` absolut dan `args`. Contoh: `"unit": {"program":"C:\\Program Files\\nodejs\\npm.cmd", "args":["test"]}`. Pemilik komputer mengatur profil ini; AI hanya dapat memilih nama profil yang sudah tersedia.
5. Untuk mulai otomatis saat login, build binary tetap dengan `cargo build --release` lalu jalankan `scripts/install-autostart.ps1 -AgentExe <path-ke-jarvis-core.exe>` dari PowerShell. Skrip membuat tugas Windows untuk pengguna yang sedang login; tidak dijalankan otomatis oleh proses build. Hapus dengan `scripts/remove-autostart.ps1`. Jika binary dipindah, daftar ulang tugas dengan lokasi baru. Skrip menerima `-ConfigPath <path>` opsional bila konfigurasi bukan di lokasi bawaan; berikan path yang sama saat menghapus tugas.

`unenroll` menghapus token dan konfigurasi dari komputer ini. Untuk membatalkan akses token di backend, cabut device dari akun Jarvis atau rotasi tokennya.

Uji koneksi end-to-end tanpa akun atau key pribadi: dari root repo, jalankan `cargo build` di `core/rust-agent`, lalu `node --import tsx scripts/smoke-local-agent.mjs`. Uji ini membuat akun/perangkat sementara, memakai Windows Credential Manager selama uji, menjalankan satu perintah `system.info`, lalu menghapus pendaftaran sementara.
`node --import tsx scripts/smoke-local-agent.mjs --background` juga mendaftarkan tugas Windows sementara, memulainya secara manual, membuktikan agent bisa mengambil perintah, lalu menghapus tugas dan kredensial uji. Ini menguji eksekusi di latar belakang tanpa logout; pemicu otomatis saat login Windows masih perlu diuji dengan logout/login sungguhan dan backend yang tetap menyala.

## Alur perintah

1. Buat task di `POST /v1/tasks`, lalu minta izin di `POST /v1/permissions` dengan task, device, capability, resource, dan arguments yang persis. `resource` adalah folder absolut untuk Git/tes/profil terminal, file absolut untuk `file.read`, `device:<device-id>` untuk info/proses/lock, atau `app:<profile-id>` / `app:<launch-id>` untuk aplikasi.
2. Bila status izin `pending`, pengguna memutuskan melalui `POST /v1/permissions/:id/decision` dengan `allow_once`. Untuk read capability, kebijakan yang diizinkan juga dapat memberi grant. Simpan nonce yang dikembalikan hanya sampai dispatch.
3. Kirim `POST /v1/device-commands` dengan task, device, capability, resource, arguments, permission request ID, nonce, dan idempotency key unik. Backend mengonsumsi nonce dan menaruh perintah di antrean.
4. Agent yang berjalan mengambil perintah, meminta otorisasi ulang, menjalankan capability, lalu mengirim hasil. Pengguna bisa melihat status dan hasil di `GET /v1/device-commands/:id` serta aktivitas di `GET /v1/audit`.

Perintah yang sudah diklaim tetapi agent mati sebelum melaporkan hasil tetap `running` untuk investigasi. Backend tidak otomatis mengulanginya, karena pengulangan diam-diam dapat menjalankan aksi dua kali. Perintah profil memiliki batas 120 detik dan output dibatasi 90 KB di agent. Hasil proses lokal tidak otomatis diberikan ke model AI. `app.close` hanya dapat menutup proses yang diluncurkan agent yang masih berjalan; setelah agent restart, pemilik komputer dapat menutup aplikasi itu sendiri. `os.lock` memerlukan persetujuan baru setiap kali dan hanya menginisiasi penguncian layar Windows; API Windows tidak memastikan layar sudah terkunci saat panggilan selesai.
