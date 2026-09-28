// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Polish.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Pierwsze kroki',
  title: 'Skonfiguruj OmniFM w pięć minut',
  intro: 'Krok po kroku od zaproszenia do pierwszej piosenki, i co pomaga, gdy coś nie działa.',
  toc: 'Na tej stronie',
  steps: [
    {
      id: 'commander',
      title: '1. Zaproś commandera',
      body: 'Commander to bot „OmniFM DJ”. Przyjmuje twoje komendy i zarządza workerami. Zaprosić go może każdy, kto ma uprawnienie „Zarządzanie serwerem”.',
      tips: ['Kliknij „Zaproś commandera”, wybierz swój serwer i potwierdź przyciskiem „Autoryzuj”.', 'Zostaw proponowane uprawnienia bez zmian: bez nich OmniFM nie wejdzie na kanały głosowe.'],
    },
    {
      id: 'worker',
      title: '2. Dodaj workera',
      body: 'Dlaczego dwa boty? Commander słucha, workery grają. Dzięki temu na jednym serwerze może grać kilka kanałów głosowych naraz, każdy z własnym streamem.',
      tips: ['Wpisz /invite na kanale tekstowym.', 'Wybierz „OmniFM 1” i zaproś go przyciskiem.', 'Free ma 2 workery, Pro 8, a Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Włącz radio',
      body: 'Wejdź na kanał głosowy i wpisz /play. Podczas pisania Discord podpowiada stacje, na przykład dla „lofi”.',
      tips: ['/play lofi włącza stację lofi.', 'Bez nazwy stacji /play prowadzi cię krok po kroku.', 'OmniFM gra całą dobę, dopóki nie wpiszesz /stop.'],
    },
    {
      id: 'panel',
      title: '4. Panel i ulubione',
      body: 'Dla każdej stacji OmniFM pokazuje panel (po angielsku): co teraz gra oraz przyciski pauzy, stopu, innych stacji i twoich ulubionych.',
      tips: ['Ulubione stacje oznaczasz gwiazdką w przeglądarce stacji; potem pojawiają się jako przyciski w panelu.', '„Save” odkłada dla ciebie piosenkę, „Share” publikuje kartę na kanale.', '„Report a problem” daje nam znać, gdy stacja się zacina.'],
    },
    {
      id: 'dashboard',
      title: '5. Panel na stronie',
      body: 'Panel na stronie pokazuje, co i gdzie gra, i pozwala ustawić serwer. Logujesz się po prostu przez Discorda.',
      tips: ['Język: w jakim języku OmniFM odpowiada na twoim serwerze.', 'Voice Guard: co robi OmniFM, gdy ktoś przeniesie go na inny kanał.', 'Wydarzenia: planowanie audycji radiowych o stałych porach.'],
    },
  ],
  inviteLabel: 'Zaproś commandera',
  dashboardLink: 'Otwórz panel',
  helpTitle: 'Gdy coś nie działa',
  helpIntro: 'Najczęstsze problemy, każdy z rozwiązaniem.',
  help: [
    {
      key: 'join',
      question: 'Bot nie wchodzi na kanał głosowy',
      answer: 'Zwykle brakuje uprawnień. Prawy klik na kanał głosowy → Edytuj kanał → Uprawnienia: OmniFM potrzebuje tam „Łączenie” i „Mówienie”. Jeśli kanał jest pełny, musi być wolne miejsce.',
    },
    {
      key: 'silent',
      question: 'Nic nie słychać',
      answer: 'Najpierw sprawdź, czy na kanale głosowym jest worker; jeśli nie, zaproś go przez /invite. Jeśli jest, ale ma przekreślony mikrofon, ktoś wyciszył go na serwerze: kliknij go prawym przyciskiem i wyłącz to wyciszenie. Sprawdź też, czy nie ściszyłeś go u siebie.',
    },
    {
      key: 'station',
      question: 'Stacja nie działa',
      answer: 'Gdy stacja przestaje działać, OmniFM automatycznie gra podobną i wraca, gdy tylko znów ruszy. Jeśli stacja często się zacina, naciśnij w panelu „Report a problem”, a my się temu przyjrzymy.',
    },
    {
      key: 'commands',
      question: 'Brakuje komend',
      answer: 'Ustawienia serwera → Integracje → OmniFM DJ: tam komendy muszą być dozwolone dla twojej roli i kanału. Dopiero zaproszony? Discord może potrzebować kilku minut, by pokazać komendy; pomaga ponowne uruchomienie Discorda.',
    },
  ],
  more: 'Masz pytania? Zadaj je w naszej społeczności na Discordzie.',
  community: 'Do społeczności',
};

export default guide;
