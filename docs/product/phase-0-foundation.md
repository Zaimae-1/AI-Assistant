# Phase 0 — Product foundation

Status: **rancangan untuk diuji**, 14 Oktober 2026. Keputusan di sini memberi arah implementasi awal, tetapi tidak menggantikan wawancara calon pengguna.

Sumber: [PRD Jarvis](https://app.notion.com/p/3ed499df915c813aa30ed73253e837cc), [product thesis](https://app.notion.com/p/3eb499df915c8074a7c0fda4a170e142), [roadmap](https://app.notion.com/p/3eb499df915c81d5b31fd0f25bb770af), dan [struktur](https://app.notion.com/p/3ec499df915c81d4b57bcbac4142d515). Daftar "Fitur Lama" adalah arsip ide setelah reset produk 30 September 2026.

## Pengguna dan masalah

Visi pengguna: orang dari berbagai latar belakang yang ingin dibantu bekerja, belajar, dan mengurus aktivitas sehari-hari. Jarvis berperan sebagai satu assistant yang menghubungkan AI, aplikasi, layanan, serta perangkat sesuai izin pengguna. PRD Notion masih menyebut developer/technical power user untuk MVP; pemilik proyek kini menegaskan bahwa itu **bukan batas identitas produk**. Segmen dan kemampuan rilis pertama masih perlu diputuskan.

Problem statement sementara: pekerjaan dan proses belajar tersebar di banyak aplikasi, sumber informasi, AI, dan perangkat. Pengguna sering perlu mengulang konteks, berpindah aplikasi, serta menyatukan hasil secara manual. Ketika assistant boleh bertindak, pengguna juga perlu tahu apa yang akan dilakukan dan dapat mengendalikannya.

## Kandidat killer use case

**Bantu selesaikan satu tugas dari permintaan sampai hasil.** Pengguna menyampaikan tujuan; Jarvis memakai konteks yang dipilih pengguna, menjelaskan langkahnya, meminta izin untuk tindakan yang diperlukan, menjalankan capability yang tersedia, lalu menunjukkan hasil dan riwayatnya. Pola ini dapat dipakai untuk pekerjaan, belajar, dan kebutuhan pribadi. Tugas konkret pertama untuk rilis awal **belum dipilih**.

Contoh kandidat yang perlu dibandingkan: merangkum bahan belajar dan menyiapkan rencana belajar; mengumpulkan informasi dari beberapa aplikasi untuk tugas kerja; atau memahami perubahan proyek tim. Contoh Git dari [wawancara awal](interview-001-project-owner.md) hanya salah satu kasus, bukan fokus seluruh Jarvis.

Sinyal awal 14 Oktober 2026: pemilik proyek melaporkan perpindahan antara VS Code, GitHub, dan AI ketika mengerjakan proyek tim. Ini contoh nyata masalah fragmentasi, tetapi satu respons tidak cukup untuk memilih segmen atau workflow pertama.

Ukuran keberhasilan uji: untuk tugas yang sama, pengguna dapat mencapai hasil yang benar dengan lebih sedikit perpindahan aplikasi dan pengulangan konteks, sambil memahami serta mengendalikan tindakan Jarvis. Ukur langkah manual, waktu, tingkat penyelesaian, kesalahan, dan rasa kontrol dibanding alur lama. Jangan tetapkan angka target sebelum baseline.

## Batas MVP v1

| Core | Supporting | Future |
| --- | --- | --- |
| Satu identitas assistant; interaksi teks; konteks yang dipilih pengguna; rencana tindakan yang terlihat; minimal satu capability nyata lintas aplikasi/sumber; permission per capability; hasil dan activity log; protocol berversi | Voice dasar, memory yang dapat dikontrol, agent khusus, progress task, integrasi tambahan | Device Mesh, wearable, katalog profesi yang luas, enterprise, marketplace |

Batas MVP masih rancangan dan perlu diselaraskan dengan PRD Notion yang mencantumkan cakupan lebih besar, termasuk multi-agent, mobile, dan wearable. Jangan mengklaim semua itu sudah menjadi komitmen rilis pertama. Model AI membantu interpretasi dan perencanaan; tindakan dilakukan capability yang terdaftar dengan scope dan izin yang jelas. Tidak ada akses bebas ke seluruh perangkat secara default.

Kriteria selesai MVP baru dapat dikunci setelah tugas awal dipilih. Prinsip yang sudah jelas: pengguna berhasil menyelesaikan tugas nyata, permission berlaku di setiap tindakan, dan activity log menjelaskan apa yang terjadi. Phase 0 belum selesai sampai pilihan tersebut diuji.

## Risiko dan asumsi

- Belum terbukti pengguna memerlukan produk baru dibanding kombinasi coding agent yang ada.
- Prioritas lintas perangkat, multi-agent, dan voice untuk rilis pertama belum diputuskan.
- Kepercayaan terhadap tindakan lokal harus diuji, bukan diasumsikan.
- Membangun semua workflow profesi sekaligus akan membuat MVP tidak terukur.

## Gerbang Phase 0

- [x] Visi lintas profesi dan problem statement umum dirumuskan.
- [ ] Pilih dan uji satu tugas konkret pertama tanpa menjadikannya batas identitas produk.
- [x] Fitur dipisah menjadi Core, Supporting, Future.
- [ ] Riset pembanding dilengkapi di luar alat coding; [riset awal](competitor-research.md) baru mencakup contoh developer.
- [ ] Wawancara/observasi calon pengguna dilakukan dan dicatat.
- [ ] Segmen, masalah, killer use case, dan MVP disesuaikan berdasarkan temuan tersebut lalu disetujui pemilik produk.

Gunakan [rencana validasi](user-validation.md) untuk menyelesaikan keputusan yang masih terbuka. Jangan menandai Phase 0 selesai hanya karena dokumennya sudah dibuat.
