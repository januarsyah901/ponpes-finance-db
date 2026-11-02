import { pgTable, uuid, text, timestamp, date, integer, bigint, boolean, pgEnum, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { santri, komplek } from './master';
import { pengguna } from './auth';

export const tagihanTipeEnum = pgEnum('tagihan_tipe', ['syahriah', 'kegiatan']);
export const tagihanStatusEnum = pgEnum('tagihan_status', ['belum_bayar', 'sebagian', 'lunas', 'dibatalkan']);
export const metodePembayaranEnum = pgEnum('metode_pembayaran', ['transfer', 'tunai', 'subsidi']);
export const statusPembayaranEnum = pgEnum('status_pembayaran', ['menunggu_verifikasi', 'terverifikasi', 'ditolak']);

export const tagihan = pgTable('tagihan', {
  id: uuid('id').defaultRandom().primaryKey(),
  santriId: uuid('santri_id').notNull().references(() => santri.id, { onDelete: 'restrict' }),
  komplekId: uuid('komplek_id').notNull().references(() => komplek.id, { onDelete: 'restrict' }),
  tipe: tagihanTipeEnum('tipe').notNull().default('syahriah'),
  judul: text('judul').notNull(),
  bulan: integer('bulan'),        // 1..12 (for syahriah)
  tahun: integer('tahun'),        // e.g. 2026
  jatuhTempo: date('jatuh_tempo').notNull(),
  nominal: bigint('nominal', { mode: 'number' }).notNull(),
  terbayar: bigint('terbayar', { mode: 'number' }).notNull().default(0),
  sisa: bigint('sisa', { mode: 'number' }).notNull(),
  status: tagihanStatusEnum('status').notNull().default('belum_bayar'),
  alasanBatal: text('alasan_batal'),
  dibatalkanPada: timestamp('dibatalkan_pada', { withTimezone: true }),
  dibatalkanOlehId: uuid('dibatalkan_oleh_id').references(() => pengguna.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  santriJatuhTempoIdx: index('tagihan_santri_jatuh_tempo_idx').on(table.santriId, table.jatuhTempo),
  santriStatusIdx: index('tagihan_santri_status_idx').on(table.santriId, table.status),
  komplekStatusIdx: index('tagihan_komplek_status_idx').on(table.komplekId, table.status),
  nominalCheck: check('tagihan_nominal_check', sql`${table.nominal} >= 0`),
  terbayarCheck: check('tagihan_terbayar_check', sql`${table.terbayar} >= 0`),
  sisaCheck: check('tagihan_sisa_check', sql`${table.sisa} >= 0`),
}));

export const pembayaran = pgTable('pembayaran', {
  id: uuid('id').defaultRandom().primaryKey(),
  santriId: uuid('santri_id').notNull().references(() => santri.id, { onDelete: 'restrict' }),
  komplekId: uuid('komplek_id').notNull().references(() => komplek.id, { onDelete: 'restrict' }),
  metode: metodePembayaranEnum('metode').notNull(),
  nominal: bigint('nominal', { mode: 'number' }).notNull(),
  nominalDiverifikasi: bigint('nominal_diverifikasi', { mode: 'number' }),
  tanggalBayar: date('tanggal_bayar').notNull(),
  buktiUrl: text('bukti_url'),
  catatanSantri: text('catatan_santri'),
  status: statusPembayaranEnum('status').notNull().default('menunggu_verifikasi'),
  diverifikasiOlehId: uuid('diverifikasi_oleh_id').references(() => pengguna.id),
  diverifikasiPada: timestamp('diverifikasi_pada', { withTimezone: true }),
  alasanPenolakan: text('alasan_penolakan'),
  isReversal: boolean('is_reversal').notNull().default(false),
  reversalOfId: uuid('reversal_of_id'),
  alasanReversal: text('alasan_reversal'),
  isSubsidi: boolean('is_subsidi').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  santriStatusIdx: index('pembayaran_santri_status_idx').on(table.santriId, table.status),
  komplekStatusIdx: index('pembayaran_komplek_status_idx').on(table.komplekId, table.status)
}));

export const alokasiPembayaran = pgTable('alokasi_pembayaran', {
  id: uuid('id').defaultRandom().primaryKey(),
  pembayaranId: uuid('pembayaran_id').notNull().references(() => pembayaran.id, { onDelete: 'restrict' }),
  tagihanId: uuid('tagihan_id').notNull().references(() => tagihan.id, { onDelete: 'restrict' }),
  nominalAlokasi: bigint('nominal_alokasi', { mode: 'number' }).notNull(),
  alokasiTabungan: bigint('alokasi_tabungan', { mode: 'number' }).notNull().default(0),
  alokasiOperasional: bigint('alokasi_operasional', { mode: 'number' }).notNull().default(0),
  isReversal: boolean('is_reversal').notNull().default(false),
  isSubsidi: boolean('is_subsidi').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  pembayaranIdx: index('alokasi_pembayaran_pembayaran_idx').on(table.pembayaranId),
  tagihanIdx: index('alokasi_pembayaran_tagihan_idx').on(table.tagihanId),
  allocationSumCheck: check(
    'alokasi_sum_check',
    sql`${table.nominalAlokasi} = (${table.alokasiTabungan} + ${table.alokasiOperasional})`
  )
}));
