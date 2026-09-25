const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Statik dosyaları doğrudan ana dizinden servis et
app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. ANA SAYFA: Doğrudan Hekim/Kullanıcı Giriş Portalı
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. YÖNETİCİ PANELİ: Sadece /admin adresinden erişilir
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Sunucuyu Başlat
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});
