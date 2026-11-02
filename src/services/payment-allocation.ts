import { eq, and, inArray, asc, desc, sql } from 'drizzle-orm';
import type { Database } from '../client';
import {
  santri,
  tagihan,
  pembayaran,
  alokasiPembayaran,
  ledgerTabungan,
  tarifSyahriah,
  auditLog,
} from '../schema';
import type { AllocatePaymentInput, AllocatedBillItem, AllocationResult } from '../types';
import { INDO_MONTHS } from './billing';

export type { AllocatePaymentInput, AllocatedBillItem, AllocationResult };

export async function allocatePayment(
  db: Database,
  input: AllocatePaymentInput
): Promise<AllocationResult> {
  const {
    pembayaranId: existingPembayaranId,
    santriId,
    nominal,
    metode,
    tanggalBayar,
    catatan,
    buktiUrl,
    adminUserId,
    isCashDesk = false,
  } = input;

  if (nominal <= 0) {
    throw new Error('Nominal pembayaran harus lebih besar dari 0');
  }

  const tanggalBayarStr =
    typeof tanggalBayar === 'string'
      ? tanggalBayar.split('T')[0]
      : tanggalBayar.toISOString().split('T')[0];

  return await db.transaction(async (tx) => {
    // 1. PESSIMISTIC ROW LOCK on santri to serialize payments for this santri
    const [lockedSantri] = await tx
      .select()
      .from(santri)
      .where(eq(santri.id, santriId))
      .for('update');

    if (!lockedSantri) {
      throw new Error(`Santri dengan ID ${santriId} tidak ditemukan`);
    }

    // 2. Resolve or Create Pembayaran Record
    let activePembayaranId: string;

    if (existingPembayaranId) {
      const [existingPay] = await tx
        .select()
        .from(pembayaran)
        .where(eq(pembayaran.id, existingPembayaranId))
        .for('update');

      if (!existingPay) {
        throw new Error(`Pembayaran dengan ID ${existingPembayaranId} tidak ditemukan`);
      }

      if (existingPay.status === 'terverifikasi') {
        throw new Error('Pembayaran ini sudah pernah diverifikasi sebelumnya');
      }

      if (existingPay.isReversal) {
        throw new Error('Tidak dapat mengalokasikan pembayaran yang berstatus reversal');
      }

      await tx
        .update(pembayaran)
        .set({
          status: 'terverifikasi',
          nominalDiverifikasi: nominal,
          diverifikasiOlehId: adminUserId,
          diverifikasiPada: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pembayaran.id, existingPembayaranId));

      activePembayaranId = existingPembayaranId;
    } else {
      const [newPay] = await tx
        .insert(pembayaran)
        .values({
          santriId,
          komplekId: lockedSantri.komplekId,
          metode,
          nominal,
          nominalDiverifikasi: nominal,
          tanggalBayar: tanggalBayarStr,
          catatanSantri: catatan || (isCashDesk ? 'Pembayaran tunai di meja kasir' : undefined),
          buktiUrl,
          status: 'terverifikasi',
          diverifikasiOlehId: adminUserId,
          diverifikasiPada: new Date(),
          isReversal: false,
        })
        .returning({ id: pembayaran.id });

      activePembayaranId = newPay.id;
    }

    // 3. FETCH & LOCK UNPAID BILLS (FIFO Order: oldest due date, year, month, created_at)
    const unpaidBills = await tx
      .select()
      .from(tagihan)
      .where(
        and(
          eq(tagihan.santriId, santriId),
          inArray(tagihan.status, ['belum_bayar', 'sebagian'])
        )
      )
      .orderBy(
        asc(tagihan.jatuhTempo),
        asc(tagihan.tahun),
        asc(tagihan.bulan),
        asc(tagihan.createdAt)
      )
      .for('update');

    let remainingFunds = nominal;
    let totalSavingsAllocated = 0;
    let totalOperationalAllocated = 0;
    const allocatedBills: AllocatedBillItem[] = [];

    // 4. FIFO ALLOCATION LOOP
    for (const bill of unpaidBills) {
      if (remainingFunds <= 0) break;

      const billSisa = Number(bill.sisa);
      if (billSisa <= 0) continue;

      const allocationAmount = Math.min(remainingFunds, billSisa);
      let savingsAllocation = 0;
      let operationalAllocation = 0;

      if (bill.tipe === 'syahriah') {
        // Query cumulative savings previously allocated to this specific bill
        const [priorSavingsResult] = await tx
          .select({
            totalTabungan: sql<number>`COALESCE(SUM(${alokasiPembayaran.alokasiTabungan}), 0)::int`,
          })
          .from(alokasiPembayaran)
          .where(
            and(
              eq(alokasiPembayaran.tagihanId, bill.id),
              eq(alokasiPembayaran.isReversal, false)
            )
          );

        const priorSavings = Number(priorSavingsResult?.totalTabungan || 0);
        const fixedSavingsCap = 50000;
        const savingsNeeded = Math.max(0, fixedSavingsCap - priorSavings);

        savingsAllocation = Math.min(allocationAmount, savingsNeeded);
        operationalAllocation = allocationAmount - savingsAllocation;
      } else {
        // Activity/event bill: 100% operational
        savingsAllocation = 0;
        operationalAllocation = allocationAmount;
      }

      // Check sum constraint
      if (allocationAmount !== savingsAllocation + operationalAllocation) {
        throw new Error(
          `Constraint Error: Alokasi (${allocationAmount}) != Tabungan (${savingsAllocation}) + Operasional (${operationalAllocation})`
        );
      }

      // Insert alokasi_pembayaran
      await tx.insert(alokasiPembayaran).values({
        pembayaranId: activePembayaranId,
        tagihanId: bill.id,
        nominalAlokasi: allocationAmount,
        alokasiTabungan: savingsAllocation,
        alokasiOperasional: operationalAllocation,
        isReversal: false,
      });

      // Insert savings ledger entry if savings portion was allocated
      if (savingsAllocation > 0) {
        const monthYearLabel = bill.bulan && bill.tahun ? ` (${bill.judul})` : '';
        await tx.insert(ledgerTabungan).values({
          santriId,
          jenisMutasi: 'setoran_syahriah',
          nominal: savingsAllocation,
          referensiTipe: 'pembayaran',
          referensiId: activePembayaranId,
          keterangan: `Setoran tabungan syahriah${monthYearLabel}`,
          dibuatOlehId: adminUserId,
          disetujuiOlehId: adminUserId,
        });
      }

      // Update bill state
      const newTerbayar = Number(bill.terbayar) + allocationAmount;
      const newSisa = billSisa - allocationAmount;
      const newStatus = newSisa === 0 ? ('lunas' as const) : ('sebagian' as const);

      await tx
        .update(tagihan)
        .set({
          terbayar: newTerbayar,
          sisa: newSisa,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(tagihan.id, bill.id));

      totalSavingsAllocated += savingsAllocation;
      totalOperationalAllocated += operationalAllocation;
      remainingFunds -= allocationAmount;

      allocatedBills.push({
        tagihanId: bill.id,
        judul: bill.judul,
        bulan: bill.bulan,
        tahun: bill.tahun,
        tabunganAllocated: savingsAllocation,
        operasionalAllocated: operationalAllocation,
        totalAllocated: allocationAmount,
        remainingBill: newSisa,
        status: newStatus,
      });
    }

    // 5. ADVANCE PAYMENT HANDLING (Bayar di Muka if remainingFunds > 0)
    if (remainingFunds > 0) {
      const [activeTarif] = await tx
        .select()
        .from(tarifSyahriah)
        .where(
          and(
            eq(tarifSyahriah.komplekId, lockedSantri.komplekId),
            eq(tarifSyahriah.kategoriId, lockedSantri.kategoriId),
            eq(tarifSyahriah.isActive, true)
          )
        )
        .limit(1);

      if (activeTarif) {
        const [latestBill] = await tx
          .select({
            bulan: tagihan.bulan,
            tahun: tagihan.tahun,
          })
          .from(tagihan)
          .where(and(eq(tagihan.santriId, santriId), eq(tagihan.tipe, 'syahriah')))
          .orderBy(desc(tagihan.tahun), desc(tagihan.bulan))
          .limit(1);

        const now = new Date();
        let nextBulan = latestBill?.bulan ? (latestBill.bulan % 12) + 1 : now.getMonth() + 1;
        let nextTahun = latestBill?.tahun
          ? latestBill.bulan === 12
            ? latestBill.tahun + 1
            : latestBill.tahun
          : now.getFullYear();

        while (remainingFunds > 0) {
          const tarifNominal = Number(activeTarif.nominal);
          const advanceJatuhTempo = `${nextTahun}-${String(nextBulan).padStart(2, '0')}-10`;
          const monthName = INDO_MONTHS[nextBulan - 1] || `Bulan ${nextBulan}`;
          const advanceJudul = `Syahriah ${monthName} ${nextTahun}`;

          const [advanceBill] = await tx
            .insert(tagihan)
            .values({
              santriId,
              komplekId: lockedSantri.komplekId,
              tipe: 'syahriah',
              judul: advanceJudul,
              bulan: nextBulan,
              tahun: nextTahun,
              jatuhTempo: advanceJatuhTempo,
              nominal: tarifNominal,
              terbayar: 0,
              sisa: tarifNominal,
              status: 'belum_bayar',
            })
            .returning();

          const allocationAmount = Math.min(remainingFunds, tarifNominal);
          const fixedSavingsCap = 50000;
          const savingsAllocation = Math.min(allocationAmount, fixedSavingsCap);
          const operationalAllocation = allocationAmount - savingsAllocation;

          await tx.insert(alokasiPembayaran).values({
            pembayaranId: activePembayaranId,
            tagihanId: advanceBill.id,
            nominalAlokasi: allocationAmount,
            alokasiTabungan: savingsAllocation,
            alokasiOperasional: operationalAllocation,
            isReversal: false,
          });

          if (savingsAllocation > 0) {
            await tx.insert(ledgerTabungan).values({
              santriId,
              jenisMutasi: 'setoran_syahriah',
              nominal: savingsAllocation,
              referensiTipe: 'pembayaran',
              referensiId: activePembayaranId,
              keterangan: `Setoran tabungan syahriah (Bayar di Muka: ${advanceJudul})`,
              dibuatOlehId: adminUserId,
              disetujuiOlehId: adminUserId,
            });
          }

          const newTerbayar = allocationAmount;
          const newSisa = tarifNominal - allocationAmount;
          const newStatus = newSisa === 0 ? ('lunas' as const) : ('sebagian' as const);

          await tx
            .update(tagihan)
            .set({
              terbayar: newTerbayar,
              sisa: newSisa,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(tagihan.id, advanceBill.id));

          totalSavingsAllocated += savingsAllocation;
          totalOperationalAllocated += operationalAllocation;
          remainingFunds -= allocationAmount;

          allocatedBills.push({
            tagihanId: advanceBill.id,
            judul: advanceJudul,
            bulan: nextBulan,
            tahun: nextTahun,
            tabunganAllocated: savingsAllocation,
            operasionalAllocated: operationalAllocation,
            totalAllocated: allocationAmount,
            remainingBill: newSisa,
            status: newStatus,
          });

          nextBulan = (nextBulan % 12) + 1;
          if (nextBulan === 1) {
            nextTahun += 1;
          }
        }
      }
    }

    // 6. RECORD AUDIT LOG ENTRY
    await tx.insert(auditLog).values({
      userId: adminUserId,
      action: isCashDesk ? 'kas_pembayaran_tunai' : 'verifikasi_pembayaran_setujui',
      entityType: 'pembayaran',
      entityId: activePembayaranId,
      newValues: {
        santriId,
        nominalDiverifikasi: nominal,
        metode,
        totalTabungan: totalSavingsAllocated,
        totalOperasional: totalOperationalAllocated,
        allocatedBillsCount: allocatedBills.length,
      },
    });

    return {
      pembayaranId: activePembayaranId,
      santriId,
      nominalTotal: nominal,
      allocatedBills,
      totalTabungan: totalSavingsAllocated,
      totalOperasional: totalOperationalAllocated,
      excessCredit: remainingFunds,
    };
  });
}
