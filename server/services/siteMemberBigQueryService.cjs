'use strict';

const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

const SCHEMAS = {
  sites: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'site_name', type: 'STRING' },
    { name: 'manager_name', type: 'STRING' },
    { name: 'method', type: 'STRING' },
    { name: 'series', type: 'STRING' },
    { name: 'is_active', type: 'BOOLEAN' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  members: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING' },
    { name: 'role', type: 'STRING' },
    { name: 'phone', type: 'STRING' },
    { name: 'target_lat', type: 'FLOAT' },
    { name: 'target_lng', type: 'FLOAT' },
    { name: 'radius_m', type: 'FLOAT' },
    { name: 'notes', type: 'STRING' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  member_sites: [
    { name: 'member_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'site_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'is_primary', type: 'BOOLEAN' },
    { name: 'can_manage', type: 'BOOLEAN' },
    { name: 'is_bidirectional', type: 'BOOLEAN' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ]
};

async function ensureTableSchema(table, tableName, schema) {
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({ schema });
    return;
  }

  const [metadata] = await table.getMetadata();
  const existing = metadata.schema?.fields || [];
  const existingNames = new Set(existing.map((field) => field.name));
  const missingNullable = schema.filter((field) => !existingNames.has(field.name) && field.mode !== 'REQUIRED');

  if (missingNullable.length > 0) {
    await table.setMetadata({
      schema: { fields: [...existing, ...missingNullable] }
    });
  }
}

async function ensureSiteMemberTables() {
  const bq = getBigQueryClient();
  if (!bq) return { success: false, message: 'BigQuery 클라이언트 초기화 실패' };

  const dataset = bq.dataset(DATASET_ID);
  for (const [tableName, schema] of Object.entries(SCHEMAS)) {
    await ensureTableSchema(dataset.table(tableName), tableName, schema);
  }

  return { success: true };
}

async function upsertSiteMemberSnapshot(payload) {
  const bq = getBigQueryClient();
  if (!bq) return { success: false, message: 'BigQuery 클라이언트 초기화 실패' };

  const ensured = await ensureSiteMemberTables();
  if (!ensured.success) return ensured;

  const now = new Date().toISOString();
  const { site, member, link } = payload;

  await bq.query({
    query: `
      MERGE \`${DATASET_ID}.sites\` T
      USING (
        SELECT @id AS id, @site_name AS site_name, @manager_name AS manager_name, @method AS method, @series AS series,
               @is_active AS is_active, @updated_at AS updated_at, @uploaded_at AS uploaded_at
      ) S
      ON T.id = S.id
      WHEN MATCHED THEN UPDATE SET
        site_name = S.site_name,
        manager_name = S.manager_name,
        method = S.method,
        series = S.series,
        is_active = S.is_active,
        updated_at = S.updated_at,
        uploaded_at = S.uploaded_at
      WHEN NOT MATCHED THEN INSERT (id, site_name, manager_name, method, series, is_active, updated_at, uploaded_at)
      VALUES (S.id, S.site_name, S.manager_name, S.method, S.series, S.is_active, S.updated_at, S.uploaded_at)
    `,
    params: {
      id: String(site.id),
      site_name: site.site_name || '',
      manager_name: site.manager_name || '',
      method: site.method || '',
      series: site.series || '',
      is_active: Boolean(site.is_active),
      updated_at: now,
      uploaded_at: now
    }
  });

  await bq.query({
    query: `
      MERGE \`${DATASET_ID}.members\` T
      USING (
        SELECT @id AS id, @name AS name, @role AS role, @phone AS phone,
               @target_lat AS target_lat, @target_lng AS target_lng, @radius_m AS radius_m, @notes AS notes,
               @updated_at AS updated_at, @uploaded_at AS uploaded_at
      ) S
      ON T.id = S.id
      WHEN MATCHED THEN UPDATE SET
        name = S.name,
        role = S.role,
        phone = S.phone,
        target_lat = S.target_lat,
        target_lng = S.target_lng,
        radius_m = S.radius_m,
        notes = S.notes,
        updated_at = S.updated_at,
        uploaded_at = S.uploaded_at
      WHEN NOT MATCHED THEN INSERT (id, name, role, phone, target_lat, target_lng, radius_m, notes, updated_at, uploaded_at)
      VALUES (S.id, S.name, S.role, S.phone, S.target_lat, S.target_lng, S.radius_m, S.notes, S.updated_at, S.uploaded_at)
    `,
    params: {
      id: String(member.id),
      name: member.name || '',
      role: member.role || 'user',
      phone: member.phone || '',
      target_lat: member.target_lat != null ? Number(member.target_lat) : null,
      target_lng: member.target_lng != null ? Number(member.target_lng) : null,
      radius_m: member.radius_m != null ? Number(member.radius_m) : null,
      notes: member.notes || '',
      updated_at: now,
      uploaded_at: now
    }
  });

  await bq.query({
    query: `
      MERGE \`${DATASET_ID}.member_sites\` T
      USING (
        SELECT @member_id AS member_id, @site_id AS site_id, @is_primary AS is_primary,
               @can_manage AS can_manage, @is_bidirectional AS is_bidirectional,
               @updated_at AS updated_at, @uploaded_at AS uploaded_at
      ) S
      ON T.member_id = S.member_id AND T.site_id = S.site_id
      WHEN MATCHED THEN UPDATE SET
        is_primary = S.is_primary,
        can_manage = S.can_manage,
        is_bidirectional = S.is_bidirectional,
        updated_at = S.updated_at,
        uploaded_at = S.uploaded_at
      WHEN NOT MATCHED THEN INSERT (member_id, site_id, is_primary, can_manage, is_bidirectional, updated_at, uploaded_at)
      VALUES (S.member_id, S.site_id, S.is_primary, S.can_manage, S.is_bidirectional, S.updated_at, S.uploaded_at)
    `,
    params: {
      member_id: String(link.member_id),
      site_id: String(link.site_id),
      is_primary: Boolean(link.is_primary),
      can_manage: Boolean(link.can_manage),
      is_bidirectional: Boolean(link.is_bidirectional),
      updated_at: now,
      uploaded_at: now
    }
  });

  return { success: true };
}

module.exports = {
  ensureSiteMemberTables,
  upsertSiteMemberSnapshot
};
