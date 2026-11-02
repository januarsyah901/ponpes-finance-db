import { eq, and, inArray, sql, isNull, or, lte, gte } from 'drizzle-orm';
import type { Database } from '../client';
import { santri, komplek, kategori, tarifSyahriah, tagihan, auditLog } from '../schema';
import type { BulkSyahriahGenerateInput } from '../validators';

export type { BulkSyahriahGenerateInput };

export interface BulkSyahriahResult {
  success: boolean;
  totalActiveSantri: number;
  newlyBilledCount: number;
  alreadyBilledCount: number;
  totalNominalBilled: number;
  missingTarifPairs?: Array<{ komplekKode: string; kategoriKode: string }>;
  billsCreated?: Array<{
    id: string;
    santriId: string;
    nominal: number;
    judul: string;
  }>;
  error?: string;
}

export interface BillingActor {
  userId?: string;
  role?: string;
  complexIds?: string[];
}

export const INDO_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export async function generateBulkSyahriahBills(
  db: Database,
  input: BulkSyahriahGenerateInput,
  actor?: BillingActor
): Promise<BulkSyahriahResult> {
  const { bulan, tahun, komplekId } = input;
  const jatuhTempo = input.jatuhTempo || `${tahun}-${String(bulan).padStart(2, '0')}-10`;

  // 1. Determine scoped complex IDs
  let targetComplexIds: string[] = [];
  if (actor?.role === 'bendahara_komplek' && actor.complexIds && !actor.complexIds.includes('all')) {
    if (komplekId && !actor.complexIds.includes(komplekId)) {
      throw new Error('Akses ditolak: Anda tidak memiliki wewenang untuk komplek ini.');
    }
    targetComplexIds = komplekId ? [komplekId] : actor.complexIds;
  } else {
    if (komplekId) {
      targetComplexIds = [komplekId];
    } else {
      const allComplexes = await db.select({ id: komplek.id }).from(komplek);
      targetComplexIds = allComplexes.map((c) => c.id);
    }
  }

  if (targetComplexIds.length === 0) {
    return {
      success: false,
      totalActiveSantri: 0,
      newlyBilledCount: 0,
      alreadyBilledCount: 0,
      totalNominalBilled: 0,
      error: 'Tidak ada komplek sasaran yang valid.',
    };
  }

  // 2. Query active santri in the target complexes
  const activeSantri = await db
    .select({
      id: santri.id,
      nis: santri.nis,
      nama: santri.nama,
      komplekId: santri.komplekId,
      kategoriId: santri.kategoriId,
    })
    .from(santri)
    .where(
      and(
        eq(santri.status, 'aktif'),
        inArray(santri.komplekId, targetComplexIds)
      )
    );

  if (activeSantri.length === 0) {
    return {
      success: true,
      totalActiveSantri: 0,
      newlyBilledCount: 0,
      alreadyBilledCount: 0,
      totalNominalBilled: 0,
    };
  }

  // 3. Query active tarif_syahriah for the target complexes
  const targetDateStr = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const activeRates = await db
    .select()
    .from(tarifSyahriah)
    .where(
      and(
        eq(tarifSyahriah.isActive, true),
        inArray(tarifSyahriah.komplekId, targetComplexIds),
        lte(tarifSyahriah.berlakuMulai, targetDateStr),
        or(isNull(tarifSyahriah.berlakuSampai), gte(tarifSyahriah.berlakuSampai, targetDateStr))
      )
    );

  const rateMap = new Map<string, typeof activeRates[0]>();
  for (const rate of activeRates) {
    rateMap.set(`${rate.komplekId}:${rate.kategoriId}`, rate);
  }

  // Check for any santri with missing rates
  const missingPairsSet = new Set<string>();
  for (const s of activeSantri) {
    const key = `${s.komplekId}:${s.kategoriId}`;
    if (!rateMap.has(key)) {
      missingPairsSet.add(key);
    }
  }

  if (missingPairsSet.size > 0) {
    const missingDetails: Array<{ komplekKode: string; kategoriKode: string }> = [];
    for (const key of missingPairsSet) {
      const [kId, cId] = key.split(':');
      const [comp] = await db.select({ kode: komplek.kode }).from(komplek).where(eq(komplek.id, kId));
      const [kat] = await db.select({ kode: kategori.kode }).from(kategori).where(eq(kategori.id, cId));
      missingDetails.push({
        komplekKode: comp?.kode || kId,
        kategoriKode: kat?.kode || cId,
      });
    }
    return {
      success: false,
      totalActiveSantri: activeSantri.length,
      newlyBilledCount: 0,
      alreadyBilledCount: 0,
      totalNominalBilled: 0,
      missingTarifPairs: missingDetails,
      error: `Konfigurasi tarif belum lengkap untuk ${missingDetails.length} kombinasi komplek-kategori.`,
    };
  }

  // 4. Strict idempotency check: Query existing syahriah bills for same month/year
  const activeSantriIds = activeSantri.map((s) => s.id);
  const existingBills = await db
    .select({ santriId: tagihan.santriId })
    .from(tagihan)
    .where(
      and(
        eq(tagihan.tipe, 'syahriah'),
        eq(tagihan.bulan, bulan),
        eq(tagihan.tahun, tahun),
        sql`${tagihan.status} != 'dibatalkan'`,
        inArray(tagihan.santriId, activeSantriIds)
      )
    );

  const existingSantriIdsSet = new Set(existingBills.map((b) => b.santriId));
  const santriToBill = activeSantri.filter((s) => !existingSantriIdsSet.has(s.id));

  if (santriToBill.length === 0) {
    return {
      success: true,
      totalActiveSantri: activeSantri.length,
      newlyBilledCount: 0,
      alreadyBilledCount: existingSantriIdsSet.size,
      totalNominalBilled: 0,
    };
  }

  const monthName = INDO_MONTHS[bulan - 1] || `Bulan ${bulan}`;
  const billingTitle = `Syahriah ${monthName} ${tahun}`;

  let totalNominal = 0;
  const newBillRecords = santriToBill.map((s) => {
    const rate = rateMap.get(`${s.komplekId}:${s.kategoriId}`)!;
    const nominal = Number(rate.nominal);
    totalNominal += nominal;

    return {
      santriId: s.id,
      komplekId: s.komplekId,
      tipe: 'syahriah' as const,
      judul: billingTitle,
      bulan,
      tahun,
      jatuhTempo,
      nominal,
      terbayar: 0,
      sisa: nominal,
      status: 'belum_bayar' as const,
    };
  });

  const createdBills: Array<{ id: string; santriId: string; nominal: number; judul: string }> = [];

  // 5. Atomic Batch Insert inside transaction
  await db.transaction(async (tx) => {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < newBillRecords.length; i += CHUNK_SIZE) {
      const chunk = newBillRecords.slice(i, i + CHUNK_SIZE);
      const inserted = await tx.insert(tagihan).values(chunk).returning({
        id: tagihan.id,
        santriId: tagihan.santriId,
        nominal: tagihan.nominal,
        judul: tagihan.judul,
      });
      createdBills.push(...inserted);
    }

    // 6. Record Audit Log
    if (actor?.userId) {
      await tx.insert(auditLog).values({
        userId: actor.userId,
        action: 'GENERATE_BULK_SYAHRIAH',
        entityType: 'tagihan',
        entityId: 'bulk',
        newValues: {
          bulan,
          tahun,
          jatuhTempo,
          newlyBilledCount: newBillRecords.length,
          alreadyBilledCount: existingSantriIdsSet.size,
          totalNominalBilled: totalNominal,
          targetComplexIds,
        },
      });
    }
  });

  return {
    success: true,
    totalActiveSantri: activeSantri.length,
    newlyBilledCount: createdBills.length,
    alreadyBilledCount: existingSantriIdsSet.size,
    totalNominalBilled: totalNominal,
    billsCreated: createdBills,
  };
}
