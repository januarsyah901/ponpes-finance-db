-- Ponpes Finance: Initial Schema Migration
-- 15 Tables, Strict Constraints, Non-Negative Savings Trigger

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create Enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('super_admin', 'bendahara_komplek', 'santri', 'pengasuh');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE santri_status AS ENUM ('aktif', 'boyong');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE santri_kategori AS ENUM ('pengurus', 'non_pengurus', 'mbak_ndalem');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE tagihan_tipe AS ENUM ('syahriah', 'kegiatan');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE tagihan_status AS ENUM ('belum_bayar', 'sebagian', 'lunas', 'dibatalkan');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE metode_pembayaran AS ENUM ('transfer', 'tunai');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE status_pembayaran AS ENUM ('menunggu_verifikasi', 'terverifikasi', 'ditolak');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE jenis_mutasi_tabungan AS ENUM (
        'setoran_syahriah',
        'saldo_awal',
        'pemakaian_kegiatan',
        'penarikan_boyong',
        'penarikan_mendesak',
        'koreksi'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE pengeluaran_status AS ENUM ('aktif', 'dibatalkan');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Master Tables
CREATE TABLE IF NOT EXISTS komplek (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode TEXT NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    jenis TEXT NOT NULL,
    deskripsi TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kategori (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode santri_kategori NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS santri (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nis TEXT NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE RESTRICT,
    kategori_id UUID NOT NULL REFERENCES kategori(id) ON DELETE RESTRICT,
    tanggal_masuk DATE NOT NULL,
    status santri_status NOT NULL DEFAULT 'aktif',
    nomor_whatsapp TEXT NOT NULL,
    nama_wali TEXT,
    nomor_whatsapp_wali TEXT,
    alamat TEXT,
    terakhir_diingatkan TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS santri_nis_idx ON santri(nis);
CREATE INDEX IF NOT EXISTS santri_komplek_status_idx ON santri(komplek_id, status);

CREATE TABLE IF NOT EXISTS tarif_syahriah (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE RESTRICT,
    kategori_id UUID NOT NULL REFERENCES kategori(id) ON DELETE RESTRICT,
    nominal BIGINT NOT NULL,
    alokasi_tabungan BIGINT NOT NULL DEFAULT 50000,
    alokasi_operasional BIGINT NOT NULL,
    berlaku_mulai DATE NOT NULL,
    berlaku_sampai DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tarif_komplek_kategori_idx ON tarif_syahriah(komplek_id, kategori_id);

-- 3. Auth & Scoping Tables
CREATE TABLE IF NOT EXISTS pengguna (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nama TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'santri',
    is_first_login BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    santri_id UUID REFERENCES santri(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pengguna_username_idx ON pengguna(username);
CREATE INDEX IF NOT EXISTS pengguna_role_idx ON pengguna(role);

CREATE TABLE IF NOT EXISTS pengguna_komplek (
    user_id UUID NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, komplek_id)
);

CREATE INDEX IF NOT EXISTS pengguna_komplek_user_idx ON pengguna_komplek(user_id);
CREATE INDEX IF NOT EXISTS pengguna_komplek_komplek_idx ON pengguna_komplek(komplek_id);

-- 4. Billing & Payment Processing
CREATE TABLE IF NOT EXISTS tagihan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    santri_id UUID NOT NULL REFERENCES santri(id) ON DELETE RESTRICT,
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE RESTRICT,
    tipe tagihan_tipe NOT NULL DEFAULT 'syahriah',
    judul TEXT NOT NULL,
    bulan INTEGER,
    tahun INTEGER,
    jatuh_tempo DATE NOT NULL,
    nominal BIGINT NOT NULL,
    terbayar BIGINT NOT NULL DEFAULT 0,
    sisa BIGINT NOT NULL,
    status tagihan_status NOT NULL DEFAULT 'belum_bayar',
    alasan_batal TEXT,
    dibatalkan_pada TIMESTAMPTZ,
    dibatalkan_oleh_id UUID REFERENCES pengguna(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tagihan_nominal_check CHECK (nominal >= 0),
    CONSTRAINT tagihan_terbayar_check CHECK (terbayar >= 0),
    CONSTRAINT tagihan_sisa_check CHECK (sisa >= 0)
);

CREATE INDEX IF NOT EXISTS tagihan_santri_jatuh_tempo_idx ON tagihan(santri_id, jatuh_tempo);
CREATE INDEX IF NOT EXISTS tagihan_santri_status_idx ON tagihan(santri_id, status);
CREATE INDEX IF NOT EXISTS tagihan_komplek_status_idx ON tagihan(komplek_id, status);

CREATE TABLE IF NOT EXISTS pembayaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    santri_id UUID NOT NULL REFERENCES santri(id) ON DELETE RESTRICT,
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE RESTRICT,
    metode metode_pembayaran NOT NULL,
    nominal BIGINT NOT NULL,
    nominal_diverifikasi BIGINT,
    tanggal_bayar DATE NOT NULL,
    bukti_url TEXT,
    catatan_santri TEXT,
    status status_pembayaran NOT NULL DEFAULT 'menunggu_verifikasi',
    diverifikasi_oleh_id UUID REFERENCES pengguna(id),
    diverifikasi_pada TIMESTAMPTZ,
    alasan_penolakan TEXT,
    is_reversal BOOLEAN NOT NULL DEFAULT false,
    reversal_of_id UUID REFERENCES pembayaran(id),
    alasan_reversal TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pembayaran_santri_status_idx ON pembayaran(santri_id, status);
CREATE INDEX IF NOT EXISTS pembayaran_komplek_status_idx ON pembayaran(komplek_id, status);

CREATE TABLE IF NOT EXISTS alokasi_pembayaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pembayaran_id UUID NOT NULL REFERENCES pembayaran(id) ON DELETE RESTRICT,
    tagihan_id UUID NOT NULL REFERENCES tagihan(id) ON DELETE RESTRICT,
    nominal_alokasi BIGINT NOT NULL,
    alokasi_tabungan BIGINT NOT NULL DEFAULT 0,
    alokasi_operasional BIGINT NOT NULL DEFAULT 0,
    is_reversal BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT alokasi_sum_check CHECK (nominal_alokasi = alokasi_tabungan + alokasi_operasional)
);

CREATE INDEX IF NOT EXISTS alokasi_pembayaran_pembayaran_idx ON alokasi_pembayaran(pembayaran_id);
CREATE INDEX IF NOT EXISTS alokasi_pembayaran_tagihan_idx ON alokasi_pembayaran(tagihan_id);

-- 5. Savings Ledger
CREATE TABLE IF NOT EXISTS ledger_tabungan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    santri_id UUID NOT NULL REFERENCES santri(id) ON DELETE RESTRICT,
    jenis_mutasi jenis_mutasi_tabungan NOT NULL,
    nominal BIGINT NOT NULL,
    referensi_tipe TEXT,
    referensi_id UUID,
    keterangan TEXT NOT NULL,
    dibuat_oleh_id UUID REFERENCES pengguna(id),
    disetujui_oleh_id UUID REFERENCES pengguna(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_santri_idx ON ledger_tabungan(santri_id);
CREATE INDEX IF NOT EXISTS ledger_santri_created_idx ON ledger_tabungan(santri_id, created_at);

-- Invariant Enforcement: Non-negative savings balance trigger
CREATE OR REPLACE FUNCTION check_santri_savings_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_total_balance BIGINT;
BEGIN
    SELECT COALESCE(SUM(nominal), 0) + NEW.nominal
    INTO v_total_balance
    FROM ledger_tabungan
    WHERE santri_id = NEW.santri_id;

    IF v_total_balance < 0 THEN
        RAISE EXCEPTION 'Constraint Violation: Santri % savings balance cannot be negative (would result in %)',
            NEW.santri_id, v_total_balance;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_savings_balance ON ledger_tabungan;
CREATE TRIGGER trg_check_savings_balance
BEFORE INSERT ON ledger_tabungan
FOR EACH ROW
EXECUTE FUNCTION check_santri_savings_balance();

-- 6. Subsidy Tables
CREATE TABLE IF NOT EXISTS aturan_subsidi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tagihan_kegiatan_id UUID NOT NULL REFERENCES tagihan(id) ON DELETE RESTRICT,
    nama TEXT NOT NULL,
    nominal BIGINT NOT NULL,
    syarat_json JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    dibuat_oleh_id UUID REFERENCES pengguna(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aturan_subsidi_tagihan_kegiatan_idx ON aturan_subsidi(tagihan_kegiatan_id);

CREATE TABLE IF NOT EXISTS subsidi_penerima (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aturan_subsidi_id UUID NOT NULL REFERENCES aturan_subsidi(id) ON DELETE RESTRICT,
    santri_id UUID NOT NULL REFERENCES santri(id) ON DELETE RESTRICT,
    tagihan_id UUID NOT NULL REFERENCES tagihan(id) ON DELETE RESTRICT,
    nominal_diterima BIGINT NOT NULL,
    ledger_tabungan_id UUID REFERENCES ledger_tabungan(id),
    diterapkan_pada TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subsidi_rule_santri_uidx ON subsidi_penerima(aturan_subsidi_id, santri_id);
CREATE INDEX IF NOT EXISTS subsidi_penerima_santri_idx ON subsidi_penerima(santri_id);

-- 7. Expenses Tables
CREATE TABLE IF NOT EXISTS kategori_pengeluaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama TEXT NOT NULL UNIQUE,
    deskripsi TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pengeluaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    komplek_id UUID NOT NULL REFERENCES komplek(id) ON DELETE RESTRICT,
    kategori_pengeluaran_id UUID NOT NULL REFERENCES kategori_pengeluaran(id) ON DELETE RESTRICT,
    tanggal DATE NOT NULL,
    nominal BIGINT NOT NULL,
    keterangan TEXT NOT NULL,
    bukti_url TEXT,
    status pengeluaran_status NOT NULL DEFAULT 'aktif',
    dibatalkan_pada TIMESTAMPTZ,
    alasan_batal TEXT,
    dibatalkan_oleh_id UUID REFERENCES pengguna(id),
    dibuat_oleh_id UUID REFERENCES pengguna(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pengeluaran_komplek_tanggal_idx ON pengeluaran(komplek_id, tanggal);

-- 8. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES pengguna(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_user_created_idx ON audit_log(user_id, created_at);
