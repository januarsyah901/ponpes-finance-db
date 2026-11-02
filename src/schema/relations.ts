import { relations } from 'drizzle-orm';
import { pengguna, penggunaKomplek } from './auth';
import { komplek, kategori, santri, tarifSyahriah } from './master';
import { tagihan, pembayaran, alokasiPembayaran } from './billing';
import { ledgerTabungan } from './savings';
import { aturanSubsidi, subsidiPenerima } from './subsidy';
import { kategoriPengeluaran, pengeluaran } from './expenses';
import { auditLog } from './audit';

export const penggunaRelations = relations(pengguna, ({ one, many }) => ({
  santri: one(santri, { fields: [pengguna.santriId], references: [santri.id] }),
  assignedKomplek: many(penggunaKomplek),
  auditLogs: many(auditLog),
  verifiedPayments: many(pembayaran, { relationName: 'verifier' }),
}));

export const penggunaKomplekRelations = relations(penggunaKomplek, ({ one }) => ({
  pengguna: one(pengguna, { fields: [penggunaKomplek.userId], references: [pengguna.id] }),
  komplek: one(komplek, { fields: [penggunaKomplek.komplekId], references: [komplek.id] }),
}));

export const komplekRelations = relations(komplek, ({ many }) => ({
  santri: many(santri),
  tarifSyahriah: many(tarifSyahriah),
  tagihan: many(tagihan),
  pengeluaran: many(pengeluaran),
  penggunaKomplek: many(penggunaKomplek),
}));

export const kategoriRelations = relations(kategori, ({ many }) => ({
  santri: many(santri),
  tarifSyahriah: many(tarifSyahriah),
}));

export const santriRelations = relations(santri, ({ one, many }) => ({
  komplek: one(komplek, { fields: [santri.komplekId], references: [komplek.id] }),
  kategori: one(kategori, { fields: [santri.kategoriId], references: [kategori.id] }),
  tagihan: many(tagihan),
  pembayaran: many(pembayaran),
  ledgerTabungan: many(ledgerTabungan),
  subsidiPenerima: many(subsidiPenerima),
}));

export const tarifSyahriahRelations = relations(tarifSyahriah, ({ one }) => ({
  komplek: one(komplek, { fields: [tarifSyahriah.komplekId], references: [komplek.id] }),
  kategori: one(kategori, { fields: [tarifSyahriah.kategoriId], references: [kategori.id] }),
}));

export const tagihanRelations = relations(tagihan, ({ one, many }) => ({
  santri: one(santri, { fields: [tagihan.santriId], references: [santri.id] }),
  komplek: one(komplek, { fields: [tagihan.komplekId], references: [komplek.id] }),
  alokasiPembayaran: many(alokasiPembayaran),
  aturanSubsidi: many(aturanSubsidi),
}));

export const pembayaranRelations = relations(pembayaran, ({ one, many }) => ({
  santri: one(santri, { fields: [pembayaran.santriId], references: [santri.id] }),
  komplek: one(komplek, { fields: [pembayaran.komplekId], references: [komplek.id] }),
  diverifikasiOleh: one(pengguna, { fields: [pembayaran.diverifikasiOlehId], references: [pengguna.id], relationName: 'verifier' }),
  alokasiPembayaran: many(alokasiPembayaran),
}));

export const alokasiPembayaranRelations = relations(alokasiPembayaran, ({ one }) => ({
  pembayaran: one(pembayaran, { fields: [alokasiPembayaran.pembayaranId], references: [pembayaran.id] }),
  tagihan: one(tagihan, { fields: [alokasiPembayaran.tagihanId], references: [tagihan.id] }),
}));

export const ledgerTabunganRelations = relations(ledgerTabungan, ({ one }) => ({
  santri: one(santri, { fields: [ledgerTabungan.santriId], references: [santri.id] }),
  dibuatOleh: one(pengguna, { fields: [ledgerTabungan.dibuatOlehId], references: [pengguna.id] }),
}));

export const aturanSubsidiRelations = relations(aturanSubsidi, ({ one, many }) => ({
  tagihanKegiatan: one(tagihan, { fields: [aturanSubsidi.tagihanKegiatanId], references: [tagihan.id] }),
  penerima: many(subsidiPenerima),
}));

export const subsidiPenerimaRelations = relations(subsidiPenerima, ({ one }) => ({
  aturanSubsidi: one(aturanSubsidi, { fields: [subsidiPenerima.aturanSubsidiId], references: [aturanSubsidi.id] }),
  santri: one(santri, { fields: [subsidiPenerima.santriId], references: [santri.id] }),
  tagihan: one(tagihan, { fields: [subsidiPenerima.tagihanId], references: [tagihan.id] }),
  ledgerTabungan: one(ledgerTabungan, { fields: [subsidiPenerima.ledgerTabunganId], references: [ledgerTabungan.id] }),
}));

export const kategoriPengeluaranRelations = relations(kategoriPengeluaran, ({ many }) => ({
  pengeluaran: many(pengeluaran),
}));

export const pengeluaranRelations = relations(pengeluaran, ({ one }) => ({
  komplek: one(komplek, { fields: [pengeluaran.komplekId], references: [komplek.id] }),
  kategori: one(kategoriPengeluaran, { fields: [pengeluaran.kategoriPengeluaranId], references: [kategoriPengeluaran.id] }),
  dibuatOleh: one(pengguna, { fields: [pengeluaran.dibuatOlehId], references: [pengguna.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(pengguna, { fields: [auditLog.userId], references: [pengguna.id] }),
}));
