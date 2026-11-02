import type { SubsidyCakupan, SubsidySumberDana, SubsidyTipeTarget } from '../validators/subsidy.validator';

export interface EligibleBeneficiaryPreview {
  santriId: string;
  nis: string;
  nama: string;
  komplekId: string;
  komplekKode: string;
  kategoriId: string;
  kategoriKode: string;
  saldoTabungan: number;
  unpaidBillsCount: number;
  targetBillId: string;
  targetBillJudul: string;
  targetBillNominal: number;
  targetBillSisa: number;
  proposedSubsidyNominal: number;
  remainingBillAfterSubsidy: number;
  sumberDana: SubsidySumberDana;
}

export interface IneligibleCandidatePreview {
  santriId: string;
  nis: string;
  nama: string;
  komplekKode: string;
  kategoriKode: string;
  reasons: string[];
}

export interface SubsidyPreviewResult {
  aturanId: string;
  ruleName: string;
  ruleNominal: number;
  sumberDana: SubsidySumberDana;
  cakupan: SubsidyCakupan;
  tipeTarget: SubsidyTipeTarget;
  bulanTarget?: number;
  tahunTarget?: number;
  totalCandidates: number;
  totalEligibleCount: number;
  totalIneligibleCount: number;
  totalProposedNominal: number;
  eligibleBeneficiaries: EligibleBeneficiaryPreview[];
  ineligibleCandidates: IneligibleCandidatePreview[];
}

export interface AppliedBeneficiaryItem {
  subsidiPenerimaId: string;
  santriId: string;
  nis: string;
  nama: string;
  tagihanId: string;
  tagihanJudul: string;
  nominalDiterima: number;
  pembayaranId: string;
  ledgerTabunganId: string | null;
  newBillStatus: 'lunas' | 'sebagian';
  remainingBillSisa: number;
}

export interface SubsidyExecutionResult {
  success: boolean;
  aturanId: string;
  ruleName: string;
  totalBeneficiaries: number;
  totalAppliedNominal: number;
  appliedBeneficiaries: AppliedBeneficiaryItem[];
  skippedCount: number;
  executionTimestamp: string;
}
