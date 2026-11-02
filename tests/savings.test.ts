import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/client';
import {
  getSantriSavingsBalance,
  getSantriSavingsHistory,
  recordSavingsInitialBalance,
  recordSavingsWithdrawal,
  payEventBillFromSavings,
  recordSavingsCorrection,
  InsufficientSavingsBalanceError,
  InvalidBillForSavingsPaymentError,
  SantriNotFoundError,
} from '../src/services/savings';
import { createEventBills, cancelEventBill } from '../src/services/event-billing';
import {
  santri,
  komplek,
  kategori,
  tagihan,
  ledgerTabungan,
  pengguna,
  auditLog,
} from '../src/schema';
import { eq, sql } from 'drizzle-orm';

describe('Savings Ledger & Event Billing Services', () => {
  const db = getDb();
  let testKomplekId: string;
  let testKategoriId: string;
  let adminUserId: string;
  let testSantriId: string;
  let otherSantriId: string;

  beforeAll(async () => {
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

    // Create test santri 1
    const [s1] = await db
      .insert(santri)
      .values({
        nis: `TEST-SAV-${Date.now()}-1`,
        nama: 'Santri Test Savings 1',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2025-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281112223331',
      })
      .returning();
    testSantriId = s1.id;

    // Create test santri 2
    const [s2] = await db
      .insert(santri)
      .values({
        nis: `TEST-SAV-${Date.now()}-2`,
        nama: 'Santri Test Savings 2',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2025-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281112223332',
      })
      .returning();
    otherSantriId = s2.id;
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(auditLog).where(
      sql`${auditLog.userId} = ${adminUserId} AND ${auditLog.createdAt} >= NOW() - INTERVAL '1 hour'`
    );
    await db.delete(ledgerTabungan).where(
      sql`${ledgerTabungan.santriId} IN (${testSantriId}, ${otherSantriId})`
    );
    await db.delete(tagihan).where(
      sql`${tagihan.santriId} IN (${testSantriId}, ${otherSantriId})`
    );
    await db.delete(santri).where(
      sql`${santri.id} IN (${testSantriId}, ${otherSantriId})`
    );
  });

  it('SAV-1.1: computes strictly derived balance SUM(nominal) across multiple mutations', async () => {
    // Starts with 0 balance
    const initialBal = await getSantriSavingsBalance(testSantriId);
    expect(initialBal).toBe(0);

    // Initial balance credit
    await recordSavingsInitialBalance({
      santriId: testSantriId,
      nominal: 200000,
      keterangan: 'Opening balance',
      adminId: adminUserId,
    });

    // Syahriah credit
    await db.insert(ledgerTabungan).values({
      santriId: testSantriId,
      jenisMutasi: 'setoran_syahriah',
      nominal: 50000,
      referensiTipe: 'pembayaran',
      keterangan: 'Syahriah allocation',
      dibuatOlehId: adminUserId,
    });

    const balance = await getSantriSavingsBalance(testSantriId);
    expect(balance).toBe(250000);

    // Verify history
    const history = await getSantriSavingsHistory(testSantriId);
    expect(history.currentBalance).toBe(250000);
    expect(history.totalCredits).toBe(250000);
    expect(history.totalDebits).toBe(0);
    expect(history.mutasi.length).toBe(2);
  });

  it('SAV-1.2: processes penarikan_mendesak with valid balance', async () => {
    const balBefore = await getSantriSavingsBalance(testSantriId);

    const withdrawal = await recordSavingsWithdrawal({
      santriId: testSantriId,
      nominal: 50000,
      jenis: 'penarikan_mendesak',
      alasan: 'Keperluan medis darurat santri',
      adminId: adminUserId,
    });

    expect(withdrawal.nominalDitarik).toBe(50000);
    expect(withdrawal.saldoSebelum).toBe(balBefore);
    expect(withdrawal.saldoSesudah).toBe(balBefore - 50000);

    const balAfter = await getSantriSavingsBalance(testSantriId);
    expect(balAfter).toBe(balBefore - 50000);
  });

  it('SAV-1.4: settles event bill directly from savings (payEventBillFromSavings)', async () => {
    // Create an event bill
    const [eventBill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Ujian Akhir Semester',
        jatuhTempo: '2026-12-31',
        nominal: 100000,
        terbayar: 0,
        sisa: 100000,
        status: 'belum_bayar',
      })
      .returning();

    const balBefore = await getSantriSavingsBalance(testSantriId);

    const settlement = await payEventBillFromSavings({
      santriId: testSantriId,
      tagihanId: eventBill.id,
      nominal: 100000,
      adminId: adminUserId,
      catatan: 'Bayar ujian dari tabungan',
    });

    expect(settlement.nominalDibayar).toBe(100000);
    expect(settlement.tagihanSisaBaru).toBe(0);
    expect(settlement.tagihanStatusBaru).toBe('lunas');
    expect(settlement.saldoSesudah).toBe(balBefore - 100000);

    // Verify tagihan in DB
    const [updatedBill] = await db.select().from(tagihan).where(eq(tagihan.id, eventBill.id));
    expect(updatedBill.status).toBe('lunas');
    expect(Number(updatedBill.sisa)).toBe(0);
    expect(Number(updatedBill.terbayar)).toBe(100000);
  });

  it('SAV-1.5: partial payment of event bill from savings', async () => {
    const [eventBill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Wisuda Santri',
        jatuhTempo: '2026-12-31',
        nominal: 80000,
        terbayar: 0,
        sisa: 80000,
        status: 'belum_bayar',
      })
      .returning();

    const settlement = await payEventBillFromSavings({
      santriId: testSantriId,
      tagihanId: eventBill.id,
      nominal: 30000,
      adminId: adminUserId,
    });

    expect(settlement.nominalDibayar).toBe(30000);
    expect(settlement.tagihanSisaBaru).toBe(50000);
    expect(settlement.tagihanStatusBaru).toBe('sebagian');
  });

  it('SAV-1.6: records positive and negative corrections (recordSavingsCorrection)', async () => {
    const balBefore = await getSantriSavingsBalance(testSantriId);

    // Credit correction
    const c1 = await recordSavingsCorrection({
      santriId: testSantriId,
      nominal: 20000,
      alasan: 'Penyesuaian lebih bayar',
      adminId: adminUserId,
    });
    expect(c1.saldoSesudah).toBe(balBefore + 20000);

    // Debit correction
    const c2 = await recordSavingsCorrection({
      santriId: testSantriId,
      nominal: -10000,
      alasan: 'Penyesuaian salah catat',
      adminId: adminUserId,
    });
    expect(c2.saldoSesudah).toBe(balBefore + 10000);
  });

  it('SAV-2.1: rejects withdrawal when amount exceeds current balance', async () => {
    const bal = await getSantriSavingsBalance(testSantriId);
    await expect(
      recordSavingsWithdrawal({
        santriId: testSantriId,
        nominal: bal + 500000,
        jenis: 'penarikan_mendesak',
        alasan: 'Penarikan melebihi saldo',
        adminId: adminUserId,
      })
    ).rejects.toThrow(InsufficientSavingsBalanceError);
  });

  it('SAV-2.3: rejects payEventBillFromSavings on syahriah bill', async () => {
    const [syahriahBill] = await db
      .insert(tagihan)
      .values({
        santriId: testSantriId,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Desember 2026',
        bulan: 12,
        tahun: 2026,
        jatuhTempo: '2026-12-10',
        nominal: 350000,
        terbayar: 0,
        sisa: 350000,
        status: 'belum_bayar',
      })
      .returning();

    await expect(
      payEventBillFromSavings({
        santriId: testSantriId,
        tagihanId: syahriahBill.id,
        adminId: adminUserId,
      })
    ).rejects.toThrow(InvalidBillForSavingsPaymentError);
  });

  it('SAV-2.5: rejects payment on bill belonging to another santri', async () => {
    const [otherBill] = await db
      .insert(tagihan)
      .values({
        santriId: otherSantriId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Kegiatan Santri Lain',
        jatuhTempo: '2026-12-31',
        nominal: 20000,
        terbayar: 0,
        sisa: 20000,
        status: 'belum_bayar',
      })
      .returning();

    await expect(
      payEventBillFromSavings({
        santriId: testSantriId, // Calling for testSantriId, but bill is otherSantriId
        tagihanId: otherBill.id,
        adminId: adminUserId,
      })
    ).rejects.toThrow(InvalidBillForSavingsPaymentError);
  });

  it('SAV-2.6: database trigger trg_check_savings_balance rejects direct insert that overdrafts balance', async () => {
    const currentBal = await getSantriSavingsBalance(testSantriId);
    const overdraftAmount = -(currentBal + 999999);

    await expect(
      db.insert(ledgerTabungan).values({
        santriId: testSantriId,
        jenisMutasi: 'pemakaian_kegiatan',
        nominal: overdraftAmount,
        keterangan: 'Direct SQL overdraft test',
        dibuatOlehId: adminUserId,
      })
    ).rejects.toThrow();
  });

  it('SAV-1.3: recordSavingsWithdrawal penarikan_boyong transitions santri status to boyong and zeroes balance', async () => {
    const currentBal = await getSantriSavingsBalance(testSantriId);
    expect(currentBal).toBeGreaterThan(0);

    const withdrawal = await recordSavingsWithdrawal({
      santriId: testSantriId,
      nominal: currentBal,
      jenis: 'penarikan_boyong',
      alasan: 'Santri telah lulus dan boyong',
      adminId: adminUserId,
    });

    expect(withdrawal.saldoSesudah).toBe(0);
    expect(withdrawal.santriStatusUpdated).toBe('boyong');

    const [updatedSantri] = await db.select().from(santri).where(eq(santri.id, testSantriId));
    expect(updatedSantri.status).toBe('boyong');

    const finalBal = await getSantriSavingsBalance(testSantriId);
    expect(finalBal).toBe(0);
  });

  it('EVB-1.1 & EVB-2.1: createEventBills creates bills and is idempotent', async () => {
    const title = `Ziarah Makam Wali Songo ${Date.now()}`;
    const result1 = await createEventBills({
      judul: title,
      nominal: 150000,
      jatuhTempo: '2026-11-20',
      target: {
        santriIds: [otherSantriId],
      },
      adminId: adminUserId,
    });

    expect(result1.success).toBe(true);
    expect(result1.newlyBilledCount).toBe(1);
    expect(result1.alreadyBilledCount).toBe(0);
    expect(result1.billsCreated.length).toBe(1);

    // Rerunning identical event billing should skip already billed santri (idempotency)
    const result2 = await createEventBills({
      judul: title,
      nominal: 150000,
      jatuhTempo: '2026-11-20',
      target: {
        santriIds: [otherSantriId],
      },
      adminId: adminUserId,
    });

    expect(result2.newlyBilledCount).toBe(0);
    expect(result2.alreadyBilledCount).toBe(1);

    // Cancel unpaid event bill
    const billId = result1.billsCreated[0].id;
    const cancelRes = await cancelEventBill({
      tagihanId: billId,
      alasanBatal: 'Kegiatan ziarah ditunda ke semester depan',
      adminId: adminUserId,
    });

    expect(cancelRes.status).toBe('dibatalkan');
    const [cancelledBill] = await db.select().from(tagihan).where(eq(tagihan.id, billId));
    expect(cancelledBill.status).toBe('dibatalkan');
  });
});
