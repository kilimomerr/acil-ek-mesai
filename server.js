const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const dbPath = path.join(__dirname, 'emergency_schedule.db');

// Eski veritabanı temizleme
if (fs.existsSync(dbPath)) {
    try {
        fs.unlinkSync(dbPath);
        console.log("Eski veritabanı dosyası temizlendi.");
    } catch (err) {
        console.error("Veritabanı silinemedi:", err.message);
    }
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Veritabanı hatası:", err.message);
    else console.log("Yeni SQLite veritabanı bağlandı.");
});

// Tablo Yapılandırmaları
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL DEFAULT '1234',
        role TEXT DEFAULT 'doctor'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        shift_date TEXT NOT NULL,
        area TEXT NOT NULL,
        duration INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS main_duties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        duty_date TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    // Varsayılan Ayarlar (Varsayılan aktif ay: içinde bulunulan YYYY-MM)
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_shifts', '3')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('active_month', '${currentMonthStr}')`);
    db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES ('YÖNETİCİ', 'admin123', 'admin')`);

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

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// API ENDPOINTLERİ

app.post('/api/login', (req, res) => {
    const { doctor_id, password } = req.body;
    db.get(`SELECT * FROM doctors WHERE id = ? AND password = ?`, [doctor_id, password], (err, row) => {
        if (err || !row) return res.status(401).json({ error: "Hatalı şifre veya kullanıcı!" });
        res.json({ success: true, user: { id: row.id, name: row.name, role: row.role } });
    });
});

app.post('/api/change-password', (req, res) => {
    const { doctor_id, oldPassword, newPassword } = req.body;
    db.get(`SELECT * FROM doctors WHERE id = ? AND password = ?`, [doctor_id, oldPassword], (err, row) => {
        if (!row) return res.status(400).json({ error: "Mevcut şifreniz hatalı!" });
        db.run(`UPDATE doctors SET password = ? WHERE id = ?`, [newPassword, doctor_id], (err2) => {
            res.json({ message: "Şifreniz başarıyla değiştirildi." });
        });
    });
});

app.get('/api/doctors', (req, res) => {
    db.all(`SELECT id, name, role FROM doctors ORDER BY name ASC`, [], (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        const settings = {};
        if (rows) rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

// Yönetici Ayarları
app.post('/api/admin/set-active-month', (req, res) => {
    const { activeMonth } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('active_month', ?)`, [activeMonth], () => {
        res.json({ message: "İşlem ayı güncellendi." });
    });
});

app.post('/api/admin/set-limit', (req, res) => {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('max_shifts', ?)`, [req.body.newLimit], () => {
        res.json({ message: "Limit güncellendi." });
    });
});

app.post('/api/admin/add-main-duty', (req, res) => {
    const { doctor_id, duty_date } = req.body;
    if (!doctor_id || !duty_date) return res.status(400).json({ error: "Eksik bilgi." });

    db.run(`INSERT INTO main_duties (doctor_id, duty_date) VALUES (?, ?)`, [doctor_id, duty_date], (err) => {
        if (err) return res.status(500).json({ error: "Nöbet eklenemedi." });
        res.json({ message: "Rutin nöbet eklendi." });
    });
});

app.get('/api/main-duties', (req, res) => {
    const sql = `SELECT main_duties.id, main_duties.doctor_id, main_duties.duty_date, doctors.name as doctor_name 
                 FROM main_duties 
                 JOIN doctors ON main_duties.doctor_id = doctors.id`;
    db.all(sql, [], (err, rows) => res.json(rows || []));
});

app.get('/api/shifts', (req, res) => {
    const sql = `SELECT shifts.id, shifts.doctor_id, shifts.shift_date, shifts.area, shifts.duration, doctors.name as doctor_name 
                 FROM shifts 
                 JOIN doctors ON shifts.doctor_id = doctors.id`;
    db.all(sql, [], (err, rows) => res.json(rows || []));
});

// KONTROLLÜ EK MESAİ EKLEME
app.post('/api/shift/add', async (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;

    // Ay Kontrolü
    const shiftMonth = shift_date.slice(0, 7);
    const getActiveMonth = () => {
        return new Promise((resolve) => {
            db.get(`SELECT value FROM settings WHERE key = 'active_month'`, [], (err, row) => {
                resolve(row ? row.value : null);
            });
        });
    };

    const activeMonth = await getActiveMonth();
    if (activeMonth && shiftMonth !== activeMonth) {
        return res.status(400).json({ error: `Sadece yöneticinin belirlediği aktif ay (${activeMonth}) için işlem yapabilirsiniz!` });
    }

    const prevDate = addDays(shift_date, -1);
    const prev2Date = addDays(shift_date, -2);

    const getDoctorDates = () => {
        return new Promise((resolve) => {
            const dates = new Set();
            db.all(`SELECT duty_date as dDate FROM main_duties WHERE doctor_id = ? 
                    UNION 
                    SELECT shift_date as dDate FROM shifts WHERE doctor_id = ?`, [doctor_id, doctor_id], (err, rows) => {
                if (rows) rows.forEach(r => dates.add(r.dDate));
                resolve(dates);
            });
        });
    };

    const docDates = await getDoctorDates();

    if (docDates.has(shift_date)) {
        return res.status(400).json({ error: "Bu tarihte zaten asli nöbetiniz veya ek mesainiz bulunmaktadır!" });
    }

    if (docDates.has(prevDate)) {
        return res.status(400).json({ error: "Nöbet ertesi güne ek mesai yazamazsınız! (Dinlenme Günü)" });
    }

    if (docDates.has(prev2Date) && docDates.has(prevDate)) {
        return res.status(400).json({ error: "Ardışık 3 gün boyunca nöbet/ek mesai yazamazsınız!" });
    }

    db.get(`SELECT * FROM shifts WHERE shift_date = ? AND area = ?`, [shift_date, area], (err, areaCheck) => {
        if (areaCheck) return res.status(400).json({ error: `Bu tarihte ${area} alanına zaten nöbet yazılmış!` });

        db.get(`SELECT value FROM settings WHERE key = 'max_shifts'`, [], (err2, limitRow) => {
            const maxLimit = parseInt(limitRow ? limitRow.value : '3');
            db.get(`SELECT COUNT(*) as count FROM shifts WHERE doctor_id = ?`, [doctor_id], (err3, countRow) => {
                if (countRow.count >= maxLimit) {
                    return res.status(400).json({ error: `Belirlenen ek mesai limitine (${maxLimit}) ulaştınız!` });
                }

                db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration) VALUES (?, ?, ?, ?)`, 
                    [doctor_id, shift_date, area, duration], (err4) => {
                    if (err4) return res.status(500).json({ error: "Mesai kaydedilemedi." });
                    res.json({ message: "Ek mesainiz takvime eklendi!" });
                });
            });
        });
    });
});

// EK MESAİ İPTAL/SİLME
app.delete('/api/shift/delete/:id', async (req, res) => {
    const shiftId = req.params.id;
    const { doctor_id, role } = req.body;

    db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId], async (err, shift) => {
        if (!shift) return res.status(404).json({ error: "Ek mesai bulunamadı." });

        // Ay Kontrolü (Hekim sadece aktif ayın mesaisini silebilir, yönetici her zaman silebilir)
        if (role !== 'admin') {
            if (shift.doctor_id !== doctor_id) {
                return res.status(403).json({ error: "Sadece kendi ek mesainizi silebilirsiniz!" });
            }

            const shiftMonth = shift.shift_date.slice(0, 7);
            const activeMonthRow = await new Promise(resolve => {
                db.get(`SELECT value FROM settings WHERE key = 'active_month'`, [], (e, r) => resolve(r));
            });
            const activeMonth = activeMonthRow ? activeMonthRow.value : null;

            if (activeMonth && shiftMonth !== activeMonth) {
                return res.status(400).json({ error: `Geçmiş/Gelecek aylara ait ek mesaileri silemezsiniz! (Aktif Ay: ${activeMonth})` });
            }
        }

        db.run(`DELETE FROM shifts WHERE id = ?`, [shiftId], () => {
            res.json({ message: "Ek mesainiz iptal edildi." });
        });
    });
});

app.delete('/api/admin/main-duty/:id', (req, res) => {
    db.run(`DELETE FROM main_duties WHERE id = ?`, [req.params.id], () => {
        res.json({ message: "Rutin nöbet silindi." });
    });
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));
