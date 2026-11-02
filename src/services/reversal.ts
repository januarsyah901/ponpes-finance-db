import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../client';
import {
  pembayaran,
  alokasiPembayaran,
  tagihan,
  ledgerTabungan,
  auditLog,
} from '../schema';

export interface ReversePaymentInput {
  pembayaranId: string;
  alasan: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ReversalResult {
  reversalPembayaranId: string;
  originalPembayaranId: string;
  santriId: string;
  totalNominalDibalik: number;
  totalTabunganDibalik: number;
  totalOperasionalDibalik: number;
  tagihanDipulihkan: Array<{
    tagihanId: string;
    nominalDipulihkan: number;
    sisaBaru: number;
    statusBaru: 'belum_bayar' | 'sebagian' | 'lunas';
  }>;
}

export async function reversePayment(
  db: Database,
  input: ReversePaymentInput
): Promise<ReversalResult> {
  const { pembayaranId, alasan, userId, ipAddress, userAgent } = input;

  if (!alasan || alasan.trim().length < 5) {
    throw new Error('Alasan pembatalan/reversal wajib diisi minimal 5 karakter');
  }

  return await db.transaction(async (tx) => {
    // 1. PESSIMISTIC LOCK on original payment row
    const [originalPay] = await tx
      .select()
      .from(pembayaran)
      .where(eq(pembayaran.id, pembayaranId))
      .for('update');

    if (!originalPay) {
      throw new Error(`Pembayaran dengan ID ${pembayaranId} tidak ditemukan`);
    }

    if (originalPay.status !== 'terverifikasi') {
      throw new Error('Hanya pembayaran yang berstatus terverifikasi yang dapat dibatalkan');
    }

    if (originalPay.isReversal) {
      throw new Error('Tidak dapat membatalkan transaksi yang merupakan record reversal');
    }

    // Check for double reversal
    const [existingReversal] = await tx
      .select({ id: pembayaran.id })
      .from(pembayaran)
      .where(eq(pembayaran.reversalOfId, pembayaranId));

    if (existingReversal) {
      throw new Error(
        `Pembayaran ini sudah pernah dibatalkan sebelumnya (Reversal ID: ${existingReversal.id})`
      );
    }

    // 2. Fetch all non-reversal allocations for this payment
    const allocations = await tx
      .select()
      .from(alokasiPembayaran)
      .where(
        and(
          eq(alokasiPembayaran.pembayaranId, pembayaranId),
          eq(alokasiPembayaran.isReversal, false)
        )
      );

    if (allocations.length === 0) {
      throw new Error('Tidak ditemukan data alokasi untuk pembayaran ini');
    }

    // 3. Sum total savings to reverse & verify that santri's current savings balance is sufficient
    const totalSavingsToReverse = allocations.reduce(
      (sum, item) => sum + Number(item.alokasiTabungan),
      0
    );

    if (totalSavingsToReverse > 0) {
      const [santriBalanceResult] = await tx
        .select({
          balance: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
        })
        .from(ledgerTabungan)
        .where(eq(ledgerTabungan.santriId, originalPay.santriId));

      const currentBalance = Number(santriBalanceResult?.balance || 0);

      if (currentBalance < totalSavingsToReverse) {
        throw new Error(
          `Gagal membatalkan pembayaran: Saldo tabungan santri saat ini (Rp${currentBalance.toLocaleString('id-ID')}) ` +
          `tidak mencukupi untuk membalik alokasi tabungan sebesar Rp${totalSavingsToReverse.toLocaleString('id-ID')} ` +
          `karena saldo sudah terpakai untuk transaksi lain.`
        );
      }
    }

    // 4. Insert Compensating Reversal Pembayaran Record (Zero-Delete Policy)
    const [reversalPay] = await tx
      .insert(pembayaran)
      .values({
        santriId: originalPay.santriId,
        komplekId: originalPay.komplekId,
        metode: originalPay.metode,
        nominal: originalPay.nominal,
        nominalDiverifikasi: originalPay.nominalDiverifikasi,
        tanggalBayar: originalPay.tanggalBayar,
        catatanSantri: `KOREKSI PEMBATALAN PEMBAYARAN #${originalPay.id.slice(0, 8)}: ${alasan.trim()}`,
        status: 'terverifikasi',
        diverifikasiOlehId: userId,
        diverifikasiPada: new Date(),
        isReversal: true,
        reversalOfId: originalPay.id,
        alasanReversal: alasan.trim(),
      })
      .returning();

    // 5. Process Compensating Allocations & Restore Bill Balances
    let totalNominalRestored = 0;
    let totalOperationalToReverse = 0;
    const restoredBills: ReversalResult['tagihanDipulihkan'] = [];

    for (const alloc of allocations) {
      const nominalAlloc = Number(alloc.nominalAlokasi);
      const tabunganAlloc = Number(alloc.alokasiTabungan);
      const operasionalAlloc = Number(alloc.alokasiOperasional);

      totalNominalRestored += nominalAlloc;
      totalOperationalToReverse += operasionalAlloc;

      // 5a. Insert compensating allocation (negative nominals, isReversal = true)
      await tx.insert(alokasiPembayaran).values({
        pembayaranId: reversalPay.id,
        tagihanId: alloc.tagihanId,
        nominalAlokasi: -nominalAlloc,
        alokasiTabungan: -tabunganAlloc,
        alokasiOperasional: -operasionalAlloc,
        isReversal: true,
      });

      // 5b. Lock and restore target bill
      const [targetBill] = await tx
        .select()
        .from(tagihan)
        .where(eq(tagihan.id, alloc.tagihanId))
        .for('update');

      if (!targetBill) {
        throw new Error(`Tagihan target ${alloc.tagihanId} tidak ditemukan`);
      }

      const prevTerbayar = Number(targetBill.terbayar);
      const prevSisa = Number(targetBill.sisa);
      const billNominal = Number(targetBill.nominal);

      const restoredTerbayar = Math.max(0, prevTerbayar - nominalAlloc);
      const restoredSisa = Math.min(billNominal, prevSisa + nominalAlloc);

      let restoredStatus: 'belum_bayar' | 'sebagian' | 'lunas';
      if (restoredSisa >= billNominal) {
        restoredStatus = 'belum_bayar';
      } else if (restoredSisa > 0) {
        restoredStatus = 'sebagian';
      } else {
        restoredStatus = 'lunas';
      }

      await tx
        .update(tagihan)
        .set({
          terbayar: restoredTerbayar,
          sisa: restoredSisa,
          status: restoredStatus,
          updatedAt: new Date(),
        })
        .where(eq(tagihan.id, alloc.tagihanId));

      restoredBills.push({
        tagihanId: alloc.tagihanId,
        nominalDipulihkan: nominalAlloc,
        sisaBaru: restoredSisa,
        statusBaru: restoredStatus,
      });
    }

    // 6. Insert Compensating Ledger Mutation
    if (totalSavingsToReverse > 0) {
      await tx.insert(ledgerTabungan).values({
        santriId: originalPay.santriId,
        jenisMutasi: 'koreksi',
        nominal: -totalSavingsToReverse, // Signed negative integer
        referensiTipe: 'pembayaran',
        referensiId: reversalPay.id,
        keterangan: `Koreksi pembatalan alokasi tabungan pembayaran #${originalPay.id.slice(0, 8)} (${alasan.trim()})`,
        dibuatOlehId: userId,
        disetujuiOlehId: userId,
      });
    }

    // 7. Record Audit Log Entry
    await tx.insert(auditLog).values({
      userId,
      action: 'reversal_pembayaran',
      entityType: 'pembayaran',
      entityId: originalPay.id,
      oldValues: {
        pembayaranId: originalPay.id,
        status: originalPay.status,
        nominal: originalPay.nominal,
        allocationsCount: allocations.length,
      },
      newValues: {
        reversalPembayaranId: reversalPay.id,
        alasanReversal: alasan.trim(),
        totalNominalDibalik: totalNominalRestored,
        totalTabunganDibalik: totalSavingsToReverse,
        totalOperasionalDibalik: totalOperationalToReverse,
        restoredBillsCount: restoredBills.length,
      },
      ipAddress,
      userAgent,
    });

    return {
      reversalPembayaranId: reversalPay.id,
      originalPembayaranId: originalPay.id,
      santriId: originalPay.santriId,
      totalNominalDibalik: totalNominalRestored,
      totalTabunganDibalik: totalSavingsToReverse,
      totalOperasionalDibalik: totalOperationalToReverse,
      tagihanDipulihkan: restoredBills,
    };
  });
}
