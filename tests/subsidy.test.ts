import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/client';
import {
  previewSubsidyApplication,
  executeSubsidyApplication,
} from '../src/services/subsidy';
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
  pengguna,
  auditLog,
} from '../src/schema';
import { eq, sql } from 'drizzle-orm';

describe('Automated Subsidy Rules & Execution Engine', () => {
  const db = getDb();
  let testKomplekId: string;
  let otherKomplekId: string;
  let testKategoriId: string;
  let adminUserId: string;

  let santriEligibleId: string;
  let santriIneligibleArrearsId: string;
  let santriIneligibleSavingsId: string;
  let santriSavingsDeductionId: string;

  beforeAll(async () => {
    const complexes = await db.select().from(komplek).limit(2);
    testKomplekId = complexes[0].id;
    otherKomplekId = complexes[1].id;

    const [kat] = await db.select().from(kategori).limit(1);
    testKategoriId = kat.id;

    const [admin] = await db
      .select()
      .from(pengguna)
      .where(eq(pengguna.role, 'super_admin'))
      .limit(1);
    adminUserId = admin.id;

    // Santri 1: Fully eligible (enrolled 2024, 2 unpaid syahriah bills, 0 savings)
    const [s1] = await db
      .insert(santri)
      .values({
        nis: `SUB-TEST-1-${Date.now()}`,
        nama: 'Santri Eligible Direct',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2024-01-01',
        status: 'aktif',
        nomorWhatsapp: '6282211110001',
      })
      .returning();
    santriEligibleId = s1.id;

    // Create 2 unpaid syahriah bills for santri 1
    await db.insert(tagihan).values([
      {
        santriId: s1.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Januari 2026',
        bulan: 1,
        tahun: 2026,
        jatuhTempo: '2026-01-10',
        nominal: 150000,
        terbayar: 0,
        sisa: 150000,
        status: 'belum_bayar',
      },
      {
        santriId: s1.id,
        komplekId: testKomplekId,
        tipe: 'syahriah',
        judul: 'Syahriah Februari 2026',
        bulan: 2,
        tahun: 2026,
        jatuhTempo: '2026-02-10',
        nominal: 150000,
        terbayar: 0,
        sisa: 150000,
        status: 'belum_bayar',
      },
    ]);

    // Santri 2: Ineligible due to insufficient arrears (only 0 unpaid bills)
    const [s2] = await db
      .insert(santri)
      .values({
        nis: `SUB-TEST-2-${Date.now()}`,
        nama: 'Santri Ineligible Arrears',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2024-01-01',
        status: 'aktif',
        nomorWhatsapp: '6282211110002',
      })
      .returning();
    santriIneligibleArrearsId = s2.id;

    // Santri 3: Ineligible due to excess savings (has 500.000 in savings)
    const [s3] = await db
      .insert(santri)
      .values({
        nis: `SUB-TEST-3-${Date.now()}`,
        nama: 'Santri Ineligible High Savings',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2024-01-01',
        status: 'aktif',
        nomorWhatsapp: '6282211110003',
      })
      .returning();
    santriIneligibleSavingsId = s3.id;

    await db.insert(tagihan).values({
      santriId: s3.id,
      komplekId: testKomplekId,
      tipe: 'syahriah',
      judul: 'Syahriah Maret 2026',
      bulan: 3,
      tahun: 2026,
      jatuhTempo: '2026-03-10',
      nominal: 150000,
      terbayar: 0,
      sisa: 150000,
      status: 'belum_bayar',
    });
    await db.insert(ledgerTabungan).values({
      santriId: s3.id,
      jenisMutasi: 'saldo_awal',
      nominal: 500000,
      keterangan: 'Tabungan banyak',
      dibuatOlehId: adminUserId,
    });

    // Santri 4: For savings deduction subsidy (has 200.000 savings and 100.000 event bill)
    const [s4] = await db
      .insert(santri)
      .values({
        nis: `SUB-TEST-4-${Date.now()}`,
        nama: 'Santri Savings Deduction Target',
        komplekId: testKomplekId,
        kategoriId: testKategoriId,
        tanggalMasuk: '2024-01-01',
        status: 'aktif',
        nomorWhatsapp: '6282211110004',
      })
      .returning();
    santriSavingsDeductionId = s4.id;

    await db.insert(ledgerTabungan).values({
      santriId: s4.id,
      jenisMutasi: 'saldo_awal',
      nominal: 200000,
      keterangan: 'Opening balance s4',
      dibuatOlehId: adminUserId,
    });
  });

  afterAll(async () => {
    const santriIds = [
      santriEligibleId,
      santriIneligibleArrearsId,
      santriIneligibleSavingsId,
      santriSavingsDeductionId,
    ].filter(Boolean);

    if (santriIds.length > 0) {
      await db.delete(subsidiPenerima).where(
        sql`${subsidiPenerima.santriId} IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})`
      );
      await db.delete(aturanSubsidi).where(
        sql`${aturanSubsidi.tagihanKegiatanId} IN (SELECT id FROM tagihan WHERE santri_id IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})) OR ${aturanSubsidi.nama} IN ('Keringanan Syahriah Santri Dhuafa', 'Bantuan Langsung Syahriah 2026', 'Subsidi Haul Akbar dari Tabungan', 'Subsidi Kebersihan Capping Test')`
      );
      await db.delete(alokasiPembayaran).where(
        sql`${alokasiPembayaran.pembayaranId} IN (SELECT id FROM pembayaran WHERE santri_id IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)}))`
      );
      await db.delete(pembayaran).where(
        sql`${pembayaran.santriId} IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})`
      );
      await db.delete(ledgerTabungan).where(
        sql`${ledgerTabungan.santriId} IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})`
      );
      await db.delete(tagihan).where(
        sql`${tagihan.santriId} IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})`
      );
      await db.delete(santri).where(
        sql`${santri.id} IN (${sql.join(santriIds.map((id) => sql`${id}`), sql`, `)})`
      );
    }
  });

  it('SUB-1: preview dry-run correctly evaluates compound AND conditions', async () => {
    // Create rule: Aid for santri in testKomplek, min 2 unpaid bills, max savings 100k
    const [rule] = await db
      .insert(aturanSubsidi)
      .values({
        nama: 'Keringanan Syahriah Santri Dhuafa',
        nominal: 100000,
        syaratJson: {
          komplekId: testKomplekId,
          minTagihanTertunggak: 2,
          maxSaldoTabungan: 100000,
          minLamaMondokBulan: 6,
          sumberDana: 'bantuan_langsung',
          cakupan: 'nominal_tetap',
          tipeTarget: 'syahriah',
        },
        isActive: true,
        dibuatOlehId: adminUserId,
      })
      .returning();

    const preview = await previewSubsidyApplication({
      aturanId: rule.id,
      komplekId: testKomplekId,
    });

    expect(preview.aturanId).toBe(rule.id);
    expect(preview.totalProposedNominal).toBeGreaterThanOrEqual(100000);

    const eligible = preview.eligibleBeneficiaries.find((b) => b.santriId === santriEligibleId);
    expect(eligible).toBeDefined();
    expect(eligible?.proposedSubsidyNominal).toBe(100000);

    // Verify ineligible candidates and explicit reasons
    const ineligArrears = preview.ineligibleCandidates.find(
      (b) => b.santriId === santriIneligibleArrearsId
    );
    expect(ineligArrears).toBeDefined();
    expect(ineligArrears?.reasons.some((r) => r.includes('kurang dari syarat minimal'))).toBe(true);

    const ineligSavings = preview.ineligibleCandidates.find(
      (b) => b.santriId === santriIneligibleSavingsId
    );
    expect(ineligSavings).toBeDefined();
    expect(ineligSavings?.reasons.some((r) => r.includes('melebihi batas maksimal'))).toBe(true);
  });

  it('SUB-2: executes direct fee relief atomically without touching savings ledger', async () => {
    const [rule] = await db
      .insert(aturanSubsidi)
      .values({
        nama: 'Bantuan Langsung Syahriah 2026',
        nominal: 100000,
        syaratJson: {
          komplekId: testKomplekId,
          minTagihanTertunggak: 2,
          maxSaldoTabungan: 100000,
          sumberDana: 'bantuan_langsung',
          cakupan: 'nominal_tetap',
          tipeTarget: 'syahriah',
        },
        isActive: true,
        dibuatOlehId: adminUserId,
      })
      .returning();

    const balBefore = await db
      .select({
        total: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
      })
      .from(ledgerTabungan)
      .where(eq(ledgerTabungan.santriId, santriEligibleId));
    const savingsBalBefore = balBefore[0]?.total || 0;

    const result = await executeSubsidyApplication({
      aturanId: rule.id,
      adminUserId,
      selectedSantriIds: [santriEligibleId],
    });

    expect(result.success).toBe(true);
    expect(result.totalBeneficiaries).toBe(1);
    expect(result.totalAppliedNominal).toBe(100000);

    const beneficiary = result.appliedBeneficiaries[0];
    expect(beneficiary.santriId).toBe(santriEligibleId);
    expect(beneficiary.ledgerTabunganId).toBeNull(); // No savings deduction

    // Verify savings balance remained completely untouched
    const balAfter = await db
      .select({
        total: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
      })
      .from(ledgerTabungan)
      .where(eq(ledgerTabungan.santriId, santriEligibleId));
    expect(balAfter[0]?.total || 0).toBe(savingsBalBefore);

    // Verify pembayaran has metode 'subsidi' and is_subsidi true
    const [pay] = await db.select().from(pembayaran).where(eq(pembayaran.id, beneficiary.pembayaranId));
    expect(pay.metode).toBe('subsidi');
    expect(pay.isSubsidi).toBe(true);
    expect(pay.status).toBe('terverifikasi');

    // Verify alokasi_pembayaran has is_subsidi true
    const [alokasi] = await db
      .select()
      .from(alokasiPembayaran)
      .where(eq(alokasiPembayaran.pembayaranId, beneficiary.pembayaranId));
    expect(alokasi.isSubsidi).toBe(true);
    expect(Number(alokasi.nominalAlokasi)).toBe(100000);

    // Verify tagihan was credited
    const [bill] = await db.select().from(tagihan).where(eq(tagihan.id, beneficiary.tagihanId));
    expect(Number(bill.terbayar)).toBe(100000);
    expect(Number(bill.sisa)).toBe(50000);
    expect(bill.status).toBe('sebagian');

    // Idempotency: executing again for the same rule should skip already awarded santri
    const secondExec = await executeSubsidyApplication({
      aturanId: rule.id,
      adminUserId,
      selectedSantriIds: [santriEligibleId],
    });
    expect(secondExec.totalBeneficiaries).toBe(0);
    expect(secondExec.skippedCount).toBe(0); // filtered in preview
  });

  it('SUB-3: executes event subsidy funded by savings (potong_tabungan) atomically', async () => {
    // Create an event bill for santriSavingsDeductionId
    const [eventBill] = await db
      .insert(tagihan)
      .values({
        santriId: santriSavingsDeductionId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Haul Akbar Pesantren',
        jatuhTempo: '2026-12-31',
        nominal: 75000,
        terbayar: 0,
        sisa: 75000,
        status: 'belum_bayar',
      })
      .returning();

    const [rule] = await db
      .insert(aturanSubsidi)
      .values({
        nama: 'Subsidi Haul Akbar dari Tabungan',
        tagihanKegiatanId: eventBill.id,
        nominal: 75000,
        syaratJson: {
          komplekId: testKomplekId,
          sumberDana: 'potong_tabungan',
          cakupan: 'nominal_tetap',
          tipeTarget: 'kegiatan',
        },
        isActive: true,
        dibuatOlehId: adminUserId,
      })
      .returning();

    const result = await executeSubsidyApplication({
      aturanId: rule.id,
      adminUserId,
      selectedSantriIds: [santriSavingsDeductionId],
    });

    expect(result.success).toBe(true);
    expect(result.totalBeneficiaries).toBe(1);

    const beneficiary = result.appliedBeneficiaries[0];
    expect(beneficiary.ledgerTabunganId).not.toBeNull();

    // Verify ledger_tabungan has negative deduction
    const [ledgerEntry] = await db
      .select()
      .from(ledgerTabungan)
      .where(eq(ledgerTabungan.id, beneficiary.ledgerTabunganId!));
    expect(ledgerEntry.jenisMutasi).toBe('pemakaian_kegiatan');
    expect(Number(ledgerEntry.nominal)).toBe(-75000);

    // Derived savings balance decreased by exactly 75.000 (was 200.000 -> now 125.000)
    const [balResult] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${ledgerTabungan.nominal}), 0)::int`,
      })
      .from(ledgerTabungan)
      .where(eq(ledgerTabungan.santriId, santriSavingsDeductionId));
    expect(balResult.total).toBe(125000);

    // Tagihan is now lunas
    const [updatedBill] = await db.select().from(tagihan).where(eq(tagihan.id, eventBill.id));
    expect(updatedBill.status).toBe('lunas');
    expect(Number(updatedBill.sisa)).toBe(0);
  });

  it('SUB-4: caps subsidy at remaining bill sisa (no overpayment)', async () => {
    // Bill has sisa 40.000, rule offers 100.000 -> awarded subsidy should be exactly 40.000
    const [partialBill] = await db
      .insert(tagihan)
      .values({
        santriId: santriSavingsDeductionId,
        komplekId: testKomplekId,
        tipe: 'kegiatan',
        judul: 'Iuran Kebersihan',
        jatuhTempo: '2026-12-31',
        nominal: 50000,
        terbayar: 10000,
        sisa: 40000,
        status: 'sebagian',
      })
      .returning();

    const [rule] = await db
      .insert(aturanSubsidi)
      .values({
        nama: 'Subsidi Kebersihan Capping Test',
        tagihanKegiatanId: partialBill.id,
        nominal: 100000, // Offered nominal is 100k, higher than sisa (40k)
        syaratJson: {
          komplekId: testKomplekId,
          sumberDana: 'bantuan_langsung',
          cakupan: 'nominal_tetap',
          tipeTarget: 'kegiatan',
        },
        isActive: true,
        dibuatOlehId: adminUserId,
      })
      .returning();

    const result = await executeSubsidyApplication({
      aturanId: rule.id,
      adminUserId,
      selectedSantriIds: [santriSavingsDeductionId],
    });

    expect(result.success).toBe(true);
    expect(result.totalAppliedNominal).toBe(40000); // strictly capped at 40k!
    expect(result.appliedBeneficiaries[0].remainingBillSisa).toBe(0);
    expect(result.appliedBeneficiaries[0].newBillStatus).toBe('lunas');
  });
});
