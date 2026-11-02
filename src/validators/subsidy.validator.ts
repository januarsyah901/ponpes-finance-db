import { z } from 'zod';

export const SubsidyCakupanSchema = z.enum(['nominal_tetap', 'lunas_penuh']);
export type SubsidyCakupan = z.infer<typeof SubsidyCakupanSchema>;

export const SubsidySumberDanaSchema = z.enum(['bantuan_langsung', 'potong_tabungan']);
export type SubsidySumberDana = z.infer<typeof SubsidySumberDanaSchema>;

export const SubsidyTipeTargetSchema = z.enum(['syahriah', 'kegiatan']);
export type SubsidyTipeTarget = z.infer<typeof SubsidyTipeTargetSchema>;

export const SubsidySyaratJsonSchema = z.object({
  // 1. Scoping criteria (null / undefined applies to all)
  komplekId: z.string().uuid().nullable().optional(),
  kategoriId: z.string().uuid().nullable().optional(),
  komplekIds: z.array(z.string().uuid()).optional(),
  kategoriIds: z.array(z.string().uuid()).optional(),

  // 2. Santri financial & tenure criteria (AND conditions)
  minTagihanTertunggak: z.number().int().nonnegative().optional(),
  maxSaldoTabungan: z.number().int().nonnegative().optional(),
  minLamaMondokBulan: z.number().int().nonnegative().optional(),
  minLamaMondokHari: z.number().int().nonnegative().optional(),
  maksTanggalMasuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  syahriahLunasSampai: z.string().regex(/^\d{4}-\d{2}$/).optional(),

  // 3. Operational behavior
  cakupan: SubsidyCakupanSchema.default('nominal_tetap'),
  sumberDana: SubsidySumberDanaSchema.default('bantuan_langsung'),
  tipeTarget: SubsidyTipeTargetSchema.default('syahriah'),
});
export type SubsidySyaratJson = z.infer<typeof SubsidySyaratJsonSchema>;

export const CreateSubsidyRuleSchema = z.object({
  nama: z.string().min(3, 'Nama aturan subsidi minimal 3 karakter').trim(),
  nominal: z.number().int().nonnegative('Nominal subsidi tidak boleh negatif'),
  tagihanKegiatanId: z.string().uuid().nullable().optional(),
  syaratJson: SubsidySyaratJsonSchema,
  isActive: z.boolean().default(true),
});
export type CreateSubsidyRuleInput = z.infer<typeof CreateSubsidyRuleSchema>;

export const PreviewSubsidySchema = z.object({
  aturanId: z.string().uuid(),
  bulan: z.number().int().min(1).max(12).optional(),
  tahun: z.number().int().min(2020).max(2050).optional(),
  komplekId: z.string().uuid().optional(),
});
export type PreviewSubsidyInput = z.infer<typeof PreviewSubsidySchema>;

export const ExecuteSubsidySchema = z.object({
  aturanId: z.string().uuid(),
  bulan: z.number().int().min(1).max(12).optional(),
  tahun: z.number().int().min(2020).max(2050).optional(),
  adminUserId: z.string().uuid(),
  selectedSantriIds: z.array(z.string().uuid()).optional(),
});
export type ExecuteSubsidyInput = z.infer<typeof ExecuteSubsidySchema>;
