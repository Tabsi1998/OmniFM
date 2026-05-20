/* === OmniFM - Frontend v4.0 === */

var BOT_COLORS = [
  { name: 'cyan',   accent: '#00F0FF', glow: 'rgba(0,240,255,0.15)',  border: 'rgba(0,240,255,0.25)' },
  { name: 'green',  accent: '#39FF14', glow: 'rgba(57,255,20,0.15)',  border: 'rgba(57,255,20,0.25)' },
  { name: 'pink',   accent: '#EC4899', glow: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.25)' },
  { name: 'amber',  accent: '#FFB800', glow: 'rgba(255,184,0,0.15)',  border: 'rgba(255,184,0,0.25)' },
  { name: 'purple', accent: '#BD00FF', glow: 'rgba(189,0,255,0.15)',  border: 'rgba(189,0,255,0.25)' },
  { name: 'red',    accent: '#FF2A2A', glow: 'rgba(255,42,42,0.15)',  border: 'rgba(255,42,42,0.25)' },
];

var STATION_COLORS = ['#00F0FF', '#39FF14', '#EC4899', '#FFB800', '#BD00FF', '#FF2A2A'];
var BOT_IMAGES = ['/img/bot-1.png', '/img/bot-2.png', '/img/bot-3.png', '/img/bot-4.png'];

function detectAppLanguage() {
  var queryLang = '';
  try {
    var params = new URLSearchParams(window.location.search || '');
    queryLang = String(params.get('lang') || '').toLowerCase();
  } catch (_) {}

  if (queryLang === 'de' || queryLang === 'en') {
    try { localStorage.setItem('omnifm_lang', queryLang); } catch (_) {}
    return queryLang;
  }

  try {
    var stored = String(localStorage.getItem('omnifm_lang') || '').toLowerCase();
    if (stored === 'de' || stored === 'en') return stored;
  } catch (_) {}

  var browserLang = String(navigator.language || navigator.userLanguage || '').toLowerCase();
  if (browserLang.indexOf('de') === 0) return 'de';
  return 'en';
}

var APP_LANG = detectAppLanguage();
var APP_IS_DE = APP_LANG === 'de';
var APP_LOCALE = APP_IS_DE ? 'de-DE' : 'en-US';
document.documentElement.lang = APP_LANG;

function sanitizeOfferCodeInput(rawCode) {
  return String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}

var CHECKOUT_QUERY_PREFILL = (function() {
  try {
    var params = new URLSearchParams(window.location.search || '');
    return {
      couponCode: sanitizeOfferCodeInput(params.get('coupon') || params.get('code') || ''),
      referralCode: sanitizeOfferCodeInput(params.get('ref') || params.get('referral') || ''),
    };
  } catch (_) {
    return { couponCode: '', referralCode: '' };
  }
})();

function tr(deText, enText) {
  return APP_IS_DE ? deText : enText;
}

var COMMANDS_DE = [
  { name: '/help',          args: '',                     desc: 'Zeigt alle Commands und Erklaerungen direkt im Bot' },
  { name: '/play',          args: '[station] [voice]',   desc: 'Startet einen Radio-Stream im Voice/Stage-Channel' },
  { name: '/pause',         args: '',                     desc: 'Pausiert die aktuelle Wiedergabe' },
  { name: '/resume',        args: '',                     desc: 'Setzt die Wiedergabe fort' },
  { name: '/stop',          args: '',                     desc: 'Stoppt die Wiedergabe und verlaesst den Channel' },
  { name: '/stations',      args: '',                     desc: 'Zeigt alle verfuegbaren Radio-Stationen (nach Tier gefiltert)' },
  { name: '/list',          args: '[page]',               desc: 'Listet Stationen paginiert auf' },
  { name: '/now',           args: '',                     desc: 'Zeigt die aktuelle Station und Metadaten' },
  { name: '/history',       args: '[limit]',              desc: 'Zeigt die zuletzt erkannten Songs im Server' },
  { name: '/setvolume',     args: '<0-100>',              desc: 'Setzt die Lautstaerke' },
  { name: '/status',        args: '',                     desc: 'Zeigt Bot-Status, Uptime und Last' },
  { name: '/health',        args: '',                     desc: 'Zeigt Stream-Health und Reconnect-Info' },
  { name: '/diag',          args: '',                     desc: 'Zeigt ffmpeg/Audio-Diagnose fuer Troubleshooting' },
  { name: '/premium',       args: '',                     desc: 'Zeigt den Premium-Status dieses Servers' },
  { name: '/language',      args: '<show|set|reset>',    desc: 'Stellt die Bot-Sprache (DE/EN) fuer den Server ein' },
  { name: '/addstation',    args: '<key> <name> <url>',   desc: '[Ultimate] Eigene Station hinzufuegen' },
  { name: '/removestation', args: '<key>',                desc: '[Ultimate] Eigene Station entfernen' },
  { name: '/mystations',    args: '',                     desc: '[Ultimate] Zeigt deine Custom-Stationen' },
  { name: '/event',         args: '<create|list|delete>', desc: '[Pro] Plant Auto-Starts mit Wiederholung und Zeitzone' },
  { name: '/license',       args: '<activate|info|remove>', desc: 'Lizenz verwalten: aktivieren, anzeigen oder entfernen' },
  { name: '/perm',          args: '<allow|deny|remove|list|reset>', desc: '[Pro] Rollenrechte fuer Commands verwalten' },
];

var COMMANDS_EN = [
  { name: '/help',          args: '',                     desc: 'Shows all commands and explanations in Discord' },
  { name: '/play',          args: '[station] [voice]',   desc: 'Starts a radio stream in a voice/stage channel' },
  { name: '/pause',         args: '',                     desc: 'Pauses current playback' },
  { name: '/resume',        args: '',                     desc: 'Resumes playback' },
  { name: '/stop',          args: '',                     desc: 'Stops playback and leaves the channel' },
  { name: '/stations',      args: '',                     desc: 'Shows all available stations (tier-filtered)' },
  { name: '/list',          args: '[page]',               desc: 'Lists stations with pagination' },
  { name: '/now',           args: '',                     desc: 'Shows current station and metadata' },
  { name: '/history',       args: '[limit]',              desc: 'Shows recently detected songs for this server' },
  { name: '/setvolume',     args: '<0-100>',              desc: 'Sets playback volume' },
  { name: '/status',        args: '',                     desc: 'Shows bot status, uptime, and load' },
  { name: '/health',        args: '',                     desc: 'Shows stream health and reconnect info' },
  { name: '/diag',          args: '',                     desc: 'Shows ffmpeg/audio diagnostics' },
  { name: '/premium',       args: '',                     desc: 'Shows premium status for this server' },
  { name: '/language',      args: '<show|set|reset>',    desc: 'Sets bot language (DE/EN) for the server' },
  { name: '/addstation',    args: '<key> <name> <url>',   desc: '[Ultimate] Adds a custom station' },
  { name: '/removestation', args: '<key>',                desc: '[Ultimate] Removes a custom station' },
  { name: '/mystations',    args: '',                     desc: '[Ultimate] Lists your custom stations' },
  { name: '/event',         args: '<create|list|delete>', desc: '[Pro] Schedules auto-starts with recurrence and time zone' },
  { name: '/license',       args: '<activate|info|remove>', desc: 'Manage license: activate, view, or remove' },
  { name: '/perm',          args: '<allow|deny|remove|list|reset>', desc: '[Pro] Manage role permissions for commands' },
];

var COMMANDS = APP_IS_DE ? COMMANDS_DE : COMMANDS_EN;

var fmt = new Intl.NumberFormat(APP_LOCALE);
function fmtInt(v) { return fmt.format(Number(v) || 0); }
function fmtDec2(v) {
  var value = Number(v || 0);
  if (!Number.isFinite(value)) value = 0;
  var raw = value.toFixed(2);
  return APP_IS_DE ? raw.replace('.', ',') : raw;
}
function formatEuroFromCents(cents) {
  var amount = fmtDec2((Number(cents || 0) / 100));
  return APP_IS_DE ? amount + '\u20ac' : '\u20ac' + amount;
}
function formatEuroFromValue(value) {
  var amount = fmtDec2(Number(value || 0));
  return APP_IS_DE ? amount + '\u20ac' : '\u20ac' + amount;
}
function monthWord(count) {
  return APP_IS_DE
    ? ('Monat' + (count > 1 ? 'e' : ''))
    : ('month' + (count > 1 ? 's' : ''));
}
function serverWord(count) {
  if (APP_IS_DE) return 'Server';
  return count === 1 ? 'server' : 'servers';
}

var allStations = [];
var currentTierFilter = 'all';

function setTierFilter(tier) {
  currentTierFilter = tier;
  stationsDisplayCount = STATIONS_PER_PAGE;
  var buttons = document.querySelectorAll('#tierFilter button');
  buttons.forEach(function(btn) {
    var t = btn.getAttribute('data-tier');
    var isActive = t === tier;
    btn.style.background = isActive ? (
      t === 'free' ? 'rgba(57,255,20,0.12)' :
      t === 'pro' ? 'rgba(255,184,0,0.12)' :
      'rgba(255,255,255,0.08)'
    ) : 'transparent';
    btn.style.borderColor = isActive ? (
      t === 'free' ? 'rgba(57,255,20,0.5)' :
      t === 'pro' ? 'rgba(255,184,0,0.5)' :
      'rgba(255,255,255,0.3)'
    ) : (
      t === 'free' ? 'rgba(57,255,20,0.2)' :
      t === 'pro' ? 'rgba(255,184,0,0.2)' :
      'rgba(255,255,255,0.15)'
    );
  });
  filterStations(document.getElementById('stationSearch').value);
}

// --- Navbar scroll + mobile toggle ---
window.addEventListener('scroll', function() {
  var nav = document.getElementById('navbar');
  if (window.scrollY > 40) { nav.classList.add('scrolled'); }
  else { nav.classList.remove('scrolled'); }
});

(function initMobileNav() {
  var toggle = document.getElementById('navToggle');
  var mobile = document.getElementById('navMobile');
  var icon = document.getElementById('navIcon');
  var isOpen = false;

  toggle.addEventListener('click', function() {
    isOpen = !isOpen;
    if (isOpen) {
      mobile.classList.add('open');
      mobile.style.display = '';
    } else {
      mobile.classList.remove('open');
    }
    icon.innerHTML = isOpen
      ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
      : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
  });

  mobile.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      isOpen = false;
      mobile.classList.remove('open');
      icon.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
    });
  });
})();

function setTrailingText(el, text) {
  if (!el) return;
  for (var i = el.childNodes.length - 1; i >= 0; i--) {
    var node = el.childNodes[i];
    if (node && node.nodeType === 3 && String(node.nodeValue || '').trim()) {
      node.nodeValue = ' ' + text;
      return;
    }
  }
  el.appendChild(document.createTextNode(' ' + text));
}

function applyStaticEnglishTranslations() {
  if (APP_IS_DE) return;

  var metaDesc = document.querySelector('meta[name=\"description\"]');
  if (metaDesc) {
    metaDesc.setAttribute('content', 'OmniFM - 24/7 radio streams for your Discord server');
  }

  var navLinks = document.querySelectorAll('#navLinks a');
  if (navLinks[0]) navLinks[0].textContent = 'Bots';
  if (navLinks[1]) navLinks[1].textContent = 'Features';
  if (navLinks[2]) navLinks[2].textContent = 'Stations';
  if (navLinks[3]) navLinks[3].textContent = 'Commands';
  if (navLinks[4]) navLinks[4].textContent = 'Premium';

  var navMobile = document.querySelectorAll('#navMobile a');
  if (navMobile[0]) navMobile[0].textContent = 'Bots';
  if (navMobile[1]) navMobile[1].textContent = 'Features';
  if (navMobile[2]) navMobile[2].textContent = 'Stations';
  if (navMobile[3]) navMobile[3].textContent = 'Commands';
  if (navMobile[4]) navMobile[4].textContent = 'Premium';
  if (navMobile[5]) navMobile[5].innerHTML = navMobile[5].innerHTML.replace('Discord Community', 'Discord Community');

  var heroTitle = document.querySelector('.hero-title');
  if (heroTitle) heroTitle.innerHTML = 'Turn the <span class=\"glow-cyan\">volume</span> up';

  var heroSub = document.querySelector('.hero-sub');
  if (heroSub) heroSub.textContent = '24/7 streaming for your Discord server. Pick a station, invite the bot, and enjoy nonstop music.';

  var heroActions = document.querySelectorAll('.hero-actions a');
  if (heroActions[0]) setTrailingText(heroActions[0], 'Invite bot');
  if (heroActions[1]) setTrailingText(heroActions[1], 'Browse stations');

  var heroStatLabels = document.querySelectorAll('#heroStats .stat-label');
  if (heroStatLabels[0]) heroStatLabels[0].textContent = 'SERVERS';
  if (heroStatLabels[1]) heroStatLabels[1].textContent = 'STATIONS';
  if (heroStatLabels[2]) heroStatLabels[2].textContent = 'BOTS';

  var botsEyebrow = document.querySelector('#bots .section-eyebrow');
  if (botsEyebrow) botsEyebrow.textContent = 'Choose your frequency';
  var botsTitle = document.querySelector('#bots .section-title');
  if (botsTitle) botsTitle.textContent = 'Our OmniFM Bots';
  var botsSub = document.querySelector('#bots .section-sub');
  if (botsSub) botsSub.textContent = 'Each bot is an independent worker. Invite as many as you want for maximum coverage.';
  var botGridMuted = document.querySelector('#botGrid .muted');
  if (botGridMuted && botGridMuted.textContent.indexOf('Lade') !== -1) botGridMuted.textContent = 'Loading bots...';

  var featuresEyebrow = document.querySelector('#features .section-eyebrow');
  if (featuresEyebrow) featuresEyebrow.textContent = 'Why OmniFM?';
  var featuresTitle = document.querySelector('#features .section-title');
  if (featuresTitle) featuresTitle.textContent = 'Built for quality';
  var featureTitles = document.querySelectorAll('#features .feature-card h3');
  var featureTexts = document.querySelectorAll('#features .feature-card p');
  var featureTitleMap = ['24/7 streaming', 'Multi-bot system', 'Ready instantly', 'HQ audio', 'Auto reconnect', 'Unlimited scaling'];
  var featureTextMap = [
    'Nonstop radio around the clock. Your server never sleeps.',
    'Up to 20 bots in parallel. Every bot can play in its own channel.',
    'Slash commands. No prefix needed. Just /play and go.',
    'Opus transcoding with configurable bitrate for crystal clear sound.',
    'If the connection drops, the bot reconnects automatically.',
    'Add as many bots as you need. Every bot runs independently and stable.'
  ];
  featureTitles.forEach(function(el, i) { if (featureTitleMap[i]) el.textContent = featureTitleMap[i]; });
  featureTexts.forEach(function(el, i) { if (featureTextMap[i]) el.textContent = featureTextMap[i]; });

  var stationsEyebrow = document.querySelector('#stations .section-eyebrow');
  if (stationsEyebrow) stationsEyebrow.textContent = 'Live station directory';
  var stationsTitle = document.querySelector('#stations .section-title');
  if (stationsTitle) stationsTitle.textContent = 'OmniFM Stations';
  var stationCount = document.getElementById('stationCount');
  if (stationCount && stationCount.textContent.indexOf('Lade') !== -1) stationCount.textContent = 'Loading stations...';
  var stationListMuted = document.querySelector('#stationList .muted');
  if (stationListMuted && stationListMuted.textContent.indexOf('Lade') !== -1) stationListMuted.textContent = 'Loading stations...';

  var stationSearch = document.getElementById('stationSearch');
  if (stationSearch) stationSearch.placeholder = 'Search station...';
  var allBtn = document.querySelector('#tierFilter [data-tier=\"all\"]');
  if (allBtn) allBtn.textContent = 'ALL';

  var commandsEyebrow = document.querySelector('#commands .section-eyebrow');
  if (commandsEyebrow) commandsEyebrow.textContent = 'Slash commands';
  var commandsTitle = document.querySelector('#commands .section-title');
  if (commandsTitle) commandsTitle.textContent = 'Control';

  var premiumEyebrow = document.querySelector('#premium .section-eyebrow');
  if (premiumEyebrow) premiumEyebrow.textContent = 'Premium';
  var premiumTitle = document.querySelector('#premium .section-title');
  if (premiumTitle) premiumTitle.textContent = 'Upgrade your experience';
  var premiumSub = document.querySelector('#premium .section-sub');
  if (premiumSub) premiumSub.textContent = 'More quality, exclusive features, and priority support.';
  var premiumPeriods = document.querySelectorAll('.premium-period');
  premiumPeriods.forEach(function(p) { p.textContent = '/month'; });
  var premiumAmounts = document.querySelectorAll('.premium-amount');
  if (premiumAmounts[1]) premiumAmounts[1].innerHTML = 'from 2.99&euro;';
  if (premiumAmounts[2]) premiumAmounts[2].innerHTML = 'from 4.99&euro;';

  var freeBtn = document.querySelector('.free-btn');
  if (freeBtn) freeBtn.textContent = 'Get started';
  var proBtn = document.querySelector('.pro-btn');
  if (proBtn) proBtn.textContent = 'Upgrade to Pro';
  var ultimateBtn = document.querySelector('.ultimate-btn');
  if (ultimateBtn) ultimateBtn.textContent = 'Upgrade to Ultimate';
  var freeFeatures = document.querySelectorAll('.premium-card:nth-child(1) .premium-features li');
  var proFeatures = document.querySelectorAll('.premium-card:nth-child(2) .premium-features li');
  var ultimateFeatures = document.querySelectorAll('.premium-card:nth-child(3) .premium-features li');
  var freeMap = [
    'Up to 2 bots',
    '20 free stations',
    'Standard audio (64k)',
    'Auto reconnect (5s)',
    'Premium stations',
    'Custom station URLs'
  ];
  var proMap = [
    'Up to 8 bots',
    '20 free + 100 pro stations',
    'HQ audio (128k Opus)',
    'Priority reconnect (1.5s)',
    'Server license (1/2/3/5 servers)',
    'Email support + invoice',
    'Custom station URLs'
  ];
  var ultimateMap = [
    'Up to 16 bots',
    'All stations + custom URLs',
    'Ultra HQ audio (320k)',
    'Instant reconnect (0.4s)',
    'Server license bundles (1/2/3/5)',
    'Custom station URLs (50 per server)',
    'Priority Discord support + invoice'
  ];
  freeFeatures.forEach(function(li, i) { if (freeMap[i]) setTrailingText(li, freeMap[i]); });
  proFeatures.forEach(function(li, i) { if (proMap[i]) setTrailingText(li, proMap[i]); });
  ultimateFeatures.forEach(function(li, i) { if (ultimateMap[i]) setTrailingText(li, ultimateMap[i]); });

  var infoHeaders = document.querySelectorAll('.premium-info-card h4');
  if (infoHeaders[0]) infoHeaders[0].textContent = 'Server license bundles';
  if (infoHeaders[1]) infoHeaders[1].textContent = 'Seat-based licensing';
  if (infoHeaders[2]) infoHeaders[2].textContent = 'Yearly discount';
  var infoTableHeaders = document.querySelectorAll('.premium-info-card th');
  if (infoTableHeaders[0]) infoTableHeaders[0].textContent = 'Servers';
  if (infoTableHeaders[1]) infoTableHeaders[1].textContent = 'Pro/mo';
  if (infoTableHeaders[2]) infoTableHeaders[2].textContent = 'Ultimate/mo';
  var infoTableRows = document.querySelectorAll('.premium-info-card tbody tr td:first-child');
  if (infoTableRows[0]) infoTableRows[0].textContent = '1 server';
  if (infoTableRows[1]) infoTableRows[1].textContent = '2 servers';
  if (infoTableRows[2]) infoTableRows[2].textContent = '3 servers';
  if (infoTableRows[3]) infoTableRows[3].textContent = '5 servers';

  var infoParagraphs = document.querySelectorAll('.premium-info-card p');
  if (infoParagraphs[0]) infoParagraphs[0].textContent = 'Each license covers a fixed number of servers. Link and unlink servers flexibly in your dashboard.';
  if (infoParagraphs[1]) infoParagraphs[1].innerHTML = 'Pay for 12 months and only pay for 10. <strong style=\"color:#39FF14\">2 months free</strong> with yearly billing.';

  var checkHeading = document.querySelector('#premium h3');
  if (checkHeading) checkHeading.textContent = 'Check premium status';
  var checkInput = document.getElementById('premiumCheckInput');
  if (checkInput) checkInput.placeholder = 'Enter Discord server ID...';
  var checkButton = document.querySelector('#premium button[onclick=\"checkPremiumStatus()\"]');
  if (checkButton) checkButton.textContent = 'Check';

  var supportBannerSpan = document.querySelector('#premium span a[href=\"https://discord.gg/UeRkfGS43R\"]') ?
    document.querySelector('#premium span a[href=\"https://discord.gg/UeRkfGS43R\"]').parentElement :
    null;
  if (supportBannerSpan && supportBannerSpan.tagName === 'SPAN') {
    supportBannerSpan.innerHTML = 'Questions about your plan or issues? '
      + '<a href=\"https://discord.gg/UeRkfGS43R\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"color:#5865F2;font-weight:700;text-decoration:none\">Join our Discord</a>'
      + ' or '
      + '<a href=\"mailto:contact@omnifm.xyz\" style=\"color:#39FF14;font-weight:700;text-decoration:none\">email us</a>';
  }

  var premiumModal = document.getElementById('premiumModal');
  if (premiumModal) {
    var emailInput = document.getElementById('premiumEmail');
    if (emailInput) {
      var emailBlock = emailInput.parentElement;
      var emailLabel = emailBlock ? emailBlock.querySelector('div') : null;
      var emailHint = emailBlock ? emailBlock.querySelector('p') : null;
      if (emailLabel) emailLabel.textContent = 'EMAIL ADDRESS';
      if (emailHint) emailHint.textContent = 'Your license key and invoice will be sent to this address.';
      emailInput.placeholder = 'you@example.com';
    }

    var couponInput = document.getElementById('premiumCouponCode');
    if (couponInput) {
      var couponBlock = couponInput.parentElement;
      var couponLabel = couponBlock ? couponBlock.querySelector('div') : null;
      if (couponLabel) couponLabel.textContent = 'DISCOUNT CODE (OPTIONAL)';
      couponInput.placeholder = 'e.g. PRO10';
    }

    var referralInput = document.getElementById('premiumReferralCode');
    if (referralInput) {
      var referralBlock = referralInput.parentElement;
      var referralLabel = referralBlock ? referralBlock.querySelector('div') : null;
      var referralHint = referralBlock ? referralBlock.querySelector('p') : null;
      if (referralLabel) referralLabel.textContent = 'REFERRAL CODE (OPTIONAL)';
      if (referralHint) referralHint.textContent = 'Referral links can prefill this code automatically.';
      referralInput.placeholder = 'e.g. CREATOR10';
    }

    var seatRow = document.getElementById('seatSelectorRow');
    if (seatRow) {
      var seatLabel = seatRow.querySelector('div');
      var seatHint = seatRow.querySelector('p');
      if (seatLabel) seatLabel.textContent = 'NUMBER OF SERVERS';
      if (seatHint) seatHint.textContent = 'License multiple servers with one subscription - the more servers, the lower the price per server.';
    }

    var monthsRow = document.getElementById('premiumMonthsRow');
    if (monthsRow) {
      var monthsLabel = monthsRow.querySelector('div');
      if (monthsLabel) monthsLabel.textContent = 'BILLING PERIOD';
    }

    var upgradeText = document.getElementById('premiumUpgradeText');
    if (upgradeText) upgradeText.textContent = 'Upgrade path detected for this account.';
    var upgradeTitle = premiumModal.querySelector('#premiumUpgradeBadge div div');
    if (upgradeTitle) upgradeTitle.textContent = 'Upgrade detected';

    var licenseHint = premiumModal.querySelector('div[style*=\"rgba(255,184,0,0.06)\"] p');
    if (licenseHint) {
      licenseHint.innerHTML = 'After purchase, you will receive your <strong style=\"color:#FFB800\">license key</strong> by email. Use <strong style=\"color:#00F0FF\">/license activate</strong> in Discord to link your server.';
    }

    var cancelBtn = premiumModal.querySelector('button[onclick=\"closePremiumModal()\"]');
    if (cancelBtn) cancelBtn.textContent = 'Cancel';
    var trialBtn = document.getElementById('premiumTrialBtn');
    if (trialBtn) trialBtn.textContent = 'Start 1-month Pro trial';
  }

  var footerLove = document.querySelector('.footer-love');
  if (footerLove) {
    var heart = footerLove.querySelector('svg');
    if (heart) {
      var clone = heart.cloneNode(true);
      footerLove.innerHTML = '';
      footerLove.appendChild(document.createTextNode('Built with '));
      footerLove.appendChild(clone);
      footerLove.appendChild(document.createTextNode(' for Discord'));
    }
  }
}

applyStaticEnglishTranslations();

// --- Dynamic Equalizer ---
var eqBars = [];
var eqIsPlaying = false;

(function initEq() {
  var el = document.getElementById('equalizer');
  var heights = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.6, 0.8, 0.4];
  heights.forEach(function(h, i) {
    var bar = document.createElement('div');
    bar.className = 'eq-bar';
    bar.style.height = (h * 100) + '%';
    bar.style.animation = 'eq ' + (0.6 + Math.random() * 0.8).toFixed(2) + 's ease-in-out ' + (i * 0.08).toFixed(2) + 's infinite';
    el.appendChild(bar);
    eqBars.push(bar);
  });
})();

function setEqActive(active) {
  var el = document.getElementById('equalizer');
  if (active && !eqIsPlaying) {
    eqIsPlaying = true;
    el.classList.add('active');
    eqBars.forEach(function(bar, i) {
      bar.style.animation = 'eq-active ' + (0.3 + Math.random() * 0.5).toFixed(2) + 's ease-in-out ' + (i * 0.06).toFixed(2) + 's infinite';
      bar.style.background = 'linear-gradient(to top, #00F0FF, #BD00FF, #FF2A2A)';
    });
  } else if (!active && eqIsPlaying) {
    eqIsPlaying = false;
    el.classList.remove('active');
    eqBars.forEach(function(bar, i) {
      bar.style.animation = 'eq ' + (0.6 + Math.random() * 0.8).toFixed(2) + 's ease-in-out ' + (i * 0.08).toFixed(2) + 's infinite';
      bar.style.background = 'linear-gradient(to top, var(--cyan), var(--purple))';
    });
  }
}

// --- Commands ---
function renderCommands(commands) {
  var list = document.getElementById('commandsList');
  if (!list) return;
  list.innerHTML = '';
  (commands || []).forEach(function(cmd) {
    var row = document.createElement('div');
    row.className = 'cmd-row';

    var cmdMain = document.createElement('div');
    cmdMain.className = 'cmd-main';

    var badge = document.createElement('span');
    badge.className = 'cmd-badge';
    badge.textContent = cmd.name;
    cmdMain.appendChild(badge);

    if (cmd.args) {
      var argsSpan = document.createElement('span');
      argsSpan.className = 'cmd-args';
      argsSpan.textContent = cmd.args;
      cmdMain.appendChild(argsSpan);
    }

    var desc = document.createElement('span');
    desc.className = 'cmd-desc';
    desc.textContent = cmd.desc;

    row.appendChild(cmdMain);
    row.appendChild(desc);
    list.appendChild(row);
  });
}

function commandFallbackMap() {
  var map = {};
  COMMANDS.forEach(function(cmd) {
    map[cmd.name] = cmd;
  });
  return map;
}

function normalizeApiCommands(commands) {
  if (!Array.isArray(commands)) return [];
  var fallbackByName = commandFallbackMap();

  return commands
    .map(function(cmd) {
      var name = String(cmd && cmd.name || '').trim();
      if (!name || name.charAt(0) !== '/') return null;
      var fallback = fallbackByName[name] || null;
      var args = String((fallback && fallback.args) || (cmd && cmd.args) || '').trim();
      var desc = String((fallback && fallback.desc) || (cmd && cmd.description) || (cmd && cmd.desc) || '').trim();
      return { name: name, args: args, desc: desc };
    })
    .filter(Boolean);
}

function loadAndRenderCommands() {
  fetch('/api/commands', { cache: 'no-store' })
    .then(function(res) {
      if (!res.ok) throw new Error('api commands status ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var apiCommands = normalizeApiCommands(data && data.commands);
      if (apiCommands.length > 0) {
        renderCommands(apiCommands);
        return;
      }
      renderCommands(COMMANDS);
    })
    .catch(function() {
      renderCommands(COMMANDS);
    });
}

loadAndRenderCommands();

// --- Copy helper ---
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(function() {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 2000);
  }).catch(function() {});
}

// --- Render Bots ---
function renderBots(bots) {
  var grid = document.getElementById('botGrid');
  grid.innerHTML = '';
  if (!bots || bots.length === 0) {
    grid.innerHTML = '<p class="muted">' + tr('Keine Bots konfiguriert.', 'No bots configured.') + '</p>';
    return;
  }
  bots.forEach(function(bot, i) {
    var c = BOT_COLORS[i % BOT_COLORS.length];
    var url = bot.inviteUrl || ('https://discord.com/oauth2/authorize?client_id=' + bot.clientId + '&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands');
    var botImg = bot.avatarUrl || BOT_IMAGES[i % BOT_IMAGES.length];

    var card = document.createElement('article');
    card.className = 'bot-card';
    card.addEventListener('mouseenter', function() { card.style.borderColor = c.border; card.style.boxShadow = '0 0 40px ' + c.glow; });
    card.addEventListener('mouseleave', function() { card.style.borderColor = ''; card.style.boxShadow = ''; });

    var bar = document.createElement('div');
    bar.className = 'accent-bar';
    bar.style.background = c.accent;
    card.appendChild(bar);

    var head = document.createElement('div');
    head.className = 'bot-head';
    var icon = document.createElement('div');
    icon.className = 'bot-icon';
    icon.style.background = 'linear-gradient(135deg,' + c.accent + '22,' + c.accent + '08)';
    icon.style.border = '1px solid ' + c.accent + '33';
    var img = document.createElement('img');
    img.src = botImg; img.alt = bot.name || 'Bot';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
    img.onerror = function() { this.style.display = 'none'; icon.innerHTML += '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + c.accent + '" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>'; };
    icon.appendChild(img);
    var info = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'bot-name';
    name.textContent = bot.name || 'Bot';
    var tag = document.createElement('div');
    tag.className = 'bot-tag';
    tag.textContent = bot.userTag || tr('Bereit', 'Ready');
    info.appendChild(name); info.appendChild(tag);
    var status = document.createElement('div');
    status.className = 'bot-status';
    var dot = document.createElement('div');
    dot.className = 'bot-status-dot ' + (bot.ready ? 'online' : 'offline');
    status.appendChild(dot);
    status.appendChild(document.createTextNode(bot.ready ? tr('Online', 'Online') : tr('Konfigurierbar', 'Configurable')));
    info.appendChild(status);
    head.appendChild(icon); head.appendChild(info);
    card.appendChild(head);

    // === Bot Statistiken ===
    var statsBox = document.createElement('div');
    statsBox.className = 'bot-stats';
    statsBox.style.borderColor = c.accent + '15';

    var statsTitle = document.createElement('div');
    statsTitle.className = 'stats-title';
    statsTitle.style.color = c.accent;
    statsTitle.textContent = tr('BOT STATISTIKEN', 'BOT STATS');
    statsBox.appendChild(statsTitle);

    var statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';
    var statsData = [
      { label: tr('Server', 'Servers'), value: bot.servers || bot.guilds || 0 },
      { label: tr('Nutzer', 'Users'), value: bot.users || 0 },
      { label: tr('Verbindungen', 'Connections'), value: bot.connections || 0 },
      { label: tr('Zuhoerer', 'Listeners'), value: bot.listeners || 0 }
    ];
    statsData.forEach(function(s) {
      var item = document.createElement('div');
      var label = document.createElement('div');
      label.className = 'stat-label';
      label.textContent = s.label;
      var val = document.createElement('div');
      val.className = 'stat-value';
      val.textContent = new Intl.NumberFormat(APP_LOCALE).format(s.value);
      item.appendChild(label);
      item.appendChild(val);
      statsGrid.appendChild(item);
    });
    statsBox.appendChild(statsGrid);
    card.appendChild(statsBox);

    var isPremiumBot = bot.requiredTier && bot.requiredTier !== 'free';
    var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };

    // Premium badge neben Name
    if (isPremiumBot) {
      var badge = document.createElement('span');
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;font-family:Orbitron,sans-serif;letter-spacing:0.1em;margin-left:8px;background:' + (tierColors[bot.requiredTier] || '#FFB800') + '15;color:' + (tierColors[bot.requiredTier] || '#FFB800') + ';border:1px solid ' + (tierColors[bot.requiredTier] || '#FFB800') + '30';
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16l-1 4h16l-1-4"/></svg> ' + (bot.requiredTier === 'ultimate' ? 'ULTIMATE' : 'PRO');
      name.appendChild(badge);
    }

    var actions = document.createElement('div');
    actions.className = 'bot-actions';

    if (isPremiumBot) {
      var lockBtn = document.createElement('a');
      lockBtn.className = 'invite-btn'; lockBtn.href = '#premium';
      lockBtn.style.cssText = 'background:' + (tierColors[bot.requiredTier] || '#FFB800') + '15;color:' + (tierColors[bot.requiredTier] || '#FFB800') + ';border:1px solid ' + (tierColors[bot.requiredTier] || '#FFB800') + '30';
      lockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ' + (bot.requiredTier === 'ultimate' ? 'Ultimate' : 'Pro') + ' ' + tr('erforderlich', 'required');
      actions.appendChild(lockBtn);
    } else {
      var invBtn = document.createElement('a');
      invBtn.className = 'invite-btn'; invBtn.href = url; invBtn.target = '_blank'; invBtn.rel = 'noopener noreferrer';
      invBtn.style.background = c.accent;
      invBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg> ' + tr('Einladen', 'Invite');
      actions.appendChild(invBtn);
      var cpBtn = document.createElement('button');
      cpBtn.className = 'copy-btn'; cpBtn.type = 'button';
      cpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      cpBtn.addEventListener('click', function() { copyText(url, cpBtn); });
      actions.appendChild(cpBtn);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  });
}

// --- Audio Player ---
var currentAudio = null;
var currentPlayingKey = null;
var currentVolume = 80;
var currentMuted = false;

function playStation(station) {
  stopStation();
  currentAudio = new Audio(station.url);
  currentAudio.volume = currentMuted ? 0 : currentVolume / 100;
  currentAudio.play().then(function() {
    currentPlayingKey = station.key;
    updateNowPlaying(station);
    filterStations(document.getElementById('stationSearch').value);
    setEqActive(true);
  }).catch(function(err) {
    console.error('Audio play failed:', err);
    currentPlayingKey = null;
    updateNowPlaying(null);
    setEqActive(false);
  });
  currentAudio.onerror = function() {
    currentPlayingKey = null; updateNowPlaying(null);
    filterStations(document.getElementById('stationSearch').value);
    setEqActive(false);
  };
}

function stopStation() {
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
  currentPlayingKey = null;
  updateNowPlaying(null);
  setEqActive(false);
  filterStations(document.getElementById('stationSearch').value);
}

function setVolume(val) {
  currentVolume = val; currentMuted = val === 0;
  if (currentAudio) currentAudio.volume = val / 100;
}

function toggleMute() {
  currentMuted = !currentMuted;
  if (currentAudio) currentAudio.volume = currentMuted ? 0 : currentVolume / 100;
  var station = allStations.find(function(s) { return s.key === currentPlayingKey; });
  if (station) updateNowPlaying(station);
}

function updateNowPlaying(station) {
  var container = document.getElementById('nowPlaying');
  if (!station) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = '';

  // Mini EQ
  var eqWrap = document.createElement('div');
  eqWrap.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:20px;flex-shrink:0';
  [0.5, 0.8, 0.6, 1, 0.7].forEach(function(h, i) {
    var b = document.createElement('div');
    b.className = 'eq-bar';
    b.style.cssText = 'width:3px;border-radius:1px;background:#00F0FF;height:' + (h*100) + '%;animation:eq-active ' + (0.3+Math.random()*0.5).toFixed(2) + 's ease-in-out ' + (i*0.06).toFixed(2) + 's infinite';
    eqWrap.appendChild(b);
  });
  container.appendChild(eqWrap);

  // Name
  var nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  nameEl.textContent = station.name;
  container.appendChild(nameEl);

  // Volume
  var volWrap = document.createElement('div');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0';

  var muteBtn = document.createElement('button');
  muteBtn.style.cssText = 'background:none;border:none;color:' + (currentMuted ? '#FF2A2A' : '#A1A1AA') + ';cursor:pointer;padding:4px;line-height:0';
  muteBtn.innerHTML = currentMuted
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  muteBtn.onclick = toggleMute;
  volWrap.appendChild(muteBtn);

  var volNum = document.createElement('span');
  volNum.style.cssText = 'font-size:11px;font-family:JetBrains Mono,monospace;color:#52525B;width:28px;text-align:right';
  volNum.textContent = currentMuted ? '0' : String(currentVolume);

  var slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100';
  slider.value = currentMuted ? '0' : String(currentVolume);
  slider.className = 'vol-slider';
  var pct = currentMuted ? 0 : currentVolume;
  slider.style.background = 'linear-gradient(to right, #00F0FF ' + pct + '%, rgba(255,255,255,0.1) ' + pct + '%)';
  slider.oninput = function() {
    var v = Number(this.value); setVolume(v);
    this.style.background = 'linear-gradient(to right, #00F0FF ' + v + '%, rgba(255,255,255,0.1) ' + v + '%)';
    volNum.textContent = v;
    muteBtn.style.color = v === 0 ? '#FF2A2A' : '#A1A1AA';
  };
  volWrap.appendChild(slider);
  volWrap.appendChild(volNum);
  container.appendChild(volWrap);

  // Stop
  var stopBtn = document.createElement('button');
  stopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;flex-shrink:0';
  stopBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  stopBtn.onclick = stopStation;
  container.appendChild(stopBtn);
}

// --- Stations ---
var STATIONS_PER_PAGE = 8;
var stationsDisplayCount = STATIONS_PER_PAGE;

function renderStations(stations) {
  // IMPORTANT: Only show official stations (free + pro). NEVER show custom stations.
  allStations = (stations || []).filter(function(s) {
    if (s.key && s.key.indexOf('custom:') === 0) return false;
    var tier = (s.tier || 'free').toLowerCase();
    return tier === 'free' || tier === 'pro';
  });
  var freeCount = allStations.filter(function(s) { return (s.tier || 'free') === 'free'; }).length;
  var proCount = allStations.filter(function(s) { return (s.tier || 'free') === 'pro'; }).length;
  document.getElementById('stationCount').textContent = APP_IS_DE
    ? (allStations.length + ' Stationen (' + freeCount + ' Free, ' + proCount + ' Pro). Klicke zum Vorhoeren oder nutze /play im Discord.')
    : (allStations.length + ' stations (' + freeCount + ' free, ' + proCount + ' pro). Click to preview or use /play in Discord.');
  stationsDisplayCount = STATIONS_PER_PAGE;
  filterStations('');
}

function filterStations(query) {
  var list = document.getElementById('stationList');
  var pagination = document.getElementById('stationPagination');
  list.innerHTML = '';
  var q = (query || '').toLowerCase().trim();
  var filtered = allStations.filter(function(s) {
    if (currentTierFilter !== 'all' && (s.tier || 'free') !== currentTierFilter) return false;
    if (!q) return true;
    return s.name.toLowerCase().indexOf(q) !== -1 || s.key.toLowerCase().indexOf(q) !== -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:40px;text-align:center">' + tr('Keine Stationen gefunden.', 'No stations found.') + '</p>';
    if (pagination) pagination.innerHTML = '';
    return;
  }

  var visible = filtered.slice(0, stationsDisplayCount);
  var remaining = filtered.length - visible.length;

  visible.forEach(function(s, i) {
    var color = STATION_COLORS[i % STATION_COLORS.length];
    var isPlaying = currentPlayingKey === s.key;
    var item = document.createElement('div');
    item.className = 'station-item';
    if (isPlaying) { item.style.background = color + '10'; item.style.borderColor = color + '30'; }
    item.onclick = function() { if (isPlaying) { stopStation(); } else { playStation(s); } };

    var icon = document.createElement('div');
    icon.className = 'station-icon';
    icon.style.background = isPlaying ? color : color + '12';
    icon.style.border = '1px solid ' + (isPlaying ? color : color + '22');
    if (isPlaying) {
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#050505" stroke="#050505" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    } else {
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>';
    }

    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:8px';
    var textWrap = document.createElement('div');
    textWrap.style.cssText = 'flex:1;min-width:0';
    var nm = document.createElement('div');
    nm.className = 'station-name'; nm.textContent = s.name;
    var ky = document.createElement('div');
    ky.className = 'station-key'; ky.textContent = s.key;
    textWrap.appendChild(nm); textWrap.appendChild(ky);
    info.appendChild(textWrap);

    // Tier Badge
    var tier = (s.tier || 'free').toLowerCase();
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;font-weight:800;letter-spacing:0.08em;padding:3px 8px;border-radius:6px;font-family:Orbitron,sans-serif;white-space:nowrap;flex-shrink:0';
    if (tier === 'pro') {
      badge.textContent = 'PRO';
      badge.style.background = 'rgba(255,184,0,0.12)';
      badge.style.border = '1px solid rgba(255,184,0,0.3)';
      badge.style.color = '#FFB800';
    } else if (tier === 'ultimate') {
      badge.textContent = 'ULTIMATE';
      badge.style.background = 'rgba(189,0,255,0.12)';
      badge.style.border = '1px solid rgba(189,0,255,0.3)';
      badge.style.color = '#BD00FF';
    } else {
      badge.textContent = 'FREE';
      badge.style.background = 'rgba(57,255,20,0.08)';
      badge.style.border = '1px solid rgba(57,255,20,0.2)';
      badge.style.color = '#39FF14';
    }
    info.appendChild(badge);

    item.appendChild(icon); item.appendChild(info);

    if (isPlaying) {
      var eqW = document.createElement('div');
      eqW.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:16px';
      [0.6, 1, 0.7, 0.9].forEach(function(h, j) {
        var b = document.createElement('div');
        b.className = 'eq-bar';
        b.style.cssText = 'width:3px;border-radius:1px;background:' + color + ';height:' + (h*100) + '%;animation:eq-active ' + (0.3+Math.random()*0.5).toFixed(2) + 's ease-in-out ' + (j*0.06).toFixed(2) + 's infinite';
        eqW.appendChild(b);
      });
      item.appendChild(eqW);
    }
    list.appendChild(item);
  });

  // Pagination
  if (pagination) {
    pagination.innerHTML = '';
    if (remaining > 0) {
      var btn = document.createElement('button');
      btn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#A1A1AA;padding:14px 40px;border-radius:14px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.2s';
      btn.textContent = APP_IS_DE
        ? ('Mehr anzeigen (' + remaining + ' weitere)')
        : ('Show more (' + remaining + ' more)');
      btn.onmouseenter = function() { btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.borderColor = 'rgba(255,255,255,0.2)'; };
      btn.onmouseleave = function() { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.borderColor = 'rgba(255,255,255,0.12)'; };
      btn.onclick = function() {
        stationsDisplayCount += STATIONS_PER_PAGE;
        filterStations(document.getElementById('stationSearch').value);
      };
      pagination.appendChild(btn);
    }
    var countText = document.createElement('p');
    countText.style.cssText = 'color:#52525B;font-size:12px;margin-top:8px';
    countText.textContent = APP_IS_DE
      ? (visible.length + ' von ' + filtered.length + ' Stationen angezeigt')
      : ('Showing ' + visible.length + ' of ' + filtered.length + ' stations');
    pagination.appendChild(countText);
  }
}

document.getElementById('stationSearch').addEventListener('input', function(e) {
  stationsDisplayCount = STATIONS_PER_PAGE;
  filterStations(e.target.value);
});

// --- Premium Checkout (Server-Seat + Month Selector) ---
var MONTH_OPTIONS = [1, 3, 6, 12];
var SEAT_OPTIONS = [1, 2, 3, 5];
var YEARLY_DISCOUNT_MONTHS = 10;
var checkoutUpgradeInfo = null;

// Seat-based pricing in cents per month
var SEAT_PRICING = {
  pro:      { 1: 299, 2: 549, 3: 749, 5: 1149 },
  ultimate: { 1: 499, 2: 799, 3: 1099, 5: 1699 }
};

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function setCheckoutLoadingState(isLoading) {
  var modal = document.getElementById('premiumModal');
  var submitBtn = document.getElementById('premiumSubmit');
  var trialBtn = document.getElementById('premiumTrialBtn');

  if (submitBtn) {
    submitBtn.disabled = !!isLoading;
    if (isLoading) {
      submitBtn.textContent = tr('Wird geladen...', 'Loading...');
    } else if (modal && modal.dataset && modal.dataset.tier) {
      updatePriceDisplay();
    }
  }

  if (trialBtn) {
    trialBtn.disabled = !!isLoading;
    trialBtn.style.opacity = isLoading ? '0.65' : '1';
    trialBtn.style.cursor = isLoading ? 'not-allowed' : 'pointer';
  }

  if (modal) {
    modal.dataset.loading = isLoading ? '1' : '0';
  }
}

function calculateCheckoutPrice(pricePerMonth, months) {
  if (months >= 12) {
    var fullYears = Math.floor(months / 12);
    var remaining = months % 12;
    return (fullYears * YEARLY_DISCOUNT_MONTHS * pricePerMonth) + (remaining * pricePerMonth);
  }
  return months * pricePerMonth;
}

function getSeatPricePerMonth(tier, seats) {
  var pricing = SEAT_PRICING[tier];
  if (!pricing) return 0;
  return pricing[seats] || pricing[1] || 0;
}

function renderSeatButtons(tier) {
  var container = document.getElementById('seatButtons');
  if (!container) return;
  container.innerHTML = '';
  var modal = document.getElementById('premiumModal');
  var currentSeats = parseInt(modal.dataset.seats) || 1;
  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var color = tierColors[tier] || '#FFB800';

  SEAT_OPTIONS.forEach(function(seats) {
    var pricePerMonth = getSeatPricePerMonth(tier, seats);
    var priceLabel = formatEuroFromCents(pricePerMonth);
    var isActive = seats === currentSeats;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:10px 6px;border-radius:10px;cursor:pointer;text-align:center;transition:all 0.2s;' +
      'background:' + (isActive ? color + '12' : 'rgba(255,255,255,0.03)') + ';' +
      'border:1px solid ' + (isActive ? color + '40' : 'rgba(255,255,255,0.08)') + ';' +
      'color:' + (isActive ? color : '#A1A1AA');
    btn.innerHTML = '<div style="font-size:15px;font-weight:700;font-family:JetBrains Mono,monospace">' + seats + '</div>' +
      '<div style="font-size:10px;opacity:0.7">Server</div>' +
      '<div style="font-size:9px;margin-top:2px;color:' + (isActive ? color : '#52525B') + '">' + priceLabel + '/' + tr('Monat', 'mo') + '</div>';
    if (seats >= 5) {
      btn.innerHTML += '<div style="position:absolute;top:-8px;right:-4px;background:#39FF14;color:#050505;font-size:7px;font-weight:800;padding:2px 4px;border-radius:4px;font-family:Orbitron,sans-serif">BEST</div>';
      btn.style.position = 'relative';
    }
    btn.onclick = function() {
      modal.dataset.seats = String(seats);
      renderSeatButtons(tier);
      updatePriceDisplay();
    };
    container.appendChild(btn);
  });
}

function startCheckout(tier) {
  var modal = document.getElementById('premiumModal');
  var input = document.getElementById('premiumEmail');
  var couponInput = document.getElementById('premiumCouponCode');
  var referralInput = document.getElementById('premiumReferralCode');
  var statusEl = document.getElementById('premiumStatus');

  modal.style.display = 'flex';
  input.value = '';
  if (couponInput) {
    couponInput.value = CHECKOUT_QUERY_PREFILL.couponCode || '';
  }
  if (referralInput) {
    referralInput.value = CHECKOUT_QUERY_PREFILL.referralCode || '';
  }
  statusEl.textContent = '';
  modal.dataset.tier = tier;
  modal.dataset.months = '1';
  modal.dataset.seats = '1';
  modal.dataset.isUpgrade = 'false';
  modal.dataset.loading = '0';
  checkoutUpgradeInfo = null;

  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var tierNames = { pro: 'Pro', ultimate: 'Ultimate' };
  var color = tierColors[tier] || '#FFB800';

  var icon = document.getElementById('premiumModalIcon');
  icon.style.background = color + '12';
  icon.style.border = '1px solid ' + color + '30';
  icon.style.color = color;

  var title = document.getElementById('premiumModalTitle');
  title.textContent = 'OmniFM ' + tierNames[tier];

  var submitBtn = document.getElementById('premiumSubmit');
  submitBtn.style.background = color;
  submitBtn.style.color = tier === 'ultimate' ? '#fff' : '#050505';
  submitBtn.disabled = false;

  var trialBtn = document.getElementById('premiumTrialBtn');
  if (trialBtn) {
    trialBtn.style.display = tier === 'pro' ? 'block' : 'none';
    trialBtn.disabled = false;
    trialBtn.style.opacity = '1';
    trialBtn.style.cursor = 'pointer';
  }

  var priceEl = document.getElementById('premiumPrice');
  priceEl.style.color = color;

  document.getElementById('premiumUpgradeBadge').style.display = 'none';
  document.getElementById('premiumMonthsRow').style.display = 'block';
  var seatRow = document.getElementById('seatSelectorRow');
  if (seatRow) seatRow.style.display = 'block';

  renderSeatButtons(tier);
  renderMonthButtons(tier);
  updatePriceDisplay();
}

function renderMonthButtons(tier) {
  var container = document.getElementById('monthButtons');
  container.innerHTML = '';
  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var color = tierColors[tier] || '#FFB800';
  var modal = document.getElementById('premiumModal');
  var selectedMonths = parseInt(modal.dataset.months) || 1;

  MONTH_OPTIONS.forEach(function(m) {
    var isActive = selectedMonths === m;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:10px 4px;border-radius:10px;cursor:pointer;text-align:center;position:relative;transition:all 0.2s;' +
      'background:' + (isActive ? color + '12' : 'rgba(255,255,255,0.03)') + ';' +
      'border:1px solid ' + (isActive ? color + '40' : 'rgba(255,255,255,0.08)') + ';' +
      'color:' + (isActive ? color : '#A1A1AA');
    btn.innerHTML = '<div style="font-size:15px;font-weight:700;font-family:JetBrains Mono,monospace">' + m + '</div>' +
      '<div style="font-size:10px;opacity:0.7">' + monthWord(m) + '</div>';
    if (m >= 12) {
      btn.innerHTML += '<div style="position:absolute;top:-8px;right:-4px;background:#39FF14;color:#050505;font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px;font-family:Orbitron,sans-serif">' + (APP_IS_DE ? '-2 GRATIS' : '2 FREE') + '</div>';
    }
    btn.onclick = function() {
      modal.dataset.months = String(m);
      renderMonthButtons(tier);
      updatePriceDisplay();
    };
    container.appendChild(btn);
  });
}

function updatePriceDisplay() {
  var modal = document.getElementById('premiumModal');
  var tier = modal.dataset.tier;
  var months = parseInt(modal.dataset.months) || 1;
  var seats = parseInt(modal.dataset.seats) || 1;
  var couponInput = document.getElementById('premiumCouponCode');
  var referralInput = document.getElementById('premiumReferralCode');
  var hasOfferCode = Boolean(
    sanitizeOfferCodeInput(couponInput ? couponInput.value : '')
    || sanitizeOfferCodeInput(referralInput ? referralInput.value : '')
  );

  var pricePerMonth = getSeatPricePerMonth(tier, seats);
  var totalCents, regularCents, hasDiscount;

  if (checkoutUpgradeInfo) {
    totalCents = checkoutUpgradeInfo.cost;
    regularCents = totalCents;
    hasDiscount = false;
  } else {
    totalCents = calculateCheckoutPrice(pricePerMonth, months);
    regularCents = months * pricePerMonth;
    hasDiscount = months >= 12 && regularCents > totalCents;
  }

  var totalValue = totalCents / 100;
  var priceEl = document.getElementById('premiumPrice');
  priceEl.textContent = formatEuroFromValue(totalValue);

  var priceLabel = document.getElementById('premiumPriceLabel');
  var seatsLabel = seats > 1 ? ' (' + seats + ' ' + serverWord(seats) + ')' : '';
  priceLabel.textContent = checkoutUpgradeInfo ? tr('Upgrade-Preis', 'Upgrade price') : (months + ' ' + monthWord(months) + seatsLabel);

  var oldPriceEl = document.getElementById('premiumPriceOld');
  if (hasDiscount) {
    oldPriceEl.textContent = formatEuroFromCents(regularCents);
    oldPriceEl.style.display = 'inline';
  } else {
    oldPriceEl.style.display = 'none';
  }

  var discountEl = document.getElementById('premiumDiscount');
  if (hasDiscount) {
    var saved = formatEuroFromCents(regularCents - totalCents);
    discountEl.textContent = APP_IS_DE
      ? ('2 Monate gratis! Du sparst ' + saved)
      : ('2 months free! You save ' + saved);
    discountEl.style.display = 'block';
  } else if (hasOfferCode) {
    discountEl.textContent = tr(
      'Rabatt-/Referral-Code wird beim Checkout geprueft.',
      'Discount/referral code will be validated at checkout.'
    );
    discountEl.style.display = 'block';
  } else {
    discountEl.style.display = 'none';
  }

  var perMonthEl = document.getElementById('premiumPerMonth');
  if (!checkoutUpgradeInfo && months > 1) {
    perMonthEl.textContent = '= ' + formatEuroFromValue(totalCents / months / 100) + '/' + tr('Monat', 'month') + seatsLabel;
    perMonthEl.style.display = 'block';
  } else {
    perMonthEl.style.display = 'none';
  }

  var submitBtn = document.getElementById('premiumSubmit');
  submitBtn.textContent = APP_IS_DE
    ? (formatEuroFromValue(totalValue) + ' bezahlen')
    : ('Pay ' + formatEuroFromValue(totalValue));
}

function checkExistingLicense() {
  // Email-based checkout - no pre-check needed
}

(function bindCheckoutOfferInputs() {
  var couponInput = document.getElementById('premiumCouponCode');
  var referralInput = document.getElementById('premiumReferralCode');

  function handleInput(event) {
    if (!event || !event.target) return;
    var cleaned = sanitizeOfferCodeInput(event.target.value);
    if (event.target.value !== cleaned) {
      event.target.value = cleaned;
    }
    updatePriceDisplay();
  }

  if (couponInput) {
    couponInput.addEventListener('input', handleInput);
  }
  if (referralInput) {
    referralInput.addEventListener('input', handleInput);
  }
})();

function closePremiumModal() {
  setCheckoutLoadingState(false);
  document.getElementById('premiumModal').style.display = 'none';
  checkoutUpgradeInfo = null;
}

function submitPremiumCheckout() {
  var modal = document.getElementById('premiumModal');
  var input = document.getElementById('premiumEmail');
  var couponInput = document.getElementById('premiumCouponCode');
  var referralInput = document.getElementById('premiumReferralCode');
  var statusEl = document.getElementById('premiumStatus');
  var tier = modal.dataset.tier;
  var months = parseInt(modal.dataset.months) || 1;
  var seats = parseInt(modal.dataset.seats) || 1;
  var email = input.value.trim();
  var couponCode = sanitizeOfferCodeInput(couponInput ? couponInput.value : '');
  var referralCode = sanitizeOfferCodeInput(referralInput ? referralInput.value : '');

  if (!isValidEmailAddress(email)) {
    statusEl.textContent = tr('Bitte eine gueltige E-Mail-Adresse eingeben!', 'Please enter a valid email address!');
    statusEl.style.color = '#FF2A2A';
    return;
  }

  setCheckoutLoadingState(true);
  statusEl.textContent = '';

  fetch('/api/premium/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier: tier,
      email: email,
      months: months,
      seats: seats,
      couponCode: couponCode || undefined,
      referralCode: referralCode || undefined,
      returnUrl: window.location.origin,
      language: APP_LANG
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.url) {
      window.location.href = data.url;
    } else {
      statusEl.textContent = data.error || tr('Fehler beim Erstellen der Zahlung.', 'Error while creating payment.');
      statusEl.style.color = '#FF2A2A';
      setCheckoutLoadingState(false);
    }
  })
  .catch(function(err) {
    statusEl.textContent = tr('Verbindungsfehler: ', 'Connection error: ') + err.message;
    statusEl.style.color = '#FF2A2A';
    setCheckoutLoadingState(false);
  });
}

function submitProTrial() {
  var input = document.getElementById('premiumEmail');
  var statusEl = document.getElementById('premiumStatus');
  var email = input.value.trim();

  if (!isValidEmailAddress(email)) {
    statusEl.textContent = tr('Bitte eine gueltige E-Mail-Adresse eingeben!', 'Please enter a valid email address!');
    statusEl.style.color = '#FF2A2A';
    return;
  }

  setCheckoutLoadingState(true);
  statusEl.textContent = '';

  fetch('/api/premium/trial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, language: APP_LANG })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      closePremiumModal();
      var banner = document.getElementById('paymentBanner');
      var msg = data.message || tr('Pro-Testmonat aktiviert!', 'Pro trial month activated!');
      if (data.licenseKey && msg.indexOf(data.licenseKey) === -1) {
        msg += APP_IS_DE
          ? (' Dein Lizenz-Key: ' + data.licenseKey)
          : (' Your license key: ' + data.licenseKey);
      }
      banner.style.display = 'flex';
      banner.style.background = 'rgba(57,255,20,0.1)';
      banner.style.borderColor = 'rgba(57,255,20,0.3)';
      banner.querySelector('span').textContent = msg;
      banner.querySelector('span').style.color = '#39FF14';
      return;
    }

    statusEl.textContent = data.message || data.error || tr('Der Testmonat konnte nicht aktiviert werden.', 'Could not activate the trial month.');
    statusEl.style.color = '#FF2A2A';
    setCheckoutLoadingState(false);
  })
  .catch(function(err) {
    statusEl.textContent = tr('Verbindungsfehler: ', 'Connection error: ') + err.message;
    statusEl.style.color = '#FF2A2A';
    setCheckoutLoadingState(false);
  });
}

// --- Check for payment success on page load ---
(function checkPaymentReturn() {
  var params = new URLSearchParams(window.location.search);
  var payment = params.get('payment');
  var sessionId = params.get('session_id');

  if (payment === 'success' && sessionId) {
    fetch('/api/premium/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var banner = document.getElementById('paymentBanner');
      if (data.success) {
        banner.style.display = 'flex';
        banner.style.background = 'rgba(57,255,20,0.1)';
        banner.style.borderColor = 'rgba(57,255,20,0.3)';
        var msg = data.message || tr('Premium aktiviert!', 'Premium activated!');
        if (data.licenseKey) {
          msg += APP_IS_DE
            ? (' Dein Lizenz-Key: ' + data.licenseKey)
            : (' Your license key: ' + data.licenseKey);
        }
        if (data.appliedOfferCode && Number(data.discountCents || 0) > 0) {
          var discountValue = formatEuroFromCents(Number(data.discountCents || 0));
          msg += APP_IS_DE
            ? (' Rabatt: ' + discountValue + ' (' + data.appliedOfferCode + ').')
            : (' Discount: ' + discountValue + ' (' + data.appliedOfferCode + ').');
        }
        banner.querySelector('span').textContent = msg;
        banner.querySelector('span').style.color = '#39FF14';
      } else {
        banner.style.display = 'flex';
        banner.style.background = 'rgba(255,42,42,0.1)';
        banner.style.borderColor = 'rgba(255,42,42,0.3)';
        banner.querySelector('span').textContent = data.message || tr('Zahlung fehlgeschlagen.', 'Payment failed.');
        banner.querySelector('span').style.color = '#FF2A2A';
      }
    }).catch(function() {});

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }

  if (payment === 'cancelled') {
    var banner = document.getElementById('paymentBanner');
    banner.style.display = 'flex';
    banner.style.background = 'rgba(255,184,0,0.1)';
    banner.style.borderColor = 'rgba(255,184,0,0.3)';
    banner.querySelector('span').textContent = tr('Zahlung abgebrochen.', 'Payment cancelled.');
    banner.querySelector('span').style.color = '#FFB800';
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

// --- Premium Status Check ---
function checkPremiumStatus() {
  var input = document.getElementById('premiumCheckInput');
  var result = document.getElementById('premiumCheckResult');
  var serverId = input.value.trim();

  if (!/^\d{17,22}$/.test(serverId)) {
    result.textContent = tr('Server ID muss 17-22 Ziffern sein!', 'Server ID must be 17-22 digits!');
    result.style.color = '#FF2A2A';
    return;
  }

  result.textContent = tr('Pruefe...', 'Checking...');
  result.style.color = '#A1A1AA';

  fetch('/api/premium/check?serverId=' + serverId)
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var tierColors = { free: '#A1A1AA', pro: '#FFB800', ultimate: '#BD00FF' };
    result.style.color = tierColors[data.tier] || '#A1A1AA';

    if (data.license && !data.license.expired) {
      var expires = new Date(data.license.expiresAt);
      var expStr = expires.toLocaleDateString(APP_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
      result.innerHTML = '<strong>' + data.name + '</strong> | '
        + tr('Bitrate', 'Bitrate') + ': ' + data.bitrate + ' | '
        + tr('Reconnect', 'Reconnect') + ': ' + data.reconnectMs + 'ms | '
        + tr('Max Bots', 'Max bots') + ': ' + (data.maxBots || 0) + '<br>'
        + '<span style="font-size:12px;color:#A1A1AA">'
        + tr('Laeuft ab', 'Expires') + ': ' + expStr
        + (APP_IS_DE
          ? (' (' + data.license.remainingDays + ' Tage uebrig), servergebunden auf diese Server-ID.')
          : (' (' + data.license.remainingDays + ' days left), bound to this server ID.'))
        + '</span>';
    } else if (data.license && data.license.expired) {
      result.innerHTML = '<strong style="color:#FF2A2A">' + tr('Abgelaufen!', 'Expired!') + '</strong> '
        + '<span style="font-size:12px;color:#A1A1AA">' + tr('Ehemals', 'Formerly') + ': ' + (data.license.tier || tr('unbekannt', 'unknown')) + '</span>';
    } else {
      result.textContent = tr('Tier', 'Tier') + ': ' + data.name + ' | '
        + tr('Bitrate', 'Bitrate') + ': ' + data.bitrate + ' | '
        + tr('Max Bots', 'Max bots') + ': ' + (data.maxBots || 0);
    }
  })
  .catch(function() {
    result.textContent = tr('Fehler beim Pruefen.', 'Error while checking.');
    result.style.color = '#FF2A2A';
  });
}

// --- Footer Stats ---
function renderFooterStats(data) {
  var el = document.getElementById('footerStats');
  var items = [
    { label: tr('Server', 'Servers'), value: data.servers || 0, color: '#00F0FF' },
    { label: tr('Nutzer', 'Users'), value: data.users || 0, color: '#39FF14' },
    { label: tr('Bots', 'Bots'), value: data.bots || 0, color: '#EC4899' },
    { label: tr('Stationen', 'Stations'), value: data.stations || 0, color: '#FFB800' },
  ];
  el.innerHTML = '';
  items.forEach(function(s) {
    var div = document.createElement('div'); div.className = 'footer-stat';
    var num = document.createElement('span'); num.className = 'footer-stat-num';
    num.style.color = s.color; num.style.textShadow = '0 0 15px ' + s.color + '50';
    num.textContent = fmtInt(s.value);
    var lbl = document.createElement('span'); lbl.className = 'footer-stat-label'; lbl.textContent = s.label;
    div.appendChild(num); div.appendChild(lbl);
    el.appendChild(div);
  });
}

// --- Fetch & Refresh ---
var _apiErrorShown = false;
var _lastRefreshOk = false;

async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var tid = setTimeout(function() { controller.abort(); }, timeoutMs || 8000);
  try {
    var res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(url + ' -> ' + res.status);
    return res.json();
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

function showApiError() {
  if (_apiErrorShown) return;
  _apiErrorShown = true;

  // Bot-Grid Fehler
  var botGrid = document.getElementById('botGrid');
  if (botGrid && botGrid.innerHTML.indexOf('Lade') !== -1) {
    botGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px 16px">'
      + '<p style="color:#FF2A2A;font-size:14px;margin-bottom:12px">'
      + tr('⚠️ Bots konnten nicht geladen werden.', '⚠️ Could not load bots.')
      + '</p>'
      + '<button onclick="retryRefresh()" style="background:#00F0FF;color:#050505;border:none;border-radius:10px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer">'
      + tr('Erneut versuchen', 'Try again')
      + '</button></div>';
  }

  // Stationen Fehler
  var stationList = document.getElementById('stationList');
  if (stationList && stationList.innerHTML.indexOf('Lade') !== -1) {
    stationList.innerHTML = '<div style="text-align:center;padding:32px 16px">'
      + '<p style="color:#FF2A2A;font-size:14px;margin-bottom:12px">'
      + tr('⚠️ Stationen konnten nicht geladen werden.', '⚠️ Could not load stations.')
      + '</p>'
      + '<button onclick="retryRefresh()" style="background:#00F0FF;color:#050505;border:none;border-radius:10px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer">'
      + tr('Erneut versuchen', 'Try again')
      + '</button></div>';
  }

  // Stationen-Count
  var stationCount = document.getElementById('stationCount');
  if (stationCount) stationCount.textContent = tr('Stationen konnten nicht geladen werden.', 'Stations could not be loaded.');
}

function retryRefresh() {
  _apiErrorShown = false;
  var botGrid = document.getElementById('botGrid');
  if (botGrid) botGrid.innerHTML = '<p class="muted">' + tr('Lade Bots...', 'Loading bots...') + '</p>';
  var stationList = document.getElementById('stationList');
  if (stationList) stationList.innerHTML = '<p class="muted">' + tr('Lade Stationen...', 'Loading stations...') + '</p>';
  refresh();
}

async function refresh() {
  try {
    var results = await Promise.all([
      fetchJson('/api/bots', 8000),
      fetchJson('/api/stations', 8000),
    ]);

    var botsRes = results[0];
    var stationsRes = results[1];
    var bots = botsRes.bots || [];
    var totals = botsRes.totals || {};
    var stations = stationsRes.stations || [];

    _lastRefreshOk = true;
    _apiErrorShown = false;

    renderBots(bots);
    renderStations(stations);
    // Use allStations.length (filtered in renderStations) for accurate count
    renderFooterStats({ ...totals, bots: bots.length, stations: allStations.length });

    document.getElementById('statServers').textContent = fmtInt(totals.servers);
    document.getElementById('statStations').textContent = fmtInt(allStations.length);
    document.getElementById('statBots').textContent = fmtInt(bots.length);
  } catch (e) {
    console.error(tr('API Fehler:', 'API error:'), e);
    if (!_lastRefreshOk) {
      // Nur beim ersten Fehler (noch nie erfolgreich geladen) Fehlermeldung zeigen
      showApiError();
    }
  }
}

// Erster Ladeversuch mit Timeout-Fallback: nach 6s Fehlermeldung wenn noch nichts geladen
var _initialLoadTimer = setTimeout(function() {
  if (!_lastRefreshOk) showApiError();
}, 6000);

refresh().then(function() { clearTimeout(_initialLoadTimer); });
setInterval(refresh, 15000);

// --- Count-Up Animation für Hero-Stats ---
var _countUpDone = false;
function animateCounter(el, target, duration) {
  if (!el) return;
  var start = 0;
  var startTime = null;
  var num = Number(target) || 0;
  if (num === 0) { el.textContent = '0'; return; }
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / (duration || 1200), 1);
    // Ease-out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(eased * num);
    el.textContent = new Intl.NumberFormat(APP_LOCALE).format(current);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = new Intl.NumberFormat(APP_LOCALE).format(num);
  }
  requestAnimationFrame(step);
}

// Überschreibe fmtInt für Stats nach erstem Laden mit Animation
var _origStatServers = document.getElementById('statServers');
var _origStatStations = document.getElementById('statStations');
var _origStatBots = document.getElementById('statBots');

var _refreshOriginal = refresh;
refresh = async function() {
  try {
    var results = await Promise.all([
      fetchJson('/api/bots', 8000),
      fetchJson('/api/stations', 8000),
    ]);
    var botsRes = results[0];
    var stationsRes = results[1];
    var bots = botsRes.bots || [];
    var totals = botsRes.totals || {};
    var stations = stationsRes.stations || [];

    _lastRefreshOk = true;
    _apiErrorShown = false;

    renderBots(bots);
    renderStations(stations);
    renderFooterStats({ ...totals, bots: bots.length, stations: allStations.length });

    var serverEl = document.getElementById('statServers');
    var stationEl = document.getElementById('statStations');
    var botEl = document.getElementById('statBots');

    if (!_countUpDone) {
      _countUpDone = true;
      animateCounter(serverEl, totals.servers || 0, 1200);
      animateCounter(stationEl, allStations.length, 1400);
      animateCounter(botEl, bots.length, 1000);
    } else {
      if (serverEl) serverEl.textContent = fmtInt(totals.servers);
      if (stationEl) stationEl.textContent = fmtInt(allStations.length);
      if (botEl) botEl.textContent = fmtInt(bots.length);
    }
  } catch (e) {
    console.error(tr('API Fehler:', 'API error:'), e);
    if (!_lastRefreshOk) showApiError();
  }
};

// --- Scroll-Indicator ausblenden ---
window.addEventListener('scroll', function() {
  var ind = document.getElementById('scrollIndicator');
  if (ind) {
    ind.style.opacity = window.scrollY > 80 ? '0' : '1';
    ind.style.pointerEvents = window.scrollY > 80 ? 'none' : 'auto';
  }
}, { passive: true });

// --- Station-Suche Debounce ---
(function patchStationSearch() {
  var searchEl = document.getElementById('stationSearch');
  if (!searchEl) return;
  // Entferne alten Listener und ersetze mit Debounce
  var newEl = searchEl.cloneNode(true);
  searchEl.parentNode.replaceChild(newEl, searchEl);
  var debounceTimer;
  newEl.addEventListener('input', function(e) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      stationsDisplayCount = STATIONS_PER_PAGE;
      filterStations(e.target.value);
    }, 150);
  });
})();
