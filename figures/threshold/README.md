# Figur threshold

Sumber figur interaktif di `docs/threshold/index.html` (GitHub Pages) dan preview `reports/threshold_figure.{svg,png}`.

Semua angka dibaca dari `reports/threshold_table.json`, jadi urutannya:

```bash
python src/threshold_table.py          # tabel threshold dari model final
node figures/threshold/build.mjs       # halaman + SVG (Node 18+)
node figures/threshold/build.mjs --audit   # opsional: cek urutan gambar & tumpuan di 6 posisi ambang
```

PNG preview diambil dari halaman dengan screenshot headless Chrome (skrip `capture.mjs` dari Anatomy).

`kit/` berisi kit Anatomy (`iso-kit.mjs`, `audit.mjs`, `lathe.mjs`, `tube.mjs`) tanpa perubahan, berlisensi MIT: lihat `LICENSE-anatomy`.
