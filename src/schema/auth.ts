import { pgTable, uuid, text, timestamp, boolean, pgEnum, primaryKey, index } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'super_admin',
  'bendahara_komplek',
  'santri',
  'pengasuh'
]);

export const pengguna = pgTable('pengguna', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(), // NIS for santri, username for bendahara / admin
  passwordHash: text('password_hash').notNull(),
  nama: text('nama').notNull(),
  role: userRoleEnum('role').notNull().default('santri'),
  isFirstLogin: boolean('is_first_login').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  santriId: uuid('santri_id'), // Nullable FK linked to santri.id if role is santri
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  usernameIdx: index('pengguna_username_idx').on(table.username),
  roleIdx: index('pengguna_role_idx').on(table.role),
}));

export const penggunaKomplek = pgTable('pengguna_komplek', {
  userId: uuid('user_id').notNull().references(() => pengguna.id, { onDelete: 'cascade' }),
  komplekId: uuid('komplek_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.komplekId] }),
  userIdIdx: index('pengguna_komplek_user_idx').on(table.userId),
  komplekIdIdx: index('pengguna_komplek_komplek_idx').on(table.komplekId),
}));
