import { pgTable, uuid, text, timestamp, bigint, jsonb, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tagihan } from './billing';
import { santri } from './master';
import { pengguna } from './auth';
import { ledgerTabungan } from './savings';

export const aturanSubsidi = pgTable('aturan_subsidi', {
  id: uuid('id').defaultRandom().primaryKey(),
  tagihanKegiatanId: uuid('tagihan_kegiatan_id').references(() => tagihan.id, { onDelete: 'restrict' }),
  nama: text('nama').notNull(),
  nominal: bigint('nominal', { mode: 'number' }).notNull(),
  syaratJson: jsonb('syarat_json').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  dibuatOlehId: uuid('dibuat_oleh_id').references(() => pengguna.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  tagihanKegiatanIdx: index('aturan_subsidi_tagihan_kegiatan_idx').on(table.tagihanKegiatanId)
}));

export const subsidiPenerima = pgTable('subsidi_penerima', {
  id: uuid('id').defaultRandom().primaryKey(),
  aturanSubsidiId: uuid('aturan_subsidi_id').notNull().references(() => aturanSubsidi.id, { onDelete: 'restrict' }),
  santriId: uuid('santri_id').notNull().references(() => santri.id, { onDelete: 'restrict' }),
  tagihanId: uuid('tagihan_id').notNull().references(() => tagihan.id, { onDelete: 'restrict' }),
  nominalDiterima: bigint('nominal_diterima', { mode: 'number' }).notNull(),
  ledgerTabunganId: uuid('ledger_tabungan_id').references(() => ledgerTabungan.id),
  diterapkanPada: timestamp('diterapkan_pada', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  uniqueRuleSantri: uniqueIndex('subsidi_rule_santri_uidx').on(table.aturanSubsidiId, table.santriId),
  santriIdx: index('subsidi_penerima_santri_idx').on(table.santriId)
}));
