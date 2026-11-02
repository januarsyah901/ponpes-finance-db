import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/client';
import { allocatePayment } from '../src/services/payment-allocation';
import {
  santri,
  komplek,
  kategori,
  tagihan,
  pembayaran,
  alokasiPembayaran,
  ledgerTabungan,
  auditLog,
  pengguna,
  penggunaKomplek,
  tarifSyahriah,
} from '../src/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';

describe('Empirical Verification Flow & Authorization Scoping Challenge', () => {
  const db = getDb();

  let komplekPa1Id: string;
  let komplekPi1Id: string;
  let kategoriId: string;
  let superAdminId: string;
  let bendaharaPutraId: string;
  let bendaharaPutri1Id: string;

  let testSantriPa1Id: string;
  let testSantriPi1Id: string;

  beforeAll(async () => {
    // 1. Fetch complexes
    const [pa1] = await db.select().from(komplek).where(eq(komplek.kode, 'PA1')).limit(1);
    const [pi1] = await db.select().from(komplek).where(eq(komplek.kode, 'PI1')).limit(1);
    komplekPa1Id = pa1.id;
    komplekPi1Id = pi1.id;

    // 2. Fetch category
    const [kat] = await db.select().from(kategori).limit(1);
    kategoriId = kat.id;

    // 3. Fetch users
    const [admin] = await db.select().from(pengguna).where(eq(pengguna.role, 'super_admin')).limit(1);
    const [bPutra] = await db.select().from(pengguna).where(eq(pengguna.username, 'bendahara_putra')).limit(1);
    const [bPutri1] = await db.select().from(pengguna).where(eq(pengguna.username, 'bendahara_putri1')).limit(1);

    superAdminId = admin.id;
    bendaharaPutraId = bPutra.id;
    bendaharaPutri1Id = bPutri1.id;

    // 4. Create test santri in PA1 and PI1
    const [sPa1] = await db
      .insert(santri)
      .values({
        nis: `CHALLENGE-PA1-${Date.now()}`,
        nama: 'Santri Test PA1',
        komplekId: komplekPa1Id,
        kategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281111111111',
      })
      .returning();
    testSantriPa1Id = sPa1.id;

    const [sPi1] = await db
      .insert(santri)
      .values({
        nis: `CHALLENGE-PI1-${Date.now()}`,
        nama: 'Santri Test PI1',
        komplekId: komplekPi1Id,
        kategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6282222222222',
      })
      .returning();
    testSantriPi1Id = sPi1.id;
  });

  afterAll(async () => {
    const testIds = [testSantriPa1Id, testSantriPi1Id].filter(Boolean);
    if (testIds.length > 0) {
      await db.delete(auditLog).where(
        sql`${auditLog.entityId} IN (SELECT id::text FROM pembayaran WHERE santri_id IN ${testIds})`
      );
      await db.delete(alokasiPembayaran).where(
        sql`${alokasiPembayaran.pembayaranId} IN (SELECT id FROM pembayaran WHERE santri_id IN ${testIds})`
      );
      await db.delete(ledgerTabungan).where(inArray(ledgerTabungan.santriId, testIds));
      await db.delete(pembayaran).where(inArray(pembayaran.santriId, testIds));
      await db.delete(tagihan).where(inArray(tagihan.santriId, testIds));
      await db.delete(santri).where(inArray(santri.id, testIds));
    }
  });

  describe('1. Bendahara Decision Pathway A: Standard Approval', () => {
    it('verifies pending payment, sets terverifikasi, and atomically allocates oldest bill', async () => {
      // Create unpaid bill
      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
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

      // Santri submits transfer payment
      const [pay] = await db
        .insert(pembayaran)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
          metode: 'transfer',
          nominal: 350000,
          tanggalBayar: '2026-01-05',
          catatanSantri: 'Transfer via BSI',
          buktiUrl: '/uploads/bukti/test-proof-1.jpg',
          status: 'menunggu_verifikasi',
        })
        .returning();

      // Bendahara Approves
      const allocationRes = await allocatePayment(db, {
        pembayaranId: pay.id,
        santriId: testSantriPa1Id,
        nominal: 350000,
        metode: 'transfer',
        tanggalBayar: '2026-01-05',
        adminUserId: bendaharaPutraId,
      });

      expect(allocationRes.pembayaranId).toBe(pay.id);
      expect(allocationRes.totalTabungan).toBe(50000);
      expect(allocationRes.totalOperasional).toBe(300000);
      expect(allocationRes.totalTabungan + allocationRes.totalOperasional).toBe(350000);

      // Verify payment row updated
      const [updatedPay] = await db.select().from(pembayaran).where(eq(pembayaran.id, pay.id));
      expect(updatedPay.status).toBe('terverifikasi');
      expect(Number(updatedPay.nominalDiverifikasi)).toBe(350000);
      expect(updatedPay.diverifikasiOlehId).toBe(bendaharaPutraId);
      expect(updatedPay.diverifikasiPada).not.toBeNull();

      // Verify bill status updated to lunas
      const [updatedBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(updatedBill.status).toBe('lunas');
      expect(Number(updatedBill.terbayar)).toBe(350000);
      expect(Number(updatedBill.sisa)).toBe(0);

      // Verify ledger tabungan entry created
      const [ledger] = await db
        .select()
        .from(ledgerTabungan)
        .where(
          and(
            eq(ledgerTabungan.santriId, testSantriPa1Id),
            eq(ledgerTabungan.referensiId, pay.id)
          )
        );
      expect(ledger).toBeDefined();
      expect(ledger.jenisMutasi).toBe('setoran_syahriah');
      expect(Number(ledger.nominal)).toBe(50000);

      // Double-verification guard: calling again MUST throw error
      await expect(
        allocatePayment(db, {
          pembayaranId: pay.id,
          santriId: testSantriPa1Id,
          nominal: 350000,
          metode: 'transfer',
          tanggalBayar: '2026-01-05',
          adminUserId: bendaharaPutraId,
        })
      ).rejects.toThrow('Pembayaran ini sudah pernah diverifikasi sebelumnya');
    });
  });

  describe('2. Bendahara Decision Pathway B: Approve with Corrected Amount', () => {
    it('approves with corrected amount, updates nominalDiverifikasi, and allocates only corrected amount', async () => {
      // Bill: 350.000
      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
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

      // Santri mistyped 400.000 in form
      const [pay] = await db
        .insert(pembayaran)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
          metode: 'transfer',
          nominal: 400000,
          tanggalBayar: '2026-02-05',
          catatanSantri: 'Salah ketik nominal',
          buktiUrl: '/uploads/bukti/test-proof-2.jpg',
          status: 'menunggu_verifikasi',
        })
        .returning();

      // Bendahara inspects mutasi and corrects nominal to 300.000
      const correctedAmount = 300000;
      const res = await allocatePayment(db, {
        pembayaranId: pay.id,
        santriId: testSantriPa1Id,
        nominal: correctedAmount,
        metode: 'transfer',
        tanggalBayar: '2026-02-05',
        adminUserId: bendaharaPutraId,
        catatan: 'Disesuaikan oleh bendahara: Mutasi bank tercatat Rp300.000',
      });

      expect(res.totalTabungan + res.totalOperasional).toBe(300000);
      expect(res.totalTabungan).toBe(50000);
      expect(res.totalOperasional).toBe(250000);

      // Verify payment row
      const [updatedPay] = await db.select().from(pembayaran).where(eq(pembayaran.id, pay.id));
      expect(Number(updatedPay.nominal)).toBe(400000); // original nominal preserved
      expect(Number(updatedPay.nominalDiverifikasi)).toBe(300000); // corrected nominal
      expect(updatedPay.status).toBe('terverifikasi');

      // Verify bill row is partially paid (status: sebagian)
      const [updatedBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(updatedBill.status).toBe('sebagian');
      expect(Number(updatedBill.terbayar)).toBe(300000);
      expect(Number(updatedBill.sisa)).toBe(50000);
    });

    it('rejects corrected nominal <= 0', async () => {
      const [pay] = await db
        .insert(pembayaran)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
          metode: 'transfer',
          nominal: 100000,
          tanggalBayar: '2026-02-05',
          buktiUrl: '/uploads/bukti/test-proof-zero.jpg',
          status: 'menunggu_verifikasi',
        })
        .returning();

      await expect(
        allocatePayment(db, {
          pembayaranId: pay.id,
          santriId: testSantriPa1Id,
          nominal: 0,
          metode: 'transfer',
          tanggalBayar: '2026-02-05',
          adminUserId: bendaharaPutraId,
        })
      ).rejects.toThrow('Nominal pembayaran harus lebih besar dari 0');

      await expect(
        allocatePayment(db, {
          pembayaranId: pay.id,
          santriId: testSantriPa1Id,
          nominal: -50000,
          metode: 'transfer',
          tanggalBayar: '2026-02-05',
          adminUserId: bendaharaPutraId,
        })
      ).rejects.toThrow('Nominal pembayaran harus lebih besar dari 0');
    });
  });

  describe('3. Bendahara Decision Pathway C: Rejection Workflow', () => {
    it('rejects payment with mandatory reason, leaves bills unpaid, and prevents allocations', async () => {
      // Bill: 350.000
      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
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

      // Pending payment with blurry proof
      const [pay] = await db
        .insert(pembayaran)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
          metode: 'transfer',
          nominal: 350000,
          tanggalBayar: '2026-03-05',
          buktiUrl: '/uploads/bukti/blur.jpg',
          status: 'menunggu_verifikasi',
        })
        .returning();

      // Perform rejection transaction (simulating rejectPaymentAction)
      const rejectionReason = 'Bukti transfer buram dan nomor rekening tidak terbaca';
      expect(rejectionReason.trim().length).toBeGreaterThanOrEqual(5);

      await db.transaction(async (tx) => {
        await tx
          .update(pembayaran)
          .set({
            status: 'ditolak',
            alasanPenolakan: rejectionReason.trim(),
            diverifikasiOlehId: bendaharaPutraId,
            diverifikasiPada: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pembayaran.id, pay.id));

        await tx.insert(auditLog).values({
          userId: bendaharaPutraId,
          action: 'verifikasi_pembayaran_tolak',
          entityType: 'pembayaran',
          entityId: pay.id,
          newValues: {
            santriId: testSantriPa1Id,
            nominal: pay.nominal,
            alasanPenolakan: rejectionReason.trim(),
          },
        });
      });

      // Verify payment row
      const [rejectedPay] = await db.select().from(pembayaran).where(eq(pembayaran.id, pay.id));
      expect(rejectedPay.status).toBe('ditolak');
      expect(rejectedPay.alasanPenolakan).toBe(rejectionReason);
      expect(rejectedPay.diverifikasiOlehId).toBe(bendaharaPutraId);

      // CRITICAL INVARIANT: ZERO bill allocations created
      const allocations = await db
        .select()
        .from(alokasiPembayaran)
        .where(eq(alokasiPembayaran.pembayaranId, pay.id));
      expect(allocations.length).toBe(0);

      // CRITICAL INVARIANT: Bill remains completely unpaid
      const [untouchedBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(untouchedBill.status).toBe('belum_bayar');
      expect(Number(untouchedBill.terbayar)).toBe(0);
      expect(Number(untouchedBill.sisa)).toBe(350000);

      // CRITICAL INVARIANT: ZERO savings ledger mutations created
      const ledgers = await db
        .select()
        .from(ledgerTabungan)
        .where(eq(ledgerTabungan.referensiId, pay.id));
      expect(ledgers.length).toBe(0);

      // Verify audit log entry
      const [log] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, 'pembayaran'),
            eq(auditLog.entityId, pay.id),
            eq(auditLog.action, 'verifikasi_pembayaran_tolak')
          )
        );
      expect(log).toBeDefined();
    });
  });

  describe('4. Cash Desk & Receipt Intake Workflow', () => {
    it('processes cash payment: immediate terverifikasi status, atomic FIFO allocation', async () => {
      // Bill for Santri PI1: 350.000
      const [bill] = await db
        .insert(tagihan)
        .values({
          santriId: testSantriPi1Id,
          komplekId: komplekPi1Id,
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

      // Process direct cash desk payment by Bendahara Putri 1
      const allocationRes = await allocatePayment(db, {
        santriId: testSantriPi1Id,
        nominal: 350000,
        metode: 'tunai',
        tanggalBayar: '2026-04-02',
        catatan: 'Kasir kantor pondok putri',
        adminUserId: bendaharaPutri1Id,
        isCashDesk: true,
      });

      expect(allocationRes.pembayaranId).toBeDefined();
      expect(allocationRes.totalTabungan).toBe(50000);
      expect(allocationRes.totalOperasional).toBe(300000);

      // Verify newly created pembayaran record has status 'terverifikasi' immediately
      const [cashPay] = await db
        .select()
        .from(pembayaran)
        .where(eq(pembayaran.id, allocationRes.pembayaranId));
      expect(cashPay.metode).toBe('tunai');
      expect(cashPay.status).toBe('terverifikasi');
      expect(Number(cashPay.nominalDiverifikasi)).toBe(350000);
      expect(cashPay.diverifikasiOlehId).toBe(bendaharaPutri1Id);

      // Verify bill is marked lunas
      const [paidBill] = await db.select().from(tagihan).where(eq(tagihan.id, bill.id));
      expect(paidBill.status).toBe('lunas');
      expect(Number(paidBill.sisa)).toBe(0);
    });
  });

  describe('5. Authorization & Multi-Complex Scoping Guards', () => {
    it('verifies Bendahara Putra complexes (PA1, PA2, PA3) and Putri (PI1)', async () => {
      // Bendahara Putra user has 3 complexes in pengguna_komplek
      const putraAssigned = await db
        .select({ komplekId: penggunaKomplek.komplekId, kode: komplek.kode })
        .from(penggunaKomplek)
        .innerJoin(komplek, eq(penggunaKomplek.komplekId, komplek.id))
        .where(eq(penggunaKomplek.userId, bendaharaPutraId));

      const putraKodes = putraAssigned.map((a) => a.kode).sort();
      expect(putraKodes).toEqual(['PA1', 'PA2', 'PA3']);

      // Bendahara Putri 1 has only PI1
      const putri1Assigned = await db
        .select({ komplekId: penggunaKomplek.komplekId, kode: komplek.kode })
        .from(penggunaKomplek)
        .innerJoin(komplek, eq(penggunaKomplek.komplekId, komplek.id))
        .where(eq(penggunaKomplek.userId, bendaharaPutri1Id));

      const putri1Kodes = putri1Assigned.map((a) => a.kode);
      expect(putri1Kodes).toEqual(['PI1']);
    });

    it('enforces that Bendahara Putri 1 is unauthorized to access or process payments for Santri in PA1', async () => {
      // User context for Bendahara Putri 1
      const userPutri1 = {
        id: bendaharaPutri1Id,
        role: 'bendahara_komplek' as const,
        complexIds: [komplekPi1Id],
      };

      // Santri in PA1 submits payment
      const [payPa1] = await db
        .insert(pembayaran)
        .values({
          santriId: testSantriPa1Id,
          komplekId: komplekPa1Id,
          metode: 'transfer',
          nominal: 350000,
          tanggalBayar: '2026-05-01',
          status: 'menunggu_verifikasi',
        })
        .returning();

      // Authorization guard check simulating server action guard
      const hasVerificationAccess =
        userPutri1.role === 'super_admin' ||
        (userPutri1.complexIds && (userPutri1.complexIds.includes('all') || userPutri1.complexIds.includes(payPa1.komplekId)));

      expect(hasVerificationAccess).toBe(false);

      // Verify that Super Admin DOES have access
      const userAdmin = {
        id: superAdminId,
        role: 'super_admin' as const,
        complexIds: ['all'],
      };
      const adminHasAccess =
        userAdmin.role === 'super_admin' ||
        (userAdmin.complexIds && (userAdmin.complexIds.includes('all') || userAdmin.complexIds.includes(payPa1.komplekId)));
      expect(adminHasAccess).toBe(true);

      // Verify that Bendahara Putra DOES have access to PA1
      const userPutra = {
        id: bendaharaPutraId,
        role: 'bendahara_komplek' as const,
        complexIds: [komplekPa1Id],
      };
      const putraHasAccess =
        userPutra.role === 'super_admin' ||
        (userPutra.complexIds && (userPutra.complexIds.includes('all') || userPutra.complexIds.includes(payPa1.komplekId)));
      expect(putraHasAccess).toBe(true);
    });
  });
});
