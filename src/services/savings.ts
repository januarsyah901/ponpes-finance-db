import { eq, sql, desc, and } from 'drizzle-orm';
import { db as defaultDb } from '../client';
import type { Database } from '../client';
import { santri, tagihan, ledgerTabungan, pengguna, auditLog } from '../schema';
import type {
  PaginationOptions,
  SavingsHistoryResult,
  RecordSavingsWithdrawalInput,
  SavingsWithdrawalResult,
  RecordSavingsInitialBalanceInput,
  SavingsInitialBalanceResult,
  PayEventBillFromSavingsInput,
  EventBillSettlementResult,
  RecordSavingsCorrectionInput,
  SavingsCorrectionResult,
} from '../types';

export class SavingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavingsError';
  }
}

export class InsufficientSavingsBalanceError extends SavingsError {
  constructor(
    public readonly requestedAmount: number,
    public readonly currentBalance: number
  ) {
    super(
      `Saldo tabungan tidak mencukupi. Saldo saat ini: Rp${currentBalance.toLocaleString('id-ID')}, dibutuhkan: Rp${requestedAmount.toLocaleString('id-ID')}.`
    );
    this.name = 'InsufficientSavingsBalanceError';
  }
}

export class SantriNotFoundError extends SavingsError {
  constructor(public readonly santriId: string) {
    super(`Santri dengan ID "${santriId}" tidak ditemukan.`);
    this.name = 'SantriNotFoundError';
  }
}

export class InvalidBillForSavingsPaymentError extends SavingsError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBillForSavingsPaymentError';
  }
}

/**
 * Derives current savings balance: SUM(nominal) where santriId = S
 * Supports signatures:
 *   getSantriSavingsBalance(santriId, tx?)
 *   getSantriSavingsBalance(db, santriId)
 */
export async function getSantriSavingsBalance(
  arg1: any,
  arg2?: any
): Promise<number> {
  let targetDb: any = defaultDb;
  let targetSantriId: string;

  if (typeof arg1 === 'string') {
    targetSantriId = arg1;
    if (arg2) targetDb = arg2;
  } else {
    targetDb = arg1 || defaultDb;
    targetSantriId = arg2;
  }

  const [res] = await targetDb
    .select({
      balance: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
    })
    .from(ledgerTabungan)
    .where(eq(ledgerTabungan.santriId, targetSantriId));

  return Number(res?.balance || 0);
}

/**
 * Returns current balance alongside paginated mutation history.
 * Supports signatures:
 *   getSantriSavingsHistory(santriId, options?, db?)
 *   getSantriSavingsHistory(db, santriId, options?)
 */
export async function getSantriSavingsHistory(
  arg1: any,
  arg2?: any,
  arg3?: any
): Promise<SavingsHistoryResult> {
  let targetDb: any = defaultDb;
  let targetSantriId: string;
  let options: PaginationOptions = {};

  if (typeof arg1 === 'string') {
    targetSantriId = arg1;
    options = arg2 || {};
    if (arg3) targetDb = arg3;
  } else {
    targetDb = arg1 || defaultDb;
    targetSantriId = arg2;
    options = arg3 || {};
  }

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  // 1. Verify santri existence
  const [targetSantri] = await targetDb
    .select({ id: santri.id })
    .from(santri)
    .where(eq(santri.id, targetSantriId));

  if (!targetSantri) {
    throw new SantriNotFoundError(targetSantriId);
  }

  // 2. Aggregate metrics: total balance, credits, debits
  const [metrics] = await targetDb
    .select({
      balance: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
      totalCredits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerTabungan.nominal} > 0 THEN ${ledgerTabungan.nominal} ELSE 0 END), 0)::int`,
      totalDebits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerTabungan.nominal} < 0 THEN ABS(${ledgerTabungan.nominal}) ELSE 0 END), 0)::int`,
      totalCount: sql<number>`COUNT(*)::int`,
    })
    .from(ledgerTabungan)
    .where(eq(ledgerTabungan.santriId, targetSantriId));

  // 3. Query paginated ledger entries with author info
  const entries = await targetDb
    .select({
      id: ledgerTabungan.id,
      santriId: ledgerTabungan.santriId,
      jenisMutasi: ledgerTabungan.jenisMutasi,
      nominal: ledgerTabungan.nominal,
      referensiTipe: ledgerTabungan.referensiTipe,
      referensiId: ledgerTabungan.referensiId,
      keterangan: ledgerTabungan.keterangan,
      dibuatOlehId: ledgerTabungan.dibuatOlehId,
      dibuatOlehNama: pengguna.nama,
      disetujuiOlehId: ledgerTabungan.disetujuiOlehId,
      createdAt: ledgerTabungan.createdAt,
    })
    .from(ledgerTabungan)
    .leftJoin(pengguna, eq(ledgerTabungan.dibuatOlehId, pengguna.id))
    .where(eq(ledgerTabungan.santriId, targetSantriId))
    .orderBy(desc(ledgerTabungan.createdAt), desc(ledgerTabungan.id))
    .limit(limit)
    .offset(offset);

  return {
    santriId: targetSantriId,
    currentBalance: Number(metrics?.balance || 0),
    totalCredits: Number(metrics?.totalCredits || 0),
    totalDebits: Number(metrics?.totalDebits || 0),
    totalCount: Number(metrics?.totalCount || 0),
    mutasi: entries.map((e: any) => ({
      ...e,
      nominal: Number(e.nominal),
    })),
  };
}

/**
 * Records opening balance (saldo_awal)
 */
export async function recordSavingsInitialBalance(
  arg1: any,
  arg2?: any
): Promise<SavingsInitialBalanceResult> {
  const targetDb: Database = arg2 ? arg1 : defaultDb;
  const input: RecordSavingsInitialBalanceInput = arg2 ? arg2 : arg1;
  const { santriId, nominal, keterangan, adminId, tanggal, ipAddress, userAgent } = input;

  if (nominal <= 0) {
    throw new SavingsError('Nominal saldo awal harus lebih besar dari 0.');
  }

  return await targetDb.transaction(async (tx) => {
    // 1. Pessimistic Row Lock on Santri
    const [lockedSantri] = await tx
      .select()
      .from(santri)
      .where(eq(santri.id, santriId))
      .for('update');

    if (!lockedSantri) {
      throw new SantriNotFoundError(santriId);
    }

    const currentBalance = await getSantriSavingsBalance(santriId, tx);

    const [newLedger] = await tx
      .insert(ledgerTabungan)
      .values({
        santriId,
        jenisMutasi: 'saldo_awal',
        nominal,
        referensiTipe: 'migrasi',
        referensiId: null,
        keterangan: keterangan?.trim() || 'Saldo awal tabungan',
        dibuatOlehId: adminId,
        disetujuiOlehId: adminId,
        createdAt: tanggal ? new Date(`${tanggal}T12:00:00Z`) : new Date(),
      })
      .returning();

    const newBalance = currentBalance + nominal;

    await tx.insert(auditLog).values({
      userId: adminId,
      action: 'tabungan_saldo_awal',
      entityType: 'ledger_tabungan',
      entityId: newLedger.id,
      oldValues: { santriId, saldoSebelum: currentBalance },
      newValues: {
        nominal,
        saldoSesudah: newBalance,
        keterangan: newLedger.keterangan,
      },
      ipAddress,
      userAgent,
    });

    return {
      ledgerId: newLedger.id,
      santriId,
      nominal,
      saldoSebelum: currentBalance,
      saldoSesudah: newBalance,
      keterangan: newLedger.keterangan,
      waktu: newLedger.createdAt,
    };
  });
}

/**
 * Records manual savings withdrawal (penarikan_boyong or penarikan_mendesak).
 * Enforces pessimistic locking and derived balance non-negative validation.
 */
export async function recordSavingsWithdrawal(
  arg1: any,
  arg2?: any
): Promise<SavingsWithdrawalResult> {
  const targetDb: Database = arg2 ? arg1 : defaultDb;
  const input: RecordSavingsWithdrawalInput = arg2 ? arg2 : arg1;
  const { santriId, nominal, jenis, alasan, adminId, ipAddress, userAgent } = input;

  if (nominal <= 0) {
    throw new SavingsError('Nominal penarikan harus lebih besar dari 0.');
  }

  if (!alasan || alasan.trim().length < 5) {
    throw new SavingsError('Alasan penarikan wajib diisi minimal 5 karakter.');
  }

  return await targetDb.transaction(async (tx) => {
    // 1. Pessimistic Row Lock on Santri
    const [lockedSantri] = await tx
      .select()
      .from(santri)
      .where(eq(santri.id, santriId))
      .for('update');

    if (!lockedSantri) {
      throw new SantriNotFoundError(santriId);
    }

    // 2. Compute current balance inside the transaction
    const currentBalance = await getSantriSavingsBalance(santriId, tx);

    if (currentBalance < nominal) {
      throw new InsufficientSavingsBalanceError(nominal, currentBalance);
    }

    // 3. Handle boyong status transition if applicable
    let statusUpdated: 'boyong' | undefined;
    if (jenis === 'penarikan_boyong' && lockedSantri.status !== 'boyong') {
      await tx
        .update(santri)
        .set({
          status: 'boyong',
          updatedAt: new Date(),
        })
        .where(eq(santri.id, santriId));
      statusUpdated = 'boyong';
    }

    // 4. Insert debit ledger mutation (negative nominal)
    const negativeNominal = -nominal;
    const [newLedger] = await tx
      .insert(ledgerTabungan)
      .values({
        santriId,
        jenisMutasi: jenis,
        nominal: negativeNominal,
        referensiTipe: 'penarikan',
        referensiId: null,
        keterangan: alasan.trim(),
        dibuatOlehId: adminId,
        disetujuiOlehId: adminId,
      })
      .returning();

    const newBalance = currentBalance - nominal;

    // 5. Insert Audit Log
    await tx.insert(auditLog).values({
      userId: adminId,
      action: jenis === 'penarikan_boyong' ? 'tabungan_penarikan_boyong' : 'tabungan_penarikan_mendesak',
      entityType: 'ledger_tabungan',
      entityId: newLedger.id,
      oldValues: {
        santriId,
        saldoSebelum: currentBalance,
        santriStatus: lockedSantri.status,
      },
      newValues: {
        nominalDitarik: nominal,
        saldoSesudah: newBalance,
        jenisMutasi: jenis,
        alasan: alasan.trim(),
        santriStatus: statusUpdated || lockedSantri.status,
      },
      ipAddress,
      userAgent,
    });

    return {
      ledgerId: newLedger.id,
      santriId,
      nominalDitarik: nominal,
      saldoSebelum: currentBalance,
      saldoSesudah: newBalance,
      jenisMutasi: jenis,
      keterangan: alasan.trim(),
      santriStatusUpdated: statusUpdated,
      waktu: newLedger.createdAt,
    };
  });
}

/**
 * Settles an event bill directly using the santri's accumulated savings.
 */
export async function payEventBillFromSavings(
  arg1: any,
  arg2?: any
): Promise<EventBillSettlementResult> {
  const targetDb: Database = arg2 ? arg1 : defaultDb;
  const input: PayEventBillFromSavingsInput = arg2 ? arg2 : arg1;
  const { santriId, tagihanId, nominal, adminId, catatan, ipAddress, userAgent } = input;

  return await targetDb.transaction(async (tx) => {
    // 1. Pessimistic Row Lock on Santri
    const [lockedSantri] = await tx
      .select()
      .from(santri)
      .where(eq(santri.id, santriId))
      .for('update');

    if (!lockedSantri) {
      throw new SantriNotFoundError(santriId);
    }

    // 2. Pessimistic Row Lock on Target Event Bill
    const [lockedBill] = await tx
      .select()
      .from(tagihan)
      .where(eq(tagihan.id, tagihanId))
      .for('update');

    if (!lockedBill) {
      throw new InvalidBillForSavingsPaymentError(`Tagihan dengan ID "${tagihanId}" tidak ditemukan.`);
    }

    // Validation: bill must belong to this santri
    if (lockedBill.santriId !== santriId) {
      throw new InvalidBillForSavingsPaymentError(
        `Tagihan "${lockedBill.judul}" bukan milik santri yang bersangkutan.`
      );
    }

    // Validation: bill must be of type 'kegiatan'
    if (lockedBill.tipe !== 'kegiatan') {
      throw new InvalidBillForSavingsPaymentError(
        `Pembayaran dari tabungan hanya dapat digunakan untuk tagihan kegiatan. Tipe tagihan ini adalah "${lockedBill.tipe}".`
      );
    }

    // Validation: bill must not be cancelled
    if (lockedBill.status === 'dibatalkan') {
      throw new InvalidBillForSavingsPaymentError(
        `Tagihan "${lockedBill.judul}" telah dibatalkan dan tidak dapat dibayar.`
      );
    }

    // Validation: bill must have outstanding balance
    const billSisa = Number(lockedBill.sisa);
    if (billSisa <= 0 || lockedBill.status === 'lunas') {
      throw new InvalidBillForSavingsPaymentError(`Tagihan "${lockedBill.judul}" sudah lunas.`);
    }

    // 3. Determine payment amount
    const amountToPay = nominal ? Math.min(nominal, billSisa) : billSisa;
    if (amountToPay <= 0) {
      throw new SavingsError('Nominal pembayaran tagihan dari tabungan harus lebih besar dari 0.');
    }

    // 4. Verify savings balance sufficiency
    const currentBalance = await getSantriSavingsBalance(santriId, tx);
    if (currentBalance < amountToPay) {
      throw new InsufficientSavingsBalanceError(amountToPay, currentBalance);
    }

    // 5. Insert negative ledger entry (pemakaian_kegiatan)
    const negativeNominal = -amountToPay;
    const memo = catatan?.trim() || `Pembayaran tagihan kegiatan: ${lockedBill.judul} dari tabungan`;

    const [newLedger] = await tx
      .insert(ledgerTabungan)
      .values({
        santriId,
        jenisMutasi: 'pemakaian_kegiatan',
        nominal: negativeNominal,
        referensiTipe: 'tagihan_kegiatan',
        referensiId: lockedBill.id,
        keterangan: memo,
        dibuatOlehId: adminId,
        disetujuiOlehId: adminId,
      })
      .returning();

    // 6. Update tagihan record
    const newTerbayar = Number(lockedBill.terbayar) + amountToPay;
    const newSisa = billSisa - amountToPay;
    const newStatus = newSisa === 0 ? ('lunas' as const) : ('sebagian' as const);

    await tx
      .update(tagihan)
      .set({
        terbayar: newTerbayar,
        sisa: newSisa,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(tagihan.id, lockedBill.id));

    const newBalance = currentBalance - amountToPay;

    // 7. Record Audit Log
    await tx.insert(auditLog).values({
      userId: adminId,
      action: 'tabungan_pemakaian_kegiatan',
      entityType: 'tagihan',
      entityId: lockedBill.id,
      oldValues: {
        santriId,
        tagihanId: lockedBill.id,
        terbayar: lockedBill.terbayar,
        sisa: lockedBill.sisa,
        status: lockedBill.status,
        saldoTabunganSebelum: currentBalance,
      },
      newValues: {
        ledgerId: newLedger.id,
        nominalDibayar: amountToPay,
        terbayarBaru: newTerbayar,
        sisaBaru: newSisa,
        statusBaru: newStatus,
        saldoTabunganSesudah: newBalance,
      },
      ipAddress,
      userAgent,
    });

    return {
      ledgerId: newLedger.id,
      santriId,
      tagihanId: lockedBill.id,
      tagihanJudul: lockedBill.judul,
      nominalDibayar: amountToPay,
      saldoSebelum: currentBalance,
      saldoSesudah: newBalance,
      tagihanSisaBaru: newSisa,
      tagihanStatusBaru: newStatus,
      waktu: newLedger.createdAt,
    };
  });
}

/**
 * Records audited savings correction without modifying historical transactions.
 */
export async function recordSavingsCorrection(
  arg1: any,
  arg2?: any
): Promise<SavingsCorrectionResult> {
  const targetDb: Database = arg2 ? arg1 : defaultDb;
  const input: RecordSavingsCorrectionInput = arg2 ? arg2 : arg1;
  const { santriId, nominal, alasan, adminId, referensiTipe, referensiId, ipAddress, userAgent } = input;

  if (nominal === 0) {
    throw new SavingsError('Nominal koreksi tidak boleh bernilai 0.');
  }

  if (!alasan || alasan.trim().length < 5) {
    throw new SavingsError('Alasan koreksi tabungan wajib diisi minimal 5 karakter.');
  }

  return await targetDb.transaction(async (tx) => {
    const [lockedSantri] = await tx
      .select()
      .from(santri)
      .where(eq(santri.id, santriId))
      .for('update');

    if (!lockedSantri) {
      throw new SantriNotFoundError(santriId);
    }

    const currentBalance = await getSantriSavingsBalance(santriId, tx);

    if (nominal < 0 && currentBalance + nominal < 0) {
      throw new InsufficientSavingsBalanceError(Math.abs(nominal), currentBalance);
    }

    const [newLedger] = await tx
      .insert(ledgerTabungan)
      .values({
        santriId,
        jenisMutasi: 'koreksi',
        nominal,
        referensiTipe: referensiTipe || 'koreksi',
        referensiId: referensiId || null,
        keterangan: `Koreksi: ${alasan.trim()}`,
        dibuatOlehId: adminId,
        disetujuiOlehId: adminId,
      })
      .returning();

    const newBalance = currentBalance + nominal;

    await tx.insert(auditLog).values({
      userId: adminId,
      action: 'tabungan_koreksi',
      entityType: 'ledger_tabungan',
      entityId: newLedger.id,
      oldValues: {
        santriId,
        saldoSebelum: currentBalance,
      },
      newValues: {
        nominalKoreksi: nominal,
        saldoSesudah: newBalance,
        alasan: alasan.trim(),
      },
      ipAddress,
      userAgent,
    });

    return {
      ledgerId: newLedger.id,
      santriId,
      nominalKoreksi: nominal,
      saldoSebelum: currentBalance,
      saldoSesudah: newBalance,
      alasan: alasan.trim(),
      waktu: newLedger.createdAt,
    };
  });
}
