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
- `node --test tests/theme-export.test.mjs`: 15 test başarılı.
- `python -m unittest discover -s tests -p 'test_theme_chunks.py' -v`: 16 test başarılı (`requirements.txt` bağımlılıkları kurulu olmalı).
- Derlenen uygulama gerçek tarayıcıda test verileriyle kontrol edildi: tema seçimi, tek tema indirme, ZIP kaydı, eski uygulama yedeği, iptal, mağaza değiştirme ve eksik izin mesajı başarılı; sayfa JavaScript hatası yok.
- Tarayıcıdan indirilen test ZIP'i Python `zipfile` ile açılarak klasörler, dosya listesi, UTF-8 içerik ve ZIP CRC doğrulandı.

Canlı mağaza erişim belirteciyle gerçek Shopify indirmesi ve canlı Vercel dağıtımı bu çalışma ortamında denenmedi.

## Tema dosyası adresi düzeltmesi

`Shopify returned an unsupported theme asset URL.` hatası, ilk sürümdeki dar alan adı filtresinden kaynaklanıyordu. Shopify API'nin verdiği geçici bağlantılar artık yalnızca Shopify alan adı uzantılarıyla sınırlandırılmıyor. İmzalı bağlantının yolu ve sorgu parametreleri aynen korunuyor. Yönlendirmeler de denetleniyor; HTTPS doğrulaması ve yerel/özel ağ adreslerinin engellenmesi devam ediyor. TCP bağlantısı DNS kontrolünde doğrulanan genel IP adresine yapılıyor.

Bu düzeltme için canlı projede yalnızca `api/bridge.py` dosyasını güncellemek yeterlidir. GitHub commit/push sonrasında Vercel dağıtımı Ready olduğunda sayfayı yenileyin, temayı tekrar seçin ve indirin. Bu sürümün adres, yönlendirme ve parça indirme kontrolleri 11 sunucu testiyle doğrulandı; canlı mağazanın gerçek bağlantısı bu ortamda alınmadı.

Shopify'ın bağlantı alanı dokümantasyonu: https://shopify.dev/docs/api/admin-graphql/latest/objects/OnlineStoreThemeFileBodyUrl

## JSON boyut farkı düzeltmesi

`Incomplete file: config/settings_data.json. No ZIP was saved.` hatasını veren kontrol düzeltildi. Önceki kod, API'deki dosya boyutunu döndürülen JSON gövdesinin bayt sayısıyla birebir eşit olmak zorunda kabul ediyordu. Farkın mağazadaki kesin nedeni canlı dosyaya erişmeden belirlenemedi. Artık böyle bir farkta JSON/JSONC sözdizimi, yeniden okunan içeriğin tutarlılığı ve parçalar arasındaki SHA-256 özeti doğrulanıyor. JSON yeniden yazılmıyor; ayarlar, yorumlar, boşluklar, satır sonları ve varsa BOM özgün haliyle ZIP'e giriyor.

JSON için kaynak revizyon bilgisi (sourceSize / checksumMd5) ile indirilen gövdenin boyutu ve özeti (totalSize / contentSha256) ayrı tutulur. ZIP'teki dosya boyutu ve ilerleme sayacı gerçek indirilen bayt sayısını kullanır. Diğer dosyalarda boyut denetimi, HTTP ile yarım kalan yanıtların denetimi ve tema değişikliği kontrolleri devam eder.

Bu sürüm için aşağıdaki üç uygulama dosyasını BİRLİKTE güncelleyin:

- `api/bridge.py`
- `src/lib/themeExport.ts`
- `src/lib/webApi.ts`

Düzeltme ZIP'indeki klasör yapısını mevcut GitHub proje kökünde koruyun. ZIP dosyasını depoya tek dosya olarak yüklemek yerine açılmış içeriği aynı yolların üzerine yükleyin. Test dosyalarının yeni sürümleri de küçük düzeltme paketine dahil edildi.

Doğrulama: 15 tarayıcı tarafı birim testi, 16 Python testi ve üretim derlemesi başarılı. Derlenen arayüz gerçek tarayıcıda Python'daki tema dosyası okuma işleviyle beraber, yalnızca Shopify yanıtı test verisi olacak şekilde denendi. Farklı boyut bilgisi döndüren `settings_data.json` indirilerek özgün UTF-8 baytları ve ZIP CRC doğrulandı. Canlı mağazada indirme veya Vercel yayını yapılmadı.
