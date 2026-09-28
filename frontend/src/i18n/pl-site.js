// OmniFM website texts, Polish: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js. Numbers stand
// after a colon, so the Polish plural forms never go wrong.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Jak to działa', href: '#features' },
      { key: 'why', label: 'Dlaczego OmniFM', href: '#why-omnifm' },
      { key: 'dashboard', label: 'Panel', href: '#dashboard-showcase' },
      { key: 'stations', label: 'Stacje', page: 'stations' },
      { key: 'pricing', label: 'Cennik', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Społeczność na Discordzie',
  },
  cookieConsent: {
    title: 'Pliki cookie i statystyki',
    body: 'OmniFM używa niezbędnej pamięci dla języka, bezpieczeństwa i sesji panelu. Tag Google działa w trybie zgody; pamięć na potrzeby statystyk jest dozwolona tylko wtedy, gdy się na nią zgodzisz.',
    necessaryTitle: 'Niezbędne',
    necessaryBody: 'Potrzebne do zapamiętania języka, bezpiecznych sesji panelu i działania technicznego. Tej kategorii nie można wyłączyć.',
    analyticsTitle: 'Statystyki',
    analyticsBody: 'Pozwala Google Analytics 4 w trybie zgody ogólnie mierzyć wyświetlenia stron i korzystanie z nich. Bez zgody pamięć na potrzeby statystyk pozostaje zablokowana.',
    acceptAll: 'Akceptuj wszystkie',
    reject: 'Odrzuć',
    save: 'Zapisz wybór',
    manage: 'Ustawienia cookie',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Twoje radio',
    titleAccent: 'na Discordzie.',
    titleTail: '24/7 na żywo.',
    subtitleLead: 'Radio na Discordzie 24/7 z ponad 120 stacjami, niezawodnością dzięki workerom, sterowaniem z panelu i czystym ponownym łączeniem. Zaproś commandera, dodaj workera i użyj',
    subtitleTail: '.',
    ctaInvite: 'Zaproś commandera',
    ctaFlow: 'Jak to działa',
    stats: {
      servers: 'Serwery',
      stations: 'Stacje',
      bots: 'Boty',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Stacje',
        detail: 'Katalog na żywo dla Free i Pro, z odsłuchem prosto na stronie.',
      },
      network: {
        label: 'Aktywność na żywo',
        detail: 'Aktywne streamy i gotowa sieć botów pokazują, że OmniFM naprawdę działa w produkcji, a nie tylko na stronie głównej.',
      },
      dashboard: {
        label: 'Panel',
        detail: 'Podgląd na żywo, statystyki, uprawnienia ról i powiadomienia o awariach od Pro wzwyż.',
      },
      reliability: {
        label: 'Niezawodność',
        detail: 'Ponowne łączenie, jasne plany i prosta droga rozwoju dla rosnących serwerów.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `boty: ${bots} · serwery: ${servers}`,
      dashboard: 'Wydarzenia · uprawnienia · stan',
      reliability: 'Ponowne łączenie · workery · jasne plany',
    },
  },
  whyOmniFM: {
    eyebrow: 'Dlaczego OmniFM',
    title: 'Nie tylko bot radiowy, ale porządnie zorganizowana instalacja na Discordzie',
    subtitle: 'OmniFM jest najmocniejszy, gdy muzyka, niezawodność i zarządzanie serwerem działają razem.',
    cards: {
      radio: {
        title: 'Szybki start',
        desc: 'Zaproś commandera, dodaj workera, użyj /play i od razu słuchaj. Bez ciężkiej konfiguracji na start.',
      },
      workers: {
        title: 'Więcej niż jeden bot',
        desc: 'Architektura workerów porządnie rozkłada streamy i sprawia, że równoległe korzystanie w dużych społecznościach jest przewidywalne.',
      },
      control: {
        title: 'Kontrola dla adminów',
        desc: 'Panel, wydarzenia, uprawnienia ról i widoki stanu dają serwerom Pro prawdziwą kontrolę, a nie tylko więcej stacji.',
      },
      growth: {
        title: 'Rozwój bez tarcia',
        desc: 'Free, Pro i Ultimate opierają się na tym samym rdzeniu, od szybkiego startu po instalację na poziomie operatora.',
      },
    },
  },
  dashboardShowcase: {
    eyebrow: 'Panel i obsługa',
    title: 'Pro i Ultimate dają prawdziwą kontrolę nad serwerem',
    subtitle: 'OmniFM to nie tylko bot, który uruchamia streamy. Panel zmienia go w system, którym da się zarządzać: wydarzenia, uprawnienia, stan, statystyki i automatyzacja.',
    cards: {
      events: {
        title: 'Planer wydarzeń',
        desc: 'Planuj automatyczne starty dla cyklicznych sesji, wieczorów społeczności albo stałych muzycznych pasm.',
      },
      permissions: {
        title: 'Uprawnienia ról dla komend',
        desc: 'Ustal dokładnie, kto może używać /event, /perm i innych wrażliwych komend na twoim serwerze.',
      },
      health: {
        title: 'Stan i statystyki',
        desc: 'Śledź stan serwera, kluczowe liczby, a w Ultimate także dokładniejsze statystyki.',
      },
      automation: {
        title: 'Własne stacje i webhooki',
        desc: 'Ultimate rozszerza OmniFM dla zaawansowanych o własne stacje, eksporty i webhooki do automatyzacji.',
      },
    },
    primaryCta: 'Otwórz panel',
    secondaryCta: 'Porównaj plany',
    ctaNote: 'Każdy serwer ma podstawy. Wyższy plan dodaje kontrolę, a nie drugi produkt.',
  },
  stations: {
    eyebrow: 'Katalog stacji na żywo',
    title: 'Stacje OmniFM',
    summary: ({ count, free, pro, ultimate }) => `Stacje: ${count} (${free} free, ${pro} pro, ${ultimate} ultimate). Kliknij, aby posłuchać, albo użyj /play na Discordzie.`,
    nowPlaying: 'Gra podgląd',
    searchPlaceholder: 'Szukaj stacji...',
    filters: {
      all: 'Wszystkie',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `Stacje: ${count} (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Wczytywanie stacji...',
    empty: 'Nie znaleziono stacji.',
    loadMore: ({ remaining }) => `Pokaż więcej (pozostało: ${remaining})`,
    visible: ({ visible, total }) => `Widoczne stacje: ${visible} z ${total}`,
    previewVolume: 'Głośność',
    stopPreview: 'Zatrzymaj podgląd',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Najważniejsze pytania przed startem',
    subtitle: 'Pierwsze uruchomienie ma być szybkie, droga do wyższego planu jasna, a architektura zrozumiała.',
    items: [
      {
        key: 'start',
        question: 'Jak najprościej zacząć z OmniFM?',
        answer: 'Zwykle w niecałą minutę: zaproś commandera, dodaj co najmniej jednego workera, wejdź na kanał głosowy, a potem użyj /play i wybierz stację.',
      },
      {
        key: 'workerRequired',
        question: 'Czy przed /play potrzebuję workera?',
        answer: 'Tak. Commander przyjmuje komendy, ale sam stream idzie przez workera. /play działa poprawnie dopiero wtedy, gdy na serwerze jest worker.',
      },
      {
        key: 'free',
        question: 'Co obejmuje plan Free?',
        answer: 'Free to mocny start: do 2 botów, 20 darmowych stacji, podstawowe komendy i cały przebieg commander plus worker.',
      },
      {
        key: 'dashboard',
        question: 'Czy od razu potrzebuję panelu?',
        answer: 'Nie, wszystko działa też na Discordzie. W Free panel pokazuje, co gdzie gra, zmienia lub zatrzymuje stację, ustawia język i planuje jedno wydarzenie. Pro dodaje podgląd na żywo, statystyki, nieograniczone wydarzenia, uprawnienia ról i powiadomienia o awariach.',
      },
      {
        key: 'pro',
        question: 'Kiedy opłaca się Pro?',
        answer: 'Gdy chcesz kształtować serwer i nim zarządzać: wszystkie stacje z katalogu, 8 kanałów głosowych naraz, panel z podglądem na żywo, nieograniczone wydarzenia, uprawnienia ról i powiadomienia o awariach na Discordzie.',
      },
      {
        key: 'ultimate',
        question: 'Kiedy potrzebuję Ultimate?',
        answer: 'Gdy prowadzisz własne radio: do 50 własnych stacji z logo, własny wygląd bota na każdym serwerze, własne łańcuchy stacji zastępczych, webhooki i szczegółowe statystyki, a do tego 16 kanałów głosowych naraz.',
      },
      {
        key: 'workers',
        question: 'Jak działają commander i workery?',
        answer: 'Commander obsługuje komendy i zaproszenia workerów. Workery nadają streamy. Dzięki temu OmniFM może porządnie rozdzielić kilka streamów równolegle i utrzymać je stabilnie.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Dla kogo jest OmniFM?',
    title: 'Każdy plan ma jasne zadanie',
    subtitle: 'Nie tylko ceny: który plan naprawdę pasuje do jakiego serwera.',
    cards: {
      free: {
        title: 'Free do szybkiego radia społeczności',
        desc: 'Jeśli chcesz radia 24/7 na małym lub prywatnym serwerze, Free to najprostszy możliwy start.',
        fit: 'Idealny dla mniejszych społeczności, grup znajomych i pierwszej instalacji bez administracyjnego narzutu.',
      },
      pro: {
        title: 'Pro dla adminów społeczności',
        desc: 'Gdy wydarzenia, uprawnienia i panel stają się codziennością, Pro jest prawdziwym planem do zarządzania.',
        fit: 'Idealny dla serwerów z wydarzeniami, średnich społeczności i zespołów z regularnymi sesjami i jasnymi rolami.',
      },
      ultimate: {
        title: 'Ultimate dla instalacji operatorskich',
        desc: 'Gdy liczą się narzędzia niezawodności, własne stacje, szczegółowe statystyki i automatyzacja, Ultimate jest właściwym planem.',
        fit: 'Idealny dla dużych społeczności, zaawansowanych użytkowników i operatorów, którzy chcą, by OmniFM działał jak zarządzany system.',
      },
    },
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Prosto na Discordzie',
    titleLead: 'Gra na twoim ',
    titleAccent: 'kanale głosowym',
    titleTail: ', sterowane komendami ukośnika.',
    body: 'Bez odtwarzacza w przeglądarce, bez odtwarzania na stronie. OmniFM nadaje 24/7 prosto na twój kanał głosowy na Discordzie — z czytelnymi wiadomościami Now Playing, przyciskami i ponownym łączeniem.',
    cmds: [
      ['/play synthwave', 'Uruchamia stream na twoim kanale głosowym'],
      ['/now', 'Pokazuje utwór na żywo, okładkę i słuchaczy'],
      ['/stations', 'Przeglądaj ponad 120 wybranych stacji'],
    ],
    nowPlaying: 'Now Playing', genre: 'Gatunek', bitrate: 'Bitrate', listeners: 'Słuchacze',
    liveStream: 'Radio na żywo', liveRadio: 'Radio na żywo',
    time: 'dziś o 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Poradnik · w mniej niż 60 sekund',
    title: 'Jak uruchomić OmniFM na Discordzie',
    subtitle: 'Bez odtwarzacza w przeglądarce. Trzy kroki i twoje radio gra 24/7 prosto na kanale głosowym.',
    steps: [
      { n: '01', cmd: 'Dodaj aplikację', title: 'Zaproś commandera', desc: 'Dodaj commandera OmniFM do swojego serwera. Obsługuje wszystkie komendy ukośnika i zarządza twoimi workerami.' },
      { n: '02', cmd: '/invite', title: 'Dodaj bota workera', desc: 'Zaproś co najmniej jednego workera. To on niesie stream głosowy — więcej workerów = więcej kanałów naraz.' },
      { n: '03', cmd: '/play lofi', title: 'Uruchom radio', desc: 'Wybierz stację, a OmniFM dołączy do twojego kanału głosowego. Wiadomość Now Playing, przyciski i ponowne łączenie w zestawie.' },
    ],
    permsTitle: 'Uprawnienia',
    perms: ['Dołączanie do głosowych i mówienie', 'Wysyłanie wiadomości i embedów', 'Używanie komend ukośnika'],
    addServer: 'Dodaj do serwera',
    workerHint: 'Worker gotowy',
    invite: 'Zaproś',
    connected: 'połączony',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
