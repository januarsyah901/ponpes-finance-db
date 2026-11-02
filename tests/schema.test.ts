import { describe, it, expect } from 'vitest';
import * as schema from '../src/schema';
import * as validators from '../src/validators';
import * as fs from 'fs';
import * as path from 'path';

describe('Schema & Validator Definitions', () => {
  it('should export all 15 tables and relations', () => {
    expect(schema.pengguna).toBeDefined();
    expect(schema.penggunaKomplek).toBeDefined();
    expect(schema.komplek).toBeDefined();
    expect(schema.kategori).toBeDefined();
    expect(schema.santri).toBeDefined();
    expect(schema.tarifSyahriah).toBeDefined();
    expect(schema.tagihan).toBeDefined();
    expect(schema.pembayaran).toBeDefined();
    expect(schema.alokasiPembayaran).toBeDefined();
    expect(schema.ledgerTabungan).toBeDefined();
    expect(schema.aturanSubsidi).toBeDefined();
    expect(schema.subsidiPenerima).toBeDefined();
    expect(schema.kategoriPengeluaran).toBeDefined();
    expect(schema.pengeluaran).toBeDefined();
    expect(schema.auditLog).toBeDefined();
  });

  it('should export relations for core entities', () => {
    expect(schema.penggunaRelations).toBeDefined();
    expect(schema.penggunaKomplekRelations).toBeDefined();
    expect(schema.komplekRelations).toBeDefined();
    expect(schema.kategoriRelations).toBeDefined();
    expect(schema.santriRelations).toBeDefined();
    expect(schema.tarifSyahriahRelations).toBeDefined();
    expect(schema.tagihanRelations).toBeDefined();
    expect(schema.pembayaranRelations).toBeDefined();
    expect(schema.alokasiPembayaranRelations).toBeDefined();
    expect(schema.ledgerTabunganRelations).toBeDefined();
    expect(schema.aturanSubsidiRelations).toBeDefined();
    expect(schema.subsidiPenerimaRelations).toBeDefined();
    expect(schema.kategoriPengeluaranRelations).toBeDefined();
    expect(schema.pengeluaranRelations).toBeDefined();
    expect(schema.auditLogRelations).toBeDefined();
  });

  it('should validate valid excel import row', () => {
    const validRow = {
      nis: '2024001',
      nama: 'Ahmad Fauzi',
      komplekKode: 'PA1',
      kategoriKode: 'non_pengurus',
      tanggalMasuk: '2024-07-15',
      nomorWhatsapp: '6281234567890',
      saldoAwalTabungan: 500000,
    };
    const parsed = validators.SantriImportRowSchema.safeParse(validRow);
    expect(parsed.success).toBe(true);
  });

  it('should reject payment verification rejection without reason', () => {
    const invalidVerification = {
      pembayaranId: '10000000-0000-0000-0000-000000000001',
      status: 'ditolak',
    };
    const parsed = validators.PaymentVerifySchema.safeParse(invalidVerification);
    expect(parsed.success).toBe(false);
  });

  it('should accept payment verification rejection with reason', () => {
    const validRejection = {
      pembayaranId: '10000000-0000-0000-0000-000000000001',
      status: 'ditolak',
      alasanPenolakan: 'Bukti transfer tidak terbaca',
    };
    const parsed = validators.PaymentVerifySchema.safeParse(validRejection);
    expect(parsed.success).toBe(true);
  });

  it('should enforce positive integer for cash payments', () => {
    const invalidCash = {
      santriId: '10000000-0000-0000-0000-000000000001',
      nominal: -50000,
      tanggalBayar: '2026-11-02',
    };
    const parsed = validators.CashPaymentCreateSchema.safeParse(invalidCash);
    expect(parsed.success).toBe(false);
  });

  it('should enforce minimum rate of Rp50.000 for tarif syahriah', () => {
    const invalidTarif = {
      komplekId: '10000000-0000-0000-0000-000000000001',
      kategoriId: '20000000-0000-0000-0000-000000000001',
      nominal: 40000, // Below 50.000 min
      berlakuMulai: '2026-01-01',
    };
    const parsed = validators.TarifUpdateSchema.safeParse(invalidTarif);
    expect(parsed.success).toBe(false);

    const validTarif = {
      komplekId: '10000000-0000-0000-0000-000000000001',
      kategoriId: '20000000-0000-0000-0000-000000000001',
      nominal: 350000,
      berlakuMulai: '2026-01-01',
    };
    expect(validators.TarifUpdateSchema.safeParse(validTarif).success).toBe(true);
  });

  it('should verify migration SQL file exists and contains trigger check_santri_savings_balance', () => {
    const migrationPath = path.resolve(__dirname, '../supabase/migrations/0001_initial_schema.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('check_santri_savings_balance');
    expect(content).toContain('CREATE TRIGGER trg_check_savings_balance');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS ledger_tabungan');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS santri');
  });

  it('should verify seed SQL file exists and contains essential Indonesian pesantren test data', () => {
    const seedPath = path.resolve(__dirname, '../supabase/seed.sql');
    expect(fs.existsSync(seedPath)).toBe(true);
    const content = fs.readFileSync(seedPath, 'utf-8');
    expect(content).toContain('PA1');
    expect(content).toContain('PI1');
    expect(content).toContain('non_pengurus');
    expect(content).toContain('pengurus');
    expect(content).toContain('mbak_ndalem');
    expect(content).toContain('Ahmad Fauzi');
    expect(content).toContain('50000'); // fixed savings
  });
});
