import { pgTable, uuid, text, timestamp, bigint, pgEnum, index } from 'drizzle-orm/pg-core';
import { santri } from './master';
import { pengguna } from './auth';

export const jenisMutasiTabunganEnum = pgEnum('jenis_mutasi_tabungan', [
  'setoran_syahriah',
  'saldo_awal',
  'pemakaian_kegiatan',
  'penarikan_boyong',
  'penarikan_mendesak',
  'koreksi'
]);

export const ledgerTabungan = pgTable('ledger_tabungan', {
  id: uuid('id').defaultRandom().primaryKey(),
  santriId: uuid('santri_id').notNull().references(() => santri.id, { onDelete: 'restrict' }),
  jenisMutasi: jenisMutasiTabunganEnum('jenis_mutasi').notNull(),
  nominal: bigint('nominal', { mode: 'number' }).notNull(), // Signed: positive = credit, negative = debit
  referensiTipe: text('referensi_tipe'), // e.g. "pembayaran", "tagihan_kegiatan", "penarikan"
  referensiId: uuid('referensi_id'),
  keterangan: text('keterangan').notNull(),
  dibuatOlehId: uuid('dibuat_oleh_id').references(() => pengguna.id),
  disetujuiOlehId: uuid('disetujui_oleh_id').references(() => pengguna.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  santriIdx: index('ledger_santri_idx').on(table.santriId),
  santriCreatedIdx: index('ledger_santri_created_idx').on(table.santriId, table.createdAt)
}));
