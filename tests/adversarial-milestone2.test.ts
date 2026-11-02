import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { getDb } from '../src/client';
import { allocatePayment } from '../src/services/payment-allocation';
import { reversePayment } from '../src/services/reversal';
import { generateBulkSyahriahBills } from '../src/services/billing';
import {
  santri,
  komplek,
  kategori,
  tarifSyahriah,
  tagihan,
  pembayaran,
  alokasiPembayaran,
  ledgerTabungan,
  pengguna,
} from '../src/schema';
import { eq, sql, and, inArray, desc } from 'drizzle-orm';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54329/ponpes_finance';

describe('Adversarial Stress-Testing: Milestone 2 Core Accounting Engines', () => {
  const db = getDb();
  let rawSql: postgres.Sql;

  let testKomplekId: string;
  let testKategoriId: string;
  let adminUserId: string;
  const createdSantriIds: string[] = [];

  beforeAll(async () => {
    rawSql = postgres(TEST_DB_URL, { max: 5 });

    const [k] = await db.select().from(komplek).limit(1);
    const [kat] = await db.select().from(kategori).limit(1);
    const [admin] = await db
      .select()
      .from(pengguna)
      .where(eq(pengguna.role, 'super_admin'))
      .limit(1);

    testKomplekId = k.id;
    testKategoriId = kat.id;
    adminUserId = admin.id;
  });

  afterAll(async () => {
    // Clean up all santri created during testing
    if (createdSantriIds.length > 0) {
      const santriPays = await db
        .select({ id: pembayaran.id })
        .from(pembayaran)
        .where(inArray(pembayaran.santriId, createdSantriIds));
      const payIds = santriPays.map((p) => p.id);

      if (payIds.length > 0) {
        await db
          .delete(alokasiPembayaran)
          .where(inArray(alokasiPembayaran.pembayaranId, payIds));
      }
      await db
        .delete(ledgerTabungan)
        .where(inArray(ledgerTabungan.santriId, createdSantriIds));
      await db
        .delete(pembayaran)
        .where(inArray(pembayaran.santriId, createdSantriIds));
      await db
        .delete(tagihan)
        .where(inArray(tagihan.santriId, createdSantriIds));
      await db
        .delete(santri)
        .where(inArray(santri.id, createdSantriIds));
    }
    await rawSql.end();
  });

  // Helper to create an isolated santri
  async function createTestSantri(nameSuffix: string) {
    const [s] = await db
      .insert(santri)
      .values({
        nis: `ADV-M2-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        nama: `Santri Adv M2 ${nameSuffix}`,
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281234567800',
      })
      .returning();
    createdSantriIds.push(s.id);
    return s;
  }

  // =========================================================================
  // SECTION 1: Partial Installments (Cicilan) & Savings Priority
  // =========================================================================
  describe('1. Partial Installments (Cicilan) & Savings Priority', () => {
    it('ADV-1.1: Cicilan < Rp50.000 (Rp30.000) must allocate 100% to savings and Rp0 to operational', async () => {
      const s = await createTestSantri('Cicilan-1');

      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Januari 2026',
          bulan: 1,
          tahun: 2026,
          jatuhTempo: '2026-01-10',
          nominal: 350000,
          terbayar: 0,
          sisa: 350000,
          status: 'belum_bayar',
        })
        .returning();

      // Pay Rp30.000
      const result = await allocatePayment(db, {
        santriId: s.id,
        nominal: 30000,
        metode: 'tunai',
        tanggalBayar: '2026-01-02',
        adminUserId,
        isCashDesk: true,
      });

      expect(result.totalTabungan).toBe(30000);
      expect(result.totalOperasional).toBe(0);
      expect(result.allocatedBills).toHaveLength(1);
      expect(result.allocatedBills[0].tabunganAllocated).toBe(30000);
      expect(result.allocatedBills[0].operasionalAllocated).toBe(0);
      expect(result.allocatedBills[0].remainingBill).toBe(320000);
      expect(result.allocatedBills[0].status).toBe('sebagian');

      // Verify DB ledger
      const [ledgerRow] = await db
        .select()
        .from(ledgerTabungan)
        .where(eq(ledgerTabungan.referensiId, result.pembayaranId));
      expect(ledgerRow).toBeDefined();
      expect(ledgerRow.nominal).toBe(30000);
      expect(ledgerRow.jenisMutasi).toBe('setoran_syahriah');
    });

    it('ADV-1.2: Subsequent cicilan (Rp40.000) allocates Rp20.000 to cap savings at Rp50.000, and remaining Rp20.000 to operational', async () => {
      const s = await createTestSantri('Cicilan-2');

      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Februari 2026',
          bulan: 2,
          tahun: 2026,
          jatuhTempo: '2026-02-10',
          nominal: 350000,
          terbayar: 0,
          sisa: 350000,
          status: 'belum_bayar',
        })
        .returning();

      // Installment 1: Rp30.000
      await allocatePayment(db, {
        santriId: s.id,
        nominal: 30000,
        metode: 'tunai',
        tanggalBayar: '2026-02-02',
        adminUserId,
      });

      // Installment 2: Rp40.000
      const result2 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 40000,
        metode: 'tunai',
        tanggalBayar: '2026-02-05',
        adminUserId,
      });

      expect(result2.totalTabungan).toBe(20000);
      expect(result2.totalOperasional).toBe(20000);
      expect(result2.allocatedBills[0].tabunganAllocated).toBe(20000);
      expect(result2.allocatedBills[0].operasionalAllocated).toBe(20000);
      expect(result2.allocatedBills[0].remainingBill).toBe(280000);
      expect(result2.allocatedBills[0].status).toBe('sebagian');

      // Installment 3: Rp100.000 -> Savings cap reached, 100% operational
      const result3 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 100000,
        metode: 'transfer',
        tanggalBayar: '2026-02-10',
        adminUserId,
      });

      expect(result3.totalTabungan).toBe(0);
      expect(result3.totalOperasional).toBe(100000);
      expect(result3.allocatedBills[0].remainingBill).toBe(180000);
    });

    it('ADV-1.3: Micro-installments sequence (10k + 15k + 25k + 10k) precisely reaches 50k cap on 3rd payment', async () => {
      const s = await createTestSantri('Micro-Cicilan');

      await db.insert(tagihan).values({
        santriId: s.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Maret 2026',
        bulan: 3,
        tahun: 2026,
        jatuhTempo: '2026-03-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      });

      // P1: 10.000 -> 10k tab, 0 op
      const p1 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 10000,
        metode: 'tunai',
        tanggalBayar: '2026-03-01',
        adminUserId,
      });
      expect(p1.totalTabungan).toBe(10000);
      expect(p1.totalOperasional).toBe(0);

      // P2: 15.000 -> 15k tab, 0 op (cumulative tab = 25k)
      const p2 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 15000,
        metode: 'tunai',
        tanggalBayar: '2026-03-02',
        adminUserId,
      });
      expect(p2.totalTabungan).toBe(15000);
      expect(p2.totalOperasional).toBe(0);

      // P3: 25.000 -> 25k tab, 0 op (cumulative tab = 50k, cap reached!)
      const p3 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 25000,
        metode: 'tunai',
        tanggalBayar: '2026-03-03',
        adminUserId,
      });
      expect(p3.totalTabungan).toBe(25000);
      expect(p3.totalOperasional).toBe(0);

      // P4: 10.000 -> 0 tab, 10k op
      const p4 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 10000,
        metode: 'tunai',
        tanggalBayar: '2026-03-04',
        adminUserId,
      });
      expect(p4.totalTabungan).toBe(0);
      expect(p4.totalOperasional).toBe(10000);
    });

    it('ADV-1.4: Activity bill (tagihan kegiatan) allocates 0% to savings regardless of payment amount', async () => {
      const s = await createTestSantri('Kegiatan');

      await db.insert(tagihan).values({
        santriId: s.id,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Ujian Akhir Semester',
        jatuhTempo: '2026-04-10',
        nominal: 100000,
        terbayar: 0,
        sisa: 100000,
        status: 'belum_bayar',
      });

      const res = await allocatePayment(db, {
        santriId: s.id,
        nominal: 30000,
        metode: 'tunai',
        tanggalBayar: '2026-04-01',
        adminUserId,
      });

      expect(res.totalTabungan).toBe(0);
      expect(res.totalOperasional).toBe(30000);
      expect(res.allocatedBills[0].status).toBe('sebagian');
    });

    it('ADV-1.5: Non-positive payment amount (0 or negative) must reject with descriptive error', async () => {
      const s = await createTestSantri('Negative-Pay');

      await expect(
        allocatePayment(db, {
          santriId: s.id,
          nominal: 0,
          metode: 'tunai',
          tanggalBayar: '2026-01-01',
          adminUserId,
        })
      ).rejects.toThrow(/Nominal pembayaran harus lebih besar dari 0/);

      await expect(
        allocatePayment(db, {
          santriId: s.id,
          nominal: -50000,
          metode: 'transfer',
          tanggalBayar: '2026-01-01',
          adminUserId,
        })
      ).rejects.toThrow(/Nominal pembayaran harus lebih besar dari 0/);
    });
  });

  // =========================================================================
  // SECTION 2: Chronological FIFO Allocation
  // =========================================================================
  describe('2. Chronological FIFO Allocation', () => {
    it('ADV-2.1: Bills from October, November, December inserted out-of-order must be satisfied chronologically (October first, then November, then December)', async () => {
      const s = await createTestSantri('FIFO-Order');

      // Insert December first
      const [billDec] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Desember 2026',
          bulan: 12,
          tahun: 2026,
          jatuhTempo: '2026-12-10',
          nominal: 300000,
          terbayar: 0,
          sisa: 300000,
          status: 'belum_bayar',
        })
        .returning();

      // Insert October second
      const [billOct] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Oktober 2026',
          bulan: 10,
          tahun: 2026,
          jatuhTempo: '2026-10-10',
          nominal: 300000,
          terbayar: 0,
          sisa: 300000,
          status: 'belum_bayar',
        })
        .returning();

      // Insert November third
      const [billNov] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah November 2026',
          bulan: 11,
          tahun: 2026,
          jatuhTempo: '2026-11-10',
          nominal: 300000,
          terbayar: 0,
          sisa: 300000,
          status: 'belum_bayar',
        })
        .returning();

      // Pay Rp450.000:
      // - Must fully pay October (Rp300.000) -> status: lunas
      // - Must partially pay November (Rp150.000) -> status: sebagian
      // - Must leave December untouched (Rp0) -> status: belum_bayar
      const result = await allocatePayment(db, {
        santriId: s.id,
        nominal: 450000,
        metode: 'transfer',
        tanggalBayar: '2026-10-15',
        adminUserId,
      });

      expect(result.allocatedBills).toHaveLength(2);

      // 1st allocated bill MUST be October
      expect(result.allocatedBills[0].tagihanId).toBe(billOct.id);
      expect(result.allocatedBills[0].totalAllocated).toBe(300000);
      expect(result.allocatedBills[0].remainingBill).toBe(0);
      expect(result.allocatedBills[0].status).toBe('lunas');

      // 2nd allocated bill MUST be November
      expect(result.allocatedBills[1].tagihanId).toBe(billNov.id);
      expect(result.allocatedBills[1].totalAllocated).toBe(150000);
      expect(result.allocatedBills[1].remainingBill).toBe(150000);
      expect(result.allocatedBills[1].status).toBe('sebagian');

      // December bill should remain untouched in DB
      const [freshDec] = await db.select().from(tagihan).where(eq(tagihan.id, billDec.id));
      expect(freshDec.terbayar).toBe(0);
      expect(freshDec.sisa).toBe(300000);
      expect(freshDec.status).toBe('belum_bayar');
    });

    it('ADV-2.2: Second payment finishes November and leaves remainder on December', async () => {
      const s = await createTestSantri('FIFO-Step2');

      const [bill1] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Mei 2026',
          bulan: 5,
          tahun: 2026,
          jatuhTempo: '2026-05-10',
          nominal: 200000,
          terbayar: 0,
          sisa: 200000,
          status: 'belum_bayar',
        })
        .returning();

      const [bill2] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Juni 2026',
          bulan: 6,
          tahun: 2026,
          jatuhTempo: '2026-06-10',
          nominal: 200000,
          terbayar: 0,
          sisa: 200000,
          status: 'belum_bayar',
        })
        .returning();

      // Step 1: Pay 250.000 -> Bill 1 fully paid (200k), Bill 2 partially paid (50k)
      await allocatePayment(db, {
        santriId: s.id,
        nominal: 250000,
        metode: 'tunai',
        tanggalBayar: '2026-05-01',
        adminUserId,
      });

      // Step 2: Pay 150.000 -> Bill 2 gets remaining 150k and becomes lunas
      const res2 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 150000,
        metode: 'tunai',
        tanggalBayar: '2026-06-01',
        adminUserId,
      });

      expect(res2.allocatedBills).toHaveLength(1);
      expect(res2.allocatedBills[0].tagihanId).toBe(bill2.id);
      expect(res2.allocatedBills[0].remainingBill).toBe(0);
      expect(res2.allocatedBills[0].status).toBe('lunas');
      // For bill2, savings was already satisfied with 50k in step 1, so step 2 allocates 0 tabungan, 150k operasional
      expect(res2.allocatedBills[0].tabunganAllocated).toBe(0);
      expect(res2.allocatedBills[0].operasionalAllocated).toBe(150000);
    });
  });

  // =========================================================================
  // SECTION 3: Advance Payment Cascade (Bayar di Muka)
  // =========================================================================
  describe('3. Advance Payment Cascade (Bayar di Muka)', () => {
    it('ADV-3.1: Payment exceeding all unpaid bills automatically cascades into sequential future months without losing funds', async () => {
      const s = await createTestSantri('Advance-Single');

      // Create one unpaid bill for January (Rp350.000)
      const [billJan] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Januari 2026',
          bulan: 1,
          tahun: 2026,
          jatuhTempo: '2026-01-10',
          nominal: 350000,
          terbayar: 0,
          sisa: 350000,
          status: 'belum_bayar',
        })
        .returning();

      // Santri pays Rp500.000 (covers Jan Rp350k + Rp150k advance for Feb)
      const res = await allocatePayment(db, {
        santriId: s.id,
        nominal: 500000,
        metode: 'transfer',
        tanggalBayar: '2026-01-05',
        adminUserId,
      });

      expect(res.allocatedBills).toHaveLength(2);

      // Bill 1: Jan lunas
      expect(res.allocatedBills[0].tagihanId).toBe(billJan.id);
      expect(res.allocatedBills[0].status).toBe('lunas');
      expect(res.allocatedBills[0].tabunganAllocated).toBe(50000);
      expect(res.allocatedBills[0].operasionalAllocated).toBe(300000);

      // Bill 2: Advance Feb created automatically!
      const advBill = res.allocatedBills[1];
      expect(advBill.bulan).toBe(2);
      expect(advBill.tahun).toBe(2026);
      expect(advBill.totalAllocated).toBe(150000);
      expect(advBill.tabunganAllocated).toBe(50000); // 50k savings cap for Feb syahriah
      expect(advBill.operasionalAllocated).toBe(100000);
      expect(advBill.status).toBe('sebagian');
      expect(advBill.remainingBill).toBe(200000);

      // Invariant: Total funds allocated exactly equals nominal input
      expect(res.totalTabungan + res.totalOperasional).toBe(500000);
      expect(res.excessCredit).toBe(0);
    });

    it('ADV-3.2: Multi-month advance cascade crossing year boundary (e.g. Nov 2026 to Feb 2027)', async () => {
      const s = await createTestSantri('Advance-YearEnd');

      // Bill for November 2026
      await db.insert(tagihan).values({
        santriId: s.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah November 2026',
        bulan: 11,
        tahun: 2026,
        jatuhTempo: '2026-11-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      });

      // Pay Rp1.150.000:
      // - Nov 2026: Rp350.000 (lunas)
      // - Dec 2026 (advance): Rp350.000 (lunas)
      // - Jan 2027 (advance, rollover year!): Rp350.000 (lunas)
      // - Feb 2027 (advance): Rp100.000 (sebagian, tabungan: 50k, op: 50k)
      // Total = 350k + 350k + 350k + 100k = 1.150.000
      const res = await allocatePayment(db, {
        santriId: s.id,
        nominal: 1150000,
        metode: 'transfer',
        tanggalBayar: '2026-11-05',
        adminUserId,
      });

      expect(res.allocatedBills).toHaveLength(4);

      // Month 11 / Year 2026
      expect(res.allocatedBills[0].bulan).toBe(11);
      expect(res.allocatedBills[0].tahun).toBe(2026);
      expect(res.allocatedBills[0].status).toBe('lunas');

      // Month 12 / Year 2026
      expect(res.allocatedBills[1].bulan).toBe(12);
      expect(res.allocatedBills[1].tahun).toBe(2026);
      expect(res.allocatedBills[1].status).toBe('lunas');

      // Month 1 / Year 2027 (Rollover!)
      expect(res.allocatedBills[2].bulan).toBe(1);
      expect(res.allocatedBills[2].tahun).toBe(2027);
      expect(res.allocatedBills[2].status).toBe('lunas');

      // Month 2 / Year 2027
      expect(res.allocatedBills[3].bulan).toBe(2);
      expect(res.allocatedBills[3].tahun).toBe(2027);
      expect(res.allocatedBills[3].status).toBe('sebagian');
      expect(res.allocatedBills[3].tabunganAllocated).toBe(50000);
      expect(res.allocatedBills[3].operasionalAllocated).toBe(50000);

      expect(res.totalTabungan + res.totalOperasional).toBe(1150000);
      expect(res.excessCredit).toBe(0);
    });

    it('ADV-3.3: Advance payment with NO prior bills generates bill starting from current month', async () => {
      const s = await createTestSantri('Advance-CleanSlate');

      // No bills pre-created for this santri!
      const res = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-07-01',
        adminUserId,
      });

      expect(res.allocatedBills).toHaveLength(1);
      expect(res.allocatedBills[0].status).toBe('lunas');
      expect(res.allocatedBills[0].totalAllocated).toBe(350000);
      expect(res.totalTabungan).toBe(50000);
      expect(res.totalOperasional).toBe(300000);
    });
  });

  // =========================================================================
  // SECTION 4: Reversal Records Invariant (Zero-Delete)
  // =========================================================================
  describe('4. Reversal Records Invariant (Zero-Delete & Guards)', () => {
    it('ADV-4.1: Reversing a payment creates compensating records, restores bill state, and keeps original rows', async () => {
      const s = await createTestSantri('Reversal-Standard');

      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Juli 2026',
          bulan: 7,
          tahun: 2026,
          jatuhTempo: '2026-07-10',
          nominal: 350000,
          terbayar: 0,
          sisa: 350000,
          status: 'belum_bayar',
        })
        .returning();

      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'transfer',
        tanggalBayar: '2026-07-01',
        adminUserId,
      });

      // Reverse payment
      const revRes = await reversePayment(db, {
        pembayaranId: payRes.pembayaranId,
        alasan: 'Bukti transfer santri palsu / editan',
        userId: adminUserId,
      });

      expect(revRes.reversalPembayaranId).toBeDefined();
      expect(revRes.totalNominalDibalik).toBe(350000);
      expect(revRes.totalTabunganDibalik).toBe(50000);
      expect(revRes.totalOperasionalDibalik).toBe(300000);

      // Invariant: Original payment row STILL EXISTS (zero-delete)
      const [origPay] = await db
        .select()
        .from(pembayaran)
        .where(eq(pembayaran.id, payRes.pembayaranId));
      expect(origPay).toBeDefined();

      // Compensating reversal row exists
      const [revPay] = await db
        .select()
        .from(pembayaran)
        .where(eq(pembayaran.id, revRes.reversalPembayaranId));
      expect(revPay.isReversal).toBe(true);
      expect(revPay.reversalOfId).toBe(payRes.pembayaranId);

      // Bill status and sisa restored
      const [restoredBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(restoredBill.terbayar).toBe(0);
      expect(restoredBill.sisa).toBe(350000);
      expect(restoredBill.status).toBe('belum_bayar');

      // Compensating ledger mutation with negative nominal
      const [koreksi] = await db
        .select()
        .from(ledgerTabungan)
        .where(
          and(
            eq(ledgerTabungan.referensiId, revRes.reversalPembayaranId),
            eq(ledgerTabungan.jenisMutasi, 'koreksi')
          )
        );
      expect(koreksi).toBeDefined();
      expect(koreksi.nominal).toBe(-50000);
    });

    it('ADV-4.2: Double-reversal guard: Attempting to reverse an already reversed payment is blocked', async () => {
      const s = await createTestSantri('Double-Rev');

      await db.insert(tagihan).values({
        santriId: s.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Agustus 2026',
        bulan: 8,
        tahun: 2026,
        jatuhTempo: '2026-08-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      });

      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-08-01',
        adminUserId,
      });

      // 1st Reversal succeeds
      await reversePayment(db, {
        pembayaranId: payRes.pembayaranId,
        alasan: 'Kesalahan input bendahara',
        userId: adminUserId,
      });

      // 2nd Reversal MUST FAIL
      await expect(
        reversePayment(db, {
          pembayaranId: payRes.pembayaranId,
          alasan: 'Coba reversal kedua kalinya',
          userId: adminUserId,
        })
      ).rejects.toThrow(/sudah pernah dibatalkan sebelumnya/);
    });

    it('ADV-4.3: Attempting to reverse a reversal payment record is blocked', async () => {
      const s = await createTestSantri('Rev-Of-Rev');

      await db.insert(tagihan).values({
        santriId: s.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah September 2026',
        bulan: 9,
        tahun: 2026,
        jatuhTempo: '2026-09-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      });

      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-09-01',
        adminUserId,
      });

      const revRes = await reversePayment(db, {
        pembayaranId: payRes.pembayaranId,
        alasan: 'Reversal pertama sah',
        userId: adminUserId,
      });

      // Attempting to reverse the reversal itself
      await expect(
        reversePayment(db, {
          pembayaranId: revRes.reversalPembayaranId,
          alasan: 'Membatalkan record pembatalan',
          userId: adminUserId,
        })
      ).rejects.toThrow(/Tidak dapat membatalkan transaksi yang merupakan record reversal/);
    });

    it('ADV-4.4: Reversal input validation: reason < 5 characters is rejected', async () => {
      const s = await createTestSantri('Short-Reason');

      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-09-01',
        adminUserId,
      });

      await expect(
        reversePayment(db, {
          pembayaranId: payRes.pembayaranId,
          alasan: 'abc', // < 5 chars
          userId: adminUserId,
        })
      ).rejects.toThrow(/minimal 5 karakter/);
    });

    it('ADV-4.5: Insufficient balance guard: Cannot reverse if santri already withdrew or spent the savings portion', async () => {
      const s = await createTestSantri('Spent-Savings');

      // Pay 350k -> +50k tabungan
      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-09-01',
        adminUserId,
      });

      // Withdraw the 50k tabungan (balance becomes 0)
      await db.insert(ledgerTabungan).values({
        santriId: s.id,
        jenisMutasi: 'penarikan_mendesak',
        nominal: -50000,
        keterangan: 'Penarikan uang saku mendesak',
        dibuatOlehId: adminUserId,
        disetujuiOlehId: adminUserId,
      });

      // Now attempting reversal must be blocked because balance (0) < savings to reverse (50k)
      await expect(
        reversePayment(db, {
          pembayaranId: payRes.pembayaranId,
          alasan: 'Pembatalan transaksi kemarin',
          userId: adminUserId,
        })
      ).rejects.toThrow(/Saldo tabungan santri saat ini .* tidak mencukupi/);
    });

    it('ADV-4.6: Database foreign key zero-delete verification: Direct hard delete is rejected by ON DELETE RESTRICT', async () => {
      const s = await createTestSantri('FK-Restrict');

      const payRes = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-09-01',
        adminUserId,
      });

      // Direct hard delete on pembayaran should fail due to foreign key in alokasi_pembayaran
      await expect(
        rawSql`DELETE FROM pembayaran WHERE id = ${payRes.pembayaranId}`
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });

  // =========================================================================
  // SECTION 5: Adversarial Flaw Exploration (Post-Reversal Re-Payment Savings Bug)
  // =========================================================================
  describe('5. Adversarial Flaw Exploration: Post-Reversal Re-Payment Savings Allocation', () => {
    it('ADV-5.1: After a payment is reversed and the bill restored to unpaid, paying the bill again MUST allocate Rp50.000 to savings', async () => {
      const s = await createTestSantri('Post-Reversal-Bug-Hunter');

      // 1. Create bill B1
      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: s.id,
          komplekId: testKomplekId,
          tipe: 'syahriah',
          judul: 'Syahriah Uji Bug 2026',
          bulan: 10,
          tahun: 2026,
          jatuhTempo: '2026-10-10',
          nominal: 350000,
          terbayar: 0,
          sisa: 350000,
          status: 'belum_bayar',
        })
        .returning();

      // 2. Pay B1 first time (Rp350.000)
      const pay1 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'transfer',
        tanggalBayar: '2026-10-01',
        adminUserId,
      });
      expect(pay1.totalTabungan).toBe(50000);
      expect(pay1.totalOperasional).toBe(300000);

      // 3. Reverse payment pay1
      const rev = await reversePayment(db, {
        pembayaranId: pay1.pembayaranId,
        alasan: 'Transfer salah rekening bendahara',
        userId: adminUserId,
      });
      expect(rev.totalTabunganDibalik).toBe(50000);

      // Verify bill B1 is back to unpaid
      const [restoredBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(restoredBill.status).toBe('belum_bayar');
      expect(restoredBill.sisa).toBe(350000);
      expect(restoredBill.terbayar).toBe(0);

      // Verify santri current balance is 0
      const [balResult] = await db
        .select({ bal: sql<number>`COALESCE(SUM(nominal), 0)::int` })
        .from(ledgerTabungan)
        .where(eq(ledgerTabungan.santriId, s.id));
      expect(balResult.bal).toBe(0);

      // 4. NOW: Santri pays B1 AGAIN with genuine payment of Rp350.000!
      // Invariant: Since previous payment was reversed and canceled, B1 has 0 net savings allocated.
      // Therefore, this second payment MUST allocate Rp50.000 to savings!
      const pay2 = await allocatePayment(db, {
        santriId: s.id,
        nominal: 350000,
        metode: 'transfer',
        tanggalBayar: '2026-10-05',
        adminUserId,
      });

      // EMPIRICAL ASSERTION:
      // If the code has the `eq(alokasiPembayaran.isReversal, false)` bug,
      // it ignored the -50000 reversal record, thought priorSavings was 50000,
      // and allocated 0 to tabungan and 350000 to operasional!
      expect(pay2.totalTabungan).toBe(50000);
      expect(pay2.totalOperasional).toBe(300000);
      expect(pay2.allocatedBills[0].tabunganAllocated).toBe(50000);
      expect(pay2.allocatedBills[0].operasionalAllocated).toBe(300000);
    });
  });

  // =========================================================================
  // SECTION 6: Bulk Syahriah Billing Engine Invariants
  // =========================================================================
  describe('6. Bulk Syahriah Billing Engine Invariants', () => {
    it('ADV-6.1: Excludes boyong (inactive) santri from bulk billing generation', async () => {
      // Create active santri
      const activeSantri = await createTestSantri('Billing-Active');

      // Create boyong santri
      const [boyongSantri] = await db
        .insert(santri)
        .values({
          nis: `ADV-BOYONG-${Date.now()}`,
          nama: 'Santri Boyong Adv',
          komplekId: testKomplekId,
          kategoriId: testKategoriId,
          tanggalMasuk: '2025-01-01',
          status: 'boyong',
          nomorWhatsapp: '6281234567801',
        })
        .returning();
      createdSantriIds.push(boyongSantri.id);

      const res = await generateBulkSyahriahBills(db, {
        bulan: 11,
        tahun: 2029, // Future year to avoid colliding with seed
        komplekId: testKomplekId,
      });

      expect(res.success).toBe(true);

      // Verify active santri got a bill
      const [activeBill] = await db
        .select()
        .from(tagihan)
        .where(
          and(
            eq(tagihan.santriId, activeSantri.id),
            eq(tagihan.bulan, 11),
            eq(tagihan.tahun, 2029)
          )
        );
      expect(activeBill).toBeDefined();

      // Verify boyong santri did NOT get a bill
      const [boyongBill] = await db
        .select()
        .from(tagihan)
        .where(
          and(
            eq(tagihan.santriId, boyongSantri.id),
            eq(tagihan.bulan, 11),
            eq(tagihan.tahun, 2029)
          )
        );
      expect(boyongBill).toBeUndefined();
    });

    it('ADV-6.2: Idempotency: Running bulk billing twice for same month/year creates 0 duplicates', async () => {
      const s = await createTestSantri('Billing-Idempotent');

      // 1st run
      const res1 = await generateBulkSyahriahBills(db, {
        bulan: 12,
        tahun: 2029,
        komplekId: testKomplekId,
      });
      expect(res1.success).toBe(true);
      expect(res1.newlyBilledCount).toBeGreaterThan(0);

      // 2nd run
      const res2 = await generateBulkSyahriahBills(db, {
        bulan: 12,
        tahun: 2029,
        komplekId: testKomplekId,
      });
      expect(res2.success).toBe(true);
      expect(res2.newlyBilledCount).toBe(0);
      expect(res2.alreadyBilledCount).toBeGreaterThanOrEqual(1);

      // Verify count in DB for this santri is strictly 1
      const bills = await db
        .select()
        .from(tagihan)
        .where(
          and(
            eq(tagihan.santriId, s.id),
            eq(tagihan.bulan, 12),
            eq(tagihan.tahun, 2029)
          )
        );
      expect(bills).toHaveLength(1);
    });

    it('ADV-6.3: Complex scoping: Bendahara scoped to complex A is rejected when attempting to bill complex B', async () => {
      // Query another complex
      const allKompleks = await db.select().from(komplek);
      if (allKompleks.length >= 2) {
        const kA = allKompleks[0].id;
        const kB = allKompleks[1].id;

        await expect(
          generateBulkSyahriahBills(
            db,
            { bulan: 1, tahun: 2030, komplekId: kB },
            { role: 'bendahara_komplek', complexIds: [kA] }
          )
        ).rejects.toThrow(/Akses ditolak/);
      }
    });
  });
});
