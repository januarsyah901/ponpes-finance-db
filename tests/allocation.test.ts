import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/client';
import { allocatePayment } from '../src/services/payment-allocation';
import { reversePayment } from '../src/services/reversal';
import {
  santri,
  komplek,
  kategori,
  tagihan,
  pembayaran,
  alokasiPembayaran,
  ledgerTabungan,
  pengguna,
} from '../src/schema';
import { eq, sql, and } from 'drizzle-orm';

describe('Atomic Payment Allocation & Reversal Services', () => {
  const db = getDb();
  let testKomplekId: string;
  let testKategoriId: string;
  let testSantriId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const [k] = await db.select().from(komplek).limit(1);
    const [kat] = await db.select().from(kategori).limit(1);
    const [admin] = await db.select().from(pengguna).where(eq(pengguna.role, 'super_admin')).limit(1);
    testKomplekId = k.id;
    testKategoriId = kat.id;
    adminUserId = admin.id;

    const [s] = await db
      .insert(santri)
      .values({
        nis: `TEST-ALLOC-${Date.now()}`,
        nama: 'Santri Test Allocation',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281234567899',
      })
      .returning();
    testSantriId = s.id;
  });

  afterAll(async () => {
    // Clean up all related records
    await db.delete(alokasiPembayaran).where(
      sql`${alokasiPembayaran.pembayaranId} IN (SELECT id FROM pembayaran WHERE santri_id = ${testSantriId})`
    );
    await db.delete(ledgerTabungan).where(eq(ledgerTabungan.santriId, testSantriId));
    await db.delete(pembayaran).where(eq(pembayaran.santriId, testSantriId));
    await db.delete(tagihan).where(eq(tagihan.santriId, testSantriId));
    await db.delete(santri).where(eq(santri.id, testSantriId));
  });

  it('allocates full syahriah payment: strict Rp50.000 to tabungan, remainder to operasional', async () => {
    // 1. Create a syahriah bill of Rp350.000
    const [bill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Test Full',
        bulan: 1,
        tahun: 2026,
        jatuhTempo: '2026-01-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      })
      .returning();

    // 2. Allocate payment of Rp350.000
    const result = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 350000,
      metode: 'transfer',
      tanggalBayar: '2026-01-05',
      adminUserId,
    });

    expect(result.pembayaranId).toBeDefined();
    expect(result.totalTabungan).toBe(50000);
    expect(result.totalOperasional).toBe(300000);
    expect(result.allocatedBills.length).toBe(1);

    const allocBill = result.allocatedBills[0];
    expect(allocBill.tagihanId).toBe(bill.id);
    expect(allocBill.tabunganAllocated).toBe(50000);
    expect(allocBill.operasionalAllocated).toBe(300000);
    expect(allocBill.remainingBill).toBe(0);
    expect(allocBill.status).toBe('lunas');

    // 3. Verify bill in database
    const [updatedBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
    expect(updatedBill.terbayar).toBe(350000);
    expect(updatedBill.sisa).toBe(0);
    expect(updatedBill.status).toBe('lunas');

    // 4. Verify ledger mutation
    const [ledgerEntry] = await db
      .select()
      .from(ledgerTabungan)
      .where(
        and(
          eq(ledgerTabungan.santriId, testSantriId),
          eq(ledgerTabungan.referensiId, result.pembayaranId)
        )
      );
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.nominal).toBe(50000);
    expect(ledgerEntry.jenisMutasi).toBe('setoran_syahriah');
  });

  it('handles partial payment (cicilan < Rp50k): 100% to tabungan, status sebagian', async () => {
    // Create bill for month 2
    const [bill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Test Cicilan',
        bulan: 2,
        tahun: 2026,
        jatuhTempo: '2026-02-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      })
      .returning();

    // Cicilan 1: Pay Rp30.000
    const result1 = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 30000,
      metode: 'tunai',
      tanggalBayar: '2026-02-01',
      adminUserId,
      isCashDesk: true,
    });

    expect(result1.totalTabungan).toBe(30000);
    expect(result1.totalOperasional).toBe(0);
    expect(result1.allocatedBills[0].status).toBe('sebagian');
    expect(result1.allocatedBills[0].remainingBill).toBe(320000);

    // Cicilan 2: Pay Rp40.000 (should cap tabungan at remaining 20.000, 20.000 to operasional)
    const result2 = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 40000,
      metode: 'tunai',
      tanggalBayar: '2026-02-05',
      adminUserId,
      isCashDesk: true,
    });

    expect(result2.totalTabungan).toBe(20000);
    expect(result2.totalOperasional).toBe(20000);
    expect(result2.allocatedBills[0].status).toBe('sebagian');
    expect(result2.allocatedBills[0].remainingBill).toBe(280000);

    // Cicilan 3: Pay Rp280.000 (savings already reached Rp50k, so 100% to operasional)
    const result3 = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 280000,
      metode: 'tunai',
      tanggalBayar: '2026-02-10',
      adminUserId,
      isCashDesk: true,
    });

    expect(result3.totalTabungan).toBe(0);
    expect(result3.totalOperasional).toBe(280000);
    expect(result3.allocatedBills[0].status).toBe('lunas');
    expect(result3.allocatedBills[0].remainingBill).toBe(0);
  });

  it('allocates payment across multiple unpaid bills using FIFO order', async () => {
    // Create two bills
    const [billA] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
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
      })
      .returning();

    const [billB] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah April 2026',
        bulan: 4,
        tahun: 2026,
        jatuhTempo: '2026-04-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      })
      .returning();

    // Pay Rp500.000 (settles Bill A completely Rp350k, and partially settles Bill B Rp150k)
    const result = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 500000,
      metode: 'transfer',
      tanggalBayar: '2026-03-01',
      adminUserId,
    });

    expect(result.allocatedBills.length).toBe(2);

    // Oldest bill (Maret) fully paid
    const billAResult = result.allocatedBills.find((b) => b.tagihanId === billA.id);
    expect(billAResult).toBeDefined();
    expect(billAResult!.status).toBe('lunas');
    expect(billAResult!.totalAllocated).toBe(350000);
    expect(billAResult!.tabunganAllocated).toBe(50000);
    expect(billAResult!.operasionalAllocated).toBe(300000);

    // Newer bill (April) partially paid
    const billBResult = result.allocatedBills.find((b) => b.tagihanId === billB.id);
    expect(billBResult).toBeDefined();
    expect(billBResult!.status).toBe('sebagian');
    expect(billBResult!.totalAllocated).toBe(150000);
    expect(billBResult!.tabunganAllocated).toBe(50000);
    expect(billBResult!.operasionalAllocated).toBe(100000);
    expect(billBResult!.remainingBill).toBe(200000);
  });

  it('allocates 100% to operasional for activity bills (tagihan kegiatan)', async () => {
    const [kegiatanBill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Tagihan Kegiatan Haflah',
        bulan: null,
        tahun: 2026,
        jatuhTempo: '2026-01-01',
        nominal: 150000,
        terbayar: 0,
        sisa: 150000,
        status: 'belum_bayar',
      })
      .returning();

    const result = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 150000,
      metode: 'tunai',
      tanggalBayar: '2026-05-01',
      adminUserId,
    });

    const alloc = result.allocatedBills.find((b) => b.tagihanId === kegiatanBill.id);
    expect(alloc).toBeDefined();
    expect(alloc!.tabunganAllocated).toBe(0);
    expect(alloc!.operasionalAllocated).toBe(150000);
    expect(alloc!.status).toBe('lunas');
  });

  it('reverses a verified payment cleanly with zero-delete policy and compensating entries', async () => {
    // 1. Create a bill and pay it
    const [bill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Juni 2026',
        bulan: 6,
        tahun: 2026,
        jatuhTempo: '2026-06-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      })
      .returning();

    const paymentResult = await allocatePayment(db, {
      santriId: testSantriId,
      nominal: 350000,
      metode: 'transfer',
      tanggalBayar: '2026-06-01',
      adminUserId,
    });

    const targetPembayaranId = paymentResult.pembayaranId;

    // 2. Reverse the payment
    const reversalResult = await reversePayment(db, {
      pembayaranId: targetPembayaranId,
      alasan: 'Salah transfer rekening pondok',
      userId: adminUserId,
    });

    expect(reversalResult.reversalPembayaranId).toBeDefined();
    expect(reversalResult.originalPembayaranId).toBe(targetPembayaranId);
    expect(reversalResult.totalNominalDibalik).toBe(350000);
    expect(reversalResult.totalTabunganDibalik).toBe(50000);
    expect(reversalResult.totalOperasionalDibalik).toBe(300000);

    // 3. Verify original payment record is untouched (zero hard deletes)
    const [origPay] = await db
      .select()
      .from(pembayaran)
      .where(eq(pembayaran.id, targetPembayaranId));
    expect(origPay).toBeDefined();

    // 4. Verify compensating payment record
    const [compPay] = await db
      .select()
      .from(pembayaran)
      .where(eq(pembayaran.id, reversalResult.reversalPembayaranId));
    expect(compPay.isReversal).toBe(true);
    expect(compPay.reversalOfId).toBe(targetPembayaranId);

    // 5. Verify bill balance restored to unpaid
    const [restoredBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
    expect(restoredBill.terbayar).toBe(0);
    expect(restoredBill.sisa).toBe(350000);
    expect(restoredBill.status).toBe('belum_bayar');

    // 6. Verify compensating ledger entry (jenis_mutasi = 'koreksi', negative nominal)
    const [koreksiEntry] = await db
      .select()
      .from(ledgerTabungan)
      .where(
        and(
          eq(ledgerTabungan.referensiId, reversalResult.reversalPembayaranId),
          eq(ledgerTabungan.jenisMutasi, 'koreksi')
        )
      );
    expect(koreksiEntry).toBeDefined();
    expect(koreksiEntry.nominal).toBe(-50000);

    // 7. Attempt double reversal should fail
    await expect(
      reversePayment(db, {
        pembayaranId: targetPembayaranId,
        alasan: 'Mencoba pembatalan ganda',
        userId: adminUserId,
      })
    ).rejects.toThrow(/sudah pernah dibatalkan/);
  });
});
