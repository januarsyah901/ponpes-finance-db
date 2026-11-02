import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/client';
import { generateBulkSyahriahBills } from '../src/services/billing';
import { tagihan, santri, komplek, kategori, tarifSyahriah, pengguna } from '../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Bulk Syahriah Bill Generation Service', () => {
  const db = getDb();
  let testKomplekId: string;
  let testKategoriId: string;
  let testSantri1Id: string;
  let testSantri2Id: string;
  let adminUserId: string;
  const testBulan = 8;
  const testTahun = 2026;

  beforeAll(async () => {
    // 1. Fetch kategori and admin user from seed
    const [kat] = await db.select().from(kategori).limit(1);
    const [admin] = await db.select().from(pengguna).where(eq(pengguna.role, 'super_admin')).limit(1);
    testKategoriId = kat.id;
    adminUserId = admin.id;

    // 2. Create isolated test complex to prevent concurrency interference
    const [comp] = await db
      .insert(komplek)
      .values({
        kode: `TK${Date.now().toString().slice(-4)}`,
        nama: 'Komplek Test Billing Isolated',
        jenis: 'putra',
      })
      .returning();
    testKomplekId = comp.id;

    // 3. Create active rate for this complex & category combination
    await db.insert(tarifSyahriah).values({
      komplekId: testKomplekId,
      kategoriId: testKategoriId,
      nominal: 350000,
      alokasiTabungan: 50000,
      alokasiOperasional: 300000,
      berlakuMulai: '2026-01-01',
      isActive: true,
    });

    // 4. Insert exactly 2 test santri in this isolated complex
    const [s1] = await db
      .insert(santri)
      .values({
        nis: `TEST-BILL-01-${Date.now()}`,
        nama: 'Santri Test Billing 1',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281234567891',
      })
      .returning();
    testSantri1Id = s1.id;

    const [s2] = await db
      .insert(santri)
      .values({
        nis: `TEST-BILL-02-${Date.now()}`,
        nama: 'Santri Test Billing 2',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2026-01-01',
        status: 'aktif',
        nomorWhatsapp: '6281234567892',
      })
      .returning();
    testSantri2Id = s2.id;
  });

  afterAll(async () => {
    // Cleanup isolated test fixtures
    await db.delete(tagihan).where(eq(tagihan.komplekId, testKomplekId));
    await db.delete(santri).where(eq(santri.komplekId, testKomplekId));
    await db.delete(tarifSyahriah).where(eq(tarifSyahriah.komplekId, testKomplekId));
    await db.delete(komplek).where(eq(komplek.id, testKomplekId));
  });

  it('generates syahriah bills for active santri with default due date on the 10th', async () => {
    const result = await generateBulkSyahriahBills(
      db,
      {
        bulan: testBulan,
        tahun: testTahun,
        komplekId: testKomplekId,
      },
      { role: 'super_admin', userId: adminUserId }
    );

    expect(result.success).toBe(true);
    expect(result.newlyBilledCount).toBe(2);
    expect(result.totalNominalBilled).toBe(700000);

    // Verify bills created in database
    const bills = await db
      .select()
      .from(tagihan)
      .where(
        and(
          eq(tagihan.bulan, testBulan),
          eq(tagihan.tahun, testTahun),
          eq(tagihan.komplekId, testKomplekId)
        )
      );

    expect(bills.length).toBe(2);
    for (const bill of bills) {
      expect(bill.tipe).toBe('syahriah');
      expect(bill.jatuhTempo).toBe(`${testTahun}-08-10`);
      expect(bill.status).toBe('belum_bayar');
      expect(bill.terbayar).toBe(0);
      expect(bill.sisa).toBe(bill.nominal);
      expect(bill.nominal).toBe(350000);
      expect(bill.judul).toContain('Agustus 2026');
    }
  });

  it('enforces strict idempotency by skipping already billed santri on second generation run', async () => {
    // Re-run generation for the exact same month/year and complex
    const secondResult = await generateBulkSyahriahBills(
      db,
      {
        bulan: testBulan,
        tahun: testTahun,
        komplekId: testKomplekId,
      },
      { role: 'super_admin', userId: adminUserId }
    );

    expect(secondResult.success).toBe(true);
    // Newly billed count must be 0 because all active santri already have bills
    expect(secondResult.newlyBilledCount).toBe(0);
    expect(secondResult.alreadyBilledCount).toBe(2);
    expect(secondResult.totalNominalBilled).toBe(0);

    // Verify database count has not duplicated
    const billsAfter = await db
      .select()
      .from(tagihan)
      .where(
        and(
          eq(tagihan.bulan, testBulan),
          eq(tagihan.tahun, testTahun),
          eq(tagihan.komplekId, testKomplekId)
        )
      );

    expect(billsAfter.length).toBe(2);
  });
});
