const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

// ?ㅼ젙
const KEY_FILE_PATH = path.join(__dirname, '../config/work-jindan-194620a46d59.json');
const DATASET_ID = 'daily_log_system'; // ?ъ슜?먭? ?앹꽦???곗씠?곗뀑 ?대쫫

if (!fs.existsSync(KEY_FILE_PATH)) {
  console.error('?????뚯씪??李얠쓣 ???놁뒿?덈떎:', KEY_FILE_PATH);
  process.exit(1);
}

const bigquery = new BigQuery({ keyFilename: KEY_FILE_PATH });

async function ensureTableSchema(table, tableName, schema) {
  const [metadata] = await table.getMetadata();
  const existingFields = metadata.schema?.fields || [];
  const existingNames = new Set(existingFields.map((field) => field.name));
  const missingFields = schema.filter((field) => !existingNames.has(field.name));

  if (missingFields.length === 0) {
    console.log(`?좑툘  [Skip] ?뚯씠釉?'${tableName}' ?ㅽ궎留덈뒗 理쒖떊 ?곹깭?낅땲??`);
    return;
  }

  const missingRequired = missingFields.filter((field) => field.mode === 'REQUIRED');
  if (missingRequired.length > 0) {
    console.warn(`?좑툘  [Warn] ?뚯씠釉?'${tableName}'??REQUIRED 而щ읆 ${missingRequired.map((field) => field.name).join(', ')} ??媛) ?꾨씫?섏뼱 ?먮룞 異붽??????놁뒿?덈떎.`);
  }

  const appendableFields = missingFields.filter((field) => field.mode !== 'REQUIRED');
  if (appendableFields.length === 0) {
    return;
  }

  await table.setMetadata({
    schema: {
      fields: [...existingFields, ...appendableFields]
    }
  });

  console.log(`??[Updated] ?뚯씠釉?'${tableName}'??而щ읆 ${appendableFields.map((field) => field.name).join(', ')} 異붽? ?꾨즺.`);
}

// ?뚯씠釉??ㅽ궎留??뺤쓽
// 濡쒖뺄 DB 而щ읆 + site_name, author, local_id, created_at, updated_at, uploaded_at
const SCHEMAS = {
  flow_readings: [
    { name: 'site_id',  type: 'STRING' },
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'type', type: 'STRING' },
    { name: 'raw_value', type: 'FLOAT' },
    { name: 'calculated_flow', type: 'FLOAT' },
    { name: 'is_reset', type: 'BOOLEAN' },
    { name: 'is_manual', type: 'BOOLEAN' },
    { name: 'sludge_export', type: 'FLOAT' },
    { name: 'updated_at', type: 'TIMESTAMP' }, // 濡쒖뺄 ?섏젙 ?쒓컙
    { name: 'uploaded_at', type: 'TIMESTAMP' }  // ?쒕쾭 ?꾩넚 ?쒓컙
  ],
  medicine_logs: [
    { name: 'site_id',  type: 'STRING' },
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'medicine_name', type: 'STRING' },
    { name: 'date', type: 'DATE' },
    { name: 'purchase_amount', type: 'FLOAT' },
    { name: 'usage_amount', type: 'FLOAT' },
    { name: 'current_inventory', type: 'FLOAT' },
    { name: 'photo_url', type: 'STRING' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  water_quality: [
    { name: 'site_id',  type: 'STRING' },
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'date', type: 'DATE' },
    { name: 'measurement_group', type: 'STRING' },
    { name: 'measurement_order', type: 'INTEGER' },
    { name: 'source_type', type: 'STRING' },
    { name: 'source_label', type: 'STRING' },
    { name: 'qntech_project_id', type: 'STRING' },
    { name: 'location', type: 'STRING' },
    { name: 'nh3_n', type: 'STRING' }, // ?뱀닔湲고샇 ?ы븿 媛?ν븯誘濡?STRING
    { name: 'no3_n', type: 'STRING' },
    { name: 'po4_p', type: 'STRING' },
    { name: 'alkalinity', type: 'STRING' },
    { name: 'tn', type: 'STRING' },
    { name: 'tp', type: 'STRING' },
    { name: 'cod', type: 'STRING' },
    { name: 'ss', type: 'STRING' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  kit_logs: [
    { name: 'site_id',  type: 'STRING' },
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'kit_name', type: 'STRING' },
    { name: 'date', type: 'DATE' },
    { name: 'purchase_amount', type: 'FLOAT' },
    { name: 'usage_amount', type: 'FLOAT' },
    { name: 'current_inventory', type: 'FLOAT' },
    { name: 'photo_url', type: 'STRING' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  facility_logs: [
    { name: 'site_id',       type: 'STRING' },
    { name: 'site_name',     type: 'STRING', mode: 'REQUIRED' },
    { name: 'author',        type: 'STRING' },
    { name: 'local_id',      type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at',    type: 'TIMESTAMP' },
    { name: 'date',          type: 'DATE' },
    { name: 'location',      type: 'STRING' },
    { name: 'facility_name', type: 'STRING' },
    { name: 'content',       type: 'STRING' },
    { name: 'company',       type: 'STRING' },
    { name: 'price',         type: 'INTEGER' },
    { name: 'notes',         type: 'STRING' },
    { name: 'updated_at',    type: 'TIMESTAMP' },
    { name: 'uploaded_at',   type: 'TIMESTAMP' }
  ],
  certificate_water_quality: [
    { name: 'certificate_category',      type: 'STRING' },
    { name: 'certificate_file_name',     type: 'STRING' },
    { name: 'certificate_original_file_name', type: 'STRING' },
    { name: 'drive_file_id',             type: 'STRING' },
    { name: 'drive_web_view_link',       type: 'STRING' },
    { name: 'site_id',                 type: 'STRING' },
    { name: 'site_name',               type: 'STRING' },
    { name: 'site_name_raw',           type: 'STRING' },
    { name: 'local_id',                type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'report_date',             type: 'DATE', mode: 'REQUIRED' },
    { name: 'ss',                      type: 'FLOAT' },
    { name: 'bod',                     type: 'FLOAT' },
    { name: 'tn',                      type: 'FLOAT' },
    { name: 'tp',                      type: 'FLOAT' },
    { name: 'total_coliform',          type: 'FLOAT' },
    { name: 'mlss',                    type: 'FLOAT' },
    { name: 'do',                      type: 'FLOAT' },
    { name: 'ph',                      type: 'FLOAT' },
    { name: 'source_pdf_name',         type: 'STRING' },
    { name: 'source_page_index',       type: 'INTEGER' },
    { name: 'ai_confidence',           type: 'FLOAT' },
    { name: 'site_match_confidence',   type: 'FLOAT' },
    { name: 'manual_review_required',  type: 'BOOLEAN' },
    { name: 'warnings_json',           type: 'STRING' },
    { name: 'source_payload_json',     type: 'STRING' },
    { name: 'created_at',              type: 'TIMESTAMP' },
    { name: 'updated_at',              type: 'TIMESTAMP' },
    { name: 'uploaded_at',             type: 'TIMESTAMP' }
  ],

  // ?? 寃뚯떆????????????????????????????????????????????????????????????
  // author_role: 'admin'(以묒븰愿由ъ옄) | 'manager'(?꾩옣愿由ъ옄)
  // target_site: '' or NULL = ?꾩껜 ?꾩옣, ?뱀젙 ?꾩옣紐?= ?대떦 ?꾩옣留?(愿由ъ옄 ?묒꽦 ??
  // ?꾩옣愿由ъ옄媛 ?щ┛ 湲: author_site ?꾩옣 + 以묒븰愿由ъ옄 ?꾩껜?먭쾶 蹂댁엫
  // is_deleted: ?뚰봽????젣 (BigQuery DML 理쒖냼??
  posts: [
    { name: 'id',          type: 'STRING',    mode: 'REQUIRED' },  // UUID
    { name: 'author',      type: 'STRING',    mode: 'REQUIRED' },
    { name: 'author_role', type: 'STRING',    mode: 'REQUIRED' },  // 'admin' | 'manager'
    { name: 'author_site', type: 'STRING' },                        // ?꾩옣紐?(愿由ъ옄='CENTRAL')
    { name: 'target_site', type: 'STRING' },                        // '' or NULL=?꾩껜, ?꾩옣紐??뱀젙
    { name: 'title',       type: 'STRING',    mode: 'REQUIRED' },
    { name: 'content',     type: 'STRING' },
    { name: 'is_notice',   type: 'BOOLEAN' },
    { name: 'attachments', type: 'STRING' },                        // JSON 諛곗뿴 臾몄옄??
    { name: 'parent_id',   type: 'STRING' },                        // ?듦? ?먭? id
    { name: 'is_deleted',  type: 'BOOLEAN' },
    { name: 'created_at',  type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at',  type: 'TIMESTAMP' }
  ],
  comments: [
    { name: 'id',         type: 'STRING',    mode: 'REQUIRED' },
    { name: 'post_id',    type: 'STRING',    mode: 'REQUIRED' },
    { name: 'author',     type: 'STRING',    mode: 'REQUIRED' },
    { name: 'content',    type: 'STRING' },
    { name: 'is_deleted', type: 'BOOLEAN' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  // ?? 異쒓껐 ??????????????????????????????????????????????????????????
  attendance: [
    { name: 'id',                type: 'STRING',    mode: 'REQUIRED' },  // UUID
    { name: 'site_id',           type: 'STRING' },
    { name: 'site_name',         type: 'STRING' },
    { name: 'member_id',         type: 'STRING',    mode: 'REQUIRED' },
    { name: 'member_name',       type: 'STRING' },
    { name: 'date',              type: 'DATE',      mode: 'REQUIRED' },
    { name: 'login_time',        type: 'TIMESTAMP' },
    { name: 'logout_time',       type: 'TIMESTAMP' },
    { name: 'login_lat',         type: 'FLOAT' },
    { name: 'login_lng',         type: 'FLOAT' },
    { name: 'logout_lat',        type: 'FLOAT' },
    { name: 'logout_lng',        type: 'FLOAT' },
    { name: 'location_matched',  type: 'BOOLEAN' },
    { name: 'remote_session_detected', type: 'BOOLEAN' },
    { name: 'remote_session_type', type: 'STRING' },
    { name: 'remote_session_evidence', type: 'STRING' },
    { name: 'auto_logout',       type: 'BOOLEAN' },
    { name: 'uploaded_at',       type: 'TIMESTAMP' }
  ],
  sites: [
    { name: 'id',           type: 'STRING',    mode: 'REQUIRED' },
    { name: 'site_name',    type: 'STRING' },
    { name: 'manager_name', type: 'STRING' },
    { name: 'method',       type: 'STRING' },
    { name: 'series',       type: 'STRING' },
    { name: 'is_active',    type: 'BOOLEAN' },
    { name: 'updated_at',   type: 'TIMESTAMP' },
    { name: 'uploaded_at',  type: 'TIMESTAMP' }
  ],
  members: [
    { name: 'id',          type: 'STRING',    mode: 'REQUIRED' },
    { name: 'name',        type: 'STRING' },
    { name: 'role',        type: 'STRING' },
    { name: 'phone',       type: 'STRING' },
    { name: 'target_lat',  type: 'FLOAT' },
    { name: 'target_lng',  type: 'FLOAT' },
    { name: 'radius_m',    type: 'FLOAT' },
    { name: 'notes',       type: 'STRING' },
    { name: 'updated_at',  type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  member_sites: [
    { name: 'member_id',       type: 'STRING',    mode: 'REQUIRED' },
    { name: 'site_id',         type: 'STRING',    mode: 'REQUIRED' },
    { name: 'is_primary',      type: 'BOOLEAN' },
    { name: 'can_manage',      type: 'BOOLEAN' },
    { name: 'is_bidirectional',type: 'BOOLEAN' },
    { name: 'updated_at',      type: 'TIMESTAMP' },
    { name: 'uploaded_at',     type: 'TIMESTAMP' }
  ]
};

async function createTables() {
  console.log(`Dataset '${DATASET_ID}'???뚯씠釉??앹꽦???쒖옉?⑸땲??..`);
  
  const dataset = bigquery.dataset(DATASET_ID);

  for (const [tableName, schema] of Object.entries(SCHEMAS)) {
    const table = dataset.table(tableName);
    
    try {
      const [exists] = await table.exists();
      if (exists) {
        await ensureTableSchema(table, tableName, schema);
      } else {
        await table.create({ schema });
        console.log(`??[Created] ?뚯씠釉?'${tableName}' ?앹꽦 ?꾨즺.`);
      }
    } catch (err) {
      console.error(`??[Error] ?뚯씠釉?'${tableName}' ?앹꽦 ?ㅽ뙣:`, err.message);
    }
  }
  console.log('紐⑤뱺 ?묒뾽???꾨즺?섏뿀?듬땲??');
}

createTables().catch(console.error);