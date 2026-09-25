const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const dbPath = './emergency_schedule.db';

// Veritabanı Kurulumu
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Veritabanı hatası:", err.message);
    else console.log("SQLite veritabanı bağlandı.");
});

// Tabloları Oluştur
db.serialize(() => {
    // Hekimler Tablosu
    db.run(`CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL DEFAULT '1234',
        role TEXT DEFAULT 'doctor'
    )`);

    // Ayarlar Tablosu
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    // Ek Mesailer Tablosu
    db.run(`CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        shift_date TEXT NOT NULL,
        area TEXT NOT NULL,
        duration INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    // Rutin/Asıl Nöbetler Tablosu (Yöneticinin yüklediği ana nöbetler)
    db.run(`CREATE TABLE IF NOT EXISTS main_duties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        duty_date TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    // Varsayılan Ayarları ve İlk Yöneticiyi Ekle
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_shifts', '3')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('active_month', '2026-10')`);
    db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES ('YÖNETİCİ', 'admin123', 'admin')`);

    // Varsayılan Hekimleri Ekle
    const initialDoctors = [
        "BERİTAN ZÜMRÜT", "YASER HASAN BOLAT", "AHMET ÖZAY", "FATMA KÖLEOĞLU",
        "ENES GÜLDEŞ", "ÖMER TARIK SARIBIYIK", "HALİL CAN DOĞAN", "SÜEDA YALÇIN",
        "AHMET DÖNEN", "MUHAMMED ŞEN", "NİSANUR YALÇIN", "TUTKU SOYDAL",
        "TUNAHAN KAYA", "YAKUP BORA PEKTAŞ", "ÖMER KİLİM", "BARAN NİKBAY",
        "OĞUZCAN TÜFEKCİ", "ÖMER FARUK AKINCI", "SERKAN KANAT", "FARUK ARI",
        "TÜRKAN ESİN", "MUSTAFA GÜLŞEN", "HÜRRE KÖSE", "SERAP ORAL"
    ];

    initialDoctors.forEach(doc => {
        db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES (?, '1234', 'doctor')`, [doc]);
    });
});

// --- API ENDPOINTLERİ ---

// 1. Giriş Yap
app.post('/api/login', (req, res) => {
    const { doctor_id, password } = req.body;
    db.get(`SELECT * FROM doctors WHERE id = ? AND password = ?`, [doctor_id, password], (err, row) => {
        if (err) return res.status(500).json({ error: "Sunucu hatası" });
        if (!row) return res.status(401).json({ error: "Hatalı şifre!" });
        res.json({ success: true, user: { id: row.id, name: row.name, role: row.role } });
    });
});

// 2. Şifre Değiştir
app.post('/api/change-password', (req, res) => {
    const { doctor_id, oldPassword, newPassword } = req.body;
    db.get(`SELECT * FROM doctors WHERE id = ? AND password = ?`, [doctor_id, oldPassword], (err, row) => {
        if (!row) return res.status(400).json({ error: "Mevcut şifreniz hatalı!" });
        db.run(`UPDATE doctors SET password = ? WHERE id = ?`, [newPassword, doctor_id], (err2) => {
            if (err2) return res.status(500).json({ error: "Şifre güncellenemedi." });
            res.json({ message: "Şifreniz başarıyla değiştirildi." });
        });
    });
});

// 3. Hekim Listesini Getir
app.get('/api/doctors', (req, res) => {
    db.all(`SELECT id, name, role FROM doctors ORDER BY name ASC`, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 4. Yönetici: Rutin Nöbet Tanımla
app.post('/api/admin/add-main-duty', (req, res) => {
    const { doctor_id, duty_date } = req.body;
    if (!doctor_id || !duty_date) return res.status(400).json({ error: "Eksik bilgi." });

    db.get(`SELECT * FROM main_duties WHERE doctor_id = ? AND duty_date = ?`, [doctor_id, duty_date], (err, row) => {
        if (row) return res.status(400).json({ error: "Bu hekim bu tarihte zaten rutin nöbetçi." });

        db.run(`INSERT INTO main_duties (doctor_id, duty_date) VALUES (?, ?)`, [doctor_id, duty_date], (err2) => {
            if (err2) return res.status(500).json({ error: "Nöbet kaydedilemedi." });
            res.json({ message: "Rutin nöbet kaydı eklendi." });
        });
    });
});

// 5. Rutin Nöbetleri Getir
app.get('/api/main-duties', (req, res) => {
    const sql = `SELECT main_duties.id, main_duties.doctor_id, main_duties.duty_date, doctors.name as doctor_name 
                 FROM main_duties 
                 JOIN doctors ON main_duties.doctor_id = doctors.id 
                 ORDER BY main_duties.duty_date ASC`;
    db.all(sql, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 6. Rutin Nöbet Sil (Yönetici)
app.delete('/api/admin/main-duty/:id', (req, res) => {
    db.run(`DELETE FROM main_duties WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: "Silme başarısız." });
        res.json({ message: "Rutin nöbet silindi." });
    });
});

// 7. Ek Mesaileri Getir
app.get('/api/shifts', (req, res) => {
    const sql = `SELECT shifts.id, shifts.doctor_id, shifts.shift_date, shifts.area, shifts.duration, doctors.name as doctor_name 
                 FROM shifts 
                 JOIN doctors ON shifts.doctor_id = doctors.id 
                 ORDER BY shifts.shift_date ASC`;
    db.all(sql, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 8. Ek Mesai Ekle (KONTROLLER EKLENDİ)
app.post('/api/shift/add', (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;

    // KONTROL 1: Hekim o gün zaten rutin nöbetçi mi?
    db.get(`SELECT * FROM main_duties WHERE doctor_id = ? AND duty_date = ?`, [doctor_id, shift_date], (err, mainDuty) => {
        if (mainDuty) {
            return res.status(400).json({ error: "Bu tarihte zaten asli/rutin nöbetiniz bulunmaktadır! Ek mesai alamazsınız." });
        }

        // KONTROL 2: Hekim o tarihte zaten başka bir ek mesai yazmış mı?
        db.get(`SELECT * FROM shifts WHERE doctor_id = ? AND shift_date = ?`, [doctor_id, shift_date], (err2, userShift) => {
            if (userShift) {
                return res.status(400).json({ error: "Aynı gün içerisinde 2 defa ek mesai yazamazsınız!" });
            }

            // KONTROL 3: O tarihte o alana başka biri yazılmış mı?
            db.get(`SELECT * FROM shifts WHERE shift_date = ? AND area = ?`, [shift_date, area], (err3, areaCheck) => {
                if (areaCheck) {
                    return res.status(400).json({ error: `Bu tarihte ${area} alanına zaten başka bir nöbet yazılmış!` });
                }

                // KONTROL 4: Ek mesai limiti dolmuş mu?
                db.get(`SELECT value FROM settings WHERE key = 'max_shifts'`, [], (err4, limitRow) => {
                    const maxLimit = parseInt(limitRow ? limitRow.value : '3');
                    db.get(`SELECT COUNT(*) as count FROM shifts WHERE doctor_id = ?`, [doctor_id], (err5, countRow) => {
                        if (countRow.count >= maxLimit) {
                            return res.status(400).json({ error: `Belirlenen ek mesai limitine (${maxLimit}) ulaştınız!` });
                        }

                        // Tüm kontroller geçildiyse kaydet
                        db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration) VALUES (?, ?, ?, ?)`, 
                            [doctor_id, shift_date, area, duration], function(err6) {
                            if (err6) return res.status(500).json({ error: "Mesai kaydedilemedi." });
                            res.json({ message: "Ek mesainiz başarıyla takvime eklendi!" });
                        });
                    });
                });
            });
        });
    });
});

// 9. Ek Mesai İptal Et
app.delete('/api/shift/delete/:id', (req, res) => {
    db.run(`DELETE FROM shifts WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: "Silme işlemi başarısız." });
        res.json({ message: "Ek mesai kaydı silindi." });
    });
});

// 10. Canlı Limit Değiştir (Yönetici)
app.post('/api/admin/set-limit', (req, res) => {
    const { newLimit } = req.body;
    db.run(`UPDATE settings SET value = ? WHERE key = 'max_shifts'`, [newLimit], (err) => {
        if (err) return res.status(500).json({ error: "Limit güncellenemedi." });
        res.json({ message: `Canlı ek mesai sınırı ${newLimit} olarak güncellendi.` });
    });
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
