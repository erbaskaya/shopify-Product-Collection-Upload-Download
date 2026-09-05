# Seçili Shopify temasını ZIP indirme

Bu güncelleme, **System → Backup & Restore** sayfasına **Download Shopify theme** bölümü ekler.

## Kullanım

1. Üst menüden mağazayı seçin.
2. **System → Backup & Restore** sayfasını açın.
3. **Theme to download** listesinden indirmek istediğiniz TEK temayı seçin.
4. **Download Selected Theme ZIP** düğmesine basın.
5. İşlem bitene kadar sayfayı açık tutun. ZIP, tarayıcının indirme konumuna kaydedilir.

Listede tema adı, Active/Draft durumu ve tema ID'si görünür. Aynı isimdeki kopyalar ID ile ayırt edilir. Yalnızca seçtiğiniz temanın içeriği alınır. Mağaza değiştirilince seçim sıfırlanır ve sürmekte olan indirme iptal edilir. **Refresh themes** listeyi yeniden yükler; **Cancel download** indirmeyi iptal eder.

## GitHub / Vercel güncellemesi

Bu ZIP tam proje kaynaklarını içerir. ZIP'i açın; içindeki `shopify-Product-Collection-Upload-Download` klasörünün İÇERİĞİNİ mevcut GitHub projesindeki aynı yolların üzerine yükleyin. Proje kökünün içine ikinci bir proje klasörü eklemeyin.

Değişen mevcut dosyalar:

- `api/bridge.py`
- `src/App.tsx`
- `src/lib/webApi.ts`
- `src/pages/BackupPage.tsx`
- `REQUIRED-SHOPIFY-SCOPES.md`

Yeni uygulama dosyaları:

- `src/lib/themeExport.ts`
- `src/pages/ThemeDownloadCard.tsx`
- `src/pages/ThemeDownloadCard.css`

Kurulum notu ve testler de pakettedir. Mevcut Vercel ortam değişkenleri, veritabanı ve domain ayarlarıyla devam eder; yeni paket veya ortam değişkeni gerekmez. GitHub'a commit/push sonrasında bağlı Vercel projesinin yeni dağıtımını bekleyin. Bu teslim sırasında GitHub'a veya canlı Vercel projesine yayın yapılmadı.

## Shopify izni

Mağazanın uygulama erişim belirtecinde **`read_themes`** Admin API izni olmalıdır. Yalnızca okuma yapılır; `write_themes` gerekmez. İzin eksikse ekranda açıklama çıkar.

İzni Shopify uygulama yapılandırmasından ekleyin, kurulum/izin güncellemesini mağazada tamamlayın. Shopify yeni bir erişim belirteci verirse panelde **Stores** bölümünden bunu kaydedin. Ardından **Refresh themes** düğmesine basın. Yalnızca izin adını koda yazmak mevcut erişim belirtecinin yetkisini değiştirmez.

Resmî kaynak: https://shopify.dev/docs/api/admin-graphql/2026-07/queries/theme

## ZIP içeriği ve sınırlar

- Tema dosyaları özgün klasör yollarıyla arşive girer: `layout`, `templates`, `sections`, `blocks`, `snippets`, `assets`, `config`, `locales` ve temada bulunan diğer dosyalar.
- `layout/theme.liquid` arşivin kökünden doğru yolda bulunur; ek bir dış klasör veya uygulama `backup.json` dosyası eklenmez.
- Tema ayarları, Liquid, CSS/JS, dil dosyaları ve tema içindeki görsel/font gibi dosyalar dahildir. Ürünler, siparişler, uygulama verileri ve tema dışındaki Files/CDN medyası tema ZIP'inin parçası değildir.
- Mevcut **Save Backup ZIP / Choose Backup ZIP** uygulama yedekleme işlevi ayrı olarak devam eder. Tema ZIP'i bu uygulama yedeği geri yükleme düğmesine verilmez; gerektiğinde Shopify'ın tema yükleme ekranında kullanılır.
- Shopify'ın izin vermediği veya hazırlanmamış tema dosyaları için eksik ZIP üretilmez. Tema indirme sırasında değiştirilirse yeniden denemeniz istenir.
- Dosyalar küçük isteklerle okunur; büyük dosyalar 512 KiB parçalarla alınır. ZIP tarayıcıda oluşturulur; tüm tema tek Vercel yanıtından geçirilmez. Vercel'de diske kalıcı dosya veya çalışan arka plan görevi bırakılmaz.
- Tarayıcı belleğini korumak için toplam dosya boyutu 250 MiB üzerindeki temalar bu panelden dışa aktarılmaz. Bu durumda Shopify Admin'deki tema indirme seçeneğini kullanın.
- Bu özellik Shopify GraphQL Admin API `2026-07` sürümünü kullanır; diğer işlemlerin mağaza API ayarı değiştirilmez.

Vercel yanıt sınırı kaynağı: https://vercel.com/docs/functions/limitations#request-body-size

## Doğrulama

- `npm run build`: başarılı.
- `node --test tests/theme-export.test.mjs`: 9 test başarılı.
- `python -m unittest discover -s tests -p 'test_theme_chunks.py' -v`: 7 test başarılı (`requirements.txt` bağımlılıkları kurulu olmalı).
- Derlenen uygulama gerçek tarayıcıda test verileriyle kontrol edildi: tema seçimi, tek tema indirme, ZIP kaydı, eski uygulama yedeği, iptal, mağaza değiştirme ve eksik izin mesajı başarılı; sayfa JavaScript hatası yok.
- Tarayıcıdan indirilen test ZIP'i Python `zipfile` ile açılarak klasörler, dosya listesi, UTF-8 içerik ve ZIP CRC doğrulandı.

Canlı mağaza erişim belirteciyle gerçek Shopify indirmesi ve canlı Vercel dağıtımı bu çalışma ortamında denenmedi.
