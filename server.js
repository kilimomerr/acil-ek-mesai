const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Veritabanı Kurulumu
const db = new sqlite3.Database('./emergency_schedule.db', (err) => {
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

    // Ayarlar Tablosu (Canlı Limit ve Aktif Ay)
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

    // Varsayılan Ayarları ve İlk Yöneticiyi Ekle
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_shifts', '3')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('active_month', '2026-10')`);
    db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES ('YÖNETİCİ', 'admin123', 'admin')`);

    // Varsayılan Hekimleri Ekle (İlk Kurulum İçin)
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

// 2. Şifre Değiştir (Hekim Kendisi)
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

// 3. Hekim Listesini Getir (Giriş Seçeneği İçin)
app.get('/api/doctors', (req, res) => {
    db.all(`SELECT id, name, role FROM doctors ORDER BY name ASC`, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 4. Tüm Kullanıcıları ve Şifreleri Getir (Yalnızca Yönetici Görür)
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT id, name, password, role FROM doctors WHERE role != 'admin' ORDER BY name ASC`, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 5. Tekli Yeni Asistan / Hekim Ekle (Yönetici)
app.post('/api/admin/add-doctor', (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Ad ve şifre zorunludur." });
    db.run(`INSERT INTO doctors (name, password, role) VALUES (?, ?, 'doctor')`, [name.toUpperCase(), password], function(err) {
        if (err) return res.status(400).json({ error: "Bu isimde hekim zaten kayıtlı." });
        res.json({ message: "Yeni asistan başarıyla eklendi." });
    });
});

// 6. Toplu Hekim / Ay Yükleme (Yönetici Yeni Ay Yükleme)
app.post('/api/admin/bulk-upload-doctors', (req, res) => {
    const { doctorNames, defaultPassword } = req.body;
    if (!Array.isArray(doctorNames) || doctorNames.length === 0) {
        return res.status(400).json({ error: "Geçerli bir hekim listesi giriniz." });
    }
    const initialPass = defaultPassword && defaultPassword.trim() !== '' ? defaultPassword.trim() : '1234';
    const stmt = db.prepare(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES (?, ?, 'doctor')`);
    doctorNames.forEach(name => {
        if (name.trim()) stmt.run(name.trim().toUpperCase(), initialPass);
    });
    stmt.finalize();
    res.json({ message: `${doctorNames.length} hekim sisteme başarıyla yüklendi.` });
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

// 8. Ek Mesai Ekle
app.post('/api/shift/add', (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;

    // A) O güne ve alana başkası yazmış mı? (Kapasite Maks 1 Kişi)
    db.get(`SELECT * FROM shifts WHERE shift_date = ? AND area = ?`, [shift_date, area], (err, areaCheck) => {
        if (areaCheck) return res.status(400).json({ error: `Bu tarihte ${area} alanına zaten nöbet yazılmış!` });

        // B) Hekim kendi limitini aştı mı?
        db.get(`SELECT value FROM settings WHERE key = 'max_shifts'`, [], (err2, limitRow) => {
            const maxLimit = parseInt(limitRow ? limitRow.value : '3');
            db.get(`SELECT COUNT(*) as count FROM shifts WHERE doctor_id = ?`, [doctor_id], (err3, countRow) => {
                if (countRow.count >= maxLimit) {
                    return res.status(400).json({ error: `Belirlenen ek mesai limitine (${maxLimit}) ulaştınız!` });
                }

                // C) Kaydet
                db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration) VALUES (?, ?, ?, ?)`, 
                    [doctor_id, shift_date, area, duration], function(err4) {
                    if (err4) return res.status(500).json({ error: "Mesai kaydedilemedi." });
                    res.json({ message: "Ek mesainiz başarıyla takvime eklendi!" });
                });
            });
        });
    });
});

// 9. Ek Mesai İptal Et
app.delete('/api/shift/delete/:id', (req, res) => {
    const shiftId = req.params.id;
    db.run(`DELETE FROM shifts WHERE id = ?`, [shiftId], function(err) {
        if (err) return res.status(500).json({ error: "Silme işlemi başarısız." });
        res.json({ message: "Ek mesai kaydı silindi." });
    });
});

// 10. Canlı Limit Değiştir (Yönetici)
app.post('/api/admin/set-limit', (req, res) => {
    const { newLimit } = req.body;
    const limitNum = parseInt(newLimit);

    db.run(`UPDATE settings SET value = ? WHERE key = 'max_shifts'`, [newLimit], (err) => {
        if (err) return res.status(500).json({ error: "Limit güncellenemedi." });

        // Limiti aşan sonradan yazılmış nöbetleri otomatik temizle
        db.all(`SELECT doctor_id FROM shifts GROUP BY doctor_id HAVING COUNT(*) > ?`, [limitNum], (err2, doctors) => {
            if (doctors && doctors.length > 0) {
                doctors.forEach(doc => {
                    db.run(`DELETE FROM shifts WHERE id NOT IN (
                        SELECT id FROM shifts WHERE doctor_id = ? ORDER BY created_at ASC LIMIT ?
                    ) AND doctor_id = ?`, [doc.doctor_id, limitNum, doc.doctor_id]);
                });
            }
            res.json({ message: `Canlı ek mesai sınırı ${newLimit} olarak güncellendi. Fazla yazılan mesailer temizlendi.` });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
