const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));

// SQLite Veritabanı Baglantisi (Dosya olarak kaydedilir, veri silinmez)
const db = new sqlite3.Database('./emergency_schedule.db');

// Tabloları ve Kuralları Oluştur
db.serialize(() => {
    // 1. Hekimler Tablosu (Excel İsimleri Bazlı)
    db.run(`CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT UNIQUE,
        password TEXT DEFAULT '1234',
        is_rotation INTEGER DEFAULT 0
    )`);

    // 2. Sistem Ayarları Tablosu (Yönetici Limiti)
    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value INTEGER
    )`);
    db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('max_limit', 3)`);

    // 3. Ek Mesai Kayıtları Tablosu (Eşzamanlı Çakışmayı Önleyen UNIQUE INDEX)
    db.run(`CREATE TABLE IF NOT EXISTS extra_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        shift_date TEXT,
        area TEXT,
        duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(doctor_id) REFERENCES doctors(id)
    )`);
    
    // KONTENJAN KİLİDİ: Aynı tarih ve aynı alana en fazla 1 kişi kaydolabilir!
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_date_area ON extra_shifts(shift_date, area)`);
});

// APIs

// 1. Canlı Yönetici Limit Güncelleme & Düşürme Mantığı
app.post('/api/admin/set-limit', (req, res) => {
    const { newLimit } = req.body;
    db.run(`UPDATE system_settings SET value = ? WHERE key = 'max_limit'`, [newLimit], function(err) {
        if (err) return res.status(500).json({ error: err.message });

        // YÖNETİCİ LİMİTİ DÜŞÜRDÜYSE: "İlk yazılan kalsın, sonrakileri sil" algoritması
        db.all(`SELECT doctor_id, COUNT(*) as count FROM extra_shifts GROUP BY doctor_id HAVING count > ?`, [newLimit], (err, rows) => {
            if (rows) {
                rows.forEach(row => {
                    // Hekimin ilk 'newLimit' kadar erken yazdığı ek mesaisini koru, kalanları sil
                    db.run(`
                        DELETE FROM extra_shifts 
                        WHERE id NOT IN (
                            SELECT id FROM extra_shifts 
                            WHERE doctor_id = ? 
                            ORDER BY created_at ASC 
                            LIMIT ?
                        ) AND doctor_id = ?
                    `, [row.doctor_id, newLimit, row.doctor_id]);
                });
            }
        });

        res.json({ success: true, message: `Aylık limit ${newLimit} olarak güncellendi. Aşırı kayıtlar temizlendi.` });
    });
});

// 2. Ek Mesai İptal Etme (Hekimin Kendi İptal Hakkı)
app.post('/api/shift/cancel', (req, res) => {
    const { shift_id, doctor_id } = req.body;
    db.run(`DELETE FROM extra_shifts WHERE id = ? AND doctor_id = ?`, [shift_id, doctor_id], function(err) {
        if (err) return res.status(500).json({ error: "İptal işlemi başarısız." });
        res.json({ success: true, message: "Ek mesainiz başarıyla iptal edildi." });
    });
});

// 3. Güvenli Ek Mesai Ekleme (Race Condition Korumalı)
app.post('/api/shift/add', (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;

    // Limit Kontrolü
    db.get(`SELECT value FROM system_settings WHERE key = 'max_limit'`, [], (err, limitRow) => {
        const maxLimit = limitRow.value;

        db.get(`SELECT COUNT(*) as count FROM extra_shifts WHERE doctor_id = ?`, [doctor_id], (err, countRow) => {
            if (countRow.count >= maxLimit) {
                return res.status(400).json({ error: `Aylık maksimum ek mesai sınırına (${maxLimit}) ulaştınız!` });
            }

            // Veritabanına Ekleme (UNIQUE Kısıtlaması Tarafından Otomatik Denetlenir)
            db.run(`INSERT INTO extra_shifts (doctor_id, shift_date, area, duration) VALUES (?, ?, ?, ?)`, 
                [doctor_id, shift_date, area, duration], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: "KONTENJAN DOLU: Bu tarihteki alana başka bir hekim sizden önce ek mesai yazdı!" });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, message: "Ek mesai başarıyla kaydedildi." });
            });
        });
    });
});

app.listen(3000, () => console.log('Sistem 3000 portunda aktif! http://localhost:3000 adresinden erişebilirsiniz.'));