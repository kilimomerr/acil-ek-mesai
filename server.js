const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Statik dosyaları dışa aç
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. ANA SAYFA: Doğrudan Hekim/Kullanıcı Giriş Portalı
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. YÖNETİCİ PANELSİ: Sadece /admin adresinden erişilir
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Sunucuyu Başlat
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});
