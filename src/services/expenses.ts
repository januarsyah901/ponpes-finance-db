import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { pengeluaran, kategoriPengeluaran } from '../schema/expenses';
import { auditLog } from '../schema/audit';
import type { Database } from '../client';

export interface CreatePengeluaranInput {
  komplekId: string;
  kategoriPengeluaranId: string;
  tanggal: string; // YYYY-MM-DD
  nominal: number;
  keterangan: string;
  buktiUrl?: string | null;
  dibuatOlehId?: string | null;
}

export interface CancelPengeluaranInput {
  pengeluaranId: string;
  alasanBatal: string;
  dibatalkanOlehId: string;
}

export interface ListPengeluaranFilter {
  komplekId?: string;
  startDate?: string;
  endDate?: string;
  kategoriId?: string;
  status?: 'aktif' | 'dibatalkan';
}

/**
 * Buat pengeluaran baru
 */
export async function createPengeluaran(db: Database | any, input: CreatePengeluaranInput) {
  if (input.nominal <= 0) {
    throw new Error('Nominal pengeluaran harus lebih besar dari Rp 0');
  }

  const [newExpense] = await db
    .insert(pengeluaran)
    .values({
      komplekId: input.komplekId,
      kategoriPengeluaranId: input.kategoriPengeluaranId,
      tanggal: input.tanggal,
      nominal: input.nominal,
      keterangan: input.keterangan,
      buktiUrl: input.buktiUrl || null,
      dibuatOlehId: input.dibuatOlehId || null,
      status: 'aktif',
    })
    .returning();

  // Audit Log
  await db.insert(auditLog).values({
    userId: input.dibuatOlehId || null,
    action: 'CREATE_PENGELUARAN',
    entityType: 'pengeluaran',
    entityId: newExpense.id,
    newValues: newExpense,
  });

  return newExpense;
}

/**
 * Batalkan pengeluaran dengan alasan pembatalan (audit reversal)
 */
export async function cancelPengeluaran(db: Database | any, input: CancelPengeluaranInput) {
  if (!input.alasanBatal || input.alasanBatal.trim() === '') {
    throw new Error('Alasan pembatalan pengeluaran wajib diisi');
  }

  const [existing] = await db
    .select()
    .from(pengeluaran)
    .where(eq(pengeluaran.id, input.pengeluaranId));

  if (!existing) {
    throw new Error('Pengeluaran tidak ditemukan');
  }

  if (existing.status === 'dibatalkan') {
    throw new Error('Pengeluaran sudah dibatalkan sebelumnya');
  }

  const [cancelled] = await db
    .update(pengeluaran)
    .set({
      status: 'dibatalkan',
      alasanBatal: input.alasanBatal,
      dibatalkanPada: new Date(),
      dibatalkanOlehId: input.dibatalkanOlehId,
    })
    .where(eq(pengeluaran.id, input.pengeluaranId))
    .returning();

  // Audit Log
  await db.insert(auditLog).values({
    userId: input.dibatalkanOlehId,
    action: 'CANCEL_PENGELUARAN',
    entityType: 'pengeluaran',
    entityId: existing.id,
    oldValues: existing,
    newValues: cancelled,
  });

  return cancelled;
}

/**
 * Daftar pengeluaran dengan filter
 */
export async function listPengeluaran(db: Database | any, filter?: ListPengeluaranFilter) {
  const conditions = [];

  if (filter?.komplekId) {
    conditions.push(eq(pengeluaran.komplekId, filter.komplekId));
  }
  if (filter?.status) {
    conditions.push(eq(pengeluaran.status, filter.status));
  }
  if (filter?.kategoriId) {
    conditions.push(eq(pengeluaran.kategoriPengeluaranId, filter.kategoriId));
  }
  if (filter?.startDate) {
    conditions.push(gte(pengeluaran.tanggal, filter.startDate));
  }
  if (filter?.endDate) {
    conditions.push(lte(pengeluaran.tanggal, filter.endDate));
  }

  return (db as any).query.pengeluaran.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(pengeluaran.tanggal), desc(pengeluaran.createdAt)],
    with: {
      kategoriPengeluaran: true,
      komplek: true,
      dibuatOleh: true,
    },
  });
}

/**
 * Kategori Pengeluaran
 */
export async function listKategoriPengeluaran(db: Database | any) {
  return db.select().from(kategoriPengeluaran).orderBy(kategoriPengeluaran.nama);
}

export async function createKategoriPengeluaran(
  db: Database | any,
  input: { nama: string; deskripsi?: string }
) {
  const [created] = await db
    .insert(kategoriPengeluaran)
    .values({
      nama: input.nama.trim(),
      deskripsi: input.deskripsi || null,
    })
    .returning();
  return created;
}
