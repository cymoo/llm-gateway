import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models, modelBackends, usageLogs, dailyUsage } from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";
import {
  MODEL_TYPES,
  validateModelAlias,
  validateModelType,
  validateUrl,
} from "@/lib/utils/validators";
import { recordAudit, diff } from "@/lib/audit/recorder";
import { isForeignKeyViolation } from "@/lib/db/errors";
import { parseBackendsArray, BackendInput } from "../backends-input";

type Params = { params: Promise<{ id: string }> };

async function getModelBackends(modelId: string) {
  return db
    .select()
    .from(modelBackends)
    .where(eq(modelBackends.modelId, modelId))
    .orderBy(asc(modelBackends.createdAt), asc(modelBackends.id));
}

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const rows = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("Model not found");
  return Response.json({ ...rows[0], backends: await getModelBackends(id) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const body = await req.json();

  if (body.alias && !validateModelAlias(body.alias)) {
    return Response.json(
      { error: "Invalid model alias format" },
      { status: 400 }
    );
  }

  if (body.type !== undefined && !validateModelType(body.type)) {
    return Response.json(
      {
        error: `Invalid type: must be one of ${MODEL_TYPES.map(
          (t) => `'${t}'`
        ).join(", ")}`,
      },
      { status: 400 }
    );
  }

  let backendsInput: BackendInput[] | null = null;
  if (body.backends !== undefined) {
    const parsed = parseBackendsArray(body.backends);
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    backendsInput = parsed.backends;
  }

  const updates: Partial<typeof models.$inferInsert> = {};
  const fields = [
    "alias",
    "type",
    "remark",
    "isActive",
    "defaultMaxTokensPerDay",
    "defaultMaxRequestsPerDay",
    "defaultMaxRequestsPerMin",
    "defaultAllowedTimeStart",
    "defaultAllowedTimeEnd",
  ] as const;

  for (const field of fields) {
    if (body[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = body[field];
    }
  }

  const [beforeModel] = await db
    .select()
    .from(models)
    .where(eq(models.id, id))
    .limit(1);
  if (!beforeModel) return notFoundResponse("Model not found");
  const beforeBackends = await getModelBackends(id);

  // Legacy single-backend shorthand: flat backend fields update the model's
  // sole backend. Ambiguous (and rejected) when the model has several.
  if (
    backendsInput === null &&
    (body.backendUrl !== undefined ||
      body.backendModel !== undefined ||
      body.backendApiKey !== undefined)
  ) {
    if (beforeBackends.length !== 1) {
      return Response.json(
        {
          error:
            "Model has multiple backends; use the backends array to update them",
        },
        { status: 400 }
      );
    }
    if (body.backendUrl !== undefined && !validateUrl(body.backendUrl)) {
      return Response.json({ error: "Invalid backendUrl" }, { status: 400 });
    }
    const single = beforeBackends[0];
    backendsInput = [
      {
        id: single.id,
        backendUrl: body.backendUrl ?? single.backendUrl,
        backendModel: body.backendModel ?? single.backendModel,
        backendApiKey:
          body.backendApiKey !== undefined
            ? body.backendApiKey || null
            : single.backendApiKey,
        isActive: single.isActive ?? true,
      },
    ];
  }

  // A submitted backend id must reference one of this model's rows; anything
  // else is a client bug that would otherwise be masked as a fresh insert.
  if (backendsInput !== null) {
    const existingIds = new Set(beforeBackends.map((b) => b.id));
    const unknown = backendsInput.find(
      (b) => b.id !== undefined && !existingIds.has(b.id)
    );
    if (unknown) {
      return Response.json(
        { error: `Unknown backend id: ${unknown.id}` },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [model] =
        Object.keys(updates).length > 0
          ? await tx
              .update(models)
              .set(updates)
              .where(eq(models.id, id))
              .returning()
          : await tx.select().from(models).where(eq(models.id, id)).limit(1);

      if (!model) return null;

      if (backendsInput !== null) {
        // Reconcile: update rows with a known id, insert rows without one,
        // delete rows absent from the submitted list.
        const existingIds = new Set(beforeBackends.map((b) => b.id));
        const keptIds = new Set(
          backendsInput
            .map((b) => b.id)
            .filter((bid): bid is string => bid !== undefined)
        );
        const toDelete = beforeBackends
          .filter((b) => !keptIds.has(b.id))
          .map((b) => b.id);
        if (toDelete.length > 0) {
          await tx
            .delete(modelBackends)
            .where(inArray(modelBackends.id, toDelete));
        }
        for (const backend of backendsInput) {
          if (backend.id && existingIds.has(backend.id)) {
            await tx
              .update(modelBackends)
              .set({
                backendUrl: backend.backendUrl,
                backendModel: backend.backendModel,
                backendApiKey: backend.backendApiKey,
                isActive: backend.isActive,
              })
              .where(eq(modelBackends.id, backend.id));
          } else {
            await tx.insert(modelBackends).values({
              modelId: id,
              backendUrl: backend.backendUrl,
              backendModel: backend.backendModel,
              backendApiKey: backend.backendApiKey,
              isActive: backend.isActive,
            });
          }
        }
      }

      return model;
    });

    if (!updated) return notFoundResponse("Model not found");

    const afterBackends = await getModelBackends(id);

    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "model.update",
      resourceType: "model",
      resourceId: updated.id,
      resourceLabel: updated.alias,
      changes: diff(
        { ...beforeModel, backends: beforeBackends },
        { ...updated, backends: afterBackends }
      ),
      req,
    });

    return Response.json({ ...updated, backends: afterBackends });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json(
        { error: "Model alias already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  let deleted: typeof models.$inferSelect | undefined;
  try {
    deleted = await db.transaction(async (tx) => {
      // Lock the model row before touching anything else. Usage is written
      // after the proxy response (see recordUsage), so a request still in
      // flight can insert a usage_logs/daily_usage row for this model at any
      // moment; landing between the cleanup below and the delete, it would
      // fail the delete on a FK violation. FOR UPDATE conflicts with the FOR
      // KEY SHARE lock those inserts take on the referenced row, so they wait
      // for this transaction and then fail harmlessly (and are logged) against
      // the model that is by then gone.
      const [locked] = await tx
        .select({ id: models.id })
        .from(models)
        .where(eq(models.id, id))
        .for("update")
        .limit(1);
      if (!locked) return undefined;

      // usage_logs and daily_usage don't cascade: detach the history so it
      // survives the model, and drop the aggregates keyed on it. Both run in
      // this transaction, so a failed delete rolls them back instead of
      // destroying usage data for a model that is still there.
      await tx
        .update(usageLogs)
        .set({ modelId: null })
        .where(eq(usageLogs.modelId, id));
      await tx.delete(dailyUsage).where(eq(dailyUsage.modelId, id));

      const [row] = await tx.delete(models).where(eq(models.id, id)).returning();
      return row;
    });
  } catch (err: unknown) {
    // 23503: a table still referencing this model blocks the delete. Surface a
    // readable message instead of an opaque 500 with an empty body.
    if (isForeignKeyViolation(err)) {
      return Response.json(
        { error: "Model still has linked records and cannot be deleted" },
        { status: 409 }
      );
    }
    throw err;
  }

  if (!deleted) return notFoundResponse("Model not found");

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "model.delete",
    resourceType: "model",
    resourceId: deleted.id,
    resourceLabel: deleted.alias,
    changes: diff(deleted, null),
    req,
  });

  return Response.json({ success: true });
}
