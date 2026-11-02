import { eq, desc } from 'drizzle-orm';
import { auditLog } from '../schema/audit';
import type { Database } from '../client';

export interface LogAuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAudit(db: Database | any, input: LogAuditInput) {
  const [created] = await db
    .insert(auditLog)
    .values({
      userId: input.userId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: input.oldValues ? (input.oldValues as any) : null,
      newValues: input.newValues ? (input.newValues as any) : null,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    })
    .returning();
  return created;
}

export async function listAuditLogs(
  db: Database | any,
  options?: { entityType?: string; entityId?: string; limit?: number }
) {
  const limit = options?.limit ?? 50;

  return (db as any).query.auditLog.findMany({
    where: options?.entityType && options?.entityId
      ? (log: any, { and, eq }: any) =>
          and(eq(log.entityType, options.entityType!), eq(log.entityId, options.entityId!))
      : undefined,
    orderBy: [desc(auditLog.createdAt)],
    limit,
    with: {
      pengguna: true,
    },
  });
}
