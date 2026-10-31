# Pinpon 3D 🏓

Yapay zekaya karşı oynanan, tarayıcıda çalışan, telefona özel tasarlanmış **3 boyutlu pinpon (masa tenisi)** oyunu.
Hiçbir dış kütüphane, görsel ya da ses dosyası kullanılmaz: 3B çizici, fizik motoru, yapay zeka ve tüm sesler saf JavaScript ile kodlanmıştır.

**Oyna:** https://burakkolik.github.io/pinpon/

## Özellikler
- **Gerçekçi fizik:** yerçekimi, hava direnci, Magnus etkisi (topspin / backspin / yan falso), masa ve zemin sekmesinde
  sürtünme ile spin ↔ hız aktarımı (içi boş küre modeli), file gövdesi ve file ipi çarpışmaları.
- **Yapay zeka rakip (3 seviye):** Basit (Robo-Çaylak), Orta (Robo-Usta), Zor (Robo-Şampiyon).
  Rakip, topun yörüngesini fizik simülasyonuyla tahmin eder; tepki süresi, hareket hızı, isabet ve spin okuma becerisi seviyeye göre değişir.
- **Gerçek kurallar:** 11 sayı, 2 fark, her 2 sayıda servis değişimi (düste her sayıda), let, servis hatası, çift sekme, aut, set sistemi.
- **Efektler:** top izi (hızlandıkça ateşlenir), spin dikişi, kıvılcımlar, sekme halkaları, dalgalanan file, ekran sarsıntısı,
  ağır çekim, konfeti, havai fişek, seyirci flaşları, ifadeleri değişen robot rakip, sentezlenmiş sesler.
- **Tam duyarlı:** dikey/yatay telefon, tablet ve masaüstünde kamera ekrana göre otomatik ayarlanır.

## Kontroller
| Hareket | Sonuç |
|---|---|
| Parmağı sürükle | Raket parmağın biraz üstünde takip eder |
| Top gelirken hızlı yukarı kaydır | Sert vuruş + topspin (yüksek topta smaç) |
| Aşağı çek | Kesme (backspin) |
| Yana kaydır | Topu o yöne yollar + yan falso |
| Servis: dokun / yukarı / aşağı kaydır | Normal / uzun-hızlı / kısa kesme servis |

Masaüstünde fare ile oynanır; `Boşluk` servis atar, `Esc` duraklatır.

## Geliştirme
Derleme adımı yoktur; herhangi bir statik sunucu yeterlidir:
```bash
python3 -m http.server 8000
# http://localhost:8000
```

Dosyalar: `js/physics.js` (fizik + atış çözücü), `js/game.js` (kurallar, yapay zeka, efektler),
`js/renderer.js` (3B çizici), `js/audio.js` (ses sentezi), `js/main.js` (arayüz).
