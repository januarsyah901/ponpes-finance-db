import { eq, and, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../client';
import type { Database } from '../client';
import { santri, tagihan, auditLog } from '../schema';
import type {
  CreateEventBillsInput,
  CreatedEventBillItem,
  EventBillingResult,
  CancelEventBillInput,
  CancelEventBillResult,
} from '../types';

export interface EventBillingActor {
  userId?: string;
  role?: string;
  complexIds?: string[];
}

/**
 * Creates targeted event bills (tagihan kegiatan) with idempotency checks.
 */
export async function createEventBills(
  arg1: any,
  arg2?: any,
  arg3?: any
): Promise<EventBillingResult> {
  const targetDb: Database = arg2 && (arg2.judul || arg2.target) ? arg1 : defaultDb;
  const input: CreateEventBillsInput = arg2 && (arg2.judul || arg2.target) ? arg2 : arg1;
  const actor: EventBillingActor | undefined = arg2 && (arg2.judul || arg2.target) ? arg3 : arg2;

  const { judul, nominal, jatuhTempo, target, adminId, ipAddress, userAgent } = input;

  if (!judul || judul.trim().length < 3) {
    throw new Error('Judul tagihan kegiatan wajib diisi minimal 3 karakter.');
  }

  if (nominal <= 0) {
    throw new Error('Nominal tagihan kegiatan harus lebih besar dari 0.');
  }

  // 1. Resolve Target Santri Query Filters
  const conditions = [eq(santri.status, 'aktif')];

  // RBAC scope restriction: If actor is Bendahara Komplek, enforce assigned complexIds
  let scopedComplexIds = target.komplekIds;
  if (actor?.role === 'bendahara_komplek' && actor.complexIds && !actor.complexIds.includes('all')) {
    if (scopedComplexIds && scopedComplexIds.length > 0) {
      const unauthorized = scopedComplexIds.find((id) => !actor.complexIds!.includes(id));
      if (unauthorized) {
        throw new Error('Akses ditolak: Anda tidak memiliki wewenang untuk komplek yang dipilih.');
      }
    } else {
      scopedComplexIds = actor.complexIds;
    }
  }

  if (scopedComplexIds && scopedComplexIds.length > 0) {
    conditions.push(inArray(santri.komplekId, scopedComplexIds));
  }

  if (target.kategoriIds && target.kategoriIds.length > 0) {
    conditions.push(inArray(santri.kategoriId, target.kategoriIds));
  }

  if (target.santriIds && target.santriIds.length > 0) {
    conditions.push(inArray(santri.id, target.santriIds));
  }

  // 2. Query matching active santri
  const targetSantriList = await targetDb
    .select({
      id: santri.id,
      komplekId: santri.komplekId,
      nama: santri.nama,
    })
    .from(santri)
    .where(and(...conditions));

  if (targetSantriList.length === 0) {
    return {
      success: true,
      totalTargetedSantri: 0,
      newlyBilledCount: 0,
      alreadyBilledCount: 0,
      totalNominalBilled: 0,
      billsCreated: [],
      skippedSantriIds: [],
    };
  }

  const targetSantriIds = targetSantriList.map((s) => s.id);

  // 3. Strict Idempotency Check: Query existing bills for this title
  const existingBills = await targetDb
    .select({ santriId: tagihan.santriId })
    .from(tagihan)
    .where(
      and(
        inArray(tagihan.santriId, targetSantriIds),
        eq(tagihan.tipe, 'kegiatan'),
        eq(tagihan.judul, judul.trim()),
        sql`${tagihan.status} != 'dibatalkan'`
      )
    );

  const existingSet = new Set(existingBills.map((b) => b.santriId));
  const santriToBill = targetSantriList.filter((s) => !existingSet.has(s.id));
  const skippedSantriIds = Array.from(existingSet);

  if (santriToBill.length === 0) {
    return {
      success: true,
      totalTargetedSantri: targetSantriList.length,
      newlyBilledCount: 0,
      alreadyBilledCount: existingSet.size,
      totalNominalBilled: 0,
      billsCreated: [],
      skippedSantriIds,
    };
  }

  // 4. Batch Insert inside atomic transaction
  const createdBills: CreatedEventBillItem[] = [];
  let totalNominalBilled = 0;

  const billRecords = santriToBill.map((s) => {
    totalNominalBilled += nominal;
    return {
      santriId: s.id,
      komplekId: s.komplekId,
      tipe: 'kegiatan' as const,
      judul: judul.trim(),
      jatuhTempo,
      nominal,
      terbayar: 0,
      sisa: nominal,
      status: 'belum_bayar' as const,
    };
  });

  await targetDb.transaction(async (tx) => {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < billRecords.length; i += CHUNK_SIZE) {
      const chunk = billRecords.slice(i, i + CHUNK_SIZE);
      const inserted = await tx
        .insert(tagihan)
        .values(chunk)
        .returning({
          id: tagihan.id,
          santriId: tagihan.santriId,
          nominal: tagihan.nominal,
          judul: tagihan.judul,
        });
      createdBills.push(...inserted.map((b) => ({ ...b, nominal: Number(b.nominal) })));
    }

    // 5. Audit Log
    await tx.insert(auditLog).values({
      userId: adminId,
      action: 'BUAT_TAGIHAN_KEGIATAN_MASSAL',
      entityType: 'tagihan',
      entityId: 'bulk',
      newValues: {
        judul: judul.trim(),
        nominal,
        jatuhTempo,
        newlyBilledCount: createdBills.length,
        alreadyBilledCount: existingSet.size,
        totalNominalBilled,
        targetCriteria: target,
      },
      ipAddress,
      userAgent,
    });
  });

  return {
    success: true,
    totalTargetedSantri: targetSantriList.length,
    newlyBilledCount: createdBills.length,
    alreadyBilledCount: existingSet.size,
    totalNominalBilled,
    billsCreated: createdBills,
    skippedSantriIds,
  };
}

// Alias for generateEventBills
export const generateEventBills = createEventBills;

/**
 * Cancels an unpaid event bill.
 */
export async function cancelEventBill(
  arg1: any,
  arg2?: any
): Promise<CancelEventBillResult> {
  const targetDb: Database = arg2 ? arg1 : defaultDb;
  const input: CancelEventBillInput = arg2 ? arg2 : arg1;
  const { tagihanId, alasanBatal, adminId, ipAddress, userAgent } = input;

  if (!alasanBatal || alasanBatal.trim().length < 5) {
    throw new Error('Alasan pembatalan tagihan wajib diisi minimal 5 karakter.');
  }

  return await targetDb.transaction(async (tx) => {
    // 1. Lock bill row
    const [bill] = await tx
      .select()
      .from(tagihan)
      .where(eq(tagihan.id, tagihanId))
      .for('update');

    if (!bill) {
      throw new Error(`Tagihan dengan ID "${tagihanId}" tidak ditemukan.`);
    }

    if (bill.status === 'dibatalkan') {
      throw new Error('Tagihan ini sudah dibatalkan sebelumnya.');
    }

    // Invariant: Cannot cancel if bill already has payments
    if (Number(bill.terbayar) > 0) {
      throw new Error(
        `Tidak dapat membatalkan tagihan yang sudah memiliki riwayat pembayaran (terbayar: Rp${Number(bill.terbayar).toLocaleString('id-ID')}). ` +
        `Lakukan pembatalan pembayaran/reversal terlebih dahulu sebelum membatalkan tagihan.`
      );
    }

    const now = new Date();

    // 2. Update status to dibatalkan
    await tx
      .update(tagihan)
      .set({
        status: 'dibatalkan',
        alasanBatal: alasanBatal.trim(),
        dibatalkanPada: now,
        dibatalkanOlehId: adminId,
        updatedAt: now,
      })
      .where(eq(tagihan.id, tagihanId));

    // 3. Record Audit Log
    await tx.insert(auditLog).values({
      userId: adminId,
      action: 'BATALKAN_TAGIHAN_KEGIATAN',
      entityType: 'tagihan',
      entityId: bill.id,
      oldValues: {
        status: bill.status,
        nominal: bill.nominal,
        terbayar: bill.terbayar,
        sisa: bill.sisa,
      },
      newValues: {
        status: 'dibatalkan',
        alasanBatal: alasanBatal.trim(),
        dibatalkanPada: now,
      },
      ipAddress,
      userAgent,
    });

    return {
      tagihanId: bill.id,
      santriId: bill.santriId,
      judul: bill.judul,
      status: 'dibatalkan',
      alasanBatal: alasanBatal.trim(),
      dibatalkanPada: now,
    };
  });
}
