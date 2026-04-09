const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

// 설정
const KEY_FILE_PATH = path.join(__dirname, '../config/work-jindan-194620a46d59.json');
const DATASET_ID = 'daily_log_system'; // 사용자가 생성한 데이터셋 이름

if (!fs.existsSync(KEY_FILE_PATH)) {
  console.error('❌ 키 파일을 찾을 수 없습니다:', KEY_FILE_PATH);
  process.exit(1);
}

const bigquery = new BigQuery({ keyFilename: KEY_FILE_PATH });

async function ensureTableSchema(table, tableName, schema) {
  const [metadata] = await table.getMetadata();
  const existingFields = metadata.schema?.fields || [];
  const existingNames = new Set(existingFields.map((field) => field.name));
  const missingFields = schema.filter((field) => !existingNames.has(field.name));

  if (missingFields.length === 0) {
    console.log(`⚠️  [Skip] 테이블 '${tableName}' 스키마는 최신 상태입니다.`);
    return;
  }

  const missingRequired = missingFields.filter((field) => field.mode === 'REQUIRED');
  if (missingRequired.length > 0) {
    console.warn(`⚠️  [Warn] 테이블 '${tableName}'에 REQUIRED 컬럼 ${missingRequired.map((field) => field.name).join(', ')} 이(가) 누락되어 자동 추가할 수 없습니다.`);
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

  console.log(`✅ [Updated] 테이블 '${tableName}'에 컬럼 ${appendableFields.map((field) => field.name).join(', ')} 추가 완료.`);
}

// 테이블 스키마 정의
// 로컬 DB 컬럼 + site_name, author, local_id, created_at, updated_at, uploaded_at
const SCHEMAS = {
  flow_readings: [
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
    { name: 'updated_at', type: 'TIMESTAMP' }, // 로컬 수정 시간
    { name: 'uploaded_at', type: 'TIMESTAMP' }  // 서버 전송 시간
  ],
  medicine_logs: [
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'medicine_name', type: 'STRING' },
    { name: 'date', type: 'DATE' },
    { name: 'purchase_amount', type: 'FLOAT' },
    { name: 'usage_amount', type: 'FLOAT' },
    { name: 'current_inventory', type: 'FLOAT' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  water_quality: [
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
    { name: 'nh3_n', type: 'STRING' }, // 특수기호 포함 가능하므로 STRING
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
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'kit_name', type: 'STRING' },
    { name: 'date', type: 'DATE' },
    { name: 'purchase_amount', type: 'FLOAT' },
    { name: 'usage_amount', type: 'FLOAT' },
    { name: 'current_inventory', type: 'FLOAT' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],
  facility_logs: [
    { name: 'site_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'author', type: 'STRING' },
    { name: 'local_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'date', type: 'DATE' },
    { name: 'location', type: 'STRING' },
    { name: 'facility_name', type: 'STRING' },
    { name: 'content', type: 'STRING' },
    { name: 'notes', type: 'STRING' },
    { name: 'updated_at', type: 'TIMESTAMP' },
    { name: 'uploaded_at', type: 'TIMESTAMP' }
  ],

  // ── 게시판 ──────────────────────────────────────────────────────────
  // author_role: 'admin'(중앙관리자) | 'manager'(현장관리자)
  // target_site: '' or NULL = 전체 현장, 특정 현장명 = 해당 현장만 (관리자 작성 시)
  // 현장관리자가 올린 글: author_site 현장 + 중앙관리자 전체에게 보임
  // is_deleted: 소프트 삭제 (BigQuery DML 최소화)
  posts: [
    { name: 'id',          type: 'STRING',    mode: 'REQUIRED' },  // UUID
    { name: 'author',      type: 'STRING',    mode: 'REQUIRED' },
    { name: 'author_role', type: 'STRING',    mode: 'REQUIRED' },  // 'admin' | 'manager'
    { name: 'author_site', type: 'STRING' },                        // 현장명 (관리자='CENTRAL')
    { name: 'target_site', type: 'STRING' },                        // '' or NULL=전체, 현장명=특정
    { name: 'title',       type: 'STRING',    mode: 'REQUIRED' },
    { name: 'content',     type: 'STRING' },
    { name: 'is_notice',   type: 'BOOLEAN' },
    { name: 'attachments', type: 'STRING' },                        // JSON 배열 문자열
    { name: 'parent_id',   type: 'STRING' },                        // 답글 원글 id
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

  // ── 출결 ──────────────────────────────────────────────────────────
  attendance: [
    { name: 'id',                type: 'STRING',    mode: 'REQUIRED' },  // UUID
    { name: 'site_name',         type: 'STRING' },
    { name: 'member_id',         type: 'INTEGER',   mode: 'REQUIRED' },
    { name: 'member_name',       type: 'STRING' },
    { name: 'date',              type: 'DATE',      mode: 'REQUIRED' },
    { name: 'login_time',        type: 'TIMESTAMP' },
    { name: 'logout_time',       type: 'TIMESTAMP' },
    { name: 'login_lat',         type: 'FLOAT' },
    { name: 'login_lng',         type: 'FLOAT' },
    { name: 'location_matched',  type: 'BOOLEAN' },
    { name: 'auto_logout',       type: 'BOOLEAN' },
    { name: 'uploaded_at',       type: 'TIMESTAMP' }
  ]
};

async function createTables() {
  console.log(`Dataset '${DATASET_ID}'에 테이블 생성을 시작합니다...`);
  
  const dataset = bigquery.dataset(DATASET_ID);

  for (const [tableName, schema] of Object.entries(SCHEMAS)) {
    const table = dataset.table(tableName);
    
    try {
      const [exists] = await table.exists();
      if (exists) {
        await ensureTableSchema(table, tableName, schema);
      } else {
        await table.create({ schema });
        console.log(`✅ [Created] 테이블 '${tableName}' 생성 완료.`);
      }
    } catch (err) {
      console.error(`❌ [Error] 테이블 '${tableName}' 생성 실패:`, err.message);
    }
  }
  console.log('모든 작업이 완료되었습니다.');
}

createTables().catch(console.error);