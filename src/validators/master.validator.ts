import { z } from 'zod';

export const KomplekSchema = z.object({
  kode: z.string().min(2, 'Kode komplek minimal 2 karakter').max(10, 'Kode maksimal 10 karakter').toUpperCase(),
  nama: z.string().min(3, 'Nama komplek minimal 3 karakter').max(100),
  jenis: z.enum(['putra', 'putri'], { errorMap: () => ({ message: 'Jenis komplek harus putra atau putri' }) }),
  deskripsi: z.string().optional()
});
export type KomplekInput = z.infer<typeof KomplekSchema>;

export const KategoriSchema = z.object({
  kode: z.enum(['pengurus', 'non_pengurus', 'mbak_ndalem']),
  nama: z.string().min(2, 'Nama kategori minimal 2 karakter').max(50),
  deskripsi: z.string().optional()
});
export type KategoriInput = z.infer<typeof KategoriSchema>;

export const SantriCreateSchema = z.object({
  nis: z.string().trim().min(3, 'NIS minimal 3 karakter').max(50, 'NIS maksimal 50 karakter'),
  nama: z.string().trim().min(2, 'Nama santri wajib diisi').max(100),
  komplekId: z.string().uuid('Pilih komplek yang valid'),
  kategoriId: z.string().uuid('Pilih kategori santri yang valid'),
  tanggalMasuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  status: z.enum(['aktif', 'boyong']).default('aktif'),
  nomorWhatsapp: z.string().trim().min(9, 'Nomor WhatsApp wajib diisi'),
  namaWali: z.string().trim().optional(),
  nomorWhatsappWali: z.string().trim().optional(),
  alamat: z.string().trim().optional(),
  saldoAwalTabungan: z.number().int().nonnegative().optional().default(0),
});
export type SantriCreateInput = z.infer<typeof SantriCreateSchema>;

export const SantriUpdateSchema = SantriCreateSchema.partial().extend({
  id: z.string().uuid(),
});
export type SantriUpdateInput = z.infer<typeof SantriUpdateSchema>;

export const TarifUpdateSchema = z.object({
  komplekId: z.string().uuid(),
  kategoriId: z.string().uuid(),
  nominal: z.number().int().min(50000, 'Nominal syahriah minimal Rp50.000 (untuk alokasi tabungan)'),
  berlakuMulai: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
});
export type TarifUpdateInput = z.infer<typeof TarifUpdateSchema>;
