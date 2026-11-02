import { pgTable, uuid, text, timestamp, date, boolean, bigint, pgEnum, index } from 'drizzle-orm/pg-core';

export const santriStatusEnum = pgEnum('santri_status', ['aktif', 'boyong']);
export const santriKategoriEnum = pgEnum('santri_kategori', ['pengurus', 'non_pengurus', 'mbak_ndalem']);

export const komplek = pgTable('komplek', {
  id: uuid('id').defaultRandom().primaryKey(),
  kode: text('kode').notNull().unique(), // PA1, PA2, PA3, PI1, PI2, PI3
  nama: text('nama').notNull(),          // e.g. "Komplek Al-Falah (Putra 1)"
  jenis: text('jenis').notNull(),         // "putra" | "putri"
  deskripsi: text('deskripsi'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const kategori = pgTable('kategori', {
  id: uuid('id').defaultRandom().primaryKey(),
  kode: santriKategoriEnum('kode').notNull().unique(), // pengurus, non_pengurus, mbak_ndalem
  nama: text('nama').notNull(),
  deskripsi: text('deskripsi'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const santri = pgTable('santri', {
  id: uuid('id').defaultRandom().primaryKey(),
  nis: text('nis').notNull().unique(),
  nama: text('nama').notNull(),
  komplekId: uuid('komplek_id').notNull().references(() => komplek.id, { onDelete: 'restrict' }),
  kategoriId: uuid('kategori_id').notNull().references(() => kategori.id, { onDelete: 'restrict' }),
  tanggalMasuk: date('tanggal_masuk').notNull(),
  status: santriStatusEnum('status').notNull().default('aktif'),
  nomorWhatsapp: text('nomor_whatsapp').notNull(),
  namaWali: text('nama_wali'),
  nomorWhatsappWali: text('nomor_whatsapp_wali'),
  alamat: text('alamat'),
  terakhirDiingatkan: timestamp('terakhir_diingatkan', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  nisIdx: index('santri_nis_idx').on(table.nis),
  komplekStatusIdx: index('santri_komplek_status_idx').on(table.komplekId, table.status)
}));

export const tarifSyahriah = pgTable('tarif_syahriah', {
  id: uuid('id').defaultRandom().primaryKey(),
  komplekId: uuid('komplek_id').notNull().references(() => komplek.id, { onDelete: 'restrict' }),
  kategoriId: uuid('kategori_id').notNull().references(() => kategori.id, { onDelete: 'restrict' }),
  nominal: bigint('nominal', { mode: 'number' }).notNull(),
  alokasiTabungan: bigint('alokasi_tabungan', { mode: 'number' }).notNull().default(50000), // Fixed Rp50.000
  alokasiOperasional: bigint('alokasi_operasional', { mode: 'number' }).notNull(), // nominal - 50000
  berlakuMulai: date('berlaku_mulai').notNull(),
  berlakuSampai: date('berlaku_sampai'), // NULL indicates currently active
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  komplekKategoriIdx: index('tarif_komplek_kategori_idx').on(table.komplekId, table.kategoriId)
}));
