'use strict';

const { getBigQueryClient, DATASET_ID } = require('../services/bigQueryClientService.cjs');

const TABLE_ID = 'attendance';
const apply = process.argv.includes('--apply');

const attendanceSchema = [
  { name: 'id', type: 'STRING', mode: 'REQUIRED' },
  { name: 'site_id', type: 'STRING' },
  { name: 'site_name', type: 'STRING' },
  { name: 'member_id', type: 'STRING', mode: 'REQUIRED' },
  { name: 'member_name', type: 'STRING' },
  { name: 'date', type: 'DATE', mode: 'REQUIRED' },
  { name: 'login_time', type: 'TIMESTAMP' },
  { name: 'logout_time', type: 'TIMESTAMP' },
  { name: 'login_lat', type: 'FLOAT' },
  { name: 'login_lng', type: 'FLOAT' },
  { name: 'logout_lat', type: 'FLOAT' },
  { name: 'logout_lng', type: 'FLOAT' },
  { name: 'location_matched', type: 'BOOLEAN' },
  { name: 'remote_session_detected', type: 'BOOLEAN' },
  { name: 'remote_session_type', type: 'STRING' },
  { name: 'remote_session_evidence', type: 'STRING' },
  { name: 'auto_logout', type: 'BOOLEAN' },
  { name: 'uploaded_at', type: 'TIMESTAMP' }
];

const columns = attendanceSchema.map((field) => field.name);

function quoteTable(tableId) {
  return `\`${DATASET_ID}.${tableId}\``;
}

function backupTableId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${TABLE_ID}_backup_before_member_id_string_${stamp}`;
}

async function getMemberIdType(table) {
  const [metadata] = await table.getMetadata();
  const memberId = (metadata.schema.fields || []).find((field) => field.name === 'member_id');
  return memberId || null;
}

async function main() {
  const bq = getBigQueryClient();
  if (!bq) throw new Error('BigQuery 클라이언트를 초기화할 수 없습니다.');

  const dataset = bq.dataset(DATASET_ID);
  const table = dataset.table(TABLE_ID);
  const [exists] = await table.exists();
  if (!exists) throw new Error(`BigQuery 테이블이 없습니다: ${DATASET_ID}.${TABLE_ID}`);

  const memberId = await getMemberIdType(table);
  if (!memberId) throw new Error('attendance.member_id 컬럼을찾을 수 없습니다.');

  console.log(`현재 ${DATASET_ID}.${TABLE_ID}.member_id: ${memberId.type} / ${memberId.mode || 'NULLABLE'}`);
  if (String(memberId.type).toUpperCase() === 'STRING') {
    console.log('이미 STRING 타입이므로 마이그레이션을 진행할 필요가 없습니다.');
    return;
  }

  const backupId = backupTableId();
  console.log(`백업 지정 테이블 ${DATASET_ID}.${backupId}`);

  if (!apply) {
    console.log('\n실제 반영은 다음 명령으로 실행하세요 node server/scripts/migrateAttendanceMemberIdString.cjs --apply');
    return;
  }

  await bq.query(`CREATE TABLE ${quoteTable(backupId)} AS SELECT * FROM ${quoteTable(TABLE_ID)}`);
  console.log(`백업 완료: ${DATASET_ID}.${backupId}`);

  await table.delete();
  console.log(`기존 테이블 삭제 완료: ${DATASET_ID}.${TABLE_ID}`);

  await dataset.createTable(TABLE_ID, {
    schema: { fields: attendanceSchema }
  });
  console.log(`STRING 스키마테이블생성 완료: ${DATASET_ID}.${TABLE_ID}`);

  const selectColumns = columns.map((column) => {
    if (column === 'member_id') return 'CAST(member_id AS STRING) AS member_id';
    return column;
  }).join(', ');

  await bq.query(`
    INSERT INTO ${quoteTable(TABLE_ID)} (${columns.join(', ')})
    SELECT ${selectColumns}
    FROM ${quoteTable(backupId)}
  `);

  const migratedMemberId = await getMemberIdType(table);
  console.log(`마이그레이션 완료: member_id = ${migratedMemberId.type} / ${migratedMemberId.mode || 'NULLABLE'}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
