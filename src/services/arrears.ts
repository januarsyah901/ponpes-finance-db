import { eq, and, ne, lte, sql, desc, asc } from 'drizzle-orm';
import { tagihan } from '../schema/billing';
import { santri, komplek, kategori } from '../schema/master';
import { auditLog } from '../schema/audit';
import type { Database } from '../client';

export interface ArrearsFilter {
  komplekId?: string;
  minMonths?: number; // default 2
}

export interface SantriArrearsItem {
  santriId: string;
  nis: string;
  nama: string;
  komplekNama: string;
  kategoriNama: string;
  nomorWhatsapp: string;
  terakhirDiingatkan: Date | null;
  totalTunggakan: number;
  jumlahBulanTertunggak: number;
  daftarTagihan: Array<{
    id: string;
    judul: string;
    bulan: number | null;
    tahun: number | null;
    nominal: number;
    sisa: number;
    jatuhTempo: string;
  }>;
  waLink: string;
}

/**
 * Normalisasi format nomor WhatsApp Indonesia (08... -> 628...)
 */
export function formatPhoneNumberForWa(rawPhone: string): string {
  let cleaned = rawPhone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

const NAMA_BULAN = [
  '',
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * Buat pesan template pengingat tunggakan WhatsApp
 */
export function buildWaReminderMessage(santriData: {
  nama: string;
  nis: string;
  komplekNama: string;
  totalTunggakan: number;
  daftarTagihan: Array<{ bulan: number | null; tahun: number | null; sisa: number }>;
}): string {
  const periodeList = santriData.daftarTagihan
    .map((t) => {
      const namaBln = t.bulan ? NAMA_BULAN[t.bulan] : 'Kegiatan';
      const thn = t.tahun || '';
      return `• ${namaBln} ${thn}: Rp ${Number(t.sisa).toLocaleString('id-ID')}`;
    })
    .join('\n');

  return (
    `*PEMBERITAHUAN TUNGGAKAN SYAHRIAH*\n` +
    `_Pondok Pesantren_\n\n` +
    `Assalamu'alaikum Wr. Wb.\n` +
    `Yth. Wali/Santri an. *${santriData.nama}* (NIS: ${santriData.nis})\n` +
    `Komplek: ${santriData.komplekNama}\n\n` +
    `Dengan ini kami informasikan bahwa terdapat tunggakan administrasi sebesar:\n` +
    `*Rp ${Number(santriData.totalTunggakan).toLocaleString('id-ID')}*\n\n` +
    `Rincian periode:\n${periodeList}\n\n` +
    `Mohon kesediaannya untuk segera menyelesaikan pembayaran demi kelancaran kegiatan santri.\n` +
    `Pembayaran dapat ditransfer atau disetorkan langsung ke bendahara komplek.\n\n` +
    `Jazakumullah Khairan Katsiran.\nWassalamu'alaikum Wr. Wb.`
  );
}

/**
 * Ambil daftar santri yang menunggak syahriah > N bulan
 */
export async function getArrearsDashboard(
  db: Database | any,
  filter?: ArrearsFilter
): Promise<SantriArrearsItem[]> {
  const minMonths = filter?.minMonths ?? 2;

  // 1. Ambil semua tagihan yang belum lunas (status != 'lunas' dan status != 'dibatalkan')
  const tagihanConditions = [
    ne(tagihan.status, 'lunas'),
    ne(tagihan.status, 'dibatalkan'),
  ];
  if (filter?.komplekId) {
    tagihanConditions.push(eq(tagihan.komplekId, filter.komplekId));
  }

  const unpaidBills: any[] = await (db as any).query.tagihan.findMany({
    where: and(...tagihanConditions),
    orderBy: [asc(tagihan.jatuhTempo)],
    with: {
      santri: {
        with: {
          komplek: true,
          kategori: true,
        },
      },
    },
  });

  // 2. Kelompokkan per santri
  const santriMap = new Map<string, {
    santri: any;
    bills: Array<typeof unpaidBills[0]>;
  }>();

  for (const bill of unpaidBills) {
    if (!bill.santri || bill.santri.status !== 'aktif') continue;
    const existing = santriMap.get(bill.santriId);
    if (existing) {
      existing.bills.push(bill);
    } else {
      santriMap.set(bill.santriId, { santri: bill.santri, bills: [bill] });
    }
  }

  // 3. Filter santri dengan jumlah bulan tunggakan >= minMonths
  const result: SantriArrearsItem[] = [];

  for (const { santri: s, bills } of santriMap.values()) {
    // Hitung tunggakan syahriah (bulan tunggakan)
    const syahriahBills = bills.filter((b) => b.tipe === 'syahriah');
    const unpaidMonthCount = syahriahBills.length;

    if (unpaidMonthCount >= minMonths) {
      const totalTunggakan = bills.reduce((sum, b) => sum + Number(b.sisa), 0);
      const daftarTagihan = bills.map((b) => ({
        id: b.id,
        judul: b.judul,
        bulan: b.bulan,
        tahun: b.tahun,
        nominal: Number(b.nominal),
        sisa: Number(b.sisa),
        jatuhTempo: b.jatuhTempo,
      }));

      const phoneFormatted = formatPhoneNumberForWa(s.nomorWhatsapp);
      const textMessage = buildWaReminderMessage({
        nama: s.nama,
        nis: s.nis,
        komplekNama: s.komplek?.nama || '-',
        totalTunggakan,
        daftarTagihan,
      });

      const waLink = `https://wa.me/${phoneFormatted}?text=${encodeURIComponent(textMessage)}`;

      result.push({
        santriId: s.id,
        nis: s.nis,
        nama: s.nama,
        komplekNama: s.komplek?.nama || '-',
        kategoriNama: s.kategori?.nama || '-',
        nomorWhatsapp: s.nomorWhatsapp,
        terakhirDiingatkan: s.terakhirDiingatkan,
        totalTunggakan,
        jumlahBulanTertunggak: unpaidMonthCount,
        daftarTagihan,
        waLink,
      });
    }
  }

  // Sort by highest tunggakan desc
  result.sort((a, b) => b.totalTunggakan - a.totalTunggakan);

  return result;
}

/**
 * Tandai santri sudah dikirimi pengingat WhatsApp
 */
export async function markReminderSent(
  db: Database | any,
  input: { santriId: string; adminUserId?: string }
) {
  const [updated] = await db
    .update(santri)
    .set({
      terakhirDiingatkan: new Date(),
    })
    .where(eq(santri.id, input.santriId))
    .returning();

  // Audit Log
  await db.insert(auditLog).values({
    userId: input.adminUserId || null,
    action: 'SEND_WA_REMINDER',
    entityType: 'santri',
    entityId: input.santriId,
    newValues: { terakhirDiingatkan: updated.terakhirDiingatkan },
  });

  return updated;
}
