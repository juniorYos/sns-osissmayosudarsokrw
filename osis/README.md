# Kritik & Saran Yosuka

Website aspirasi siswa OSIS SMA Yos Sudarso Karawang. Aplikasi menggunakan Google Sheets sebagai penyimpanan bersama dan Google Apps Script sebagai backend.

## Struktur folder

```text
index.html                 halaman utama; sumber tunggal tampilan situs
api/index.js               proxy API untuk deployment Vercel
apps-script/Code.gs        backend dan API Google Apps Script
apps-script/AdminSetup.html
apps-script/local-proxy.mjs
logo/                      aset gambar sekolah
vidio cupilkan/            aset video
```

Folder `api` dan `apps-script` memang berbeda tugas dan keduanya diperlukan untuk target Live Server + Vercel + Google Apps Script. `apps-script/Index.html` bukan salinan yang perlu diedit: buat atau perbarui otomatis dari `index.html` sebelum `clasp push`. File konfigurasi lokal seperti `.clasp.json` dan `.env.local` jangan dibagikan atau dimasukkan ke Git.

## Setup Google Sheets dan Apps Script

Setup ini dilakukan satu kali oleh operator. Spreadsheet tetap privat; murid tidak perlu diberi akses ke spreadsheet.

1. Buat Google Sheet baru, lalu buka **Extensions → Apps Script**.
2. Di editor Apps Script, buka `Code.gs`, hapus isi awal, lalu salin isi file [`apps-script/Code.gs`](./apps-script/Code.gs).
3. Tambahkan file HTML bernama **Index** (tanpa `.html`) dan salin seluruh isi [`index.html`](./index.html). Jika file **Index** sudah ada, perbarui isinya; jangan membuat file Index tambahan.
4. Tambahkan file HTML bernama **AdminSetup** dan salin isi [`apps-script/AdminSetup.html`](./apps-script/AdminSetup.html).
5. Simpan proyek. Pilih fungsi `initializeBackend` di editor lalu tekan **Run** dan izinkan akses Google Sheets dan Google Drive. Kembali ke Google Sheet dan muat ulang halaman.
6. Di menu **Kritik & Saran → Atur akun operator**, buat akun dengan email dan kata sandi unik minimal 12 karakter. Jangan gunakan kata sandi akun Google.
7. Di Apps Script, pilih **Deploy → New deployment → Web app**. Pilih **Execute as: Me** dan **Who has access: Anyone** agar murid dapat mengirim masukan tanpa login. Deploy, izinkan akses yang diminta, lalu salin URL web app yang berakhir dengan `/exec`.
8. Bagikan **URL `/exec` yang sama** kepada semua murid dan operator. Semua perangkat yang membuka URL itu memakai spreadsheet yang sama; jangan gunakan URL GitHub Pages untuk aplikasi database.

Jika pilihan akses **Anyone** tidak tersedia, akun Google sekolah membatasi aplikasi publik; minta administrator Google Workspace mengizinkannya. Setelah mengubah kode, buat deployment versi baru melalui **Deploy → Manage deployments → Edit → New version**.

## Menguji dari Live Server dan menerbitkan ke Vercel

Aplikasi memakai backend Apps Script/Sheets yang sama di semua tempat. URL `/exec` melayani halaman Apps Script; untuk Live Server dan Vercel, folder `api` menyediakan proxy ke Apps Script karena halaman statis tidak memiliki `google.script.run`. Proxy lokal hanya mendengarkan pada komputer sendiri, sedangkan URL Apps Script disimpan di `.env.local` atau environment variable Vercel—bukan di kode frontend.

### Aktifkan API Apps Script satu kali

1. Pasang Node.js LTS versi 18 atau lebih baru dari situs resmi Node.js. Di terminal VS Code, pastikan `node -v` dan `npm -v` menampilkan versi.
2. Pastikan URL Web App `/exec` dari proyek yang sudah terhubung ke spreadsheet tersedia. Jangan buat spreadsheet/operator baru jika yang lama masih dipakai.
3. Ikuti petunjuk clasp di bagian **Mengedit dan menerbitkan dari VS Code** untuk menghubungkan repository ke Script ID yang benar.
4. Dari folder repository, salin halaman terbaru dan kirim kode:

   ```powershell
   Copy-Item .\index.html .\apps-script\Index.html -Force
   Push-Location .\apps-script
   clasp push
   Pop-Location
   ```

5. Di Apps Script, pilih **Deploy → Manage deployments → Edit → New version → Deploy**. Versi ini menambahkan handler API `doPost` pada backend aktif. Jangan lanjut bila proyek atau deployment yang dipilih bukan milik aplikasi ini.

Memilih **New version** pada deployment yang sama tidak menghapus data di Google Sheets dan mempertahankan URL `/exec`. Jangan pilih **New deployment**, membuat spreadsheet baru, atau menjalankan `initializeBackend` dari spreadsheet yang berbeda; `initializeBackend` mengubah spreadsheet yang dipakai aplikasi.

### Coba login melalui Live Server

1. Salin `apps-script/.env.local.example` menjadi `apps-script/.env.local`. Ganti nilai `APP_SCRIPT_URL` dengan URL Web App `/exec` aktif. File `.env.local` tidak di-commit.
2. Buka dua terminal VS Code. Terminal pertama:

   ```powershell
   Set-Location D:\osis\apps-script
   node .\local-proxy.mjs
   ```

3. Terminal kedua: jalankan Live Server untuk `index.html`, buka alamat localhost-nya, lalu coba login operator. Biarkan terminal proxy tetap berjalan selama pengujian. Hentikan dengan `Ctrl+C` setelah selesai.

### Terbitkan ke Vercel

1. Pastikan `api/index.js`, `index.html`, dan aset proyek ikut di-commit ke repository, tetapi jangan commit `apps-script/.env.local`, `.clasp.json`, kata sandi, atau token.
2. Impor repository ke Vercel dan deploy dari folder root proyek. Vercel akan mendeteksi fungsi di `api/index.js`.
3. Di proyek Vercel buka **Settings → Environment Variables**. Tambahkan `APP_SCRIPT_URL` dengan URL Web App `/exec` yang sama. Pilih environment yang akan dipakai (**Production**, dan **Preview** jika ingin menguji preview deployment).
4. Redeploy agar environment variable diterapkan. Buka domain Vercel dan uji login/operator serta kirim masukan.
5. Untuk perubahan backend Apps Script, lakukan push lalu buat **New version** deployment. Untuk perubahan website/proxy Vercel, push ke Git dan tunggu deployment Vercel selesai.

**Akses Apps Script:** deployment Web App harus memakai **Execute as: Me** dan **Who has access: Anyone** agar pengunjung Vercel tidak diminta login Google. Kata sandi operator tetap diverifikasi di Apps Script; jangan taruh kata sandi di Vercel atau repository. Jika kebijakan Google Workspace tidak menyediakan pilihan **Anyone**, minta admin sekolah mengizinkannya.

**Perhatian:** Live Server dan Vercel terhubung ke spreadsheet deployment `/exec` tersebut. Data uji benar-benar tersimpan. Jangan menguji impor atau hapus semua data pada database produksi; buat spreadsheet/deployment uji terpisah jika perlu. Fungsi Vercel dibatasi 4 MB per permintaan/respons; poster dioptimalkan otomatis di browser sebelum dikirim. Data/cadangan yang melebihi batas layanan perlu dikelola dari portal Apps Script.

### Memastikan login dari HP dan komputer

Gunakan **URL produksi yang sama** pada setiap perangkat:

- URL Apps Script berakhiran `/exec`, atau domain Vercel berawalan `https://`.
- Jangan gunakan `localhost`, alamat Live Server, atau proxy lokal dari HP/perangkat lain. Proxy lokal hanya untuk pengujian di komputer yang menjalankannya.
- Semua pengguna mengakses akun operator dan spreadsheet yang sama. Login murid tidak diperlukan; hanya operator yang memakai email dan kata sandi operator.
- Jika login gagal di semua perangkat, periksa deployment Apps Script: **Execute as: Me**, **Who has access: Anyone**, URL `/exec` benar, dan versi terbaru sudah di-deploy. Jika hanya Vercel yang gagal, pastikan `APP_SCRIPT_URL` pada Vercel sama dengan URL `/exec` aktif, lalu lakukan redeploy.

Bagian yang perlu diubah bila konfigurasi atau fitur login berubah:

- `index.html`: formulir login dan komunikasi frontend. Jangan menaruh kata sandi, token, atau URL rahasia di sini.
- `apps-script/Code.gs`: akun operator, sesi, dan akses spreadsheet di server. Setelah mengubahnya, jalankan `clasp push`, lalu **Deploy → Manage deployments → Edit → New version → Deploy**.
- `api/index.js`: proxy untuk Vercel. Atur `APP_SCRIPT_URL` di **Vercel → Settings → Environment Variables**; jangan hardcode URL atau kredensial.
- `apps-script/.env.local`: URL `/exec` untuk proxy pengujian lokal saja. Ubah nilai `APP_SCRIPT_URL` di file lokal ini; jangan commit file tersebut.

## Mengedit dan menerbitkan dari VS Code

VS Code dapat dipakai untuk mengedit dan mengirim kode ke proyek Apps Script. Login operator dan database saat aplikasi online tetap berjalan melalui Web App Google Apps Script.

1. Pasang clasp satu kali: `npm install --global @google/clasp`.
2. Di terminal VS Code, jalankan `clasp login` dan pilih akun Google pemilik proyek Apps Script.
3. Di Apps Script, buka **Project Settings** dan salin **Script ID**. Salin `apps-script/.clasp.json.example` menjadi `apps-script/.clasp.json`, lalu ganti nilai `scriptId` dengan ID tersebut.
4. Sebelum sinkronisasi pertama, cadangkan kode yang sekarang ada di proyek Apps Script dan pastikan proyek itu hanya berisi file aplikasi ini (`Code.gs`, `Index.html`, dan `AdminSetup.html`). `clasp push` menyinkronkan berkas lokal ke proyek tersebut.
5. Dari folder utama repository, jalankan:

   ```powershell
   Copy-Item .\index.html .\apps-script\Index.html -Force
   Push-Location .\apps-script
   clasp push
   Pop-Location
   ```

6. Di Apps Script, buka **Deploy → Manage deployments → Edit → New version → Deploy**. Bagikan URL `/exec` deployment yang sama kepada pengguna.

Jangan publikasikan isi `.clasp.json` ke repository. File `Index.html` di `apps-script` hanya salinan kerja yang dibuat dari `index.html` sebelum push.

## Data dan keamanan

- Database terdiri dari tab `events`, `feedback`, dan `settings` pada spreadsheet yang dibuat. Jangan bagikan spreadsheet kepada publik; hanya aplikasi Apps Script yang mengaksesnya.
- Jika data lama masih tersimpan di browser pada satu perangkat, data itu belum otomatis masuk ke database bersama. Login operator dari perangkat lama, ekspor cadangan terlebih dahulu, lalu pilih **Migrasi data perangkat ini** dan periksa hasilnya. Migrasi mengganti isi database bersama.
- Masukan murid tidak memerlukan login. Karena itu, situs publik dapat menerima spam; gunakan hanya untuk kegiatan sekolah dan hapus masukan yang tidak pantas dari dashboard operator.
- Login operator memakai email dan kata sandi yang disimpan di properti server Apps Script. Sesi browser berlaku sekitar 30 menit. Percobaan login dibatasi 8 per email dan 30 secara keseluruhan per 15 menit; proses hash juga membatasi maksimal tiga login bersamaan. Jangan membagikan kata sandi operator.
- Kata sandi baru dan kata sandi yang diganti disimpan memakai PBKDF2-HMAC-SHA256 dengan 250.000 iterasi. Hash PBKDF2 yang memakai iterasi lebih tinggi tetap dipertahankan dan diverifikasi dengan jumlah iterasi tersimpannya; hash lama yang lebih lemah diperbarui setelah login berhasil. Hash yang lebih kuat dapat membuat login lebih lambat, tetapi tidak dihitung ulang dengan pekerjaan migrasi tambahan. Mengganti kata sandi mencabut semua sesi operator yang sedang aktif.
- Poster disimpan di Google Drive dan dibuat dapat dilihat siapa pun yang memiliki link agar dapat tampil di situs. Jangan unggah gambar yang berisi informasi pribadi. Jika kebijakan Google Workspace melarang berbagi file publik, poster tidak dapat digunakan sampai admin mengizinkannya.
- Masukan sebelum dan sesudah acara disimpan dan ditampilkan pada papan yang terpisah. Saat masuk sebagai murid, pilih salah satu dari dua menu: **Sebelum acara** atau **Sesudah acara**. Daftar event, status formulir, pengisian, serta papan hanya menampilkan fase yang dipilih. Event yang formulir fasenya ditutup tetap bisa dibuka untuk melihat papan, tetapi murid tidak dapat mengirim jawaban baru.
- Operator dapat membuka atau menutup formulir **Sebelum acara** dan **Sesudah acara** secara terpisah dari dashboard atau saat mengedit event. Penutupan diperiksa kembali oleh backend, sehingga mengirim permintaan langsung tidak dapat melewati status tutup.
- Event lama yang hanya memiliki status formulir gabungan akan tetap memakai status lama tersebut untuk kedua fase saat pertama kali dibaca; saat disimpan dengan kode baru, statusnya menjadi dua pengaturan terpisah. Data event dan masukan tidak dihapus oleh pembaruan ini.
- Jangan meminta atau menuliskan nama murid, nomor telepon, atau informasi pribadi; masukan bukan kanal rahasia.
- Poster dioptimalkan otomatis di browser sebelum diunggah agar dapat tampil melalui Apps Script maupun Vercel. Kapasitas Google Drive, Google Sheets, dan kuota Apps Script tetap berlaku; kegagalan unggah akan ditampilkan agar operator dapat mencoba lagi.
- Ekspor cadangan sebelum mengimpor data atau menghapus seluruh data. Impor menggantikan data bersama.
- Google Apps Script dan Sheets memiliki batas kuota serta kapasitas; backend ini ditujukan untuk pemakaian sekolah berskala kecil.

## Galeri

Galeri memakai gambar di folder `cupilkan foto` serta video `WhatsApp Video 2026-11-08 at 19.44.07.mp4` di folder `vidio cupilkan`. Logo header memakai gambar `logo/sma-yos-sudarso.png`. Pada pop-up pembuka, video `logo/logo-animasi-transparan.webm` jatuh dari atas lalu berhenti pada frame terakhir yang terlihat; efek sinar tambahan CSS tidak digunakan. Jika perangkat tidak mendukung video VP9 atau autoplay, PNG menjalankan animasi jatuh dengan CSS; jika perangkat meminta pengurangan gerakan, animasi dimatikan dan PNG tampil diam. Situs Vercel/Live Server memakai berkas dari repository; URL Apps Script mengambil animasi dari branch `main` GitHub.

Video dicoba diputar otomatis tanpa suara agar sesuai kebijakan autoplay browser. Tekan **Aktifkan suara** atau kontrol suara pada video untuk mendengar audio. Tombol slide berada di dalam bingkai galeri, dan slide otomatis berpindah setiap 5 detik (kecuali perangkat meminta pengurangan animasi).

### Mengubah pertanyaan untuk event

Masuk ke **Portal OSIS → Edit event**. Pertanyaan **Sebelum acara** dan **Sesudah acara** dapat diubah terpisah, satu pertanyaan per baris; nomor pertanyaan dibuat otomatis berdasarkan urutannya. Setiap jawaban murid dibatasi hingga 2.000 karakter dan batas ini juga diperiksa oleh backend. Jumlah pertanyaan, serta panjang pertanyaan, deskripsi, dan balasan operator tidak dibatasi oleh aplikasi; batas kapasitas Google Sheets dan layanan tetap berlaku. Pertanyaan sebelum acara bawaan tetap digunakan untuk event lama yang belum disimpan ulang. Setelah perubahan kode di VS Code, salin `index.html` ke `apps-script/Index.html`, jalankan `clasp push` dari folder `apps-script`, lalu deploy **New version** di Apps Script.

## Pemulihan dan pengelolaan

- **Ganti kata sandi:** buka URL web app `/exec`, masuk sebagai operator, pilih **Ganti kata sandi**, lalu simpan kata sandi baru (minimal 12 karakter). Jangan gunakan kata sandi akun Google.
- **Ganti email operator:** buka spreadsheet pemilik database → **Extensions → Apps Script → Project Settings** (ikon roda gigi) → **Script Properties**. Ubah nilai `ADMIN_EMAIL` ke email baru, simpan, lalu gunakan email itu saat login berikutnya. Jangan mengubah `ADMIN_PASSWORD_HASH` atau `ADMIN_PASSWORD_SALT`; kata sandi diganti dari Portal OSIS.
- Jika email lama tidak bisa login dan Anda tidak dapat mengubah Script Properties, pemilik proyek Apps Script perlu memulihkan akses. Jangan membuat akun setup baru atau spreadsheet baru karena bisa memutus akses ke database lama.
- Simpan spreadsheet dan proyek Apps Script di akun Google yang dikelola sekolah. Jangan menghapus pemilik akun atau spreadsheet yang dipakai sebagai database.
- Jika akses web app berubah, buka **Deploy → Manage deployments** dan periksa pengaturan akses.
