import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../schema';

// Inferred Drizzle Entity Types
export type Pengguna = InferSelectModel<typeof schema.pengguna>;
export type NewPengguna = InferInsertModel<typeof schema.pengguna>;

export type PenggunaKomplek = InferSelectModel<typeof schema.penggunaKomplek>;
export type NewPenggunaKomplek = InferInsertModel<typeof schema.penggunaKomplek>;

export type Komplek = InferSelectModel<typeof schema.komplek>;
export type NewKomplek = InferInsertModel<typeof schema.komplek>;

export type Kategori = InferSelectModel<typeof schema.kategori>;
export type NewKategori = InferInsertModel<typeof schema.kategori>;

export type Santri = InferSelectModel<typeof schema.santri>;
export type NewSantri = InferInsertModel<typeof schema.santri>;

export type TarifSyahriah = InferSelectModel<typeof schema.tarifSyahriah>;
export type NewTarifSyahriah = InferInsertModel<typeof schema.tarifSyahriah>;

export type Tagihan = InferSelectModel<typeof schema.tagihan>;
export type NewTagihan = InferInsertModel<typeof schema.tagihan>;

export type Pembayaran = InferSelectModel<typeof schema.pembayaran>;
export type NewPembayaran = InferInsertModel<typeof schema.pembayaran>;

export type AlokasiPembayaran = InferSelectModel<typeof schema.alokasiPembayaran>;
export type NewAlokasiPembayaran = InferInsertModel<typeof schema.alokasiPembayaran>;

export type LedgerTabungan = InferSelectModel<typeof schema.ledgerTabungan>;
export type NewLedgerTabungan = InferInsertModel<typeof schema.ledgerTabungan>;

export type AturanSubsidi = InferSelectModel<typeof schema.aturanSubsidi>;
export type NewAturanSubsidi = InferInsertModel<typeof schema.aturanSubsidi>;

export type SubsidiPenerima = InferSelectModel<typeof schema.subsidiPenerima>;
export type NewSubsidiPenerima = InferInsertModel<typeof schema.subsidiPenerima>;

export type KategoriPengeluaran = InferSelectModel<typeof schema.kategoriPengeluaran>;
export type NewKategoriPengeluaran = InferInsertModel<typeof schema.kategoriPengeluaran>;

export type Pengeluaran = InferSelectModel<typeof schema.pengeluaran>;
export type NewPengeluaran = InferInsertModel<typeof schema.pengeluaran>;

export type AuditLog = InferSelectModel<typeof schema.auditLog>;
export type NewAuditLog = InferInsertModel<typeof schema.auditLog>;

// Enums as TS types
export type UserRole = 'super_admin' | 'bendahara_komplek' | 'santri' | 'pengasuh';
export type SantriStatus = 'aktif' | 'boyong';
export type SantriKategori = 'pengurus' | 'non_pengurus' | 'mbak_ndalem';
export type TagihanTipe = 'syahriah' | 'kegiatan';
export type TagihanStatus = 'belum_bayar' | 'sebagian' | 'lunas' | 'dibatalkan';
export type MetodePembayaran = 'transfer' | 'tunai';
export type StatusPembayaran = 'menunggu_verifikasi' | 'terverifikasi' | 'ditolak';
export type JenisMutasiTabungan =
  | 'setoran_syahriah'
  | 'saldo_awal'
  | 'pemakaian_kegiatan'
  | 'penarikan_boyong'
  | 'penarikan_mendesak'
  | 'koreksi';
export type PengeluaranStatus = 'aktif' | 'dibatalkan';

// Business Logic Invariant Contracts
export interface AllocatePaymentInput {
  pembayaranId?: string;
  santriId: string;
  nominal: number; // Integer Rupiah
  metode: MetodePembayaran;
  tanggalBayar: Date | string;
  catatan?: string;
  buktiUrl?: string;
  adminUserId: string;
  isCashDesk?: boolean;
}

export interface AllocatedBillItem {
  tagihanId: string;
  judul: string;
  bulan?: number | null;
  tahun?: number | null;
  tabunganAllocated: number;
  operasionalAllocated: number;
  totalAllocated: number;
  remainingBill: number;
  status: 'lunas' | 'sebagian';
}

export interface AllocationResult {
  pembayaranId: string;
  santriId?: string;
  nominalTotal?: number;
  allocatedBills: AllocatedBillItem[];
  totalTabungan: number;
  totalOperasional: number;
  excessCredit: number;
}

// Master Data & Excel Import Types
export interface KomplekItem {
  id: string;
  kode: string;
  nama: string;
  jenis: 'putra' | 'putri';
  deskripsi: string | null;
  santriCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KategoriItem {
  id: string;
  kode: SantriKategori;
  nama: string;
  deskripsi: string | null;
  santriCount?: number;
}

export interface SantriListItem {
  id: string;
  nis: string;
  nama: string;
  komplekId: string;
  komplekKode: string;
  komplekNama: string;
  kategoriId: string;
  kategoriKode: SantriKategori;
  kategoriNama: string;
  tanggalMasuk: string;
  status: SantriStatus;
  nomorWhatsapp: string;
  namaWali: string | null;
  nomorWhatsappWali: string | null;
  alamat: string | null;
  terakhirDiingatkan: Date | null;
  saldoTabungan?: number;
  tunggakanBulan?: number;
}

export interface TarifMatrixItem {
  id: string;
  komplekId: string;
  komplekKode: string;
  komplekNama: string;
  kategoriId: string;
  kategoriKode: SantriKategori;
  kategoriNama: string;
  nominal: number;
  alokasiTabungan: number;
  alokasiOperasional: number;
  berlakuMulai: string;
  berlakuSampai: string | null;
  isActive: boolean;
}

export interface ExcelImportValidationResult {
  isValid: boolean;
  totalRows: number;
  validRowsCount: number;
  errorRowsCount: number;
  totalSaldoAwal: number;
  validRows: Array<{
    rowIndex: number;
    nis: string;
    nama: string;
    komplekId: string;
    komplekKode: string;
    kategoriId: string;
    kategoriKode: SantriKategori;
    tanggalMasuk: string;
    status: SantriStatus;
    nomorWhatsapp: string;
    namaWali?: string;
    nomorWhatsappWali?: string;
    alamat?: string;
    saldoAwalTabungan: number;
  }>;
  errors: Array<{
    rowIndex: number;
    nis?: string;
    field?: string;
    message: string;
  }>;
}
