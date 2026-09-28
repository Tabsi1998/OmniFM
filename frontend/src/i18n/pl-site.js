// OmniFM website texts, Polish: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js. Numbers stand
// after a colon, so the Polish plural forms never go wrong.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Jak to działa', href: '#features' },
      { key: 'why', label: 'Dlaczego OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'Stacje', page: 'stations' },
      { key: 'pricing', label: 'Cennik', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Społeczność na Discordzie',
  },
  cookieConsent: {
    title: 'Pliki cookie i statystyki',
    short: 'Zapisujemy tylko to, czego strona potrzebuje (język, logowanie). Google Analytics zapisuje pliki cookie dopiero po twojej zgodzie.',
    privacyLink: 'Prywatność',
    necessaryTitle: 'Niezbędne',
    necessaryBody: 'Dla twojego języka, bezpiecznego logowania do panelu i działania strony. Nie można ich wyłączyć.',
    analyticsTitle: 'Statystyki (Google Analytics)',
    analyticsBody: 'Z grubsza liczy, które strony są odwiedzane, żebyśmy mogli ulepszać stronę. Bez twojej zgody Google Analytics nie zapisuje plików cookie.',
    acceptAll: 'Akceptuj wszystkie',
    reject: 'Odrzuć',
    settings: 'Ustawienia',
    save: 'Zapisz wybór',
    manage: 'Ustawienia cookie',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Twoje radio',
    titleAccent: 'na Discordzie.',
    titleTail: '24/7 na żywo.',
    subtitleLead: 'Radio przez całą dobę na twoim kanale głosowym na Discordzie: stacje z każdego gatunku, panel do sterowania, a gdy stream się urwie, OmniFM sam połączy się ponownie. Zaproś commandera, dodaj workera i użyj',
    subtitleTail: '.',
    ctaInvite: 'Zaproś commandera',
    ctaFlow: 'Jak to działa',
  },
  trustBar: {
    live: 'Liczby na żywo',
    items: {
      servers: { label: 'Serwery', detail: 'korzystają z OmniFM' },
      stations: { label: 'Stacje', detail: 'do słuchania, także tutaj' },
      bots: { label: 'Boty', detail: 'gotowe do grania' },
      listeners: { label: 'Słucha teraz', detail: 'na wszystkich serwerach' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Dlaczego OmniFM',
    title: 'Więcej niż bot radiowy',
    subtitle: 'Muzyka, która gra bez przerw, i wszystko, czego potrzebujesz do zarządzania serwerem.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Szybki start',
        desc: 'Zaproś commandera, dodaj workera, użyj /play i od razu słuchaj. Bez ciężkiej konfiguracji na start.',
      },
      workers: {
        label: 'Workery',
        title: 'Więcej niż jeden bot',
        desc: 'Kilka botów dzieli się pracą: każdy worker gra na własnym kanale głosowym, więc na dużym serwerze może lecieć kilka stacji naraz.',
      },
      control: {
        label: 'Kontrola',
        title: 'Kontrola dla adminów',
        desc: 'Panel pokazuje, co i gdzie gra, ustawia język i planuje wydarzenia. Pro dodaje widok na żywo, statystyki, uprawnienia ról i powiadomienia o awariach.',
      },
      growth: {
        label: 'Rozwój',
        title: 'Rozwój bez tarcia',
        desc: 'Free, Pro i Ultimate opierają się na sobie: po przejściu na wyższy plan wszystko zostaje ustawione, a ty dostajesz po prostu więcej.',
      },
    },
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
    subtitle: 'Krótko: jak zacząć, co dają plany i jak działa OmniFM.',
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
        answer: 'Free wystarczy na start: do 2 botów, 20 stacji i wszystkie komendy potrzebne do słuchania radia.',
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
        key: 'planStatus',
        question: 'Jak sprawdzić, jaki plan ma mój serwer?',
        answer: 'W panelu: zaloguj się przez Discorda, wybierz swój serwer i otwórz „Subskrypcja i licencja”. Zobaczysz tam plan i to, jak długo jest ważny. Na Discordzie pokaże go też komenda /premium.',
        link: { label: 'Przejdź do panelu', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'Jak działają commander i workery?',
        answer: 'Commander przyjmuje twoje komendy; /invite daje ci linki do workerów. Workery grają radio na kanałach głosowych. Dzięki temu jeden serwer może słuchać kilku stacji naraz.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Prosto na Discordzie',
    titleLead: 'Gra na twoim ',
    titleAccent: 'kanale głosowym',
    titleTail: ', sterowane komendami ukośnika.',
    body: 'Na stronie tylko posłuchasz próbki – OmniFM gra 24/7 prosto na twoim kanale głosowym na Discordzie, z panelem Now Playing, przyciskami i automatycznym ponownym łączeniem.',
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
    subtitle: 'Trzy kroki i twoje radio gra 24/7 prosto na kanale głosowym.',
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
