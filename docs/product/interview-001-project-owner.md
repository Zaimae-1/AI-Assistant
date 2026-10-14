# Wawancara awal 001 — pemilik proyek

Tanggal: 14 Oktober 2026. Metode: jawaban tertulis dalam percakapan. Ini **laporan pengalaman**, belum observasi langsung atau sampel representatif.

## Kejadian terakhir

- Konteks: proyek lomba web design bersama tim; perubahan terakhir yang di-commit adalah model 3D untuk landing page.
- Alur yang dilaporkan: VS Code untuk pull/commit, Chrome untuk memeriksa perubahan di GitHub, lalu AI untuk meminta pendapat. Perpindahan tiga aplikasi terasa merepotkan.
- Pull terakhir berhasil, tetapi peserta bingung memahami perubahan rekan tim. Tidak ada merge conflict pada kejadian itu.
- Banyak file membuat peserta sulit memahami dampak perubahan dan khawatir ada error atau sesuatu yang terlewat.
- Peserta pernah menemukan masalah setelah commit, tetapi tidak ingat contohnya. Jangan menganggap jenis atau frekuensinya sudah diketahui.
- Sebelum commit, peserta ingin tahu apakah kode benar dan hasilnya cocok dengan tujuan. Penilaian “cocok” dapat mencakup desain landing page, bukan hanya kebenaran kode.
- Bantuan yang diinginkan: Jarvis dapat melakukan pull dan commit, menjelaskan efek setiap pilihan, dan memberi saran saat ada perbedaan. “Perbedaan” mencakup tiga kasus: dua versi kode saat conflict, perubahan tim dibanding perubahan sendiri, serta pilihan desain/tampilan.
- Preferensi izin: dapat diatur per capability, termasuk full access, izin terbatas, atau selalu bertanya. Ini preferensi yang dilaporkan; belum mengubah kebijakan minimum keamanan MVP.
- Peserta menduga developer berpengalaman mungkin tidak perlu bertanya pada AI seperti dirinya. Ini hipotesis peserta yang perlu diuji pada orang lain.

## Interpretasi untuk produk

**Masalah yang terbukti dalam satu laporan:** memahami perubahan tim setelah pull dan review perubahan sebelum commit, dengan konteks tersebar di tiga aplikasi.

**Kandidat alur khusus developer:** tampilkan perubahan tim yang akan masuk, ringkas dampak per file dan tes yang mungkin terpengaruh, beri akses ke diff asli, lalu minta izin sebelum pull. Setelah pull, tampilkan perubahan aktual dan hasil tes. Ini bukan keputusan tentang fokus seluruh produk atau MVP.

**Belum terbukti:** kebutuhan penyelesaian merge conflict otomatis, kemampuan AI memilih desain yang paling cocok, kemauan memberi full access, manfaat lintas perangkat, kebutuhan developer berpengalaman, serta apakah alur Git harus menjadi prioritas rilis pertama.

## Pertanyaan lanjutan saat observasi

1. Tunjukkan satu pull tim yang nyata. File mana yang pertama dilihat dan apa yang sulit dipahami?
2. Untuk perubahan model 3D, apa arti “cocok”: visual, performa, ukuran file, browser support, atau kesesuaian brief lomba?
3. Apakah ada perubahan lokal yang belum di-commit saat pull? Apa yang dilakukan jika Git menolak pull?
4. Saat Jarvis memberi rekomendasi, bukti apa yang harus ditampilkan agar peserta percaya?
5. Apakah peserta bersedia memperlihatkan alur di VS Code/GitHub tanpa membagikan credential atau kode privat?
