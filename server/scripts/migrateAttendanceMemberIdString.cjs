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
  if (!bq) throw new Error('BigQuery ?대씪?댁뼵?몃? 珥덇린?뷀븷 ???놁뒿?덈떎.');

  const dataset = bq.dataset(DATASET_ID);
  const table = dataset.table(TABLE_ID);
  const [exists] = await table.exists();
  if (!exists) throw new Error(`BigQuery ?뚯씠釉붿씠 ?놁뒿?덈떎: ${DATASET_ID}.${TABLE_ID}`);

  const memberId = await getMemberIdType(table);
  if (!memberId) throw new Error('attendance.member_id 而щ읆??李얠쓣 ???놁뒿?덈떎.');

  console.log(`?꾩옱 ${DATASET_ID}.${TABLE_ID}.member_id: ${memberId.type} / ${memberId.mode || 'NULLABLE'}`);
  if (String(memberId.type).toUpperCase() === 'STRING') {
    console.log('?대? STRING ??낆씠誘濡?留덉씠洹몃젅?댁뀡???꾩슂 ?놁뒿?덈떎.');
    return;
  }

  const backupId = backupTableId();
  console.log(`諛깆뾽 ?덉젙 ?뚯씠釉? ${DATASET_ID}.${backupId}`);

  if (!apply) {
    console.log('\n?ㅼ젣 諛섏쁺? ?ㅼ쓬 紐낅졊?쇰줈 ?ㅽ뻾?섏꽭?? node server/scripts/migrateAttendanceMemberIdString.cjs --apply');
    return;
  }

  await bq.query(`CREATE TABLE ${quoteTable(backupId)} AS SELECT * FROM ${quoteTable(TABLE_ID)}`);
  console.log(`諛깆뾽 ?꾨즺: ${DATASET_ID}.${backupId}`);

  await table.delete();
  console.log(`湲곗〈 ?뚯씠釉???젣 ?꾨즺: ${DATASET_ID}.${TABLE_ID}`);

  await dataset.createTable(TABLE_ID, {
    schema: { fields: attendanceSchema }
  });
  console.log(`STRING ?ㅽ궎留??뚯씠釉??앹꽦 ?꾨즺: ${DATASET_ID}.${TABLE_ID}`);

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
  console.log(`留덉씠洹몃젅?댁뀡 ?꾨즺: member_id = ${migratedMemberId.type} / ${migratedMemberId.mode || 'NULLABLE'}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
