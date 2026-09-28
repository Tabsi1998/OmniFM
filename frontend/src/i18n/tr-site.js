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
    body: 'OmniFM dil, güvenlik ve panel oturumları için gerekli depolamayı kullanır. Google etiketi izin modu ile çalışır; istatistik depolamasına yalnızca izin verirsen izin verilir.',
    necessaryTitle: 'Gerekli',
    necessaryBody: 'Dil tercihi, güvenli panel oturumları ve teknik işleyiş için gereklidir. Bu kategori kapatılamaz.',
    analyticsTitle: 'İstatistikler',
    analyticsBody: 'Sayfa görüntülemelerini ve kullanımı genel olarak ölçmek için izin modlu Google Analytics 4’e izin verir. İzin olmadan istatistik depolaması reddedilmiş kalır.',
    acceptAll: 'Tümünü kabul et',
    reject: 'Reddet',
    save: 'Seçimi kaydet',
    manage: 'Çerez ayarları',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Discord',
    titleAccent: 'radyon.',
    titleTail: '24/7 canlı.',
    subtitleLead: '120’den fazla istasyon, worker’larla güvenilirlik, panelden kontrol ve temiz yeniden bağlanma ile 24/7 Discord radyosu. Commander’ı davet et, bir worker ekle ve şunu çalıştır:',
    subtitleTail: '.',
    ctaInvite: 'Commander’ı davet et',
    ctaFlow: 'Nasıl çalışır',
    stats: {
      servers: 'Sunucular',
      stations: 'İstasyonlar',
      bots: 'Botlar',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'İstasyonlar',
        detail: 'Free ve Pro için canlı katalog, doğrudan sitede önizlemeyle.',
      },
      network: {
        label: 'Canlı etkinlik',
        detail: 'Aktif yayınlar ve hazır bir bot ağı, OmniFM’in yalnızca bir tanıtım sayfasında değil gerçekten canlıda çalıştığını gösterir.',
      },
      dashboard: {
        label: 'Panel',
        detail: 'Pro’dan itibaren canlı görünüm, istatistikler, rol izinleri ve kesinti bildirimleri.',
      },
      reliability: {
        label: 'Güvenilirlik',
        detail: 'Yeniden bağlanma, net planlar ve büyüyen sunucular için kolay bir geçiş yolu.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bot · ${servers} sunucu`,
      dashboard: 'Etkinlikler · izinler · durum',
      reliability: 'Yeniden bağlanma · worker · net planlar',
    },
  },
  whyOmniFM: {
    eyebrow: 'Neden OmniFM',
    title: 'Sadece bir radyo botu değil, düzgün kurulmuş bir Discord sistemi',
    subtitle: 'OmniFM en güçlü hâline müzik, güvenilirlik ve sunucu yönetimi birlikte çalıştığında ulaşır.',
    cards: {
      radio: {
        label: 'Radyo',
        title: 'Hızlı başlangıç',
        desc: 'Commander’ı davet et, bir worker ekle, /play çalıştır ve hemen dinle. Keyfine varmadan önce ağır bir kurulum yok.',
      },
      workers: {
        label: 'Worker’lar',
        title: 'Tek bir bottan fazlası',
        desc: 'Worker mimarisi yayınları düzgünce dağıtır ve büyük topluluklarda paralel kullanımı öngörülebilir kılar.',
      },
      control: {
        label: 'Kontrol',
        title: 'Yöneticiler için kontrol',
        desc: 'Panel, etkinlikler, rol izinleri ve durum görünümleri Pro sunuculara yalnızca daha fazla istasyon değil, gerçek kontrol verir.',
      },
      growth: {
        label: 'Büyüme',
        title: 'Sürtünmesiz büyüme',
        desc: 'Free, Pro ve Ultimate aynı çekirdeğe dayanır; hızlı başlangıçtan operatör seviyesindeki kuruluma kadar.',
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
    subtitle: 'İlk kullanım hızlı, yükseltme yolu net ve mimari anlaşılır olmalı.',
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
        answer: 'Free sağlam bir başlangıç sunar: en fazla 2 bot, 20 ücretsiz istasyon, temel komutlar ve commander ile worker akışının tamamı.',
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
        key: 'workers',
        question: 'Commander ve worker’lar nasıl çalışır?',
        answer: 'Commander komutları ve worker davetlerini yönetir. Worker’lar yayınları çalıştırır. Böylece OmniFM birden fazla paralel yayını düzgünce dağıtıp kararlı tutabilir.',
      },
    ],
  },
  useCases: {
    eyebrow: 'OmniFM kimin için?',
    title: 'Her planın net bir görevi var',
    subtitle: 'Sadece fiyatlar değil: hangi plan hangi sunucuya gerçekten uyar.',
    cards: {
      free: {
        title: 'Hızlı topluluk radyosu için Free',
        desc: 'Küçük veya özel bir sunucuda 24/7 radyo istiyorsan, Free en kolay başlangıç noktasıdır.',
        fit: 'Küçük topluluklar, arkadaş grupları ve yönetim yükü olmadan ilk kurulum için ideal.',
      },
      pro: {
        title: 'Topluluk yöneticileri için Pro',
        desc: 'Etkinlikler, izinler ve panel günlük işin parçası olduğunda Pro gerçek yönetim planına dönüşür.',
        fit: 'Etkinlik sunucuları, orta büyüklükteki topluluklar ve düzenli oturumları ile net rolleri olan ekipler için ideal.',
      },
      ultimate: {
        title: 'Operatör kurulumları için Ultimate',
        desc: 'Güvenilirlik araçları, kendi istasyonlar, ayrıntılı istatistikler ve otomasyon önemliyse doğru plan Ultimate’tır.',
        fit: 'Büyük topluluklar, ileri düzey kullanıcılar ve OmniFM’in yönetilen bir sistem gibi çalışmasını isteyen operatörler için ideal.',
      },
    },
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
