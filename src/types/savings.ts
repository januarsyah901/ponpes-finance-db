import type { JenisMutasiTabungan } from './index';

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface SavingsHistoryItem {
  id: string;
  santriId: string;
  jenisMutasi: JenisMutasiTabungan;
  nominal: number;
  referensiTipe: string | null;
  referensiId: string | null;
  keterangan: string;
  dibuatOlehId: string | null;
  dibuatOlehNama?: string | null;
  disetujuiOlehId: string | null;
  createdAt: Date;
}

export interface SavingsHistoryResult {
  santriId: string;
  currentBalance: number;
  totalCredits: number;
  totalDebits: number;
  totalCount: number;
  mutasi: SavingsHistoryItem[];
}

export interface RecordSavingsWithdrawalInput {
  santriId: string;
  nominal: number;
  jenis: 'penarikan_boyong' | 'penarikan_mendesak';
  alasan: string;
  adminId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SavingsWithdrawalResult {
  ledgerId: string;
  santriId: string;
  nominalDitarik: number;
  saldoSebelum: number;
  saldoSesudah: number;
  jenisMutasi: 'penarikan_boyong' | 'penarikan_mendesak';
  keterangan: string;
  santriStatusUpdated?: 'boyong';
  waktu: Date;
}

export interface RecordSavingsInitialBalanceInput {
  santriId: string;
  nominal: number;
  keterangan?: string;
  adminId: string;
  tanggal?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SavingsInitialBalanceResult {
  ledgerId: string;
  santriId: string;
  nominal: number;
  saldoSebelum: number;
  saldoSesudah: number;
  keterangan: string;
  waktu: Date;
}

export interface PayEventBillFromSavingsInput {
  santriId: string;
  tagihanId: string;
  nominal?: number;
  adminId: string;
  catatan?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EventBillSettlementResult {
  ledgerId: string;
  santriId: string;
  tagihanId: string;
  tagihanJudul: string;
  nominalDibayar: number;
  saldoSebelum: number;
  saldoSesudah: number;
  tagihanSisaBaru: number;
  tagihanStatusBaru: 'belum_bayar' | 'sebagian' | 'lunas';
  waktu: Date;
}

export interface RecordSavingsCorrectionInput {
  santriId: string;
  nominal: number;
  alasan: string;
  adminId: string;
  referensiTipe?: string;
  referensiId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SavingsCorrectionResult {
  ledgerId: string;
  santriId: string;
  nominalKoreksi: number;
  saldoSebelum: number;
  saldoSesudah: number;
  alasan: string;
  waktu: Date;
}

export interface EventBillingTargetCriteria {
  komplekIds?: string[];
  kategoriIds?: string[];
  santriIds?: string[];
}

export interface CreateEventBillsInput {
  judul: string;
  nominal: number;
  jatuhTempo: string;
  target: EventBillingTargetCriteria;
  keterangan?: string;
  adminId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreatedEventBillItem {
  id: string;
  santriId: string;
  nominal: number;
  judul: string;
}

export interface EventBillingResult {
  success: boolean;
  totalTargetedSantri: number;
  newlyBilledCount: number;
  alreadyBilledCount: number;
  totalNominalBilled: number;
  billsCreated: CreatedEventBillItem[];
  skippedSantriIds: string[];
  error?: string;
}

export interface CancelEventBillInput {
  tagihanId: string;
  alasanBatal: string;
  adminId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CancelEventBillResult {
  tagihanId: string;
  santriId: string;
  judul: string;
  status: 'dibatalkan';
  alasanBatal: string;
  dibatalkanPada: Date;
}
