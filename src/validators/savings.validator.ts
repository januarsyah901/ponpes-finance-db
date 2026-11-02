import { z } from 'zod';

export const CreateEventBillsSchema = z.object({
  judul: z.string().min(3, 'Judul tagihan kegiatan minimal 3 karakter').trim(),
  nominal: z.number().int().positive('Nominal tagihan harus lebih dari 0'),
  jatuhTempo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  target: z.object({
    komplekIds: z.array(z.string().uuid()).optional(),
    kategoriIds: z.array(z.string().uuid()).optional(),
    santriIds: z.array(z.string().uuid()).optional(),
  }),
  keterangan: z.string().optional(),
});

export const PayEventBillFromSavingsSchema = z.object({
  santriId: z.string().uuid('ID santri tidak valid'),
  tagihanId: z.string().uuid('ID tagihan tidak valid'),
  nominal: z.number().int().positive('Nominal pembayaran harus lebih dari 0').optional(),
  catatan: z.string().max(255).optional(),
});

export const RecordSavingsWithdrawalSchema = z.object({
  santriId: z.string().uuid('ID santri tidak valid'),
  nominal: z.number().int().positive('Nominal penarikan harus lebih dari 0'),
  jenis: z.enum(['penarikan_boyong', 'penarikan_mendesak']),
  alasan: z.string().min(5, 'Alasan penarikan wajib diisi minimal 5 karakter').trim(),
});
