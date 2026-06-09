'use strict';

const crypto = require('crypto');
const { db } = require('../database.cjs');
const { getMembers, replaceMemberId, isSheetsConfigured } = require('../services/membersSheetsService.cjs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const apply = process.argv.includes('--apply');

function isUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function updateLocalMemberReferences(oldId, newId, name) {
  const existing = db.prepare('SELECT id FROM members WHERE id = ? OR name = ?').get(String(oldId), String(name));
  if (!existing) return { changed: false, reason: 'local member not found' };

  const previousId = String(existing.id);
  const nextId = String(newId);
  if (previousId === nextId) return { changed: false, reason: 'already normalized' };

  db.transaction(() => {
    const links = db.prepare('SELECT site_id, is_primary, can_manage, is_bidirectional, created_at FROM member_sites WHERE member_id = ?').all(previousId);
    const insertLink = db.prepare(`
      INSERT OR IGNORE INTO member_sites (member_id, site_id, is_primary, can_manage, is_bidirectional, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    links.forEach((link) => {
      insertLink.run(nextId, link.site_id, link.is_primary, link.can_manage, link.is_bidirectional, link.created_at);
    });

    db.prepare('DELETE FROM member_sites WHERE member_id = ?').run(previousId);
    db.prepare('UPDATE attendance SET member_id = ? WHERE member_id = ?').run(nextId, previousId);
    db.prepare('UPDATE members SET id = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(nextId, previousId);
  })();

  return { changed: true };
}

async function main() {
  if (!isSheetsConfigured()) {
    throw new Error('Google Sheets 설정이 없어 회원 ID 정규화를 진행할 수 없습니다.');
  }

  const members = await getMembers();
  const targets = members
    .filter((member) => String(member.name || '').trim() !== 'admin')
    .filter((member) => !isUuid(member.id))
    .map((member) => ({
      ...member,
      oldId: String(member.id || '').trim(),
      newId: crypto.randomUUID()
    }));

  if (targets.length === 0) {
    console.log('UUID로 전환한 회원이 없습니다.');
    return;
  }

  console.log('UUID 전환 대상 회원:');
  targets.forEach((member) => {
    console.log(`- ${member.name}: ${member.oldId} -> ${member.newId}`);
  });

  if (!apply) {
    console.log('\n실제 반영은 다음 명령으로 실행하세요 node server/scripts/normalizeMemberIds.cjs --apply');
    return;
  }

  for (const member of targets) {
    await replaceMemberId(member.oldId, member.newId);
    const localResult = updateLocalMemberReferences(member.oldId, member.newId, member.name);
    const localMessage = localResult.changed ? 'local updated' : localResult.reason;
    적용 완료: ${member.name} (${localMessage})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
