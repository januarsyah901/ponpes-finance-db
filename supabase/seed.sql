-- Synthetic Pesantren Seed Data for ponpes-finance
-- Uses deterministic UUIDs for referential integrity

-- 1. Complexes (6)
INSERT INTO komplek (id, kode, nama, jenis, deskripsi) VALUES
('10000000-0000-0000-0000-000000000001', 'PA1', 'Komplek Al-Falah (Putra 1)', 'putra', 'Komplek asrama putra induk'),
('10000000-0000-0000-0000-000000000002', 'PA2', 'Komplek Al-Hidayah (Putra 2)', 'putra', 'Komplek asrama putra madya'),
('10000000-0000-0000-0000-000000000003', 'PA3', 'Komplek An-Nur (Putra 3)', 'putra', 'Komplek asrama putra tahfidz'),
('10000000-0000-0000-0000-000000000004', 'PI1', 'Komplek Khadijah (Putri 1)', 'putri', 'Komplek asrama putri induk'),
('10000000-0000-0000-0000-000000000005', 'PI2', 'Komplek Aisyah (Putri 2)', 'putri', 'Komplek asrama putri madya'),
('10000000-0000-0000-0000-000000000006', 'PI3', 'Komplek Fatimah (Putri 3)', 'putri', 'Komplek asrama putri tahfidz')
ON CONFLICT (kode) DO NOTHING;

-- 2. Santri Categories (3)
INSERT INTO kategori (id, kode, nama, deskripsi) VALUES
('20000000-0000-0000-0000-000000000001', 'non_pengurus', 'Santri Reguler', 'Santri reguler bukan pengurus pondok'),
('20000000-0000-0000-0000-000000000002', 'pengurus', 'Santri Pengurus', 'Santri yang bertugas sebagai pengurus pesantren'),
('20000000-0000-0000-0000-000000000003', 'mbak_ndalem', 'Santri Khidmah Ndalem', 'Santri yang berkhidmah di kediaman masyayikh')
ON CONFLICT (kode) DO NOTHING;

-- 3. Rate Matrix (18 combinations: 6 complexes x 3 categories)
INSERT INTO tarif_syahriah (komplek_id, kategori_id, nominal, alokasi_tabungan, alokasi_operasional, berlaku_mulai)
SELECT 
    k.id AS komplek_id,
    c.id AS kategori_id,
    CASE 
        WHEN c.kode = 'non_pengurus' THEN 350000
        WHEN c.kode = 'pengurus' THEN 200000
        WHEN c.kode = 'mbak_ndalem' THEN 50000
    END AS nominal,
    50000 AS alokasi_tabungan,
    CASE 
        WHEN c.kode = 'non_pengurus' THEN 300000
        WHEN c.kode = 'pengurus' THEN 150000
        WHEN c.kode = 'mbak_ndalem' THEN 0
    END AS alokasi_operasional,
    '2026-01-01'::DATE AS berlaku_mulai
FROM komplek k
CROSS JOIN kategori c
ON CONFLICT DO NOTHING;

-- 4. Expense Categories
INSERT INTO kategori_pengeluaran (id, nama, deskripsi) VALUES
('30000000-0000-0000-0000-000000000001', 'Listrik & Air', 'Tagihan PLN, PDAM, dan pemeliharaan pompa'),
('30000000-0000-0000-0000-000000000002', 'Dapur & Logistik', 'Bahan pokok makan santri dan logistik asrama'),
('30000000-0000-0000-0000-000000000003', 'Sarana & Prasarana', 'Perbaikan gedung, cat, dan kebersihan'),
('30000000-0000-0000-0000-000000000004', 'Kegiatan & PHBI', 'Peringatan Hari Besar Islam dan kegiatan santri'),
('30000000-0000-0000-0000-000000000005', 'Honor & Operasional Pengajar', 'Kafalah ustadz dan ustadzah')
ON CONFLICT (nama) DO NOTHING;

-- 5. Santri Profiles (6 representative santri)
INSERT INTO santri (id, nis, nama, komplek_id, kategori_id, tanggal_masuk, status, nomor_whatsapp, nama_wali, nomor_whatsapp_wali, alamat) VALUES
('40000000-0000-0000-0000-000000000001', '2024001', 'Ahmad Fauzi', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2024-07-15', 'aktif', '6281234567890', 'H. Supardi', '6281234567899', 'Sleman, D.I. Yogyakarta'),
('40000000-0000-0000-0000-000000000002', '2024002', 'Muhammad Rizqi', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2023-07-10', 'aktif', '6281234567891', 'Bambang Irawan', '6281234567898', 'Bantul, D.I. Yogyakarta'),
('40000000-0000-0000-0000-000000000003', '2024003', 'Zulfikar Ali', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2024-01-20', 'aktif', '6281234567892', 'Drs. Subekti', '6281234567897', 'Magelang, Jawa Tengah'),
('40000000-0000-0000-0000-000000000004', '2024004', 'Fatimah Az-Zahra', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '2024-07-01', 'aktif', '6281234567893', 'K.H. Abdullah', '6281234567896', 'Purworejo, Jawa Tengah'),
('40000000-0000-0000-0000-000000000005', '2024005', 'Siti Aminah', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '2022-07-15', 'boyong', '6281234567894', 'H. Masduki', '6281234567895', 'Kebumen, Jawa Tengah'),
('40000000-0000-0000-0000-000000000006', '2024006', 'Nurul Hidayati', '10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', '2023-01-10', 'aktif', '6281234567895', 'Drs. Suryono', '6281234567894', 'Solo, Jawa Tengah')
ON CONFLICT (nis) DO NOTHING;

-- 6. Users (Admin, Bendahara, Santri)
-- password123 hash: $2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2
INSERT INTO pengguna (id, username, password_hash, nama, role, is_first_login, is_active, santri_id) VALUES
('50000000-0000-0000-0000-000000000001', 'admin', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Super Administrator Pondok', 'super_admin', false, true, NULL),
('50000000-0000-0000-0000-000000000002', 'bendahara_putra', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Ust. Muhsin (Bendahara Putra)', 'bendahara_komplek', false, true, NULL),
('50000000-0000-0000-0000-000000000003', 'bendahara_putri1', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Ustdz. Maryam (Bendahara Khadijah)', 'bendahara_komplek', false, true, NULL),
('50000000-0000-0000-0000-000000000004', 'bendahara_putri2', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Ustdz. Khadijah (Bendahara Aisyah)', 'bendahara_komplek', false, true, NULL),
('50000000-0000-0000-0000-000000000005', 'bendahara_putri3', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Ustdz. Halimah (Bendahara Fatimah)', 'bendahara_komplek', false, true, NULL),
('50000000-0000-0000-0000-000000000006', '2024001', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Ahmad Fauzi', 'santri', true, true, '40000000-0000-0000-0000-000000000001'),
('50000000-0000-0000-0000-000000000007', '2024002', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Muhammad Rizqi', 'santri', true, true, '40000000-0000-0000-0000-000000000002'),
('50000000-0000-0000-0000-000000000008', '2024003', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Zulfikar Ali', 'santri', true, true, '40000000-0000-0000-0000-000000000003'),
('50000000-0000-0000-0000-000000000009', '2024004', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Fatimah Az-Zahra', 'santri', true, true, '40000000-0000-0000-0000-000000000004'),
('50000000-0000-0000-0000-000000000010', '2024005', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Siti Aminah', 'santri', false, false, '40000000-0000-0000-0000-000000000005'),
('50000000-0000-0000-0000-000000000011', '2024006', '$2a$10$DJ4Q/1XN9Npq6bNxeraKoe0JAX/QCMv/MA06KST6RPMNgGM2jvlw2', 'Nurul Hidayati', 'santri', true, true, '40000000-0000-0000-0000-000000000006')
ON CONFLICT (username) DO NOTHING;

-- 7. Bendahara Multi-Complex Scoping (`pengguna_komplek`)
-- Bendahara Putra manages 3 complexes: PA1, PA2, PA3
INSERT INTO pengguna_komplek (user_id, komplek_id) VALUES
('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003'),
-- Bendahara Putri 1 manages PI1
('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004'),
-- Bendahara Putri 2 manages PI2
('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005'),
-- Bendahara Putri 3 manages PI3
('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006')
ON CONFLICT DO NOTHING;

-- 8. Seed Opening Savings Ledger (`saldo_awal`)
INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, referensi_tipe, referensi_id, keterangan, dibuat_oleh_id) VALUES
('40000000-0000-0000-0000-000000000001', 'saldo_awal', 600000, 'impor_awal', NULL, 'Saldo tabungan awal santri per Juli 2026', '50000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000002', 'saldo_awal', 450000, 'impor_awal', NULL, 'Saldo tabungan awal santri per Juli 2026', '50000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000003', 'saldo_awal', 150000, 'impor_awal', NULL, 'Saldo tabungan awal santri per Juli 2026', '50000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000004', 'saldo_awal', 250000, 'impor_awal', NULL, 'Saldo tabungan awal santri per Juli 2026', '50000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000006', 'saldo_awal', 350000, 'impor_awal', NULL, 'Saldo tabungan awal santri per Juli 2026', '50000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- 9. Seed Sample Bills
-- Ahmad Fauzi (PA1 Reguler: Rp 350.000)
INSERT INTO tagihan (id, santri_id, komplek_id, tipe, judul, bulan, tahun, jatuh_tempo, nominal, terbayar, sisa, status) VALUES
('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'syahriah', 'Syahriah Oktober 2026', 10, 2026, '2026-10-10', 350000, 350000, 0, 'lunas'),
('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'syahriah', 'Syahriah November 2026', 11, 2026, '2026-11-10', 350000, 0, 350000, 'belum_bayar'),

-- Muhammad Rizqi (PA1 Pengurus: Rp 200.000, cicilan Rp 100.000 terbayar)
('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'syahriah', 'Syahriah November 2026', 11, 2026, '2026-11-10', 200000, 100000, 100000, 'sebagian'),

-- Zulfikar Ali (PA2 Reguler: Rp 350.000 x 3 months overdue for WhatsApp arrears test)
('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'syahriah', 'Syahriah September 2026', 9, 2026, '2026-09-10', 350000, 0, 350000, 'belum_bayar'),
('60000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'syahriah', 'Syahriah Oktober 2026', 10, 2026, '2026-10-10', 350000, 0, 350000, 'belum_bayar'),
('60000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'syahriah', 'Syahriah November 2026', 11, 2026, '2026-11-10', 350000, 0, 350000, 'belum_bayar'),

-- Event Bill: Haul Masyayikh 2026 (Rp 150.000)
('60000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'kegiatan', 'Iuran Haul Masyayikh 2026', NULL, 2026, '2026-11-25', 150000, 75000, 75000, 'sebagian')
ON CONFLICT DO NOTHING;

-- 10. Sample Verified Payment & Allocation (Ahmad Fauzi Oktober Syahriah)
INSERT INTO pembayaran (id, santri_id, komplek_id, metode, nominal, nominal_diverifikasi, tanggal_bayar, bukti_url, status, diverifikasi_oleh_id, diverifikasi_pada) VALUES
('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'transfer', 350000, 350000, '2026-10-05', 'https://storage.ponpes.id/bukti/2024001-oct-2026.jpg', 'terverifikasi', '50000000-0000-0000-0000-000000000002', '2026-10-06 08:30:00+07')
ON CONFLICT DO NOTHING;

INSERT INTO alokasi_pembayaran (pembayaran_id, tagihan_id, nominal_alokasi, alokasi_tabungan, alokasi_operasional) VALUES
('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 350000, 50000, 300000)
ON CONFLICT DO NOTHING;

INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, referensi_tipe, referensi_id, keterangan, dibuat_oleh_id) VALUES
('40000000-0000-0000-0000-000000000001', 'setoran_syahriah', 50000, 'pembayaran', '70000000-0000-0000-0000-000000000001', 'Setoran Tabungan Syahriah Oktober 2026', '50000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

-- 11. Subsidy Rule and Beneficiary Application
INSERT INTO aturan_subsidi (id, tagihan_kegiatan_id, nama, nominal, syarat_json, is_active, dibuat_oleh_id) VALUES
('80000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000007', 'Subsidi Tabungan Haul 2026', 75000, '{"syahriahLunasSampai": "2026-10", "minLamaMondokBulan": 12}', true, '50000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Deduction mutation in ledger for Ahmad Fauzi (Ahmad Fauzi has 600,000 + 50,000 = 650,000)
INSERT INTO ledger_tabungan (id, santri_id, jenis_mutasi, nominal, referensi_tipe, referensi_id, keterangan, dibuat_oleh_id) VALUES
('90000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'pemakaian_kegiatan', -75000, 'aturan_subsidi', '80000000-0000-0000-0000-000000000001', 'Subsidi Tabungan Haul 2026', '50000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO subsidi_penerima (aturan_subsidi_id, santri_id, tagihan_id, nominal_diterima, ledger_tabungan_id) VALUES
('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000007', 75000, '90000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- 12. Sample Expense Entry
INSERT INTO pengeluaran (id, komplek_id, kategori_pengeluaran_id, tanggal, nominal, keterangan, dibuat_oleh_id) VALUES
('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2026-11-01', 1250000, 'Pembayaran token listrik asrama putra PA1 bulan November 2026', '50000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;
