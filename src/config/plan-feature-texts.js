// ============================================================
// OmniFM: the plan lines in the website's other languages (#306)
// ============================================================
// German and English sit next to each line in plan-features.js, where the
// bot reads them. The website speaks seven more languages; their lines follow
// the English ones key by key, with the same conditions. A line a language
// leaves out shows in English. Bundled by the website (frontend/vite.config.js).
import { PLAN_LIMITS, planAtLeast, planCardLines } from "./plan-features.js";

const seconds = (plan) => {
  const value = Math.max(1000, PLAN_LIMITS[plan].reconnectMs) / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
};
const pro = (plan) => planAtLeast(plan, "pro");
const ultimate = (plan) => plan === "ultimate";
const limit = (plan, key) => PLAN_LIMITS[plan][key];

/** Polish counts: 1 kanał, 2-4 kanały, 5+ kanałów (12-14 like 5). */
const polish = (count, one, few, many) => {
  if (count === 1) return one;
  const tens = count % 100;
  return count % 10 >= 2 && count % 10 <= 4 && (tens < 12 || tens > 14) ? few : many;
};

/** @type {Readonly<Record<string, Record<string, (...args: any[]) => (string | null)>>>} */
export const PLAN_FEATURE_TEXTS = Object.freeze({
  fr: {
    intro: (below) => `Tout ce que propose ${below}, plus :`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} stations du catalogue` : "Les stations gratuites du catalogue")
      : (context.allStations ? `Les ${context.allStations} stations du catalogue` : "Toutes les stations du catalogue")),
    channels: (plan) => `${limit(plan, "maxBots")} salons vocaux en même temps`,
    audio: (plan) => (ultimate(plan) ? "Audio jusqu'à 320k, aussi bon que ce que diffuse la station" : `Audio en ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `De retour ${seconds(plan)} s après une coupure`,
    fallback: () => "Une station de secours quand un flux tombe, et retour dès qu'il revient",
    nowPlaying: () => "Panneau Now Playing avec boutons, aussi avec /now",
    history: (plan) => `/history avec les ${limit(plan, "historySongs")} derniers titres`,
    favorites: (plan) => `${limit(plan, "favorites")} stations favorites en boutons dans le panneau`,
    extras: () => "Titres enregistrés, sondages, minuterie de sommeil et carte de partage",
    yearReview: (plan) => (pro(plan) ? "Bilan de l'année avec image et publication dans le salon" : "Bilan de l'année à feuilleter"),
    voiceGuard: () => "Voice Guard : le bot reste dans son salon",
    events: (plan) => (limit(plan, "events") === 1 ? "1 événement radio planifié" : "Événements radio planifiés sans limite"),
    dashboard: (plan) => (pro(plan)
      ? "Tableau de bord web avec vue en direct, statistiques et tous les réglages"
      : "Tableau de bord web : ce qui joue où, changer ou arrêter la station, langue"),
    permissions: (plan) => (pro(plan) ? "Droits par rôle : qui peut utiliser quelle commande" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Alertes de panne dans un salon Discord" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Bilan hebdomadaire dans un salon" : null),
    panelDesign: (plan) => (pro(plan) ? "Personnaliser le panneau : couleur et boutons" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Jusqu'à ${limit(plan, "customStations")} stations à vous avec logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Une apparence du bot propre à chaque serveur" : null),
    jingle: (plan) => (ultimate(plan) ? "Votre propre jingle (10 s max.) au changement de station ou à chaque heure pile" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Vos propres chaînes de stations de secours" : null),
    analytics: (plan) => (ultimate(plan) ? "Statistiques détaillées sur 30 jours" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhooks et exports" : null),
  },
  es: {
    intro: (below) => `Todo lo de ${below}, y además:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} emisoras del catálogo` : "Las emisoras gratuitas del catálogo")
      : (context.allStations ? `Las ${context.allStations} emisoras del catálogo` : "Todas las emisoras del catálogo")),
    channels: (plan) => `${limit(plan, "maxBots")} canales de voz a la vez`,
    audio: (plan) => (ultimate(plan) ? "Audio de hasta 320k, tan bueno como lo emite la emisora" : `Audio en ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `De vuelta ${seconds(plan)} s después de un corte`,
    fallback: () => "Una emisora de respaldo cuando falla una transmisión, y de vuelta en cuanto se recupera",
    nowPlaying: () => "Panel Now Playing con botones, también con /now",
    history: (plan) => `/history con las últimas ${limit(plan, "historySongs")} canciones`,
    favorites: (plan) => `${limit(plan, "favorites")} emisoras favoritas como botones en el panel`,
    extras: () => "Canciones guardadas, encuestas, temporizador de apagado y tarjeta para compartir",
    yearReview: (plan) => (pro(plan) ? "Resumen del año con imagen y publicación en el canal" : "Resumen del año para hojear"),
    voiceGuard: () => "Voice Guard: el bot se queda en su canal",
    events: (plan) => (limit(plan, "events") === 1 ? "1 evento de radio programado" : "Eventos de radio programados sin límite"),
    dashboard: (plan) => (pro(plan)
      ? "Panel web con vista en directo, estadísticas y todos los ajustes"
      : "Panel web: qué suena dónde, cambiar o detener la emisora, idioma"),
    permissions: (plan) => (pro(plan) ? "Permisos por rol: quién puede usar cada comando" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Avisos de caídas en un canal de Discord" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Resumen semanal en un canal" : null),
    panelDesign: (plan) => (pro(plan) ? "Diseña el panel: color y botones" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Hasta ${limit(plan, "customStations")} emisoras propias con logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Aspecto propio del bot en cada servidor" : null),
    jingle: (plan) => (ultimate(plan) ? "Tu propio jingle (hasta 10 s) al cambiar de emisora o a cada hora en punto" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Tus propias cadenas de emisoras de respaldo" : null),
    analytics: (plan) => (ultimate(plan) ? "Estadísticas detalladas de 30 días" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhooks y exportaciones" : null),
  },
  it: {
    intro: (below) => `Tutto quello di ${below}, in più:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} stazioni dal catalogo` : "Le stazioni gratuite del catalogo")
      : (context.allStations ? `Tutte le ${context.allStations} stazioni del catalogo` : "Tutte le stazioni del catalogo")),
    channels: (plan) => `${limit(plan, "maxBots")} canali vocali contemporaneamente`,
    audio: (plan) => (ultimate(plan) ? "Audio fino a 320k, buono quanto lo trasmette la stazione" : `Audio a ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `Di nuovo attivo ${seconds(plan)} s dopo un'interruzione`,
    fallback: () => "Una stazione di riserva quando uno stream cade, e ritorno appena riparte",
    nowPlaying: () => "Pannello Now Playing con pulsanti, anche con /now",
    history: (plan) => `/history con gli ultimi ${limit(plan, "historySongs")} brani`,
    favorites: (plan) => `${limit(plan, "favorites")} stazioni preferite come pulsanti nel pannello`,
    extras: () => "Brani salvati, sondaggi, timer di spegnimento e scheda da condividere",
    yearReview: (plan) => (pro(plan) ? "Riepilogo dell'anno con immagine e post nel canale" : "Riepilogo dell'anno da sfogliare"),
    voiceGuard: () => "Voice Guard: il bot resta nel suo canale",
    events: (plan) => (limit(plan, "events") === 1 ? "1 evento radio programmato" : "Eventi radio programmati senza limiti"),
    dashboard: (plan) => (pro(plan)
      ? "Dashboard web con vista live, statistiche e tutte le impostazioni"
      : "Dashboard web: cosa suona dove, cambiare o fermare la stazione, lingua"),
    permissions: (plan) => (pro(plan) ? "Permessi per ruolo: chi può usare quale comando" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Avvisi di interruzione in un canale Discord" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Riepilogo settimanale in un canale" : null),
    panelDesign: (plan) => (pro(plan) ? "Personalizza il pannello: colore e pulsanti" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Fino a ${limit(plan, "customStations")} stazioni tue con logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Un aspetto del bot tutto tuo per ogni server" : null),
    jingle: (plan) => (ultimate(plan) ? "Il tuo jingle (fino a 10 s) al cambio di stazione o allo scoccare dell'ora" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Le tue catene di stazioni di riserva" : null),
    analytics: (plan) => (ultimate(plan) ? "Statistiche dettagliate su 30 giorni" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhook ed esportazioni" : null),
  },
  pl: {
    intro: (below) => `Wszystko z ${below}, a do tego:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `Stacje z katalogu: ${context.freeStations}` : "Darmowe stacje z katalogu")
      : (context.allStations ? `Wszystkie stacje z katalogu (${context.allStations})` : "Wszystkie stacje z katalogu")),
    channels: (plan) => {
      const count = limit(plan, "maxBots");
      return `${count} ${polish(count, "kanał głosowy", "kanały głosowe", "kanałów głosowych")} jednocześnie`;
    },
    audio: (plan) => (ultimate(plan) ? "Dźwięk do 320k, tak dobry, jak nadaje stacja" : `Dźwięk w jakości ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `Po przerwie z powrotem w ${seconds(plan)} s`,
    fallback: () => "Stacja zastępcza, gdy stream przestaje działać, i powrót, gdy znów gra",
    nowPlaying: () => "Panel Now Playing z przyciskami, także przez /now",
    history: (plan) => `/history z ostatnimi utworami (${limit(plan, "historySongs")})`,
    favorites: (plan) => {
      const count = limit(plan, "favorites");
      return `${count} ${polish(count, "ulubiona stacja", "ulubione stacje", "ulubionych stacji")} jako przyciski w panelu`;
    },
    extras: () => "Zapisane utwory, ankiety, wyłącznik czasowy i karta do udostępniania",
    yearReview: (plan) => (pro(plan) ? "Podsumowanie roku z obrazem i wpisem na kanale" : "Podsumowanie roku do przeglądania"),
    voiceGuard: () => "Voice Guard: bot zostaje na swoim kanale",
    events: (plan) => (limit(plan, "events") === 1 ? "1 zaplanowane wydarzenie radiowe" : "Zaplanowane wydarzenia radiowe bez limitu"),
    dashboard: (plan) => (pro(plan)
      ? "Panel webowy z podglądem na żywo, statystykami i wszystkimi ustawieniami"
      : "Panel webowy: co gra gdzie, zmiana lub zatrzymanie stacji, język"),
    permissions: (plan) => (pro(plan) ? "Uprawnienia ról: kto może używać których komend" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Powiadomienia o awariach na kanale Discord" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Podsumowanie tygodnia na kanale" : null),
    panelDesign: (plan) => (pro(plan) ? "Własny wygląd panelu: kolor i przyciski" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Do ${limit(plan, "customStations")} własnych stacji z logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Własny wygląd bota na każdym serwerze" : null),
    jingle: (plan) => (ultimate(plan) ? "Własny dżingiel (do 10 s) przy zmianie stacji lub o pełnej godzinie" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Własne łańcuchy stacji zastępczych" : null),
    analytics: (plan) => (ultimate(plan) ? "Szczegółowe statystyki z 30 dni" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhooki i eksporty" : null),
  },
  tr: {
    intro: (below) => `${below} içindeki her şey, ayrıca:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `Katalogdan ${context.freeStations} istasyon` : "Katalogun ücretsiz istasyonları")
      : (context.allStations ? `Katalogdaki ${context.allStations} istasyonun tümü` : "Katalogdaki tüm istasyonlar")),
    channels: (plan) => `Aynı anda ${limit(plan, "maxBots")} ses kanalı`,
    audio: (plan) => (ultimate(plan) ? "320k'ya kadar ses, istasyonun yayını kadar iyi" : `${limit(plan, "bitrate")} ses kalitesi`),
    reconnect: (plan) => `Bir kesintiden ${seconds(plan)} sn sonra yeniden yayında`,
    fallback: () => "Bir yayın düştüğünde yedek istasyon, yeniden çaldığında geri dönüş",
    nowPlaying: () => "Butonlu Now Playing paneli, /now ile de",
    history: (plan) => `Son ${limit(plan, "historySongs")} şarkıyla /history`,
    favorites: (plan) => `Panelde buton olarak ${limit(plan, "favorites")} favori istasyon`,
    extras: () => "Kaydedilen şarkılar, anketler, uyku zamanlayıcısı ve paylaşım kartı",
    yearReview: (plan) => (pro(plan) ? "Görsel ve kanal gönderisiyle yıl özeti" : "Sayfa sayfa gezilen yıl özeti"),
    voiceGuard: () => "Voice Guard: bot kendi kanalında kalır",
    events: (plan) => (limit(plan, "events") === 1 ? "1 planlı radyo etkinliği" : "Sınırsız planlı radyo etkinliği"),
    dashboard: (plan) => (pro(plan)
      ? "Canlı görünüm, istatistikler ve tüm ayarlarla web paneli"
      : "Web paneli: nerede ne çalıyor, istasyonu değiştirme veya durdurma, dil"),
    permissions: (plan) => (pro(plan) ? "Rol izinleri: kim hangi komutu kullanabilir" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Bir Discord kanalına kesinti bildirimleri" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Bir kanalda haftalık özet" : null),
    panelDesign: (plan) => (pro(plan) ? "Paneli kendin tasarla: renk ve butonlar" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Logosuyla birlikte en fazla ${limit(plan, "customStations")} kendi istasyonun` : null),
    botProfile: (plan) => (ultimate(plan) ? "Her sunucu için kendi bot görünümü" : null),
    jingle: (plan) => (ultimate(plan) ? "Kendi jingle'ın (en fazla 10 sn): istasyon değişince veya her saat başı" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Kendi yedek istasyon zincirlerin" : null),
    analytics: (plan) => (ultimate(plan) ? "30 günlük ayrıntılı istatistikler" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhook'lar ve dışa aktarmalar" : null),
  },
  pt: {
    intro: (below) => `Tudo do ${below}, e mais:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} estações do catálogo` : "As estações gratuitas do catálogo")
      : (context.allStations ? `Todas as ${context.allStations} estações do catálogo` : "Todas as estações do catálogo")),
    channels: (plan) => `${limit(plan, "maxBots")} canais de voz ao mesmo tempo`,
    audio: (plan) => (ultimate(plan) ? "Áudio de até 320k, tão bom quanto a estação transmite" : `Áudio em ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `De volta ${seconds(plan)} s após uma queda`,
    fallback: () => "Uma estação reserva quando uma transmissão cai, e a volta assim que ela retorna",
    nowPlaying: () => "Painel Now Playing com botões, também com /now",
    history: (plan) => `/history com as últimas ${limit(plan, "historySongs")} músicas`,
    favorites: (plan) => `${limit(plan, "favorites")} estações favoritas como botões no painel`,
    extras: () => "Músicas salvas, enquetes, timer para dormir e cartão para compartilhar",
    yearReview: (plan) => (pro(plan) ? "Retrospectiva do ano com imagem e post no canal" : "Retrospectiva do ano para folhear"),
    voiceGuard: () => "Voice Guard: o bot fica no canal dele",
    events: (plan) => (limit(plan, "events") === 1 ? "1 evento de rádio agendado" : "Eventos de rádio agendados sem limite"),
    dashboard: (plan) => (pro(plan)
      ? "Painel web com visão ao vivo, estatísticas e todas as configurações"
      : "Painel web: o que toca onde, trocar ou parar a estação, idioma"),
    permissions: (plan) => (pro(plan) ? "Permissões por cargo: quem pode usar qual comando" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Alertas de queda em um canal do Discord" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Resumo semanal em um canal" : null),
    panelDesign: (plan) => (pro(plan) ? "Personalize o painel: cor e botões" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Até ${limit(plan, "customStations")} estações próprias com logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Visual próprio do bot em cada servidor" : null),
    jingle: (plan) => (ultimate(plan) ? "Seu próprio jingle (até 10 s) ao trocar de estação ou a cada hora cheia" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Suas próprias cadeias de estações reserva" : null),
    analytics: (plan) => (ultimate(plan) ? "Estatísticas detalhadas de 30 dias" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhooks e exportações" : null),
  },
  nl: {
    intro: (below) => `Alles uit ${below}, plus:`,
    stations: (plan, context = {}) => (plan === "free"
      ? (context.freeStations ? `${context.freeStations} zenders uit de catalogus` : "De gratis zenders uit de catalogus")
      : (context.allStations ? `Alle ${context.allStations} zenders uit de catalogus` : "Alle zenders uit de catalogus")),
    channels: (plan) => `${limit(plan, "maxBots")} spraakkanalen tegelijk`,
    audio: (plan) => (ultimate(plan) ? "Audio tot 320k, zo goed als de zender uitzendt" : `Audio in ${limit(plan, "bitrate")}`),
    reconnect: (plan) => `Na een onderbreking binnen ${seconds(plan)} s terug`,
    fallback: () => "Een reservezender als een stream uitvalt, en terug zodra die weer speelt",
    nowPlaying: () => "Now-playingpaneel met knoppen, ook met /now",
    history: (plan) => `/history met de laatste ${limit(plan, "historySongs")} nummers`,
    favorites: (plan) => `${limit(plan, "favorites")} favoriete zenders als knoppen in het paneel`,
    extras: () => "Opgeslagen nummers, polls, slaaptimer en deelkaart",
    yearReview: (plan) => (pro(plan) ? "Jaaroverzicht met afbeelding en bericht in het kanaal" : "Jaaroverzicht om door te bladeren"),
    voiceGuard: () => "Voice Guard: de bot blijft in zijn kanaal",
    events: (plan) => (limit(plan, "events") === 1 ? "1 gepland radio-evenement" : "Onbeperkt geplande radio-evenementen"),
    dashboard: (plan) => (pro(plan)
      ? "Webdashboard met liveweergave, statistieken en alle instellingen"
      : "Webdashboard: wat speelt waar, zender wisselen of stoppen, taal"),
    permissions: (plan) => (pro(plan) ? "Rolrechten: wie welke commando's mag gebruiken" : null),
    incidentAlerts: (plan) => (pro(plan) ? "Storingsmeldingen in een Discord-kanaal" : null),
    weeklyDigest: (plan) => (pro(plan) ? "Weekoverzicht in een kanaal" : null),
    panelDesign: (plan) => (pro(plan) ? "Paneel zelf vormgeven: kleur en knoppen" : null),
    customStations: (plan) => (limit(plan, "customStations") ? `Tot ${limit(plan, "customStations")} eigen zenders met logo` : null),
    botProfile: (plan) => (ultimate(plan) ? "Eigen uiterlijk van de bot per server" : null),
    jingle: (plan) => (ultimate(plan) ? "Je eigen jingle (max. 10 s) bij het wisselen van zender of op het hele uur" : null),
    failoverRules: (plan) => (ultimate(plan) ? "Eigen ketens van reservezenders" : null),
    analytics: (plan) => (ultimate(plan) ? "Gedetailleerde statistieken over 30 dagen" : null),
    webhooks: (plan) => (ultimate(plan) ? "Webhooks en exports" : null),
  },
});

/**
 * planCardLines in any language of the website: German and English from
 * plan-features.js, the others from PLAN_FEATURE_TEXTS, English where a
 * line is missing. language may be a locale such as "fr-CA".
 * @param {string} plan
 * @param {{ language?: string, context?: object, highlightsOnly?: boolean }} [options]
 */
export function planCardLinesIn(plan, { language = "de", context = {}, highlightsOnly = false } = {}) {
  const code = String(language || "de").trim().toLowerCase().slice(0, 2);
  if (code === "de" || code === "en") return planCardLines(plan, { language: code, context, highlightsOnly });
  return planCardLines(plan, { language: "en", context, highlightsOnly, texts: PLAN_FEATURE_TEXTS[code] || null });
}
