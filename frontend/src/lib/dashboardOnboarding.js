export function resolveDashboardInviteUrls(inviteLinks) {
  const inviteBots = Array.isArray(inviteLinks?.bots) ? inviteLinks.bots : [];
  return {
    commanderInviteUrl: inviteBots.find((bot) => String(bot?.role || '').trim().toLowerCase() === 'commander' && bot?.inviteUrl)?.inviteUrl || '',
    workerInviteUrl: inviteBots.find((bot) => String(bot?.role || '').trim().toLowerCase() !== 'commander' && bot?.inviteUrl)?.inviteUrl || '',
  };
}

export function buildDashboardNextSetupAction({ setupStatus, inviteLinks, t }) {
  if (!setupStatus) return null;
  const { commanderInviteUrl, workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus.commanderReady) {
    return {
      eyebrow: t('Nächste Aktion', 'Next action'),
      title: t('Commander zuerst verbinden', 'Connect the commander first'),
      body: t(
        'Ohne den Hauptbot kann OmniFM diesen Server noch nicht sauber steuern.',
        'Without the main bot, OmniFM cannot manage this server cleanly yet.'
      ),
      inviteLabel: t('Commander einladen', 'Invite commander'),
      inviteUrl: commanderInviteUrl,
      command: '/setup',
    };
  }

  if (!setupStatus.workerInvited) {
    return {
      eyebrow: t('Nächste Aktion', 'Next action'),
      title: t('Nächster Schritt: ersten Worker einladen', 'Next step: invite the first worker'),
      body: t(
        'Sobald mindestens ein Worker auf dem Server ist, kann /play den eigentlichen Stream starten.',
        'As soon as at least one worker is on the server, /play can start the actual stream.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (!setupStatus.firstStreamLive) {
    return {
      eyebrow: t('Nächste Aktion', 'Next action'),
      title: t('Nächster Schritt: ersten Stream starten', 'Next step: start the first stream'),
      body: t(
        'Die Bot-Architektur ist bereit. Starte jetzt in Discord den ersten Sender mit /play.',
        'The bot setup is ready. Start the first station in Discord with /play now.'
      ),
      command: '/play',
    };
  }

  return {
    eyebrow: t('Nächste Aktion', 'Next action'),
    title: t('Setup abgeschlossen', 'Setup completed'),
    body: t(
      'Dieser Server ist startklar. Danach lohnen sich je nach Bedarf Events, Rechte und weitere Worker.',
      'This server is ready. From here, events, permissions, and more workers are the next useful upgrades.'
    ),
    command: '/setup',
  };
}

export function buildDashboardEventsHint({ setupStatus, inviteLinks, hasEvents, voiceChannelCount, t }) {
  if (hasEvents) return null;
  const { workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus?.workerInvited) {
    return {
      eyebrow: t('Events vorbereiten', 'Prepare events'),
      title: t('Vor dem ersten Event zuerst einen Worker einladen', 'Invite a worker before the first event'),
      body: t(
        'Geplante Events starten später automatisch Radio. Dafür muss mindestens ein Worker bereits auf diesem Server verfügbar sein.',
        'Scheduled events start radio automatically later on. For that, at least one worker already needs to be available on this server.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (Number(voiceChannelCount || 0) <= 0) {
    return {
      eyebrow: t('Events vorbereiten', 'Prepare events'),
      title: t('Es fehlt noch ein Ziel-Channel für Events', 'A target channel for events is still missing'),
      body: t(
        'Lege in Discord zuerst einen Voice- oder Stage-Channel an. Danach kann OmniFM das Event direkt dort starten.',
        'Create a voice or stage channel in Discord first. After that, OmniFM can start the event directly there.'
      ),
      command: '/setup',
      note: t(
        'Sobald der Channel sichtbar ist, kannst du darunter direkt dein erstes Event anlegen.',
        'As soon as the channel is visible, you can create your first event right below.'
      ),
    };
  }

  return {
    eyebrow: t('Events vorbereiten', 'Prepare events'),
    title: t('Lege dein erstes automatisches Radio-Event an', 'Create your first automated radio event'),
    body: t(
      'Wähle einen Sender, eine Startzeit und den Ziel-Channel. Die Presets unten helfen für schnelle Weekly- oder One-Time-Shows.',
      'Choose a station, a start time, and the target channel. The presets below help with quick weekly or one-time shows.'
    ),
    note: t(
      'Typischer Start: erst ein einmaliges Test-Event, danach ein Weekly-Preset.',
      'Typical start: first a one-time test event, then a weekly preset.'
    ),
  };
}

export function buildDashboardCustomStationsHint({ setupStatus, inviteLinks, hasStations, t }) {
  if (hasStations) return null;
  const { workerInviteUrl } = resolveDashboardInviteUrls(inviteLinks);

  if (!setupStatus?.workerInvited) {
    return {
      eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
      title: t('Schließe zuerst das Grundsetup ab', 'Finish the core setup first'),
      body: t(
        'Custom-Stationen lohnen sich am meisten, wenn der normale OmniFM-Flow bereits mit einem Worker läuft.',
        'Custom stations are most useful once the normal OmniFM flow already runs with a worker.'
      ),
      inviteLabel: t('Worker einladen', 'Invite worker'),
      inviteUrl: workerInviteUrl,
      command: '/workers',
    };
  }

  if (!setupStatus?.firstStreamLive) {
    return {
      eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
      title: t('Teste zuerst einen normalen Live-Stream', 'Test a normal live stream first'),
      body: t(
        'Wenn /play bereits sauber funktioniert, lassen sich eigene Stream-URLs später leichter prüfen und einordnen.',
        'Once /play works cleanly, your own stream URLs become much easier to verify and organize.'
      ),
      command: '/play',
      note: t(
        'Danach kannst du hier eigene URLs mit Ordnern und Tags strukturieren.',
        'After that, you can organize your own URLs here with folders and tags.'
      ),
    };
  }

  return {
    eyebrow: t('Custom-Streams vorbereiten', 'Prepare custom streams'),
    title: t('Füge deine erste eigene Stream-URL hinzu', 'Add your first own stream URL'),
    body: t(
      'Lege einen stabilen Namen, eine HTTPS-URL und bei Bedarf Ordner oder Tags fest. So wird aus Ultimate ein echter Operator-Workspace.',
      'Add a stable name, an HTTPS URL, and optional folders or tags. That turns Ultimate into a real operator workspace.'
    ),
    note: t(
      'Nutze Ordner für Quellen oder Formate und Tags für Themen wie news, club oder chill.',
      'Use folders for sources or formats and tags for topics like news, club, or chill.'
    ),
  };
}

export function buildDashboardPermissionsHint({ setupStatus, availableRoleCount, hasRestrictedCommands, t }) {
  if (Number(availableRoleCount || 0) <= 0) {
    if (!setupStatus?.commanderReady) {
      return {
        eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
        title: t('Verbinde zuerst den Commander mit diesem Server', 'Connect the commander to this server first'),
        body: t(
          'Ohne den Hauptbot können Discord-Rollen hier noch nicht sauber geladen und zugeordnet werden.',
          'Without the main bot, Discord roles cannot be loaded and assigned cleanly here yet.'
        ),
        command: '/setup',
      };
    }

    return {
      eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
      title: t('Discord-Rollen sind gerade noch nicht verfügbar', 'Discord roles are not available yet'),
      body: t(
        'OmniFM konnte für diesen Server noch keine Rollen laden. Prüfe kurz, ob der Bot verbunden ist und Discord die Rollenliste liefert.',
        'OmniFM could not load roles for this server yet. Check whether the bot is connected and Discord returns the role list.'
      ),
      command: '/setup',
      note: t(
        'Sobald Rollen geladen sind, kannst du unten /play, /stop oder /event gezielt absichern.',
        'As soon as roles are loaded, you can protect /play, /stop, or /event below.'
      ),
    };
  }

  if (!hasRestrictedCommands) {
    return {
      eyebrow: t('Berechtigungen vorbereiten', 'Prepare permissions'),
      title: t('Commands sind aktuell noch für alle offen', 'Commands are currently open to everyone'),
      body: t(
        'Ein sauberer Start ist meist: /play, /stop und /event nur für DJ- oder Admin-Rollen freigeben.',
        'A clean starting point is usually to allow /play, /stop, and /event only for DJ or admin roles.'
      ),
      note: t(
        'OmniFM blockiert hier nichts automatisch. Du entscheidest pro Command, welche Rollen wirklich dürfen.',
        'OmniFM does not block anything automatically here. You decide per command which roles are actually allowed.'
      ),
    };
  }

  return null;
}

export function buildDashboardWeeklyDigestHint({ setupStatus, weeklyDigest, textChannelCount, t }) {
  const digest = weeklyDigest && typeof weeklyDigest === 'object'
    ? weeklyDigest
    : { enabled: false, channelId: '' };

  if (Number(textChannelCount || 0) <= 0) {
    return {
      eyebrow: t('Digest vorbereiten', 'Prepare digest'),
      title: t('Es fehlt noch ein Text-Channel für den Digest', 'A text channel for the digest is still missing'),
      body: t(
        'Lege in Discord zuerst einen Text-Channel für Reports oder Bot-Updates an. Danach kann der Weekly Digest sauber geplant werden.',
        'Create a text channel for reports or bot updates in Discord first. After that, the weekly digest can be scheduled cleanly.'
      ),
      command: '/setup',
    };
  }

  if (!setupStatus?.firstStreamLive) {
    return {
      eyebrow: t('Digest vorbereiten', 'Prepare digest'),
      title: t('Sammle zuerst die ersten echten Laufdaten', 'Collect the first real runtime data first'),
      body: t(
        'Der Weekly Digest wird deutlich wertvoller, sobald auf diesem Server bereits Sessions, Zuhörer und Senderstarts vorhanden sind.',
        'The weekly digest becomes much more valuable once this server already has sessions, listeners, and station starts.'
      ),
      command: '/play',
      note: t(
        'Du kannst ihn schon vorbereiten, aber der Nutzen steigt nach dem ersten echten Stream deutlich.',
        'You can prepare it already, but it becomes much more useful after the first real stream.'
      ),
    };
  }

  if (digest.enabled !== true) {
    return {
      eyebrow: t('Digest vorbereiten', 'Prepare digest'),
      title: t('Aktiviere den Weekly Digest für diesen Server', 'Enable the weekly digest for this server'),
      body: t(
        'Wähle einen Channel, einen Wochentag und eine Sprache. So bekommt dein Team automatisch einen kompakten Wochenbericht.',
        'Choose a channel, weekday, and language. That gives your team an automatic compact weekly report.'
      ),
    };
  }

  if (!String(digest.channelId || '').trim()) {
    return {
      eyebrow: t('Digest vorbereiten', 'Prepare digest'),
      title: t('Dem Digest fehlt noch sein Ziel-Channel', 'The digest still needs its target channel'),
      body: t(
        'Der Digest ist bereits aktiv, aber ohne Ziel-Channel kann OmniFM nichts ausliefern.',
        'The digest is already enabled, but without a target channel OmniFM cannot deliver anything.'
      ),
    };
  }

  return null;
}

export function buildDashboardFailoverHint({ setupStatus, failoverChainLength, t }) {
  if (!setupStatus?.workerInvited) {
    return {
      eyebrow: t('Failover vorbereiten', 'Prepare failover'),
      title: t('Erst Worker und normales Playback sauber aufsetzen', 'Set up workers and normal playback cleanly first'),
      body: t(
        'Failover baut auf dem normalen Streaming-Flow auf. Invite zuerst mindestens einen Worker und teste dann /play.',
        'Failover builds on the normal streaming flow. Invite at least one worker first and then test /play.'
      ),
      command: '/setup',
    };
  }

  if (!setupStatus?.firstStreamLive) {
    return {
      eyebrow: t('Failover vorbereiten', 'Prepare failover'),
      title: t('Teste zuerst den regulären Stream', 'Test the regular stream first'),
      body: t(
        'Sobald der erste Sender stabil läuft, kannst du hier gezielt die erste Ausweichstation hinterlegen.',
        'As soon as the first station runs reliably, you can define the first fallback station here.'
      ),
      command: '/play',
    };
  }

  if (Number(failoverChainLength || 0) <= 0) {
    return {
      eyebrow: t('Failover vorbereiten', 'Prepare failover'),
      title: t('Lege die erste Ausweichstation fest', 'Define the first fallback station'),
      body: t(
        'Wenn ein Stream hart ausfällt, kann OmniFM damit direkt auf eine andere Station springen statt nur stumpf neu zu verbinden.',
        'If a stream fails hard, OmniFM can jump directly to another station instead of only reconnecting blindly.'
      ),
    };
  }

  return null;
}

export function buildDashboardExportsHint({ setupStatus, exportsWebhook, t }) {
  const webhook = exportsWebhook && typeof exportsWebhook === 'object'
    ? exportsWebhook
    : { enabled: false, url: '', events: [] };

  if (!setupStatus?.firstStreamLive) {
    return {
      eyebrow: t('Webhooks vorbereiten', 'Prepare webhooks'),
      title: t('Warte auf die ersten echten Server-Daten', 'Wait for the first real server data'),
      body: t(
        'Exporte sowie Recovery- und Failover-Alerts sind besonders hilfreich, sobald bereits Statistiken, Custom Stations oder echte Laufzeitereignisse anfallen.',
        'Exports as well as recovery and failover alerts are especially helpful once statistics, custom stations, or real runtime events already exist.'
      ),
      command: '/play',
    };
  }

  if (!String(webhook.url || '').trim()) {
    return {
      eyebrow: t('Webhooks vorbereiten', 'Prepare webhooks'),
      title: t('Hinterlege zuerst eine Webhook-URL', 'Add a webhook URL first'),
      body: t(
        'Mit einer Ziel-URL kann OmniFM Exporte, Testnachrichten und später auch Recovery- oder Failover-Alerts sauber an dein eigenes System übergeben.',
        'With a target URL, OmniFM can hand off exports, test messages, and later also recovery or failover alerts cleanly to your own system.'
      ),
    };
  }

  if (webhook.enabled !== true) {
    return {
      eyebrow: t('Webhooks vorbereiten', 'Prepare webhooks'),
      title: t('Aktiviere den Webhook, sobald URL und Secret passen', 'Enable the webhook once URL and secret are ready'),
      body: t(
        'Der Endpoint ist hinterlegt. Jetzt kannst du Events auswählen und den Webhook bewusst aktiv schalten.',
        'The endpoint is saved. Now you can choose events and deliberately enable the webhook.'
      ),
    };
  }

  if (!Array.isArray(webhook.events) || webhook.events.length <= 0) {
    return {
      eyebrow: t('Webhooks vorbereiten', 'Prepare webhooks'),
      title: t('Wähle mindestens ein Webhook-Event aus', 'Select at least one webhook event'),
      body: t(
        'Ohne ausgewählte Events bleibt der Webhook aktiv, aber er wird nie etwas senden.',
        'Without selected events, the webhook stays enabled but it will never send anything.'
      ),
    };
  }

  return null;
}
