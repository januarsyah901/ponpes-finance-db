import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import * as schema from '../src/schema';
import * as validators from '../src/validators';

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54329/ponpes_finance';

describe('Adversarial Stress-Testing: Milestone 1 Deliverables', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(TEST_DB_URL, { max: 5 });
  });

  afterAll(async () => {
    await sql.end();
  });

  // =========================================================================
  // SECTION 1: Database Invariant & Negative Savings Guard
  // =========================================================================
  describe('1. Database Invariant & Negative Savings Guard', () => {
    it('EMP-1.1: Allows positive savings mutation (deposit)', async () => {
      const santriId = '40000000-0000-0000-0000-000000000001'; // Ahmad Fauzi
      const [initialRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      const initialBal = BigInt(initialRow.bal);

      const [inserted] = await sql`
        INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
        VALUES (${santriId}, 'setoran_syahriah', 50000, 'Test positive deposit')
        RETURNING id, nominal;
      `;

      expect(inserted.id).toBeDefined();

      const [newRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      expect(BigInt(newRow.bal)).toBe(initialBal + 50000n);

      // Clean up
      await sql`DELETE FROM ledger_tabungan WHERE id = ${inserted.id}`;
    });

    it('EMP-1.2: Allows withdrawal that preserves non-negative balance', async () => {
      const santriId = '40000000-0000-0000-0000-000000000001';
      const [initialRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      const initialBal = BigInt(initialRow.bal);
      expect(initialBal).toBeGreaterThan(100000n);

      const [inserted] = await sql`
        INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
        VALUES (${santriId}, 'penarikan_mendesak', -50000, 'Test valid partial withdrawal')
        RETURNING id, nominal;
      `;

      expect(inserted.id).toBeDefined();

      const [newRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      expect(BigInt(newRow.bal)).toBe(initialBal - 50000n);

      // Clean up
      await sql`DELETE FROM ledger_tabungan WHERE id = ${inserted.id}`;
    });

    it('EMP-1.3: Allows exact balance zeroing (balance = 0 is non-negative)', async () => {
      const santriId = '40000000-0000-0000-0000-000000000001';
      const [initialRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      const initialBal = BigInt(initialRow.bal);

      const [inserted] = await sql`
        INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
        VALUES (${santriId}, 'penarikan_boyong', ${-Number(initialBal)}, 'Test exact zero balance')
        RETURNING id;
      `;

      const [zeroRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      expect(BigInt(zeroRow.bal)).toBe(0n);

      // Clean up
      await sql`DELETE FROM ledger_tabungan WHERE id = ${inserted.id}`;
    });

    it('EMP-1.4: BLOCKS INSERT that would overdraft savings balance by even 1 Rupiah', async () => {
      const santriId = '40000000-0000-0000-0000-000000000001';
      const [initialRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      const initialBal = BigInt(initialRow.bal);
      const overdraftAmount = -(Number(initialBal) + 1);

      await expect(
        sql`
          INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
          VALUES (${santriId}, 'penarikan_boyong', ${overdraftAmount}, 'Test overdraft by 1 Rupiah');
        `
      ).rejects.toThrow(/Constraint Violation.*savings balance cannot be negative/);
    });

    it('EMP-1.5: BLOCKS negative mutation on a santri with 0 starting balance', async () => {
      const santriId = '40000000-0000-0000-0000-000000000005'; // Siti Aminah (has no initial ledger entries)
      const [initialRow] = await sql`SELECT COALESCE(SUM(nominal), 0)::bigint as bal FROM ledger_tabungan WHERE santri_id = ${santriId}`;
      expect(BigInt(initialRow.bal)).toBe(0n);

      await expect(
        sql`
          INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
          VALUES (${santriId}, 'penarikan_mendesak', -100, 'Test overdraft on 0 balance');
        `
      ).rejects.toThrow(/Constraint Violation.*savings balance cannot be negative/);
    });

    // =======================================================================
    // VULNERABILITY FINDING 1: UPDATE bypasses balance check trigger
    // =======================================================================
    it('EMP-1.6 [VULNERABILITY]: UPDATE mutation on ledger_tabungan bypasses trigger and makes balance negative', async () => {
      const santriId = '40000000-0000-0000-0000-000000000001';
      // Pick a mutation row
      const [row] = await sql`
        SELECT id, nominal FROM ledger_tabungan 
        WHERE santri_id = ${santriId} AND nominal > 0 
        LIMIT 1;
      `;
      expect(row).toBeDefined();

      // Attempt UPDATE that causes total balance to plunge to -10,000,000
      // In a truly guarded immutable ledger, UPDATE should either be prohibited or guarded by the trigger
      await sql`
        UPDATE ledger_tabungan 
        SET nominal = -10000000 
        WHERE id = ${row.id};
      `;

      // Check current balance after UPDATE
      const [corruptedRow] = await sql`
        SELECT COALESCE(SUM(nominal), 0)::bigint as bal 
        FROM ledger_tabungan 
        WHERE santri_id = ${santriId};
      `;
      const corruptedBal = BigInt(corruptedRow.bal);

      // Revert the row to clean up
      await sql`UPDATE ledger_tabungan SET nominal = ${row.nominal} WHERE id = ${row.id};`;

      // The fact that corruptedBal < 0 proves that UPDATE bypasses the BEFORE INSERT trigger!
      expect(corruptedBal).toBeLessThan(0n);
    });

    // =======================================================================
    // VULNERABILITY FINDING 2: DELETE mutation bypasses balance check trigger
    // =======================================================================
    it('EMP-1.7 [VULNERABILITY]: DELETE of credit entry is NOT blocked and causes balance to become negative', async () => {
      // Create a temporary santri to safely test DELETE vulnerability
      const [tempSantri] = await sql`
        INSERT INTO santri (nis, nama, komplek_id, kategori_id, tanggal_masuk, nomor_whatsapp)
        VALUES ('9999001', 'Test Santri Temp', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-01-01', '6281299990001')
        RETURNING id;
      `;

      // 1. Credit 100,000
      const [deposit] = await sql`
        INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
        VALUES (${tempSantri.id}, 'saldo_awal', 100000, 'Initial deposit')
        RETURNING id;
      `;

      // 2. Debit 75,000 (balance is now 25,000)
      const [withdrawal] = await sql`
        INSERT INTO ledger_tabungan (santri_id, jenis_mutasi, nominal, keterangan)
        VALUES (${tempSantri.id}, 'pemakaian_kegiatan', -75000, 'Kegiatan fee')
        RETURNING id;
      `;

      // 3. DELETE the 100,000 deposit. Without deposit, balance becomes -75,000!
      // In an immutable ledger, DELETE must be forbidden!
      await sql`DELETE FROM ledger_tabungan WHERE id = ${deposit.id};`;

      const [balanceRow] = await sql`
        SELECT COALESCE(SUM(nominal), 0)::bigint as bal 
        FROM ledger_tabungan 
        WHERE santri_id = ${tempSantri.id};
      `;
      const currentBal = BigInt(balanceRow.bal);

      // Clean up
      await sql`DELETE FROM ledger_tabungan WHERE santri_id = ${tempSantri.id};`;
      await sql`DELETE FROM santri WHERE id = ${tempSantri.id};`;

      // Proves that DELETE succeeded and drove the balance negative to -75,000
      expect(currentBal).toBe(-75000n);
    });
  });

  // =========================================================================
  // SECTION 2: Excel Import Edge Cases
  // =========================================================================
  describe('2. Excel Import Edge Cases', () => {
    it('EMP-2.1: Detects duplicate NIS occurring within the same import payload', () => {
      const rawRows = [
        { nis: '2026101', nama: 'Santri A', komplek: 'PA1', kategori: 'non_pengurus', nomorWhatsapp: '081234567890' },
        { nis: '2026101', nama: 'Santri B', komplek: 'PA1', kategori: 'non_pengurus', nomorWhatsapp: '081234567891' },
      ];

      // Scan logic as implemented in import action
      const nisCountMap = new Map<string, number[]>();
      rawRows.forEach((row, idx) => {
        const rawNis = row.nis ? String(row.nis).trim() : '';
        if (rawNis) {
          const existing = nisCountMap.get(rawNis) || [];
          existing.push(idx + 2);
          nisCountMap.set(rawNis, existing);
        }
      });

      const duplicates = Array.from(nisCountMap.entries()).filter(([_, rows]) => rows.length > 1);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0][0]).toBe('2026101');
      expect(duplicates[0][1]).toEqual([2, 3]);
    });

    it('EMP-2.2: Detects duplicate NIS matching existing records in database', async () => {
      const incomingNis = '2024001'; // Ahmad Fauzi exists in database seed
      const [existing] = await sql`SELECT nis FROM santri WHERE nis = ${incomingNis}`;
      expect(existing).toBeDefined();
      expect(existing.nis).toBe(incomingNis);
    });

    it('EMP-2.3: Rejects missing required columns (NIS, Nama, Komplek)', () => {
      // 1. Missing NIS
      const missingNis = {
        nis: '',
        nama: 'Ahmad Fauzi',
        komplekKode: 'PA1',
        kategoriKode: 'non_pengurus',
        tanggalMasuk: '2026-07-01',
        nomorWhatsapp: '6281234567890',
      };
      const r1 = validators.SantriImportRowSchema.safeParse(missingNis);
      expect(r1.success).toBe(false);

      // 2. Missing Nama
      const missingNama = {
        nis: '2026002',
        nama: '',
        komplekKode: 'PA1',
        kategoriKode: 'non_pengurus',
        tanggalMasuk: '2026-07-01',
        nomorWhatsapp: '6281234567890',
      };
      const r2 = validators.SantriImportRowSchema.safeParse(missingNama);
      expect(r2.success).toBe(false);

      // 3. Missing Komplek
      const missingKomplek = {
        nis: '2026003',
        nama: 'Ahmad Fauzi',
        komplekKode: '',
        kategoriKode: 'non_pengurus',
        tanggalMasuk: '2026-07-01',
        nomorWhatsapp: '6281234567890',
      };
      const r3 = validators.SantriImportRowSchema.safeParse(missingKomplek);
      expect(r3.success).toBe(false);

      // 4. Missing Kategori
      const missingKategori = {
        nis: '2026004',
        nama: 'Ahmad Fauzi',
        komplekKode: 'PA1',
        kategoriKode: 'invalid_kat',
        tanggalMasuk: '2026-07-01',
        nomorWhatsapp: '6281234567890',
      };
      const r4 = validators.SantriImportRowSchema.safeParse(missingKategori);
      expect(r4.success).toBe(false);
    });

    it('EMP-2.4: Stress-tests malformed date handling', () => {
      // Malformed date strings
      const malformedDates = ['invalid-date', 'not_a_date', '31/12/2026', '2026-99-99', '2026/01/01'];

      for (const d of malformedDates) {
        const row = {
          nis: '2026005',
          nama: 'Ahmad Fauzi',
          komplekKode: 'PA1',
          kategoriKode: 'non_pengurus',
          tanggalMasuk: d,
          nomorWhatsapp: '6281234567890',
        };
        const parsed = validators.SantriImportRowSchema.safeParse(row);
        // Schema requires strict YYYY-MM-DD
        expect(parsed.success).toBe(false);
      }
    });

    // =======================================================================
    // VULNERABILITY FINDING 3: validateExcelRowsAction silently defaults
    // malformed dates to today's date instead of raising an error!
    // =======================================================================
    it('EMP-2.5 [VULNERABILITY]: validateExcelRowsAction silently swallows "invalid-date" and substitutes today', () => {
      // Emulate validateExcelRowsAction date parsing logic
      function parseTanggalMasuk(rawDateInput: any): string {
        let tanggalMasukStr = '';
        if (rawDateInput) {
          const rawDate = String(rawDateInput).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            tanggalMasukStr = rawDate;
          } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
            const [d, m, y] = rawDate.split('/');
            tanggalMasukStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          } else if (!isNaN(Number(rawDate))) {
            const dateObj = new Date(Math.round((Number(rawDate) - 25569) * 86400 * 1000));
            if (!isNaN(dateObj.getTime())) {
              tanggalMasukStr = dateObj.toISOString().split('T')[0];
            }
          }
        }
        if (!tanggalMasukStr) {
          tanggalMasukStr = new Date().toISOString().split('T')[0]; // Default to today
        }
        return tanggalMasukStr;
      }

      // Input is explicitly garbage/malformed
      const garbageDate = 'invalid-garbage-date';
      const parsedDate = parseTanggalMasuk(garbageDate);
      const todayStr = new Date().toISOString().split('T')[0];

      // Proves that bad date was NOT rejected with an error; it silently defaulted to today!
      expect(parsedDate).toBe(todayStr);
    });

    // =======================================================================
    // VULNERABILITY FINDING 4: validateExcelRowsAction produces "9999-99-99"
    // on "99/99/9999" which crashes Postgres on insert!
    // =======================================================================
    it('EMP-2.6 [VULNERABILITY]: validateExcelRowsAction accepts "99/99/9999" into "9999-99-99" which crashes Postgres', async () => {
      const rawDate = '99/99/9999';
      // The DD/MM/YYYY branch turns this into:
      const [d, m, y] = rawDate.split('/');
      const tanggalMasukStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      expect(tanggalMasukStr).toBe('9999-99-99');

      // Attempting to insert this into PostgreSQL date column fails!
      await expect(
        sql`SELECT '9999-99-99'::date;`
      ).rejects.toThrow(/date\/time field value out of range/);
    });
  });

  // =========================================================================
  // SECTION 3: Syahriah Rate Matrix Verification
  // =========================================================================
  describe('3. Syahriah Rate Matrix Verification', () => {
    it('EMP-3.1: Complete coverage for all 6 complexes x 3 categories (18 active rates)', async () => {
      const complexes = await sql`SELECT id, kode, nama FROM komplek ORDER BY kode`;
      const categories = await sql`SELECT id, kode, nama FROM kategori ORDER BY kode`;

      expect(complexes.length).toBe(6);
      expect(categories.length).toBe(3);

      const rates = await sql`
        SELECT 
          t.id,
          k.kode as komplek_kode,
          c.kode as kategori_kode,
          t.nominal,
          t.alokasi_tabungan,
          t.alokasi_operasional,
          t.is_active
        FROM tarif_syahriah t
        JOIN komplek k ON t.komplek_id = k.id
        JOIN kategori c ON t.kategori_id = c.id
        WHERE t.is_active = true;
      `;

      expect(rates.length).toBe(18);

      // Verify every (complex, category) pair exists
      for (const k of complexes) {
        for (const c of categories) {
          const match = rates.find(r => r.komplek_kode === k.kode && r.kategori_kode === c.kode);
          expect(match).toBeDefined();
        }
      }
    });

    it('EMP-3.2: Invariant check: All rates satisfy Rp50.000 fixed savings allocation & sum equality', async () => {
      const rates = await sql`
        SELECT nominal, alokasi_tabungan, alokasi_operasional 
        FROM tarif_syahriah 
        WHERE is_active = true;
      `;

      expect(rates.length).toBe(18);

      for (const r of rates) {
        // Strict invariant: fixed Rp50.000 savings
        expect(Number(r.alokasi_tabungan)).toBe(50000);
        // Strict invariant: nominal = alokasi_tabungan + alokasi_operasional
        expect(Number(r.nominal)).toBe(Number(r.alokasi_tabungan) + Number(r.alokasi_operasional));
        // Strict invariant: operasional is non-negative
        expect(Number(r.alokasi_operasional)).toBeGreaterThanOrEqual(0);
      }
    });

    it('EMP-3.3: Mbak Ndalem rate satisfies the Rp50.000 fixed savings allocation (100% savings, 0 operational)', async () => {
      const ndalemRates = await sql`
        SELECT 
          k.kode as komplek_kode,
          c.kode as kategori_kode,
          t.nominal,
          t.alokasi_tabungan,
          t.alokasi_operasional
        FROM tarif_syahriah t
        JOIN komplek k ON t.komplek_id = k.id
        JOIN kategori c ON t.kategori_id = c.id
        WHERE t.is_active = true AND c.kode = 'mbak_ndalem';
      `;

      // 6 complexes with mbak_ndalem
      expect(ndalemRates.length).toBe(6);

      for (const r of ndalemRates) {
        expect(Number(r.nominal)).toBe(50000);
        expect(Number(r.alokasi_tabungan)).toBe(50000);
        expect(Number(r.alokasi_operasional)).toBe(0);
      }
    });

    it('EMP-3.4: Rate update validator enforces minimum Rp50.000 limit', () => {
      const invalidBelow50k = {
        komplekId: '10000000-0000-0000-0000-000000000001',
        kategoriId: '20000000-0000-0000-0000-000000000001',
        nominal: 49999, // Below minimum 50,000
        berlakuMulai: '2026-02-01',
      };
      const res = validators.TarifUpdateSchema.safeParse(invalidBelow50k);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors[0].message).toContain('minimal Rp50.000');
      }

      const validAt50k = {
        komplekId: '10000000-0000-0000-0000-000000000001',
        kategoriId: '20000000-0000-0000-0000-000000000001',
        nominal: 50000,
        berlakuMulai: '2026-02-01',
      };
      expect(validators.TarifUpdateSchema.safeParse(validAt50k).success).toBe(true);
    });
  });
});
