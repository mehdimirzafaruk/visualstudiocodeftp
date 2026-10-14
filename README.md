# Visual Studio Code FTP Plugin

> **Durum: İskelet çalışıyor, uçtan uca ilk sürüm henüz değil.**
>
> Bağlantı yönetimi, uzak dosya gezgini, yükleme/indirme ve kaydetme anında
> yükleme yazıldı ve yol eşleme katmanı testli. Eksikler aşağıda **Henüz yok**
> başlığı altında dürüstçe listelendi. Kod henüz gerçek bir sunucuya karşı
> uçtan uca denenmedi.

VS Code için FTP/SFTP istemcisi: workspace'e özel veya genel bağlantılar, uzaktan
dosya gezgini ve kaydetme anında sunucuya yükleme.

## Neden bu eklenti

Dosyaları elle bir FTP istemcisine sürüklemek, her seferinde doğru klasörü bulmak
ve uzak sunucuda hangi sürümün durduğunu hatırlamak gerekmiyor. Bağlantı bir kez
tanımlanıyor, sonrası editörün içinde kalıyor.

## Şu an çalışan özellikler

- **Bağlantı yönetimi** — ekle, düzenle, sil. Her bağlantı iki kapsamdan birinde
  yaşar: yalnızca o projede görünen *workspace* kapsamı, ya da bütün pencerelerde
  görünen *genel* kapsam.
- **FTP ve SFTP** — iki protokol aynı arayüzün arkasında; çağıran taraf protokolü
  bilmiyor.
- **Şifreler işletim sisteminin anahtar zincirinde** — `vscode.SecretStorage`
  kullanılıyor. Parola `settings.json`'a veya repoya yazılmaz.
- **Uzak dosya gezgini** — kenar çubuğunda tembel açılan ağaç. Yalnızca açtığınız
  klasörün içeriği sunucudan istenir.
- **Aktif dosyayı yükle / indir** — komut paletinden veya gezgindeki bir dosyaya
  tıklayarak.
- **Kaydetme anında yükleme** (varsayılan kapalı) — `vscodeFtp.autoUploadOnSave`
  ile açılır. `.git`, `node_modules` gibi yollar hariç listesine eklenebilir.
- **Durum çubuğu göstergesi** — hangi sunucuya bağlı olduğunuz her an görünür.
  Yanlış dosyayı yanlış sunucuya yazmayı engelleyen en basit önlem bu.
- **Çıktı günlüğü** — hangi dosyanın nereye gittiği ve hangi isteğin patladığı
  `FTP / SFTP` çıktı kanalında.

## Henüz yok

- **Yalnızca değişen dosyayı güncelleme** — şu an yükleme her zaman tam dosyayı
  gönderiyor; uzak dosyanın daha yeni olup olmadığı karşılaştırılmıyor.
- **Sunucudaki değişikliklerin otomatik algılanması** — uzaktan yerele doğru
  çalışan bir izleme yok.
- **Klasörü komple yükleme** — şu an dosya bazında çalışıyor.
- **Vekil sunucu (proxy) desteği** ve anahtar dosyası seçim arayüzü.
- **Test kapsamı dar** — yalnızca yol eşleme mantığı test ediliyor (11 test).
  İstemci katmanının gerçek bir sunucuya karşı entegrasyon testi yok.

## Kurulum (geliştirme)

```bash
git clone https://github.com/mehdimirzafaruk/visualstudiocodeftp.git
cd visualstudiocodeftp
npm install
```

VS Code'da klasörü açıp `F5`'e basın: "Eklentiyi Çalıştır" yapılandırması ikinci
bir VS Code penceresi açar ve eklenti orada yüklenir.

Testler:

```bash
npm run check
```

## Mimari

Derleme adımı yok, bilerek düz CommonJS. Kaynağı değiştirip `F5`'e basmak yeterli;
arada bir bundler katmanı olmadığı için hata ayıklama da doğrudan yazdığınız
dosyanın üzerinde çalışır.

```
extension.js              Etkinleştirme, komut kaydı, bağlantı formu
src/path-map.js           Yerel ↔ uzak yol eşleme ve sınır kontrolleri (testli)
src/create-client.js      Protokol seçimi
src/ftp-client.js         basic-ftp sarmalayıcısı
src/sftp-client.js        ssh2-sftp-client sarmalayıcısı
src/connection-store.js   Bağlantı kayıtları + SecretStorage
src/sync-manager.js       Transfer kuyruğu, kaydetme anında yükleme
src/tree-providers.js     Kenar çubuğu görünümleri
src/logger.js             Çıktı kanalı
```

İki tasarım kararı:

**Bütün ağ işlemleri tek bir kuyruktan geçer.** FTP tek bir kontrol bağlantısı
kullanır; aynı anda iki komut gönderirseniz yanıtlar birbirine karışır. Kaydetme
anında yükleme açıkken elle bir yükleme tetiklenirse işler sıraya girer.

**Yol eşleme katmanı saf fonksiyonlardan oluşur.** Yerel kökün dışındaki bir
dosyayı yüklemeye çalışmak, ya da `..` içeren bir uzak yolu yerelde kökün dışına
yazmak `null` döner ve işlem reddedilir. Eklentinin en kolay yanlış
kullanılabilecek yeri burası olduğu için ayrı bir modülde tutuluyor ve testli.

## Lisans

MIT
