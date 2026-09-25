const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const dbPath = path.join(__dirname, 'emergency_schedule.db');

// Veritabanı Bağlantısı
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Veritabanı hatası:", err.message);
    else console.log("SQLite veritabanı bağlandı.");
});

// Tablo Yapılandırmaları ve Ekim 2026 Liste Aktarımı
db.serialize(() => {
    // Mevcut tabloları sıfırlayıp güncel şema ve Ekim 2026 verileriyle baştan kuruyoruz
    db.run(`DROP TABLE IF EXISTS doctors`);
    db.run(`DROP TABLE IF EXISTS shifts`);
    db.run(`DROP TABLE IF EXISTS main_duties`);
    db.run(`DROP TABLE IF EXISTS settings`);

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
        created_by TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS main_duties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER,
        duty_date TEXT NOT NULL,
        created_by TEXT DEFAULT 'admin',
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    // Aktif Ay ve Limit Ayarları
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('max_shifts', '3')`);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('active_month', '2026-10')`);
    db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES ('YÖNETİCİ', 'admin123', 'admin')`);

    // Sadece Pratisyen Hekim Listesi (Uzmanlar Hariç)
    const initialDoctors = [
        "A.KARAKOÇ", "YASER", "TÜRKAN", "İPEK", "İMRAN", "E.EVGİN", "ÖZGÜR", "GÖKBERK", "M.ŞEN",
        "B.DEMİRCİ", "YAKUP", "MÜCAHİT", "CEM", "ECE", "RAUF", "MEHMET", "OSMAN", "M.GÜLŞEN",
        "E.ASLAN", "FATMA", "GAMZE", "AFRA", "HANİFE", "EMRECAN", "SAMET", "HÜRRE", "SERAP",
        "P.ÖZATAK", "T.ÖZATAK", "B.CAM", "B.AKIN", "TUNAHAN", "MELİS", "SENA", "OĞUZCAN",
        "Y.ÇELİK", "ÖMER", "NEDA", "TUTKU", "K.ÖZSİVRİ", "SÜEDA",
        "F.ARİ", "E.USLU", "TARIK", "SERKAN", "ERKAN", "F.ÖZKAN", "YUNUS", "ESHAT", "MUKADDES",
        "BERİTAN", "Ö.FARUK", "A.TEPE", "BERKE", "S.SOLAK", "A.DÖNEN",
        "H.TURGUT", "NİSA", "B.SAĞLAM", "E.BAHAR", "KÜBRA", "E.FERHATLAR",
        "HALİL", "N.YAPAR", "BARAN", "S.KANAT", "BÜŞRA", "FARUK",
        "MUSTAFA", "BERAN"
    ];

    const uniqueDocs = [...new Set(initialDoctors)];
    uniqueDocs.forEach(doc => {
        db.run(`INSERT OR IGNORE INTO doctors (name, password, role) VALUES (?, '1234', 'doctor')`, [doc]);
    });

    const getDocId = (name) => new Promise(resolve => {
        db.get(`SELECT id FROM doctors WHERE name = ?`, [name], (err, row) => resolve(row ? row.id : null));
    });

    const addMainDuty = async (docName, dateStr) => {
        const id = await getDocId(docName);
        if (id) {
            db.run(`INSERT INTO main_duties (doctor_id, duty_date, created_by) VALUES (?, ?, 'admin')`, [id, dateStr]);
        }
    };

    const add16hShift = async (docName, dateStr, areaName) => {
        const id = await getDocId(docName);
        if (id) {
            db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration, created_by) VALUES (?, ?, ?, 16, 'admin')`, [id, dateStr, areaName]);
        }
    };

    // Ekim 2026 Nöbet ve Ek Mesai Dökümü (Yönetici Tarafından Yüklenmiş)
    async function loadOctoberSchedule() {
        const schedule = [
            {
                date: "2026-10-01",
                main: ["A.KARAKOÇ", "YASER", "TÜRKAN", "İPEK", "İMRAN", "E.EVGİN", "ÖZGÜR", "TUTKU", "OĞUZCAN", "ERDEM", "E.BAHAR", "AHMET", "SERKAN", "BERKE"],
                shifts16: [
                    { name: "GÖKBERK", area: "Yeşil (2)" },
                    { name: "M.ŞEN", area: "Yeşil Gözlem" },
                    { name: "EMRECAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-02",
                main: ["B.DEMİRCİ", "YAKUP", "MÜCAHİT", "CEM", "ECE", "RAUF", "MEHMET", "SÜEDA", "Ö.FARUK", "MUKADDES", "E.USLU", "HALİL", "ÖMER", "GÖKBERK"],
                shifts16: [
                    { name: "OSMAN", area: "Yeşil (2)" },
                    { name: "M.GÜLŞEN", area: "Yeşil Gözlem" },
                    { name: "FATMA", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-03",
                main: ["E.ASLAN", "FATMA", "GAMZE", "AFRA", "HANİFE", "EMRECAN", "SAMET", "BERİTAN", "M.GÜLŞEN", "ESHAT", "F.ARİ", "TÜRKAN", "OSMAN"],
                shifts16: [
                    { name: "HÜRRE", area: "Yeşil (2)" },
                    { name: "SERAP", area: "Yeşil Gözlem" },
                    { name: "ERDEM", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-04",
                main: ["P.ÖZATAK", "T.ÖZATAK", "B.CAM", "B.AKIN", "TUNAHAN", "MELİS", "SENA", "BARAN", "ELİF", "YUNUS", "YASER", "SERKAN", "ERDEM"],
                shifts16: [
                    { name: "İMRAN", area: "Yeşil (2)" },
                    { name: "SÜEDA", area: "Yeşil Gözlem" },
                    { name: "SÜEDA", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-05",
                main: ["Y.ÇELİK", "ÖMER", "HÜRRE", "CEM", "RAUF", "NEDA", "ÖZGÜR", "M.ŞEN", "MÜCAHİT", "BERKE", "Ö.FARUK", "FATMA", "YAKUP", "GÖKBERK"],
                shifts16: [
                    { name: "TUTKU", area: "Yeşil (2)" },
                    { name: "SAMET", area: "Yeşil Gözlem" },
                    { name: "KÜBRA", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-06",
                main: ["K.ÖZSİVRİ", "SÜEDA", "M.GÜLŞEN", "OSMAN", "ECE", "EMRECAN", "SAMET", "BERİTAN", "SERAP", "KÜBRA", "E.ASLAN", "AHMET", "TUTKU", "İMRAN"],
                shifts16: [
                    { name: "F.ARİ", area: "Yeşil (2)" },
                    { name: "SENA", area: "Yeşil Gözlem" },
                    { name: "TÜRKAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-07",
                main: ["E.USLU", "TARIK", "SERKAN", "ERKAN", "F.ÖZKAN", "YUNUS", "MEHMET", "NİSA", "GAMZE", "SENA", "A.KARAKOÇ", "FATMA", "TUNAHAN", "ERDEM"],
                shifts16: [
                    { name: "ESHAT", area: "Yeşil (2)" },
                    { name: "MUKADDES", area: "Yeşil Gözlem" },
                    { name: "YAKUP", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-08",
                main: ["BERİTAN", "Ö.FARUK", "HÜRRE", "MUKADDES", "A.TEPE", "BERKE", "NEDA", "ÖMER", "OĞUZCAN", "GÖKBERK", "E.FERHATLAR", "HALİL", "YAKUP", "MÜCAHİT"],
                shifts16: [
                    { name: "SÜEDA", area: "Yeşil (2)" },
                    { name: "ÖZGÜR", area: "Yeşil Gözlem" },
                    { name: "BARAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-09",
                main: ["B.SATILMIŞ", "A.DÖNEN", "OSMAN", "CEM", "EMRECAN", "SAMET", "ÖZGÜR", "YASER", "BARAN", "ESHAT", "N.YAPAR", "E.GÜLDEŞ", "F.ARİ", "SENA"],
                shifts16: [
                    { name: "TÜRKAN", area: "Yeşil (2)" },
                    { name: "YUNUS", area: "Yeşil Gözlem" },
                    { name: "M.ŞEN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-10",
                main: ["H.TURGUT", "NİSA", "MELİS", "ERKAN", "İPEK", "BÜŞRA", "MEHMET", "FATMA", "SERAP", "KÜBRA", "TARIK", "TÜRKAN", "F.ÖZKAN"],
                shifts16: [
                    { name: "RAUF", area: "Yeşil (2)" },
                    { name: "ECE", area: "Yeşil Gözlem" },
                    { name: "GAMZE", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-11",
                main: ["E.BAHAR", "YAKUP", "SÜEDA", "AFRA", "HANİFE", "BERKE", "RAUF", "M.ŞEN", "SERKAN", "ERDEM", "O.UZUN", "HALİL", "ÖMER", "İMRAN"],
                shifts16: [
                    { name: "CEM", area: "Yeşil (2)" },
                    { name: "A.DÖNEN", area: "Yeşil Gözlem" },
                    { name: "BERİTAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-12",
                main: ["G.AYDIN", "SÜEDA", "M.GÜLŞEN", "YUNUS", "SENA", "A.TEPE", "ÖZGÜR", "A.DÖNEN", "F.ARİ", "CEM", "B.SATILMIŞ", "BERİTAN", "TUTKU", "ESHAT"],
                shifts16: [
                    { name: "SERAP", area: "Yeşil (2)" },
                    { name: "GÖKBERK", area: "Yeşil Gözlem" },
                    { name: "YASER", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-13",
                main: ["E.ASLAN", "B.AYVACI", "H.TURGUT", "N.YAPAR", "M.ŞEN", "GAMZE", "KÜBRA", "TUNAHAN", "TÜRKAN", "F.ÖZKAN", "NİSA", "E.GÜLDEŞ", "BARAN", "SERAP"],
                shifts16: [
                    { name: "MEHMET", area: "Yeşil (2)" },
                    { name: "MÜCAHİT", area: "Yeşil Gözlem" },
                    { name: "İMRAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-14",
                main: ["HALİL", "OĞUZCAN", "GÖKBERK", "MUKADDES", "ECE", "NEDA", "MEHMET", "ÖMER", "HÜRRE", "İMRAN", "A.KARAKOÇ", "FATMA", "YAKUP", "MÜCAHİT"],
                shifts16: [
                    { name: "A.TEPE", area: "Yeşil (2)" },
                    { name: "ESHAT", area: "Yeşil Gözlem" },
                    { name: "OSMAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-15",
                main: ["Ö.UZUN", "AHMET", "F.ARİ", "ESHAT", "ERDEM", "SAMET", "MÜCAHİT", "SÜEDA", "M.GÜLŞEN", "OSMAN", "E.BAHAR", "BERİTAN", "TUTKU", "YUNUS"],
                shifts16: [
                    { name: "Ö.FARUK", area: "Yeşil (2)" },
                    { name: "CEM", area: "Yeşil Gözlem" },
                    { name: "TUNAHAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-16",
                main: ["N.YAPAR", "NİSA", "SERKAN", "F.ÖZKAN", "KÜBRA", "A.TEPE", "RAUF", "E.GÜLDEŞ", "GAMZE", "BERKE", "BARAN", "TARIK", "TUNAHAN", "SERAP"],
                shifts16: [
                    { name: "YAKUP", area: "Yeşil (2)" },
                    { name: "A.DÖNEN", area: "Yeşil Gözlem" },
                    { name: "ÖMER", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-17",
                main: ["P.ÖZATAK", "HALİL", "ERKAN", "İPEK", "BÜŞRA", "NEDA", "MEHMET", "YAKUP", "HÜRRE", "CEM", "ÖMER", "M.ŞEN", "Ö.FARUK", "MUKADDES"],
                shifts16: [
                    { name: "ERDEM", area: "Yeşil (2)" },
                    { name: "SENA", area: "Yeşil Gözlem" },
                    { name: "TUTKU", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-18",
                main: ["YASER", "SERAP", "MELİS", "GÖKBERK", "HANİFE", "EMRECAN", "ÖZGÜR", "AHMET", "MÜCAHİT", "ECE", "TUTKU", "SÜEDA", "OĞUZCAN", "YUNUS"],
                shifts16: [
                    { name: "SAMET", area: "Yeşil (2)" },
                    { name: "A.TEPE", area: "Yeşil Gözlem" },
                    { name: "E.GÜLDEŞ", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-19",
                main: ["S.SOLAK", "G.AYDIN", "K.ÖZSİVRİ", "A.KARAKOÇ", "A.DÖNEN", "İMRAN", "SAMET", "TARIK", "TÜRKAN", "F.ÖZKAN", "B.CAM", "NİSA", "SERKAN", "KÜBRA"],
                shifts16: [
                    { name: "MEHMET", area: "Yeşil (2)" },
                    { name: "MEHMET", area: "Yeşil Gözlem" },
                    { name: "HALİL", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-20",
                main: ["E.FERHATLAR", "ÖMER", "M.GÜLŞEN", "GAMZE", "ESHAT", "SENA", "NEDA", "YAKUP", "HÜRRE", "MUKADDES", "TUNAHAN", "M.ŞEN", "Ö.FARUK", "A.TEPE"],
                shifts16: [
                    { name: "YUNUS", area: "Yeşil (2)" },
                    { name: "SÜEDA", area: "Yeşil Gözlem" },
                    { name: "RAUF", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-21",
                main: ["Ö.HİNCAL", "BARAN", "ELİF", "BÜŞRA", "YUNUS", "RAUF", "AHMET", "YASER", "F.ARİ", "OSMAN", "Y.ÇELİK", "AHMET", "OĞUZCAN", "ECE"],
                shifts16: [
                    { name: "MÜCAHİT", area: "Yeşil (2)" },
                    { name: "HALİL", area: "Yeşil Gözlem" },
                    { name: "NİSA", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-22",
                main: ["T.ÖZATAK", "TUTKU", "SERAP", "İMRAN", "ERDEM", "BERKE", "HALİL", "SERKAN", "CEM", "FATMA", "TÜRKAN", "M.ŞEN", "HÜRRE", "F.ÖZKAN"],
                shifts16: [
                    { name: "M.GÜLŞEN", area: "Yeşil (2)" },
                    { name: "YAKUP", area: "Yeşil Gözlem" },
                    { name: "Ö.FARUK", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-23",
                main: ["B.CAM", "TUNAHAN", "ESHAT", "SENA", "EMRECAN", "SAMET", "MEHMET", "E.GÜLDEŞ", "GÖKBERK", "A.TEPE", "B.AYVACI", "A.DÖNEN", "M.GÜLŞEN", "KÜBRA"],
                shifts16: [
                    { name: "BARAN", area: "Yeşil (2)" },
                    { name: "F.ARİ", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-24",
                main: ["Y.ÇELİK", "Ö.UZUN", "E.FERHATLAR", "BARAN", "OSMAN", "BERKE", "ÖZGÜR", "TARIK", "MÜCAHİT", "AHMET", "OĞUZCAN", "NİSA", "F.ARİ", "GAMZE"],
                shifts16: [
                    { name: "NEDA", area: "Yeşil (2)" },
                    { name: "ECE", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-25",
                main: ["S.SOLAK", "E.GÜLDEŞ", "Ö.FARUK", "KÜBRA", "ESHAT", "MEHMET", "TUNAHAN", "GÖKBERK", "E.USLU", "A.DÖNEN", "M.GÜLŞEN", "SENA"],
                shifts16: [
                    { name: "EMRECAN", area: "Yeşil (2)" },
                    { name: "A.TEPE", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-26",
                main: ["B.AYVACI", "TARIK", "MÜCAHİT", "MUKADDES", "ECE", "RAUF", "EMRECAN", "AHMET", "F.ARİ", "OSMAN", "N.YAPAR", "NİSA", "BARAN", "GAMZE"],
                shifts16: [
                    { name: "OĞUZCAN", area: "Yeşil (2)" },
                    { name: "NEDA", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-27",
                main: ["B.AKIN", "M.ŞEN", "HÜRRE", "İMRAN", "ERDEM", "BERKE", "NEDA", "FATMA", "TÜRKAN", "YUNUS", "T.ÖZATAK", "SÜEDA", "OĞUZCAN", "CEM"],
                shifts16: [
                    { name: "E.ASLAN", area: "Yeşil (2)" },
                    { name: "SERKAN", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-28",
                main: ["E.BAHAR", "Ö.HİNCAL", "E.USLU", "B.SATILMIŞ", "TUTKU", "SERAP", "GÖKBERK", "A.TEPE", "HALİL", "ERKAN", "Ö.FARUK", "YASER", "M.GÜLŞEN", "E.GÜLDEŞ", "TUNAHAN", "ESHAT"],
                shifts16: [
                    { name: "SENA", area: "Yeşil (2)" },
                    { name: "AHMET", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-29",
                main: ["AHMET", "F.ARİ", "MÜCAHİT", "ECE", "HANİFE", "SAMET", "MEHMET", "NİSA", "GAMZE", "KÜBRA", "SERKAN", "TARIK", "BARAN", "OSMAN"],
                shifts16: [
                    { name: "FATMA", area: "Yeşil (2)" },
                    { name: "HÜRRE", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-30",
                main: ["FATMA", "OĞUZCAN", "TÜRKAN", "YUNUS", "ERDEM", "RAUF", "EMRECAN", "A.DÖNEN", "Ö.FARUK", "SENA", "YAKUP", "YASER", "ÖMER", "MUKADDES"],
                shifts16: [
                    { name: "F.ÖZKAN", area: "Yeşil (2)" },
                    { name: "BERKE", area: "Sarı Alan 4. Sütun" }
                ]
            },
            {
                date: "2026-10-31",
                main: ["E.GÜLDEŞ", "ELİF", "BÜŞRA", "AFRA", "A.TEPE", "BERKE", "NEDA", "TUTKU", "SERAP", "İMRAN", "B.SATILMIŞ", "SÜEDA", "HÜRRE", "CEM"],
                shifts16: [
                    { name: "NİSA", area: "Yeşil (2)" },
                    { name: "TARIK", area: "Sarı Alan 4. Sütun" }
                ]
            }
        ];

        for (const item of schedule) {
            if (item.main) {
                for (const doc of item.main) {
                    await addMainDuty(doc, item.date);
                }
            }
            if (item.shifts16) {
                for (const shift of item.shifts16) {
                    await add16hShift(shift.name, item.date, shift.area);
                }
            }
        }
        console.log("Ekim 2026 nöbetleri ve ek mesaileri yönetici girişiyle veritabanına aktarıldı.");
    }

    loadOctoberSchedule();
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

    db.run(`INSERT INTO main_duties (doctor_id, duty_date, created_by) VALUES (?, ?, 'admin')`, [doctor_id, duty_date], (err) => {
        if (err) return res.status(500).json({ error: "Nöbet eklenemedi." });
        res.json({ message: "Rutin 24 saatlik nöbet eklendi." });
    });
});

app.post('/api/admin/add-shift', (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;
    if (!doctor_id || !shift_date || !area || !duration) return res.status(400).json({ error: "Eksik bilgi." });

    db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration, created_by) VALUES (?, ?, ?, ?, 'admin')`, 
        [doctor_id, shift_date, area, duration], (err) => {
        if (err) return res.status(500).json({ error: "Ek mesai eklenemedi." });
        res.json({ message: "Yönetici tarafından ek mesai tanımlandı." });
    });
});

app.get('/api/main-duties', (req, res) => {
    const sql = `SELECT main_duties.id, main_duties.doctor_id, main_duties.duty_date, main_duties.created_by, doctors.name as doctor_name 
                 FROM main_duties 
                 JOIN doctors ON main_duties.doctor_id = doctors.id`;
    db.all(sql, [], (err, rows) => res.json(rows || []));
});

app.get('/api/shifts', (req, res) => {
    const sql = `SELECT shifts.id, shifts.doctor_id, shifts.shift_date, shifts.area, shifts.duration, shifts.created_by, doctors.name as doctor_name 
                 FROM shifts 
                 JOIN doctors ON shifts.doctor_id = doctors.id`;
    db.all(sql, [], (err, rows) => res.json(rows || []));
});

app.post('/api/shift/add', async (req, res) => {
    const { doctor_id, shift_date, area, duration } = req.body;

    const shiftMonth = shift_date.slice(0, 7);
    const activeMonthRow = await new Promise(resolve => {
        db.get(`SELECT value FROM settings WHERE key = 'active_month'`, [], (err, row) => resolve(row));
    });
    const activeMonth = activeMonthRow ? activeMonthRow.value : null;

    if (activeMonth && shiftMonth !== activeMonth) {
        return res.status(400).json({ error: `Sadece aktif ay (${activeMonth}) için işlem yapabilirsiniz!` });
    }

    const mainDutyDates = new Set();
    const shiftDates = new Set();
    const allDutyDates = new Set();

    await new Promise(resolve => {
        db.all(`SELECT duty_date FROM main_duties WHERE doctor_id = ?`, [doctor_id], (err, rows) => {
            if (rows) rows.forEach(r => { mainDutyDates.add(r.duty_date); allDutyDates.add(r.duty_date); });
            resolve();
        });
    });

    await new Promise(resolve => {
        db.all(`SELECT shift_date FROM shifts WHERE doctor_id = ?`, [doctor_id], (err, rows) => {
            if (rows) rows.forEach(r => { shiftDates.add(r.shift_date); allDutyDates.add(r.shift_date); });
            resolve();
        });
    });

    if (mainDutyDates.has(shift_date)) {
        return res.status(400).json({ error: "24 saatlik nöbetinizin olduğu güne ek mesai yazamazsınız!" });
    }

    if (shiftDates.has(shift_date)) {
        return res.status(400).json({ error: "Bu tarihte zaten tanımlı bir ek mesainiz bulunmaktadır!" });
    }

    const prevDay = addDays(shift_date, -1);
    if (mainDutyDates.has(prevDay)) {
        return res.status(400).json({ error: "24 saatlik nöbetinizin ertesi gününe ek mesai yazamazsınız!" });
    }

    const dMinus1 = addDays(shift_date, -1);
    const dMinus2 = addDays(shift_date, -2);
    if (allDutyDates.has(dMinus1) && allDutyDates.has(dMinus2)) {
        return res.status(400).json({ error: "Ardışık 3 gün üst üste takvime yazılınamaz!" });
    }

    const dPlus1 = addDays(shift_date, 1);
    if (allDutyDates.has(dMinus1) && allDutyDates.has(dPlus1)) {
        return res.status(400).json({ error: "Bu tarih seçilirse ardışık 3 gün üst üste görev oluşur!" });
    }

    const dPlus2 = addDays(shift_date, 2);
    if (allDutyDates.has(dPlus1) && allDutyDates.has(dPlus2)) {
        return res.status(400).json({ error: "Bu tarih seçilirse ardışık 3 gün üst üste görev oluşur!" });
    }

    db.get(`SELECT * FROM shifts WHERE shift_date = ? AND area = ?`, [shift_date, area], (err, areaCheck) => {
        if (areaCheck) return res.status(400).json({ error: `Bu tarihte ${area} alanına zaten ek mesai yazılmış!` });

        db.get(`SELECT value FROM settings WHERE key = 'max_shifts'`, [], (err2, limitRow) => {
            const maxLimit = parseInt(limitRow ? limitRow.value : '3');
            db.get(`SELECT COUNT(*) as count FROM shifts WHERE doctor_id = ?`, [doctor_id], (err3, countRow) => {
                if (countRow.count >= maxLimit) {
                    return res.status(400).json({ error: `Belirlenen ek mesai limitine (${maxLimit}) ulaştınız!` });
                }

                db.run(`INSERT INTO shifts (doctor_id, shift_date, area, duration, created_by) VALUES (?, ?, ?, ?, 'user')`, 
                    [doctor_id, shift_date, area, duration], (err4) => {
                    if (err4) return res.status(500).json({ error: "Mesai kaydedilemedi." });
                    res.json({ message: "Ek mesainiz takvime eklendi!" });
                });
            });
        });
    });
});

app.delete('/api/shift/delete/:id', async (req, res) => {
    const shiftId = req.params.id;
    const { doctor_id, role } = req.body;

    db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId], async (err, shift) => {
        if (!shift) return res.status(404).json({ error: "Ek mesai bulunamadı." });

        if (role !== 'admin') {
            if (shift.created_by === 'admin') {
                return res.status(403).json({ error: "Yöneticinin eklediği ek mesailer yalnızca yönetici tarafından silinebilir!" });
            }

            if (shift.doctor_id !== doctor_id) {
                return res.status(403).json({ error: "Sadece kendi ek mesainizi silebilirsiniz!" });
            }

            const shiftMonth = shift.shift_date.slice(0, 7);
            const activeMonthRow = await new Promise(resolve => {
                db.get(`SELECT value FROM settings WHERE key = 'active_month'`, [], (e, r) => resolve(r));
            });
            const activeMonth = activeMonthRow ? activeMonthRow.value : null;

            if (activeMonth && shiftMonth !== activeMonth) {
                return res.status(400).json({ error: `Geçmiş/Gelecek aylara ait ek mesaileri silemezsiniz!` });
            }
        }

        db.run(`DELETE FROM shifts WHERE id = ?`, [shiftId], () => {
            res.json({ message: "Ek mesai iptal edildi." });
        });
    });
});

app.delete('/api/admin/main-duty/:id', (req, res) => {
    db.run(`DELETE FROM main_duties WHERE id = ?`, [req.params.id], () => {
        res.json({ message: "Rutin 24s nöbet silindi." });
    });
});

app.get('/api/admin/export-excel', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Nöbet ve Ek Mesai Listesi');

        worksheet.columns = [
            { header: 'Tarih', key: 'date', width: 15 },
            { header: 'Hekim Adı', key: 'doctor', width: 25 },
            { header: 'Görev Türü', key: 'type', width: 18 },
            { header: 'Alan', key: 'area', width: 18 },
            { header: 'Süre (Saat)', key: 'duration', width: 15 },
            { header: 'Ekleyen', key: 'created_by', width: 15 }
        ];

        const duties = await new Promise(resolve => {
            db.all(`SELECT md.duty_date as date, d.name as doctor, '24 Sa Nöbet' as type, '-' as area, 24 as duration, md.created_by
                    FROM main_duties md JOIN doctors d ON md.doctor_id = d.id`, [], (err, rows) => resolve(rows || []));
        });

        const shifts = await new Promise(resolve => {
            db.all(`SELECT s.shift_date as date, d.name as doctor, 'Ek Mesai' as type, s.area, s.duration, s.created_by
                    FROM shifts s JOIN doctors d ON s.doctor_id = d.id`, [], (err, rows) => resolve(rows || []));
        });

        const allRecords = [...duties, ...shifts].sort((a, b) => a.date.localeCompare(b.date));

        allRecords.forEach(r => {
            worksheet.addRow({
                date: r.date,
                doctor: r.doctor,
                type: r.type,
                area: r.area,
                duration: r.duration,
                created_by: r.created_by === 'admin' ? 'Yönetici' : 'Hekim'
            });
        });

        worksheet.getRow(1).font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Acil_Servis_Nobet_Listesi.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: "Excel dosyası oluşturulamadı." });
    }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));
