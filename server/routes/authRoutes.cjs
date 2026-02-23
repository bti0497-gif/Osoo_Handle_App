const express = require('express');

module.exports = (db) => {
    const router = express.Router();

    // 현재 날짜 KST 기준으로 구하기 (YYYY-MM-DD)
    const getTodayKST = () => {
        return new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    };

    // 1. 로컬 로그인
    router.post('/local-login', (req, res) => {
        const { name, password } = req.body;
        try {
            const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);
            // 관리자는 로컬 DB에 없으므로 여기서 인증되지 않음 (프론트엔드에서 분기 처리 예정)
            if (member) {
                res.json({ success: true, member });
            } else {
                res.status(401).json({ success: false, message: '이름 또는 비밀번호가 일치하지 않습니다.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. 관리자가 내려받은 사용자 데이터를 로컬 DB에 저장(동기화)
    router.post('/sync-member', (req, res) => {
        const { id, name, password, role } = req.body;
        try {
            if (name === 'admin') {
                return res.json({ success: true, message: 'admin은 로컬에 저장하지 않습니다.' });
            }

            const existing = db.prepare('SELECT id FROM members WHERE id = ? OR name = ?').get(id, name);
            if (existing) {
                db.prepare('UPDATE members SET name = ?, password = ?, role = ? WHERE id = ?').run(name, password, role, id);
            } else {
                db.prepare('INSERT INTO members (id, name, password, role) VALUES (?, ?, ?, ?)').run(id, name, password, role);
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. 활성 세션(진행 중인 출근 기록) 찾기
    router.post('/session', (req, res) => {
        const { memberId } = req.body;
        const dateKST = getTodayKST();
        try {
            const activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);
            res.json({ success: true, session: activeSession || null });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 4. 출근 처리
    router.post('/attendance', (req, res) => {
        const { memberId, memberName, lat, lng, locationMatched } = req.body;
        const dateKST = getTodayKST();
        const loginTime = new Date().toISOString();

        try {
            // 이미 활성 세션이 있는지 확인
            let activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);

            if (!activeSession) {
                const result = db.prepare(`
          INSERT INTO attendance 
          (member_id, member_name, date, login_time, login_lat, login_lng, location_matched) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(memberId, memberName, dateKST, loginTime, lat, lng, locationMatched ? 1 : 0);

                activeSession = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
            }

            res.json({ success: true, session: activeSession });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. 퇴근 처리
    router.post('/logout', (req, res) => {
        const { memberId, autoLogout } = req.body;
        const dateKST = getTodayKST();
        const logoutTime = new Date().toISOString();

        try {
            db.prepare(`
        UPDATE attendance 
        SET logout_time = ?, auto_logout = ?, is_synced = 0 
        WHERE member_id = ? AND date = ? AND logout_time IS NULL
      `).run(logoutTime, autoLogout ? 1 : 0, memberId, dateKST);

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 6. 로컬에 저장된 미동기화 출결 기록 목록 반환
    router.get('/unsynced-attendance', (req, res) => {
        try {
            const logs = db.prepare('SELECT * FROM attendance WHERE is_synced = 0 ORDER BY login_time ASC').all();
            res.json({ success: true, logs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 7. 동기화 완료 마킹
    router.post('/mark-attendance-synced', (req, res) => {
        const { ids } = req.body; // Array of IDs
        try {
            if (ids && ids.length > 0) {
                const placeholders = ids.map(() => '?').join(',');
                db.prepare(`UPDATE attendance SET is_synced = 1 WHERE id IN (${placeholders})`).run(...ids);
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
