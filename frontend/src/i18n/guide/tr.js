// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Turkish.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'İlk adımlar',
  title: 'OmniFM’i beş dakikada kur',
  intro: 'Davetten ilk şarkıya adım adım, ve bir şey çalışmadığında ne yapacağın.',
  toc: 'Bu sayfada',
  steps: [
    {
      id: 'commander',
      title: '1. Commander’ı davet et',
      body: 'Commander, “OmniFM DJ” botudur. Komutlarını alır ve worker’ları yönetir. Sunucuda “Sunucuyu Yönet” yetkisi olan herkes onu davet edebilir.',
      tips: ['“Commander’ı davet et”e tıkla, sunucunu seç ve “Yetkilendir” ile onayla.', 'Önerilen yetkileri olduğu gibi bırak: onlar olmadan OmniFM ses kanallarına giremez.'],
    },
    {
      id: 'worker',
      title: '2. Bir worker ekle',
      body: 'Neden iki bot? Commander dinler, worker’lar çalar. Böylece bir sunucuda birden fazla ses kanalı aynı anda, her biri kendi yayınıyla çalabilir.',
      tips: ['Bir metin kanalına /invite yaz.', '“OmniFM 1”i seç ve düğmeyle davet et.', 'Free’de 2, Pro’da 8, Ultimate’te 16 worker var.'],
    },
    {
      id: 'play',
      title: '3. Radyoyu başlat',
      body: 'Bir ses kanalına gir ve /play yaz. Sen yazarken Discord istasyon önerir, örneğin “lofi” için.',
      tips: ['/play lofi bir lofi istasyonu başlatır.', 'İstasyon adı olmadan /play seni adım adım yönlendirir.', 'OmniFM, sen /stop yazana kadar günün her saati çalmaya devam eder.'],
    },
    {
      id: 'panel',
      title: '4. Panel ve favoriler',
      body: 'OmniFM her istasyon için (İngilizce) bir panel gösterir: şu an ne çaldığı ve duraklatma, durdurma, başka istasyonlar ve favori istasyonların için düğmeler.',
      tips: ['Favori istasyonlarını istasyon tarayıcısında yıldızla işaretle; sonra panelde düğme olarak görünürler.', '“Save” bir şarkıyı senin için ayırır, “Share” kanala bir kart gönderir.', '“Report a problem”, bir istasyon takıldığında bize haber verir.'],
    },
    {
      id: 'dashboard',
      title: '5. Web paneli',
      body: 'Web paneli neyin nerede çaldığını gösterir ve sunucunu ayarlamanı sağlar. Discord ile giriş yapman yeterli.',
      tips: ['Dil: OmniFM’in sunucunda hangi dilde yanıt verdiği.', 'Voice Guard: biri OmniFM’i başka bir kanala taşıdığında ne yapacağı.', 'Etkinlikler: belirli saatlerde radyo yayınları planlamak.'],
    },
  ],
  inviteLabel: 'Commander’ı davet et',
  dashboardLink: 'Web paneline git',
  helpTitle: 'Bir şey çalışmadığında',
  helpIntro: 'En sık karşılaşılan sorunlar ve çözümleri.',
  help: [
    {
      key: 'join',
      question: 'Bot ses kanalına girmiyor',
      answer: 'Genellikle yetki eksiktir. Ses kanalına sağ tıkla → Kanalı Düzenle → İzinler: OmniFM’in orada “Bağlan” ve “Konuş” yetkisine ihtiyacı var. Kanal doluysa bir yer boş olmalı.',
    },
    {
      key: 'silent',
      question: 'Hiçbir şey duyulmuyor',
      answer: 'Önce ses kanalında bir worker olup olmadığına bak; yoksa /invite ile bir tane davet et. Oradaysa ama mikrofonunun üstü çiziliyse, biri onu sunucuda susturmuş: üzerine sağ tıkla ve bu susturmayı kaldır. Onu kendi tarafında kısıp kısmadığını da kontrol et.',
    },
    {
      key: 'station',
      question: 'Bir istasyon çalışmıyor',
      answer: 'Bir istasyon düşerse OmniFM otomatik olarak benzer bir istasyon çalar ve o tekrar çalışınca geri döner. Bir istasyon sık sık takılıyorsa panelde “Report a problem”a bas, biz inceleyelim.',
    },
    {
      key: 'commands',
      question: 'Komutlar görünmüyor',
      answer: 'Sunucu Ayarları → Entegrasyonlar → OmniFM DJ: komutların orada rolün ve kanal için izinli olması gerekir. Yeni mi davet ettin? Discord’un komutları göstermesi birkaç dakika sürebilir; Discord’u yeniden başlatmak yardımcı olur.',
    },
  ],
  more: 'Başka sorun mu var? Discord topluluğumuzda sor.',
  community: 'Topluluğa katıl',
};

export default guide;
