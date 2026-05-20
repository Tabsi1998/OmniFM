import { ChannelType, SlashCommandBuilder } from "discord.js";
import { getPermissionCommandChoices } from "./config/command-permissions.js";

const DE = "de";

function de(value) {
  return { [DE]: value };
}

function describe(target, english, german) {
  return target
    .setDescription(english)
    .setDescriptionLocalizations(de(german));
}

function choice(name, value, germanName = name) {
  return {
    name,
    value,
    name_localizations: de(germanName),
  };
}

function withStringOption(target, name, english, german, { required = false, autocomplete = false } = {}) {
  return target.addStringOption((option) => {
    option
      .setName(name)
      .setDescription(english)
      .setDescriptionLocalizations(de(german))
      .setRequired(required);
    if (autocomplete) option.setAutocomplete(true);
    return option;
  });
}

function withIntegerOption(target, name, english, german, { required = false } = {}) {
  return target.addIntegerOption((option) => option
    .setName(name)
    .setDescription(english)
    .setDescriptionLocalizations(de(german))
    .setRequired(required));
}

function withBooleanOption(target, name, english, german, { required = false } = {}) {
  return target.addBooleanOption((option) => option
    .setName(name)
    .setDescription(english)
    .setDescriptionLocalizations(de(german))
    .setRequired(required));
}

function withRoleOption(target, name, english, german, { required = false } = {}) {
  return target.addRoleOption((option) => option
    .setName(name)
    .setDescription(english)
    .setDescriptionLocalizations(de(german))
    .setRequired(required));
}

function withChannelOption(target, name, english, german, channelTypes, { required = false } = {}) {
  return target.addChannelOption((option) => option
    .setName(name)
    .setDescription(english)
    .setDescriptionLocalizations(de(german))
    .addChannelTypes(...channelTypes)
    .setRequired(required));
}

function buildRepeatChoices() {
  return [
    choice("One-time", "none", "Einmalig"),
    choice("Daily", "daily", "Täglich"),
    choice("Weekdays (Mon-Fri)", "weekdays", "Werktags (Mo-Fr)"),
    choice("Weekly (same weekday)", "weekly", "Wöchentlich (gleicher Wochentag)"),
    choice("Every 2 weeks (same weekday)", "biweekly", "Alle 2 Wochen (gleicher Wochentag)"),
    choice("Yearly (same date)", "yearly", "Jährlich (gleiches Datum)"),
    choice("Monthly: 1st weekday", "monthly_first_weekday", "Monatlich: 1. Wochentag"),
    choice("Monthly: 2nd weekday", "monthly_second_weekday", "Monatlich: 2. Wochentag"),
    choice("Monthly: 3rd weekday", "monthly_third_weekday", "Monatlich: 3. Wochentag"),
    choice("Monthly: 4th weekday", "monthly_fourth_weekday", "Monatlich: 4. Wochentag"),
    choice("Monthly: last weekday", "monthly_last_weekday", "Monatlich: letzter Wochentag"),
  ];
}

export function buildCommandBuilders() {
  const permissionChoices = getPermissionCommandChoices();
  const repeatChoices = buildRepeatChoices();

  const help = describe(
    new SlashCommandBuilder().setName("help"),
    "Show all commands and short explanations",
    "Zeigt alle Befehle und kurze Erklärungen"
  );

  const setup = describe(
    new SlashCommandBuilder().setName("setup"),
    "Show the guided first-run setup for this server",
    "Zeigt den geführten Erststart für diesen Server"
  );

  const play = describe(
    new SlashCommandBuilder().setName("play"),
    "Start a radio stream in your voice channel",
    "Startet einen Radio-Stream in deinem Voice-Channel"
  );
  withStringOption(play, "station", "Station name or ID", "Stationsname oder ID", { autocomplete: true });
  withChannelOption(
    play,
    "voice",
    "Voice or stage channel (optional)",
    "Voice- oder Stage-Channel (optional)",
    [ChannelType.GuildVoice, ChannelType.GuildStageVoice]
  );
  withIntegerOption(play, "bot", "Visible OmniFM bot number (for example 2 for OmniFM 2, optional)", "Sichtbare OmniFM-Botnummer (z. B. 2 fuer OmniFM 2, optional)");

  const pause = describe(
    new SlashCommandBuilder().setName("pause"),
    "Pause playback",
    "Wiedergabe pausieren"
  );
  withIntegerOption(pause, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");

  const resume = describe(
    new SlashCommandBuilder().setName("resume"),
    "Resume playback",
    "Wiedergabe fortsetzen"
  );
  withIntegerOption(resume, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");

  const stop = describe(
    new SlashCommandBuilder().setName("stop"),
    "Stop playback and leave the channel",
    "Stoppen und Channel verlassen"
  );
  withIntegerOption(stop, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");
  withBooleanOption(stop, "all", "Stop all workers (optional)", "Alle Worker stoppen (optional)");

  const stations = describe(
    new SlashCommandBuilder().setName("stations"),
    "Show stations available for your plan",
    "Verfügbare Stationen für deinen Plan anzeigen"
  );

  const now = describe(
    new SlashCommandBuilder().setName("now"),
    "Show what is currently playing",
    "Zeigt, was gerade läuft"
  );
  withIntegerOption(now, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");

  const stats = describe(
    new SlashCommandBuilder().setName("stats"),
    "Show listening and usage statistics for this server",
    "Zeigt Hör- und Nutzungsstatistiken für diesen Server"
  );

  const history = describe(
    new SlashCommandBuilder().setName("history"),
    "Show recently detected songs",
    "Zeigt die zuletzt erkannten Songs"
  );
  withIntegerOption(history, "limit", "Number of entries (1-20)", "Anzahl Einträge (1-20)");
  withIntegerOption(history, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");

  const setvolume = describe(
    new SlashCommandBuilder().setName("setvolume"),
    "Set the playback volume (0-100)",
    "Lautstärke setzen (0-100)"
  );
  withIntegerOption(setvolume, "value", "0 to 100", "0 bis 100", { required: true });
  withIntegerOption(setvolume, "bot", "Visible OmniFM bot number (optional)", "Sichtbare OmniFM-Botnummer (optional)");

  const status = describe(
    new SlashCommandBuilder().setName("status"),
    "Show bot status and uptime",
    "Bot-Status und Uptime anzeigen"
  );
  withIntegerOption(status, "bot", "Worker bot slot (optional)", "Worker-Bot-Slot (optional)");

  const list = describe(
    new SlashCommandBuilder().setName("list"),
    "List stations with pagination",
    "Stationen auflisten (paginiert)"
  );
  withIntegerOption(list, "page", "Page number", "Seitennummer");

  const health = describe(
    new SlashCommandBuilder().setName("health"),
    "Show stream health and reconnect details",
    "Stream-Health und Reconnect-Info anzeigen"
  );
  withIntegerOption(health, "bot", "Worker bot slot (optional)", "Worker-Bot-Slot (optional)");

  const diag = describe(
    new SlashCommandBuilder().setName("diag"),
    "Show diagnostics for audio, FFmpeg, and stream details",
    "Diagnose: Audio-, FFmpeg- und Stream-Details anzeigen"
  );
  withIntegerOption(diag, "bot", "Worker bot slot (optional)", "Worker-Bot-Slot (optional)");

  const premium = describe(
    new SlashCommandBuilder().setName("premium"),
    "Show this server's premium status",
    "OmniFM-Premium-Status dieses Servers anzeigen"
  );

  const language = describe(
    new SlashCommandBuilder().setName("language"),
    "Manage the language for this server",
    "Sprache für diesen Server verwalten"
  )
    .addSubcommand((sub) => describe(sub.setName("show"), "Show the active language", "Aktive Sprache anzeigen"))
    .addSubcommand((sub) => describe(sub.setName("set"), "Set the language explicitly", "Sprache fest einstellen")
      .addStringOption((option) => option
        .setName("value")
        .setDescription("Language")
        .setDescriptionLocalizations(de("Sprache"))
        .setRequired(true)
        .addChoices(
          choice("German", "de", "Deutsch"),
          choice("English", "en", "Englisch")
        )))
    .addSubcommand((sub) => describe(sub.setName("reset"), "Return to automatic language selection", "Automatische Sprachwahl wieder aktivieren"));

  const addstation = describe(
    new SlashCommandBuilder().setName("addstation"),
    "[Ultimate] Add your own station URL",
    "[Ultimate] Eigene Stations-URL hinzufügen"
  );
  withStringOption(addstation, "key", "Short key (for example mystation)", "Kurzer Key (z. B. mystation)", { required: true });
  withStringOption(addstation, "name", "Display name", "Anzeigename", { required: true });
  withStringOption(addstation, "url", "Stream URL (http/https)", "Stream-URL (http/https)", { required: true });

  const removestation = describe(
    new SlashCommandBuilder().setName("removestation"),
    "[Ultimate] Remove a custom station",
    "[Ultimate] Eigene Station entfernen"
  );
  withStringOption(removestation, "key", "Station key", "Stations-Key", { required: true, autocomplete: true });

  const mystations = describe(
    new SlashCommandBuilder().setName("mystations"),
    "[Ultimate] Show your custom stations",
    "[Ultimate] Eigene Stationen anzeigen"
  );

  const event = describe(
    new SlashCommandBuilder().setName("event"),
    "[Pro] Schedule automatic radio events",
    "[Pro] Event-Scheduler für automatische Starts"
  )
    .addSubcommand((sub) => {
      describe(sub.setName("create"), "Create a new scheduled event", "Neues Event planen");
      withStringOption(sub, "name", "Event name (for example Morning Show)", "Eventname (z. B. Morning Show)", { required: true });
      withStringOption(sub, "station", "Station key", "Stations-Key", { required: true, autocomplete: true });
      withChannelOption(sub, "voice", "Voice or stage channel", "Voice- oder Stage-Channel", [ChannelType.GuildVoice, ChannelType.GuildStageVoice], { required: true });
      withStringOption(sub, "start", "Start: DD.MM.YYYY HH:MM, YYYY-MM-DD HH:MM, or HH:MM", "Start komplett: DD.MM.YYYY HH:MM, YYYY-MM-DD HH:MM oder HH:MM");
      withStringOption(sub, "startdate", "Optional start date (DD.MM.YYYY, YYYY-MM-DD, today/tomorrow)", "Optional: Startdatum (DD.MM.YYYY, YYYY-MM-DD, heute/morgen)");
      withStringOption(sub, "starttime", "Optional start time (HH:MM)", "Optional: Startzeit (HH:MM)");
      withStringOption(sub, "end", "Optional end: DD.MM.YYYY HH:MM or YYYY-MM-DD HH:MM", "Optionales Ende: DD.MM.YYYY HH:MM oder YYYY-MM-DD HH:MM");
      withStringOption(sub, "enddate", "Optional end date (DD.MM.YYYY or YYYY-MM-DD)", "Optional: Enddatum (DD.MM.YYYY oder YYYY-MM-DD)");
      withStringOption(sub, "endtime", "Optional end time (HH:MM)", "Optional: Endzeit (HH:MM)");
      withStringOption(sub, "timezone", "Time zone (for example Europe/Berlin, CET, MEZ)", "Zeitzone (z. B. Europe/Berlin, CET, MEZ)", { autocomplete: true });
      sub.addStringOption((option) => option
        .setName("repeat")
        .setDescription("Repeat mode")
        .setDescriptionLocalizations(de("Wiederholung"))
        .setRequired(false)
        .addChoices(...repeatChoices));
      withChannelOption(sub, "text", "Optional text channel for the announcement", "Optionaler Text-Channel für die Ankündigung", [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
      withBooleanOption(sub, "serverevent", "Create a Discord server event automatically", "Discord-Server-Event automatisch anlegen");
      withStringOption(sub, "stagetopic", "Optional stage topic ({event},{station},{time})", "Optionales Stage-Thema ({event},{station},{time})");
      withStringOption(sub, "message", "Optional message ({event},{station},{voice},{time})", "Optionale Nachricht ({event},{station},{voice},{time})");
      withStringOption(sub, "description", "Optional event description for Discord server events", "Optionale Event-Beschreibung für Discord-Server-Events");
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("edit"), "Edit a scheduled event", "Geplantes Event bearbeiten");
      withStringOption(sub, "id", "Event ID", "Event-ID", { required: true, autocomplete: true });
      withStringOption(sub, "name", "New event name", "Neuer Eventname");
      withStringOption(sub, "station", "New station key", "Neuer Stations-Key", { autocomplete: true });
      withChannelOption(sub, "voice", "New voice or stage channel", "Neuer Voice- oder Stage-Channel", [ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
      withStringOption(sub, "start", "New start time: DD.MM.YYYY HH:MM, YYYY-MM-DD HH:MM, or HH:MM", "Neue Startzeit: DD.MM.YYYY HH:MM, YYYY-MM-DD HH:MM oder HH:MM");
      withStringOption(sub, "startdate", "New start date (DD.MM.YYYY, YYYY-MM-DD, today/tomorrow)", "Neues Startdatum (DD.MM.YYYY, YYYY-MM-DD, heute/morgen)");
      withStringOption(sub, "starttime", "New start time (HH:MM)", "Neue Startzeit (HH:MM)");
      withStringOption(sub, "end", "New end time or clear to remove it", "Neue Endzeit oder clear zum Entfernen");
      withStringOption(sub, "enddate", "New end date (DD.MM.YYYY or YYYY-MM-DD)", "Neues Enddatum (DD.MM.YYYY oder YYYY-MM-DD)");
      withStringOption(sub, "endtime", "New end time (HH:MM)", "Neue Endzeit (HH:MM)");
      withStringOption(sub, "timezone", "New time zone", "Neue Zeitzone", { autocomplete: true });
      sub.addStringOption((option) => option
        .setName("repeat")
        .setDescription("New repeat mode")
        .setDescriptionLocalizations(de("Neue Wiederholung"))
        .setRequired(false)
        .addChoices(...repeatChoices));
      withChannelOption(sub, "text", "New text channel for the announcement", "Neuer Text-Channel für die Ankündigung", [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
      withBooleanOption(sub, "cleartext", "Remove the announcement channel", "Ankündigungs-Channel entfernen");
      withBooleanOption(sub, "serverevent", "Enable or disable the Discord server event", "Discord-Server-Event an- oder ausschalten");
      withStringOption(sub, "stagetopic", "New stage topic or clear to remove it", "Neues Stage-Thema oder clear zum Entfernen");
      withStringOption(sub, "message", "New message or clear to remove it", "Neue Nachricht oder clear zum Entfernen");
      withStringOption(sub, "description", "New event description or clear to remove it", "Neue Event-Beschreibung oder clear zum Entfernen");
      withBooleanOption(sub, "enabled", "Enable or disable the event", "Event aktivieren oder deaktivieren");
      return sub;
    })
    .addSubcommand((sub) => describe(sub.setName("list"), "Show scheduled events", "Geplante Events anzeigen"))
    .addSubcommand((sub) => {
      describe(sub.setName("delete"), "Delete a scheduled event", "Event entfernen");
      withStringOption(sub, "id", "Event ID", "Event-ID", { required: true, autocomplete: true });
      return sub;
    });

  const license = describe(
    new SlashCommandBuilder().setName("license"),
    "Manage licenses for this server",
    "Lizenz für diesen Server verwalten"
  )
    .addSubcommand((sub) => {
      describe(sub.setName("activate"), "Activate a license key for this server", "Lizenz-Key für diesen Server aktivieren");
      withStringOption(sub, "key", "Your license key (for example OMNI-XXXX-XXXX-XXXX)", "Dein Lizenz-Key (z. B. OMNI-XXXX-XXXX-XXXX)", { required: true });
      return sub;
    })
    .addSubcommand((sub) => describe(sub.setName("info"), "Show license information for this server", "Lizenz-Info für diesen Server anzeigen"))
    .addSubcommand((sub) => describe(sub.setName("remove"), "Remove this server from the license", "Diesen Server von der Lizenz entfernen"));

  const perm = describe(
    new SlashCommandBuilder().setName("perm"),
    "[Pro] Manage role permissions for commands",
    "[Pro] Rollenrechte für Commands verwalten"
  )
    .addSubcommand((sub) => {
      describe(sub.setName("allow"), "Allow a role to use a command", "Erlaubt einer Rolle einen Command");
      sub.addStringOption((option) => option
        .setName("command")
        .setDescription("Command without /")
        .setDescriptionLocalizations(de("Command ohne /"))
        .setRequired(true)
        .addChoices(...permissionChoices));
      withRoleOption(sub, "role", "Role that may use the command", "Rolle, die den Command nutzen darf", { required: true });
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("deny"), "Block a role from using a command", "Sperrt eine Rolle für einen Command");
      sub.addStringOption((option) => option
        .setName("command")
        .setDescription("Command without /")
        .setDescriptionLocalizations(de("Command ohne /"))
        .setRequired(true)
        .addChoices(...permissionChoices));
      withRoleOption(sub, "role", "Role that should be blocked", "Rolle, die gesperrt werden soll", { required: true });
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("remove"), "Remove a role rule from a command", "Entfernt eine Rollenregel für einen Command");
      sub.addStringOption((option) => option
        .setName("command")
        .setDescription("Command without /")
        .setDescriptionLocalizations(de("Command ohne /"))
        .setRequired(true)
        .addChoices(...permissionChoices));
      withRoleOption(sub, "role", "Role whose rule should be removed", "Rolle, deren Regel entfernt werden soll", { required: true });
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("list"), "Show the current role rules for commands", "Zeigt die aktuellen Command-Rollenregeln");
      sub.addStringOption((option) => option
        .setName("command")
        .setDescription("Optional: show only one command")
        .setDescriptionLocalizations(de("Optional: nur einen Command anzeigen"))
        .setRequired(false)
        .addChoices(...permissionChoices));
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("reset"), "Reset rules for one command or all commands", "Setzt Regeln für einen Command oder alle zurück");
      sub.addStringOption((option) => option
        .setName("command")
        .setDescription("Optional: reset only this command")
        .setDescriptionLocalizations(de("Optional: nur diesen Command zurücksetzen"))
        .setRequired(false)
        .addChoices(...permissionChoices));
      return sub;
    });

  const invite = describe(
    new SlashCommandBuilder().setName("invite"),
    "Invite or select a worker bot for this server",
    "Worker-Bot für diesen Server auswählen oder einladen"
  );
  withIntegerOption(invite, "worker", "Worker bot slot (1-16)", "Worker-Bot-Slot (1-16)");

  const workers = describe(
    new SlashCommandBuilder().setName("workers"),
    "Show worker status and available slots on this server",
    "Zeigt Worker-Status und verfügbare Slots auf diesem Server"
  );
  workers.addStringOption((option) => option
    .setName("view")
    .setDescription("Where to show the worker status")
    .setDescriptionLocalizations(de("Wo der Worker-Status angezeigt werden soll"))
    .setRequired(false)
    .addChoices(
      choice("Private (ephemeral)", "private", "Privat (ephemeral)"),
      choice("Server panel", "panel", "Server-Panel")
    ));

  const voiceguard = describe(
    new SlashCommandBuilder().setName("voiceguard"),
    "Manage the voice move guard for this server",
    "Voice-Move-Guard für diesen Server verwalten"
  )
    .addSubcommand((sub) => {
      describe(sub.setName("status"), "Show the current voice guard status", "Aktuellen Voice-Guard-Status anzeigen");
      withIntegerOption(sub, "bot", "Optional worker slot for split mode", "Optionaler Worker-Slot fuer Split-Mode", { required: false });
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("policy"), "Set the server policy for foreign voice moves", "Server-Policy für Fremdverschiebungen setzen");
      sub.addStringOption((option) => option
        .setName("value")
        .setDescription("Policy")
        .setDescriptionLocalizations(de("Policy"))
        .setRequired(true)
        .addChoices(
          choice("Default", "default", "Standard"),
          choice("Allow", "allow", "Erlauben"),
          choice("Return", "return", "Zurückspringen"),
          choice("Disconnect", "disconnect", "Disconnect")
        ));
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("unlock"), "Temporarily allow intentional voice moves", "Bewusste Voice-Moves temporär erlauben");
      withIntegerOption(sub, "minutes", "Unlock duration in minutes", "Unlock-Dauer in Minuten", { required: false });
      withIntegerOption(sub, "bot", "Optional worker slot for split mode", "Optionaler Worker-Slot fuer Split-Mode", { required: false });
      return sub;
    })
    .addSubcommand((sub) => {
      describe(sub.setName("lock"), "End a temporary unlock immediately", "Temporären Unlock sofort beenden");
      withIntegerOption(sub, "bot", "Optional worker slot for split mode", "Optionaler Worker-Slot fuer Split-Mode", { required: false });
      return sub;
    });

  return [
    help,
    setup,
    play,
    pause,
    resume,
    stop,
    stations,
    now,
    stats,
    history,
    setvolume,
    status,
    list,
    health,
    diag,
    premium,
    language,
    addstation,
    removestation,
    mystations,
    event,
    license,
    perm,
    invite,
    workers,
    voiceguard,
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((command) => command.toJSON());
}
