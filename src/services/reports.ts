import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { pembayaran, alokasiPembayaran, tagihan } from '../schema/billing';
import { pengeluaran, kategoriPengeluaran } from '../schema/expenses';
import { santri, komplek, kategori } from '../schema/master';
import { ledgerTabungan } from '../schema/savings';
import type { Database } from '../client';

export interface FinancialSummaryFilter {
  komplekId?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface FinancialSummaryReport {
  periode: {
    startDate: string;
    endDate: string;
  };
  pemasukan: {
    totalPemasukan: number;
    alokasiOperasional: number;
    alokasiTabungan: number;
  };
  pengeluaran: {
    totalPengeluaran: number;
    breakdownPerKategori: Array<{
      kategoriId: string;
      namaKategori: string;
      nominal: number;
      persentase: number;
    }>;
  };
  surplusDefisitOperasional: number;
  totalKewajibanTabungan: number;
}

/**
 * Ringkasan Keuangan Komprehensif (Pemasukan, Pengeluaran, Surplus/Defisit, Alokasi Dana)
 */
export async function getFinancialSummaryReport(
  db: Database | any,
  filter: FinancialSummaryFilter
): Promise<FinancialSummaryReport> {
  // 1. Ambil Pemasukan Terverifikasi dalam periode
  const paymentConditions = [
    eq(pembayaran.status, 'terverifikasi'),
    gte(pembayaran.tanggalBayar, filter.startDate),
    lte(pembayaran.tanggalBayar, filter.endDate),
  ];
  if (filter.komplekId) {
    paymentConditions.push(eq(pembayaran.komplekId, filter.komplekId));
  }

  // Hitung total alokasi dari alokasiPembayaran
  const alokasiRows: any[] = await db
    .select({
      totalAlokasi: sql<number>`coalesce(sum(${alokasiPembayaran.nominalAlokasi}), 0)::numeric`,
      totalTabungan: sql<number>`coalesce(sum(${alokasiPembayaran.alokasiTabungan}), 0)::numeric`,
      totalOperasional: sql<number>`coalesce(sum(${alokasiPembayaran.alokasiOperasional}), 0)::numeric`,
    })
    .from(alokasiPembayaran)
    .innerJoin(pembayaran, eq(alokasiPembayaran.pembayaranId, pembayaran.id))
    .where(and(...paymentConditions));

  const totalPemasukan = Number(alokasiRows[0]?.totalAlokasi || 0);
  const alokasiTabungan = Number(alokasiRows[0]?.totalTabungan || 0);
  const alokasiOperasional = Number(alokasiRows[0]?.totalOperasional || 0);

  // 2. Ambil Pengeluaran Aktif dalam periode
  const expenseConditions = [
    eq(pengeluaran.status, 'aktif'),
    gte(pengeluaran.tanggal, filter.startDate),
    lte(pengeluaran.tanggal, filter.endDate),
  ];
  if (filter.komplekId) {
    expenseConditions.push(eq(pengeluaran.komplekId, filter.komplekId));
  }

  const categoryBreakdown: any[] = await db
    .select({
      kategoriId: kategoriPengeluaran.id,
      namaKategori: kategoriPengeluaran.nama,
      nominal: sql<number>`coalesce(sum(${pengeluaran.nominal}), 0)::numeric`,
    })
    .from(pengeluaran)
    .innerJoin(
      kategoriPengeluaran,
      eq(pengeluaran.kategoriPengeluaranId, kategoriPengeluaran.id)
    )
    .where(and(...expenseConditions))
    .groupBy(kategoriPengeluaran.id, kategoriPengeluaran.nama);

  const totalPengeluaran = categoryBreakdown.reduce(
    (sum: number, item: any) => sum + Number(item.nominal),
    0
  );

  const formattedBreakdown = categoryBreakdown.map((item: any) => ({
    kategoriId: item.kategoriId,
    namaKategori: item.namaKategori,
    nominal: Number(item.nominal),
    persentase:
      totalPengeluaran > 0
        ? Math.round((Number(item.nominal) / totalPengeluaran) * 100)
        : 0,
  }));

  // 3. Hitung Total Kewajiban Tabungan Santri (Total saldo dari ledger)
  const savingsRows: any[] = await db
    .select({
      totalTabungan: sql<number>`coalesce(sum(${ledgerTabungan.nominal}), 0)::numeric`,
    })
    .from(ledgerTabungan)
    .innerJoin(santri, eq(ledgerTabungan.santriId, santri.id))
    .where(filter.komplekId ? eq(santri.komplekId, filter.komplekId) : undefined);

  const totalKewajibanTabungan = Number(savingsRows[0]?.totalTabungan || 0);

  // Surplus / Defisit Operasional = Alokasi Operasional - Pengeluaran
  const surplusDefisitOperasional = alokasiOperasional - totalPengeluaran;

  return {
    periode: {
      startDate: filter.startDate,
      endDate: filter.endDate,
    },
    pemasukan: {
      totalPemasukan,
      alokasiOperasional,
      alokasiTabungan,
    },
    pengeluaran: {
      totalPengeluaran,
      breakdownPerKategori: formattedBreakdown,
    },
    surplusDefisitOperasional,
    totalKewajibanTabungan,
  };
}

/**
 * Laporan Rekap Saldo Tabungan per Santri
 */
export async function getSantriSavingsBalancesReport(
  db: Database | any,
  filter?: { komplekId?: string }
) {
  const santriList: any[] = await (db as any).query.santri.findMany({
    where: filter?.komplekId ? eq(santri.komplekId, filter.komplekId) : undefined,
    with: {
      komplek: true,
      kategori: true,
    },
  });

  const balances: any[] = await db
    .select({
      santriId: ledgerTabungan.santriId,
      saldo: sql<number>`coalesce(sum(${ledgerTabungan.nominal}), 0)::numeric`,
    })
    .from(ledgerTabungan)
    .groupBy(ledgerTabungan.santriId);

  const balanceMap = new Map(balances.map((b: any) => [b.santriId, Number(b.saldo)]));

  return santriList.map((s: any) => ({
    santriId: s.id,
    nis: s.nis,
    nama: s.nama,
    komplek: s.komplek?.nama || '-',
    kategori: s.kategori?.nama || '-',
    status: s.status,
    saldoTabungan: balanceMap.get(s.id) || 0,
  }));
}
