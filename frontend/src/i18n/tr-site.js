// OmniFM website texts, Turkish: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js. Values filled
// in at runtime stand where Turkish needs no suffix on them.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Nasıl çalışır', href: '#features' },
      { key: 'why', label: 'Neden OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'İstasyonlar', page: 'stations' },
      { key: 'pricing', label: 'Fiyatlar', page: 'premium' },
      { key: 'faq', label: 'SSS', page: 'faq' },
    ],
    discord: 'Discord topluluğu',
  },
  cookieConsent: {
    title: 'Çerezler ve istatistikler',
    short: 'Yalnızca sitenin ihtiyaç duyduğunu saklıyoruz (dil, giriş). Google Analytics çerezleri ancak sen onay verirsen kullanır.',
    privacyLink: 'Gizlilik',
    necessaryTitle: 'Gerekli',
    necessaryBody: 'Dil seçimin, panele güvenli giriş ve sitenin çalışması için. Kapatılamaz.',
    analyticsTitle: 'İstatistikler (Google Analytics)',
    analyticsBody: 'Siteyi iyileştirebilmemiz için hangi sayfaların ziyaret edildiğini kabaca sayar. Onayın olmadan Google Analytics çerez kullanmaz.',
    acceptAll: 'Tümünü kabul et',
    reject: 'Reddet',
    settings: 'Ayarlar',
    save: 'Seçimi kaydet',
    manage: 'Çerez ayarları',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Discord',
    titleAccent: 'radyon.',
    titleTail: '24/7 canlı.',
    subtitleLead: 'Discord ses kanalında günün her saati radyo: her türden istasyon, her şeyi yönetmek için bir panel ve bir yayın koparsa OmniFM kendiliğinden yeniden bağlanır. Commander’ı davet et, bir worker ekle ve şunu çalıştır:',
    subtitleTail: '.',
    ctaInvite: 'Commander’ı davet et',
    ctaFlow: 'Nasıl çalışır',
  },
  trustBar: {
    live: 'Canlı rakamlar',
    items: {
      servers: { label: 'Sunucu', detail: 'OmniFM kullanıyor' },
      stations: { label: 'İstasyon', detail: 'dinlemek için, burada da' },
      bots: { label: 'Bot', detail: 'çalmaya hazır' },
      listeners: { label: 'Şu an dinleyen', detail: 'tüm sunucularda' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Neden OmniFM',
    title: 'Bir radyo botundan fazlası',
    subtitle: 'Kesintisiz çalan müzik ve sunucunu yönetmek için ihtiyacın olan her şey.',
    cards: {
      radio: {
        label: 'Radyo',
        title: 'Hızlı başlangıç',
        desc: 'Commander’ı davet et, bir worker ekle, /play çalıştır ve hemen dinle. Keyfine varmadan önce ağır bir kurulum yok.',
      },
      workers: {
        label: 'Worker’lar',
        title: 'Tek bir bottan fazlası',
        desc: 'Birden fazla bot işi paylaşır: her worker kendi ses kanalında çalar, böylece büyük bir sunucuda aynı anda birden fazla istasyon çalabilir.',
      },
      control: {
        label: 'Kontrol',
        title: 'Yöneticiler için kontrol',
        desc: 'Panel neyin nerede çaldığını gösterir, dili ayarlar ve etkinlikleri planlar. Pro ile canlı görünüm, istatistikler, rol yetkileri ve kesinti bildirimleri gelir.',
      },
      growth: {
        label: 'Büyüme',
        title: 'Sürtünmesiz büyüme',
        desc: 'Free, Pro ve Ultimate birbirinin üzerine kurulur: üst plana geçtiğinde her şey ayarlı kalır, sadece daha fazlası eklenir.',
      },
    },
  },
  stations: {
    eyebrow: 'Canlı istasyon rehberi',
    title: 'OmniFM istasyonları',
    summary: ({ count, free, pro, ultimate }) => `${count} istasyon (${free} free, ${pro} pro, ${ultimate} ultimate). Önizleme için tıkla veya Discord’da /play kullan.`,
    nowPlaying: 'Önizleme çalıyor',
    searchPlaceholder: 'İstasyon ara...',
    filters: {
      all: 'Tümü',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} istasyon (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'İstasyonlar yükleniyor...',
    empty: 'İstasyon bulunamadı.',
    loadMore: ({ remaining }) => `Daha fazla göster (${remaining} kaldı)`,
    visible: ({ visible, total }) => `${total} istasyondan ${visible} tanesi gösteriliyor`,
    previewVolume: 'Ses',
    stopPreview: 'Önizlemeyi durdur',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'SSS',
    title: 'Başlamadan önce en önemli sorular',
    subtitle: 'Kısaca: nasıl başlarsın, planlar neler sunar ve OmniFM nasıl çalışır.',
    items: [
      {
        key: 'start',
        question: 'OmniFM’e başlamanın en kolay yolu nedir?',
        answer: 'Genelde bir dakikadan kısa sürer: commander’ı davet et, en az bir worker ekle, bir ses kanalına gir, sonra /play çalıştırıp bir istasyon seç.',
      },
      {
        key: 'workerRequired',
        question: '/play’den önce bir worker gerekiyor mu?',
        answer: 'Evet. Commander komutları alır, ama asıl yayın bir worker üzerinden akar. /play ancak sunucuda bir worker olduğunda düzgün çalışır.',
      },
      {
        key: 'free',
        question: 'Free planında neler var?',
        answer: 'Başlamak için Free yeterli: en fazla 2 bot, 20 istasyon ve radyo dinlemek için gereken tüm komutlar.',
      },
      {
        key: 'dashboard',
        question: 'Panele hemen ihtiyacım var mı?',
        answer: 'Hayır, her şey Discord’da da çalışır. Free ile panel nerede ne çaldığını gösterir, istasyonu değiştirir veya durdurur, dili ayarlar ve bir etkinlik planlar. Pro canlı görünüm, istatistikler, sınırsız etkinlik, rol izinleri ve kesinti bildirimleri ekler.',
      },
      {
        key: 'pro',
        question: 'Pro ne zaman değer?',
        answer: 'Sunucunu şekillendirmek ve yönetmek istediğin anda: katalogdaki tüm istasyonlar, aynı anda 8 ses kanalı, canlı görünümlü panel, sınırsız etkinlik, rol izinleri ve Discord’da kesinti bildirimleri.',
      },
      {
        key: 'ultimate',
        question: 'Ultimate’a ne zaman ihtiyacım olur?',
        answer: 'Kendi radyonu işletiyorsan: logosuyla birlikte en fazla 50 kendi istasyonun, her sunucu için kendi bot görünümü, kendi yedek istasyon zincirlerin, webhook’lar ve ayrıntılı istatistikler, ayrıca aynı anda 16 ses kanalı.',
      },
      {
        key: 'planStatus',
        question: 'Sunucumun hangi planda olduğunu nasıl görürüm?',
        answer: 'Panelde: Discord ile giriş yap, sunucunu seç ve “Abonelik ve lisans” bölümünü aç. Orada planı ve ne zamana kadar geçerli olduğunu görürsün. Discord’da /premium komutu da gösterir.',
        link: { label: 'Panele git', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'Commander ve worker’lar nasıl çalışır?',
        answer: 'Commander komutlarını alır; /invite sana worker’ların bağlantılarını verir. Worker’lar radyoyu ses kanallarında çalar. Böylece bir sunucu aynı anda birden fazla istasyon dinleyebilir.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Doğrudan Discord’da',
    titleLead: 'Senin ',
    titleAccent: 'ses kanalında',
    titleTail: ' çalar, eğik çizgi komutlarıyla yönetilir.',
    body: 'Sitede sadece kısaca dinlersin – OmniFM 24/7 doğrudan Discord ses kanalında çalar; Now Playing paneli, butonlar ve otomatik yeniden bağlanma ile.',
    cmds: [
      ['/play synthwave', 'Yayını ses kanalında başlatır'],
      ['/now', 'Canlı şarkıyı, kapağı ve dinleyicileri gösterir'],
      ['/stations', '120’den fazla seçilmiş istasyona göz at'],
    ],
    nowPlaying: 'Now Playing', genre: 'Tür', bitrate: 'Bitrate', listeners: 'Dinleyiciler',
    liveStream: 'Canlı radyo yayını', liveRadio: 'Canlı radyo',
    time: 'bugün 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Rehber · 60 saniyeden kısa',
    title: 'OmniFM Discord’da nasıl başlatılır',
    subtitle: 'Üç adım ve radyon 24/7 doğrudan ses kanalında çalar.',
    steps: [
      { n: '01', cmd: 'Uygulama ekle', title: 'Commander’ı davet et', desc: 'OmniFM commander’ını sunucuna ekle. Tüm eğik çizgi komutlarını karşılar ve worker’larını yönetir.' },
      { n: '02', cmd: '/invite', title: 'Bir worker bot ekle', desc: 'En az bir worker davet et. Asıl ses yayınını o taşır — daha fazla worker = daha fazla paralel kanal.' },
      { n: '03', cmd: '/play lofi', title: 'Radyoyu başlat', desc: 'Bir istasyon seç, OmniFM ses kanalına katılsın. Now Playing mesajı, butonlar ve yeniden bağlanma dahil.' },
    ],
    permsTitle: 'İzinler',
    perms: ['Sese katılma ve konuşma', 'Mesaj ve embed gönderme', 'Eğik çizgi komutlarını kullanma'],
    addServer: 'Sunucuya ekle',
    workerHint: 'Worker hazır',
    invite: 'Davet et',
    connected: 'bağlı',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
