import { z } from 'zod';

export * from './master.validator';

export const SantriStatusSchema = z.enum(['aktif', 'boyong']);
export const SantriKategoriSchema = z.enum(['pengurus', 'non_pengurus', 'mbak_ndalem']);
export const UserRoleSchema = z.enum(['super_admin', 'bendahara_komplek', 'santri', 'pengasuh']);
export const TagihanTipeSchema = z.enum(['syahriah', 'kegiatan']);
export const TagihanStatusSchema = z.enum(['belum_bayar', 'sebagian', 'lunas', 'dibatalkan']);
export const MetodePembayaranSchema = z.enum(['transfer', 'tunai', 'subsidi']);
export const StatusPembayaranSchema = z.enum(['menunggu_verifikasi', 'terverifikasi', 'ditolak']);
export const JenisMutasiTabunganSchema = z.enum([
  'setoran_syahriah',
  'saldo_awal',
  'pemakaian_kegiatan',
  'penarikan_boyong',
  'penarikan_mendesak',
  'koreksi'
]);

// Excel Santri Import Row Schema
export const SantriImportRowSchema = z.object({
  nis: z.string().min(1, 'NIS wajib diisi').trim(),
  nama: z.string().min(1, 'Nama wajib diisi').trim(),
  komplekKode: z.string().min(1, 'Kode komplek wajib diisi').trim(),
  kategoriKode: SantriKategoriSchema,
  tanggalMasuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').refine((val) => {
    const [y, m, d] = val.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const date = new Date(val);
    return !isNaN(date.getTime()) && date.toISOString().startsWith(val);
  }, 'Tanggal tidak valid'),
  nomorWhatsapp: z.string().min(9, 'Nomor WhatsApp tidak valid').trim(),
  namaWali: z.string().optional(),
  nomorWhatsappWali: z.string().optional(),
  alamat: z.string().optional(),
  saldoAwalTabungan: z.number().int().nonnegative().optional().default(0),
});
export type SantriImportRow = z.infer<typeof SantriImportRowSchema>;

// Bulk Syahriah Generation Schema
export const BulkSyahriahGenerateSchema = z.object({
  bulan: z.number().int().min(1).max(12),
  tahun: z.number().int().min(2020).max(2050),
  jatuhTempo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  komplekId: z.string().uuid().optional(), // If undefined, applies to all complexes
});
export type BulkSyahriahGenerateInput = z.infer<typeof BulkSyahriahGenerateSchema>;

// Payment Submission Schema (by Santri)
export const PaymentSubmitSchema = z.object({
  santriId: z.string().uuid(),
  nominal: z.number().int().positive('Nominal pembayaran harus lebih dari 0'),
  tanggalBayar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  catatanSantri: z.string().max(255).optional(),
  buktiUrl: z.string().min(1, 'Bukti transfer wajib diunggah'),
});
export type PaymentSubmitInput = z.infer<typeof PaymentSubmitSchema>;

// Payment Verification Schema (by Bendahara)
export const PaymentVerifySchema = z.object({
  pembayaranId: z.string().uuid(),
  status: z.enum(['terverifikasi', 'ditolak']),
  nominalDiverifikasi: z.number().int().positive().optional(),
  alasanPenolakan: z.string().min(1, 'Alasan penolakan wajib diisi jika ditolak').optional(),
}).refine((data) => {
  if (data.status === 'ditolak' && !data.alasanPenolakan) {
    return false;
  }
  return true;
}, {
  message: 'Alasan penolakan wajib diisi bila status pembayaran ditolak',
  path: ['alasanPenolakan'],
});
export type PaymentVerifyInput = z.infer<typeof PaymentVerifySchema>;

// Manual Cash Payment Recording Schema (by Bendahara)
export const CashPaymentCreateSchema = z.object({
  santriId: z.string().uuid(),
  nominal: z.number().int().positive('Nominal harus lebih dari 0'),
  tanggalBayar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  catatan: z.string().max(255).optional(),
});
export type CashPaymentCreateInput = z.infer<typeof CashPaymentCreateSchema>;

// Savings Withdrawal Schema
export const SavingsWithdrawalSchema = z.object({
  santriId: z.string().uuid(),
  nominal: z.number().int().positive('Nominal penarikan harus lebih dari 0'),
  jenisMutasi: z.enum(['penarikan_boyong', 'penarikan_mendesak', 'pemakaian_kegiatan']),
  keterangan: z.string().min(5, 'Keterangan penarikan wajib diisi dengan jelas'),
});
export type SavingsWithdrawalInput = z.infer<typeof SavingsWithdrawalSchema>;

// Re-export savings & subsidy validators
export * from './savings.validator';
export * from './subsidy.validator';

// Subsidy Rule Creation Schema (backwards-compatible alias)
export const SubsidyRuleCreateSchema = z.object({
  tagihanKegiatanId: z.string().uuid().nullable().optional(),
  nama: z.string().min(3, 'Nama aturan subsidi wajib diisi'),
  nominal: z.number().int().positive('Nominal subsidi harus lebih dari 0'),
  syaratJson: z.object({
    syahriahLunasSampai: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    minLamaMondokBulan: z.number().int().nonnegative().optional(),
    kategoriIds: z.array(z.string().uuid()).optional(),
    komplekIds: z.array(z.string().uuid()).optional(),
  }).passthrough(),
});
export type SubsidyRuleCreateInput = z.infer<typeof SubsidyRuleCreateSchema>;

// Operational Expense Schema
export const ExpenseCreateSchema = z.object({
  komplekId: z.string().uuid(),
  kategoriPengeluaranId: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  nominal: z.number().int().positive('Nominal pengeluaran harus lebih dari 0'),
  keterangan: z.string().min(3, 'Keterangan pengeluaran wajib diisi'),
  buktiUrl: z.string().optional(),
});
export type ExpenseCreateInput = z.infer<typeof ExpenseCreateSchema>;
