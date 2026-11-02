-- Migration 0002: Subsidy Enhancements & Schema Compatibility
-- Description: Add 'subsidi' payment method, allow nullable tagihan_kegiatan_id for syahriah rules, and add is_subsidi flags.

-- 1. Extend metode_pembayaran enum to support 'subsidi'
ALTER TYPE metode_pembayaran ADD VALUE IF NOT EXISTS 'subsidi';

-- 2. Allow nullable tagihan_kegiatan_id on aturan_subsidi (for syahriah subsidies)
ALTER TABLE aturan_subsidi ALTER COLUMN tagihan_kegiatan_id DROP NOT NULL;

-- 3. Add is_subsidi column to pembayaran
ALTER TABLE pembayaran ADD COLUMN IF NOT EXISTS is_subsidi BOOLEAN NOT NULL DEFAULT false;

-- 4. Add is_subsidi column to alokasi_pembayaran
ALTER TABLE alokasi_pembayaran ADD COLUMN IF NOT EXISTS is_subsidi BOOLEAN NOT NULL DEFAULT false;

-- 5. Additional index for fast subsidy recipient lookup by rule and santri
CREATE INDEX IF NOT EXISTS idx_subsidi_penerima_rule_santri 
ON subsidi_penerima (aturan_subsidi_id, santri_id);
