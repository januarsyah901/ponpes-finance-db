# @ponpes-finance/db

Shared backend models, Drizzle ORM schemas, Supabase migrations, seed data, and Zod validators for `ponpes-finance`.

## Overview
- **15 PostgreSQL Tables**: `pengguna`, `pengguna_komplek`, `komplek`, `kategori`, `santri`, `tarif_syahriah`, `tagihan`, `pembayaran`, `alokasi_pembayaran`, `ledger_tabungan`, `aturan_subsidi`, `subsidi_penerima`, `kategori_pengeluaran`, `pengeluaran`, `audit_log`.
- **Rupiah Precision**: All currency amounts represented using integer Rupiah (`bigint("...", { mode: "number" })`).
- **Trigger Integrity**: `check_santri_savings_balance()` trigger function enforces non-negative savings balances.
- **Realistic Seed Data**: Seeded with 6 complexes, 3 categories, 18 fee schedules (Rp50.000 fixed savings allocation), users with bcrypt hashed passwords (`password123`), test santri, bills, and ledger mutations.
- **Shared Contracts & Validators**: Type-safe Zod validation schemas and TypeScript types exported for frontend consumption.

## Scripts
- `pnpm run build`: Compile CJS, ESM, and `.d.ts` bundles with `tsup`.
- `pnpm run typecheck`: Validate TypeScript types (`tsc --noEmit`).
- `pnpm run test`: Run Vitest schema and invariant test suite.
