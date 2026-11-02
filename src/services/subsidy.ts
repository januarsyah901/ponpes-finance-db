import { eq, and, inArray, asc, sql } from 'drizzle-orm';
import { db as defaultDb } from '../client';
import type { Database } from '../client';
import {
  santri,
  komplek,
  kategori,
  tagihan,
  pembayaran,
  alokasiPembayaran,
  ledgerTabungan,
  aturanSubsidi,
  subsidiPenerima,
  auditLog,
} from '../schema';
import {
  SubsidySyaratJsonSchema,
  type SubsidySyaratJson,
  type PreviewSubsidyInput,
  type ExecuteSubsidyInput,
} from '../validators/subsidy.validator';
import type {
  SubsidyPreviewResult,
  SubsidyExecutionResult,
  EligibleBeneficiaryPreview,
  IneligibleCandidatePreview,
  AppliedBeneficiaryItem,
} from '../types/subsidy';

interface CandidateSantriRow {
  id: string;
  nis: string;
  nama: string;
  komplekId: string;
  komplekKode: string;
  kategoriId: string;
  kategoriKode: string;
  tanggalMasuk: string;
  status: string;
}

function evaluateSantriEligibility(
  santriItem: CandidateSantriRow,
  syarat: SubsidySyaratJson,
  balance: number,
  unpaidBills: any[],
  alreadyReceived: boolean,
  evalDate: Date = new Date()
): { isEligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // 1. Idempotency check: Already received this rule?
  if (alreadyReceived) {
    reasons.push('Santri sudah pernah menerima subsidi dari aturan ini');
  }

  // 2. Active status check
  if (santriItem.status !== 'aktif') {
    reasons.push(`Status santri bukan aktif (${santriItem.status})`);
  }

  // 3. Complex criteria
  if (syarat.komplekId && santriItem.komplekId !== syarat.komplekId) {
    reasons.push(`Komplek santri (${santriItem.komplekKode}) tidak sesuai target`);
  }
  if (syarat.komplekIds?.length && !syarat.komplekIds.includes(santriItem.komplekId)) {
    reasons.push(`Komplek santri (${santriItem.komplekKode}) tidak termasuk dalam daftar sasaran`);
  }

  // 4. Category criteria
  if (syarat.kategoriId && santriItem.kategoriId !== syarat.kategoriId) {
    reasons.push(`Kategori santri (${santriItem.kategoriKode}) tidak sesuai target`);
  }
  if (syarat.kategoriIds?.length && !syarat.kategoriIds.includes(santriItem.kategoriId)) {
    reasons.push(`Kategori santri (${santriItem.kategoriKode}) tidak termasuk dalam daftar sasaran`);
  }

  // 5. Arrears / Unpaid bills count criteria (min_tagihan_tertunggak)
  if (syarat.minTagihanTertunggak !== undefined) {
    if (unpaidBills.length < syarat.minTagihanTertunggak) {
      reasons.push(
        `Jumlah tagihan tertunggak (${unpaidBills.length}) kurang dari syarat minimal (${syarat.minTagihanTertunggak})`
      );
    }
  }

  // 6. Maximum savings balance criteria (max_saldo_tabungan)
  if (syarat.maxSaldoTabungan !== undefined) {
    if (balance > syarat.maxSaldoTabungan) {
      reasons.push(
        `Saldo tabungan (Rp${balance.toLocaleString('id-ID')}) melebihi batas maksimal (Rp${syarat.maxSaldoTabungan.toLocaleString('id-ID')})`
      );
    }
  }

  // 7. Enrollment tenure criteria (minLamaMondokBulan / minLamaMondokHari / maksTanggalMasuk)
  const admissionDate = new Date(santriItem.tanggalMasuk);
  const diffDays = Math.floor((evalDate.getTime() - admissionDate.getTime()) / (1000 * 60 * 60 * 24));
  const diffMonths =
    (evalDate.getFullYear() - admissionDate.getFullYear()) * 12 +
    (evalDate.getMonth() - admissionDate.getMonth());

  if (syarat.minLamaMondokHari !== undefined && diffDays < syarat.minLamaMondokHari) {
    reasons.push(`Lama mondok (${diffDays} hari) kurang dari batas minimal (${syarat.minLamaMondokHari} hari)`);
  }
  if (syarat.minLamaMondokBulan !== undefined && diffMonths < syarat.minLamaMondokBulan) {
    reasons.push(`Lama mondok (${diffMonths} bulan) kurang dari batas minimal (${syarat.minLamaMondokBulan} bulan)`);
  }
  if (syarat.maksTanggalMasuk && santriItem.tanggalMasuk > syarat.maksTanggalMasuk) {
    reasons.push(`Tanggal masuk (${santriItem.tanggalMasuk}) melewati batas maksimal (${syarat.maksTanggalMasuk})`);
  }

  // 8. Syahriah cleared criteria (syahriahLunasSampai: 'YYYY-MM')
  if (syarat.syahriahLunasSampai) {
    const [targetYear, targetMonth] = syarat.syahriahLunasSampai.split('-').map(Number);
    const hasUnpaidPriorSyahriah = unpaidBills.some(
      (b) =>
        b.tipe === 'syahriah' &&
        (b.tahun < targetYear || (b.tahun === targetYear && (b.bulan ?? 0) <= targetMonth))
    );
    if (hasUnpaidPriorSyahriah) {
      reasons.push(`Syahriah belum lunas sampai periode ${syarat.syahriahLunasSampai}`);
    }
  }

  return {
    isEligible: reasons.length === 0,
    reasons,
  };
}

/**
 * Stage 1: Preview Dry-Run Engine.
 * Evaluates active santri against rule criteria and calculates proposed allocations.
 */
export async function previewSubsidyApplication(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): Promise<SubsidyPreviewResult> {
  let targetDb: Database = defaultDb;
  let input: PreviewSubsidyInput;

  if (typeof arg1 === 'string') {
    input = {
      aturanId: arg1,
      bulan: arg2,
      tahun: arg3,
      komplekId: arg4,
    };
  } else if (arg1 && typeof arg1.aturanId === 'string') {
    input = arg1;
  } else if (arg2 && typeof arg2 === 'string') {
    targetDb = arg1;
    input = {
      aturanId: arg2,
      bulan: arg3,
      tahun: arg4,
    };
  } else {
    targetDb = arg1 || defaultDb;
    input = arg2;
  }

  const { aturanId, bulan, tahun, komplekId } = input;

  // 1. Fetch Rule
  const [rule] = await targetDb
    .select()
    .from(aturanSubsidi)
    .where(eq(aturanSubsidi.id, aturanId));

  if (!rule) {
    throw new Error(`Aturan subsidi dengan ID ${aturanId} tidak ditemukan`);
  }
  if (!rule.isActive) {
    throw new Error(`Aturan subsidi "${rule.nama}" tidak aktif`);
  }

  const syarat = SubsidySyaratJsonSchema.parse(rule.syaratJson);
  const targetKomplekId = komplekId || syarat.komplekId;

  // 2. Query candidate active santri
  const santriConditions = [eq(santri.status, 'aktif')];
  if (targetKomplekId) {
    santriConditions.push(eq(santri.komplekId, targetKomplekId));
  } else if (syarat.komplekIds?.length) {
    santriConditions.push(inArray(santri.komplekId, syarat.komplekIds));
  }
  if (syarat.kategoriId) {
    santriConditions.push(eq(santri.kategoriId, syarat.kategoriId));
  } else if (syarat.kategoriIds?.length) {
    santriConditions.push(inArray(santri.kategoriId, syarat.kategoriIds));
  }

  const candidateSantri = await targetDb
    .select({
      id: santri.id,
      nis: santri.nis,
      nama: santri.nama,
      komplekId: santri.komplekId,
      komplekKode: komplek.kode,
      kategoriId: santri.kategoriId,
      kategoriKode: kategori.kode,
      tanggalMasuk: santri.tanggalMasuk,
      status: santri.status,
    })
    .from(santri)
    .innerJoin(komplek, eq(santri.komplekId, komplek.id))
    .innerJoin(kategori, eq(santri.kategoriId, kategori.id))
    .where(and(...santriConditions));

  if (candidateSantri.length === 0) {
    return {
      aturanId,
      ruleName: rule.nama,
      ruleNominal: Number(rule.nominal),
      sumberDana: syarat.sumberDana,
      cakupan: syarat.cakupan,
      tipeTarget: syarat.tipeTarget,
      bulanTarget: bulan,
      tahunTarget: tahun,
      totalCandidates: 0,
      totalEligibleCount: 0,
      totalIneligibleCount: 0,
      totalProposedNominal: 0,
      eligibleBeneficiaries: [],
      ineligibleCandidates: [],
    };
  }

  const candidateIds = candidateSantri.map((s) => s.id);

  // 3. Batch query savings balances (SUM ledger_tabungan)
  const savingsRows = await targetDb
    .select({
      santriId: ledgerTabungan.santriId,
      balance: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
    })
    .from(ledgerTabungan)
    .where(inArray(ledgerTabungan.santriId, candidateIds))
    .groupBy(ledgerTabungan.santriId);
  const savingsMap = new Map(savingsRows.map((r) => [r.santriId, Number(r.balance)]));

  // 4. Batch query unpaid bills
  const unpaidBillsRows = await targetDb
    .select()
    .from(tagihan)
    .where(
      and(
        inArray(tagihan.santriId, candidateIds),
        inArray(tagihan.status, ['belum_bayar', 'sebagian'])
      )
    )
    .orderBy(
      asc(tagihan.jatuhTempo),
      asc(tagihan.tahun),
      asc(tagihan.bulan),
      asc(tagihan.createdAt)
    );

  const santriBillsMap = new Map<string, typeof unpaidBillsRows>();
  for (const b of unpaidBillsRows) {
    const list = santriBillsMap.get(b.santriId) || [];
    list.push(b);
    santriBillsMap.set(b.santriId, list);
  }

  // 5. Batch query existing rule recipients (Idempotency)
  const existingRecipients = await targetDb
    .select({ santriId: subsidiPenerima.santriId })
    .from(subsidiPenerima)
    .where(
      and(
        eq(subsidiPenerima.aturanSubsidiId, aturanId),
        inArray(subsidiPenerima.santriId, candidateIds)
      )
    );
  const existingSet = new Set(existingRecipients.map((r) => r.santriId));

  // 6. Evaluation Loop
  const eligibleBeneficiaries: EligibleBeneficiaryPreview[] = [];
  const ineligibleCandidates: IneligibleCandidatePreview[] = [];
  let totalProposedNominal = 0;

  for (const s of candidateSantri) {
    const balance = savingsMap.get(s.id) || 0;
    const unpaidBills = santriBillsMap.get(s.id) || [];
    const alreadyReceived = existingSet.has(s.id);

    const { isEligible, reasons } = evaluateSantriEligibility(
      s,
      syarat,
      balance,
      unpaidBills,
      alreadyReceived
    );

    if (!isEligible) {
      ineligibleCandidates.push({
        santriId: s.id,
        nis: s.nis,
        nama: s.nama,
        komplekKode: s.komplekKode,
        kategoriKode: s.kategoriKode,
        reasons,
      });
      continue;
    }

    // Locate target bill
    let targetBill: (typeof unpaidBillsRows)[0] | undefined;
    if (syarat.tipeTarget === 'kegiatan' && rule.tagihanKegiatanId) {
      targetBill = unpaidBills.find((b) => b.id === rule.tagihanKegiatanId);
    } else if (bulan && tahun) {
      targetBill = unpaidBills.find(
        (b) => b.tipe === 'syahriah' && b.bulan === bulan && b.tahun === tahun
      );
    }
    // Fallback: oldest unpaid bill
    if (!targetBill) {
      targetBill = unpaidBills[0];
    }

    if (!targetBill || Number(targetBill.sisa) <= 0) {
      ineligibleCandidates.push({
        santriId: s.id,
        nis: s.nis,
        nama: s.nama,
        komplekKode: s.komplekKode,
        kategoriKode: s.kategoriKode,
        reasons: ['Tidak memiliki tagihan tertunggak yang dapat disubsidi'],
      });
      continue;
    }

    const billSisa = Number(targetBill.sisa);
    const proposedSubsidy =
      syarat.cakupan === 'lunas_penuh' ? billSisa : Math.min(Number(rule.nominal), billSisa);

    // If funded from savings, ensure savings balance is sufficient
    if (syarat.sumberDana === 'potong_tabungan') {
      if (balance < proposedSubsidy) {
        ineligibleCandidates.push({
          santriId: s.id,
          nis: s.nis,
          nama: s.nama,
          komplekKode: s.komplekKode,
          kategoriKode: s.kategoriKode,
          reasons: [
            `Saldo tabungan (Rp${balance.toLocaleString('id-ID')}) tidak mencukupi untuk pemotongan subsidi (Rp${proposedSubsidy.toLocaleString('id-ID')})`,
          ],
        });
        continue;
      }
    }

    const remainingBillAfter = billSisa - proposedSubsidy;
    totalProposedNominal += proposedSubsidy;

    eligibleBeneficiaries.push({
      santriId: s.id,
      nis: s.nis,
      nama: s.nama,
      komplekId: s.komplekId,
      komplekKode: s.komplekKode,
      kategoriId: s.kategoriId,
      kategoriKode: s.kategoriKode,
      saldoTabungan: balance,
      unpaidBillsCount: unpaidBills.length,
      targetBillId: targetBill.id,
      targetBillJudul: targetBill.judul,
      targetBillNominal: Number(targetBill.nominal),
      targetBillSisa: billSisa,
      proposedSubsidyNominal: proposedSubsidy,
      remainingBillAfterSubsidy: remainingBillAfter,
      sumberDana: syarat.sumberDana,
    });
  }

  return {
    aturanId,
    ruleName: rule.nama,
    ruleNominal: Number(rule.nominal),
    sumberDana: syarat.sumberDana,
    cakupan: syarat.cakupan,
    tipeTarget: syarat.tipeTarget,
    bulanTarget: bulan,
    tahunTarget: tahun,
    totalCandidates: candidateSantri.length,
    totalEligibleCount: eligibleBeneficiaries.length,
    totalIneligibleCount: ineligibleCandidates.length,
    totalProposedNominal,
    eligibleBeneficiaries,
    ineligibleCandidates,
  };
}

/**
 * Stage 2: Atomic Execution Engine.
 * Executes subsidy awards inside an ACID transaction with pessimistic row locks.
 */
export async function executeSubsidyApplication(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any,
  arg5?: any
): Promise<SubsidyExecutionResult> {
  let targetDb: Database = defaultDb;
  let input: ExecuteSubsidyInput;

  if (typeof arg1 === 'string') {
    input = {
      aturanId: arg1,
      bulan: arg2,
      tahun: arg3,
      adminUserId: arg4,
      selectedSantriIds: arg5,
    };
  } else if (arg1 && typeof arg1.aturanId === 'string') {
    input = arg1;
  } else if (arg2 && typeof arg2 === 'string') {
    targetDb = arg1;
    input = {
      aturanId: arg2,
      bulan: arg3,
      tahun: arg4,
      adminUserId: arg5,
    };
  } else {
    targetDb = arg1 || defaultDb;
    input = arg2;
  }

  const { aturanId, bulan, tahun, adminUserId, selectedSantriIds } = input;

  return await targetDb.transaction(async (tx) => {
    // 1. Pessimistic Lock on Rule
    const [rule] = await tx
      .select()
      .from(aturanSubsidi)
      .where(eq(aturanSubsidi.id, aturanId))
      .for('update');

    if (!rule) {
      throw new Error(`Aturan subsidi dengan ID ${aturanId} tidak ditemukan`);
    }
    if (!rule.isActive) {
      throw new Error(`Aturan subsidi "${rule.nama}" tidak aktif`);
    }

    const syarat = SubsidySyaratJsonSchema.parse(rule.syaratJson);

    // 2. Run preview inside transaction to identify valid candidates
    const preview = await previewSubsidyApplication(tx as unknown as Database, {
      aturanId,
      bulan,
      tahun,
    });

    let approvedBeneficiaries = preview.eligibleBeneficiaries;
    if (selectedSantriIds && selectedSantriIds.length > 0) {
      const selectedSet = new Set(selectedSantriIds);
      approvedBeneficiaries = approvedBeneficiaries.filter((b) => selectedSet.has(b.santriId));
    }

    if (approvedBeneficiaries.length === 0) {
      return {
        success: true,
        aturanId,
        ruleName: rule.nama,
        totalBeneficiaries: 0,
        totalAppliedNominal: 0,
        appliedBeneficiaries: [],
        skippedCount: 0,
        executionTimestamp: new Date().toISOString(),
      };
    }

    const targetSantriIds = approvedBeneficiaries.map((b) => b.santriId);

    // 3. Pessimistic Row Lock on Santri Records (alphabetical order to prevent deadlocks)
    targetSantriIds.sort();
    const lockedSantriList = await tx
      .select()
      .from(santri)
      .where(inArray(santri.id, targetSantriIds))
      .for('update');
    const lockedSantriMap = new Map(lockedSantriList.map((s) => [s.id, s]));

    const appliedBeneficiaries: AppliedBeneficiaryItem[] = [];
    let totalAppliedNominal = 0;
    let skippedCount = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    // 4. Process Each Beneficiary
    for (const item of approvedBeneficiaries) {
      const lockedSantri = lockedSantriMap.get(item.santriId);
      if (!lockedSantri || lockedSantri.status !== 'aktif') {
        skippedCount++;
        continue;
      }

      // Idempotency double-check inside lock
      const [alreadyApplied] = await tx
        .select()
        .from(subsidiPenerima)
        .where(
          and(
            eq(subsidiPenerima.aturanSubsidiId, aturanId),
            eq(subsidiPenerima.santriId, item.santriId)
          )
        )
        .for('update');

      if (alreadyApplied) {
        skippedCount++;
        continue;
      }

      // Lock target bill
      const [lockedBill] = await tx
        .select()
        .from(tagihan)
        .where(eq(tagihan.id, item.targetBillId))
        .for('update');

      if (!lockedBill || Number(lockedBill.sisa) <= 0) {
        skippedCount++;
        continue;
      }

      const billSisa = Number(lockedBill.sisa);
      const subsidyAmount =
        syarat.cakupan === 'lunas_penuh' ? billSisa : Math.min(item.proposedSubsidyNominal, billSisa);

      let ledgerTabunganId: string | null = null;

      // 5. IF funded from savings: Deduct from santri savings ledger
      if (syarat.sumberDana === 'potong_tabungan') {
        const [balanceResult] = await tx
          .select({
            balance: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
          })
          .from(ledgerTabungan)
          .where(eq(ledgerTabungan.santriId, item.santriId));

        const currentBalance = Number(balanceResult?.balance || 0);
        if (currentBalance < subsidyAmount) {
          throw new Error(
            `Invarian Tabungan Terlanggar: Saldo ${lockedSantri.nama} (${currentBalance}) kurang dari subsidi (${subsidyAmount})`
          );
        }

        const [ledgerEntry] = await tx
          .insert(ledgerTabungan)
          .values({
            santriId: item.santriId,
            jenisMutasi: 'pemakaian_kegiatan',
            nominal: -subsidyAmount, // Signed negative debit
            referensiTipe: 'aturan_subsidi',
            referensiId: aturanId,
            keterangan: `Pemotongan tabungan untuk subsidi ${rule.nama} (${lockedBill.judul})`,
            dibuatOlehId: adminUserId,
            disetujuiOlehId: adminUserId,
          })
          .returning({ id: ledgerTabungan.id });

        ledgerTabunganId = ledgerEntry.id;
      }

      // 6. Record Pembayaran with metode: 'subsidi' & is_subsidi: true
      const [newPembayaran] = await tx
        .insert(pembayaran)
        .values({
          santriId: item.santriId,
          komplekId: lockedSantri.komplekId,
          metode: 'subsidi',
          nominal: subsidyAmount,
          nominalDiverifikasi: subsidyAmount,
          tanggalBayar: todayStr,
          catatanSantri: `Subsidi otomatis: ${rule.nama}`,
          status: 'terverifikasi',
          diverifikasiOlehId: adminUserId,
          diverifikasiPada: new Date(),
          isReversal: false,
          isSubsidi: true,
        })
        .returning({ id: pembayaran.id });

      // 7. Record Alokasi Pembayaran
      await tx.insert(alokasiPembayaran).values({
        pembayaranId: newPembayaran.id,
        tagihanId: lockedBill.id,
        nominalAlokasi: subsidyAmount,
        alokasiTabungan: 0,
        alokasiOperasional: subsidyAmount,
        isReversal: false,
        isSubsidi: true,
      });

      // 8. Update Tagihan State
      const newTerbayar = Number(lockedBill.terbayar) + subsidyAmount;
      const newSisa = billSisa - subsidyAmount;
      const newStatus = newSisa === 0 ? ('lunas' as const) : ('sebagian' as const);

      await tx
        .update(tagihan)
        .set({
          terbayar: newTerbayar,
          sisa: newSisa,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(tagihan.id, lockedBill.id));

      // 9. Record Subsidi Penerima
      const [newPenerima] = await tx
        .insert(subsidiPenerima)
        .values({
          aturanSubsidiId: aturanId,
          santriId: item.santriId,
          tagihanId: lockedBill.id,
          nominalDiterima: subsidyAmount,
          ledgerTabunganId,
          diterapkanPada: new Date(),
        })
        .returning({ id: subsidiPenerima.id });

      // 10. Audit Log per beneficiary
      await tx.insert(auditLog).values({
        userId: adminUserId,
        action: 'SUBSIDI_PENERIMA_DITERAPKAN',
        entityType: 'subsidi_penerima',
        entityId: newPenerima.id,
        newValues: {
          aturanSubsidiId: aturanId,
          ruleNama: rule.nama,
          santriId: item.santriId,
          tagihanId: lockedBill.id,
          nominalDiterima: subsidyAmount,
          sumberDana: syarat.sumberDana,
          pembayaranId: newPembayaran.id,
          ledgerTabunganId,
        },
      });

      totalAppliedNominal += subsidyAmount;
      appliedBeneficiaries.push({
        subsidiPenerimaId: newPenerima.id,
        santriId: item.santriId,
        nis: item.nis,
        nama: item.nama,
        tagihanId: lockedBill.id,
        tagihanJudul: lockedBill.judul,
        nominalDiterima: subsidyAmount,
        pembayaranId: newPembayaran.id,
        ledgerTabunganId,
        newBillStatus: newStatus,
        remainingBillSisa: newSisa,
      });
    }

    // 11. Batch Audit Log Entry
    await tx.insert(auditLog).values({
      userId: adminUserId,
      action: 'EKSEKUSI_SUBSIDI_BATCH',
      entityType: 'aturan_subsidi',
      entityId: aturanId,
      newValues: {
        ruleNama: rule.nama,
        totalBeneficiaries: appliedBeneficiaries.length,
        totalAppliedNominal,
        skippedCount,
        bulan,
        tahun,
      },
    });

    return {
      success: true,
      aturanId,
      ruleName: rule.nama,
      totalBeneficiaries: appliedBeneficiaries.length,
      totalAppliedNominal,
      appliedBeneficiaries,
      skippedCount,
      executionTimestamp: new Date().toISOString(),
    };
  });
}
