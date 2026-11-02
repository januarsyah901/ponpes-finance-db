import { pgTable, uuid, text, timestamp, date, bigint, pgEnum, index } from 'drizzle-orm/pg-core';
import { komplek } from './master';
import { pengguna } from './auth';

export const pengeluaranStatusEnum = pgEnum('pengeluaran_status', ['aktif', 'dibatalkan']);

export const kategoriPengeluaran = pgTable('kategori_pengeluaran', {
  id: uuid('id').defaultRandom().primaryKey(),
  nama: text('nama').notNull().unique(),
  deskripsi: text('deskripsi'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const pengeluaran = pgTable('pengeluaran', {
  id: uuid('id').defaultRandom().primaryKey(),
  komplekId: uuid('komplek_id').notNull().references(() => komplek.id, { onDelete: 'restrict' }),
  kategoriPengeluaranId: uuid('kategori_pengeluaran_id').notNull().references(() => kategoriPengeluaran.id, { onDelete: 'restrict' }),
  tanggal: date('tanggal').notNull(),
  nominal: bigint('nominal', { mode: 'number' }).notNull(),
  keterangan: text('keterangan').notNull(),
  buktiUrl: text('bukti_url'),
  status: pengeluaranStatusEnum('status').notNull().default('aktif'),
  dibatalkanPada: timestamp('dibatalkan_pada', { withTimezone: true }),
  alasanBatal: text('alasan_batal'),
  dibatalkanOlehId: uuid('dibatalkan_oleh_id').references(() => pengguna.id),
  dibuatOlehId: uuid('dibuat_oleh_id').references(() => pengguna.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  komplekTanggalIdx: index('pengeluaran_komplek_tanggal_idx').on(table.komplekId, table.tanggal)
}));
