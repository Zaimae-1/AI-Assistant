# Konfigurasi dan secret saat pengembangan

- `.env.example` berisi nama variabel dan nilai contoh yang aman. Salin ke `.env` untuk setelan lokal.
- `.env` dan varian lokalnya diabaikan Git. Jangan commit token, kata sandi, atau kunci privat.
- Backend mendengar di `127.0.0.1` secara bawaan agar endpoint awal tidak terbuka ke jaringan.
- Secret CI dan produksi nanti disimpan di penyedia deployment, diberikan hanya ke job atau layanan yang memerlukan. Jangan letakkan di workflow atau konfigurasi aplikasi klien.
- Kunci yang terlanjur bocor harus dicabut dan diganti; menghapusnya dari commit baru saja tidak cukup.

Belum ada secret yang dibutuhkan oleh kerangka Phase 3.
