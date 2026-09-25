// ============================================================
// OmniFM: forms in Discord (#273)
// ============================================================
// Three forms instead of long slash options: add a station, plan an event,
// report a problem. Here the forms and what is read from them; the runtime
// side is runtime-methods/forms.js. A closed form sends nothing, so
// "cancel" needs no code: nothing is saved before a submit.
import {
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { NP_PREFIX } from "./runtime-shared.js";

export const FORM_PREFIX = "omnifm:form:";
export const STATION_FORM_ID = `${FORM_PREFIX}station`;
export const EVENT_FORM_ID = `${FORM_PREFIX}event`;
export const PROBLEM_REPORT_BUTTON_ID = `${NP_PREFIX}report`;
export const PROBLEM_REPORT_FORM_ID = `${NP_PREFIX}reportform`;

export const PROBLEM_REASONS = Object.freeze([
  { value: "no_sound", de: "Kein Ton", en: "No sound" },
  { value: "wrong_station", de: "Falscher Sender", en: "Wrong station" },
  { value: "stuck", de: "Hängt oder stockt", en: "Stuck or stuttering" },
  { value: "other", de: "Etwas anderes", en: "Something else" },
]);

function text(id, { style = TextInputStyle.Short, required = true, max = 100, min = 0, placeholder = "", value = "" } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  if (min) input.setMinLength(min);
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (value) input.setValue(value);
  return input;
}

function label(title, description = "") {
  const block = new LabelBuilder().setLabel(title.slice(0, 45));
  if (description) block.setDescription(description.slice(0, 100));
  return block;
}

function safeTextValue(fields, id) {
  try {
    return String(fields?.getTextInputValue?.(id) ?? "").trim();
  } catch {
    return "";
  }
}

function safeSelectValues(fields, id) {
  try {
    return fields?.getStringSelectValues?.(id) || [];
  } catch {
    return [];
  }
}

// ---- add a station (Ultimate) ----

/** A short key from a name: "Mein Vereinsradio!" -> "mein-vereinsradio". */
export function stationKeyFromName(name) {
  return String(name || "").toLowerCase().normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function buildStationFormModal({ t, genres = [] }) {
  const options = [
    ...genres.slice(0, 24).map((genre) => ({ label: genre.slice(0, 100), value: genre.slice(0, 100) })),
    { label: t("Anderes Genre", "Other genre"), value: "__other__" },
  ];
  return new ModalBuilder()
    .setCustomId(STATION_FORM_ID)
    .setTitle(t("Eigenen Sender hinzufügen", "Add your own station"))
    .addLabelComponents(
      label(t("Name", "Name"), t("So heißt der Sender in OmniFM", "What the station is called in OmniFM"))
        .setTextInputComponent(text("name", { max: 60, min: 2, placeholder: t("z. B. Vereinsradio", "e.g. Club radio") })),
      label(t("Stream-URL", "Stream URL"), t("Der direkte Link zum Audio-Stream", "The direct link to the audio stream"))
        .setTextInputComponent(text("url", { max: 500, min: 8, placeholder: "https://stream.example.com/live.mp3" })),
      label(t("Genre", "Genre"))
        .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId("genre").setRequired(false).setMinValues(0).setMaxValues(1).addOptions(options)),
      label(t("Kurzname (optional)", "Short key (optional)"), t("Leer lassen: wird aus dem Namen gebildet", "Leave empty: made from the name"))
        .setTextInputComponent(text("key", { required: false, max: 40, placeholder: "vereinsradio" })),
    );
}

/** { ok, station: { key, name, url, genre } } or { ok: false, error } with error "name" | "url" | "key". */
export function readStationForm(fields) {
  const name = safeTextValue(fields, "name").replace(/\s+/g, " ").slice(0, 60);
  const url = safeTextValue(fields, "url");
  const key = stationKeyFromName(safeTextValue(fields, "key") || name);
  const genre = safeSelectValues(fields, "genre")[0] || "";
  if (name.length < 2) return { ok: false, error: "name" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return { ok: false, error: "url" };
  if (!key) return { ok: false, error: "key" };
  return { ok: true, station: { key, name, url: parsed.toString(), genre: genre === "__other__" ? "" : genre } };
}

// ---- plan an event ----

export function buildEventFormModal({ t, repeatChoices = [], language = "de" }) {
  const repeatOptions = repeatChoices.slice(0, 25).map((entry) => ({
    label: String((language === "de" && entry.name_localizations?.de) || entry.name).slice(0, 100),
    value: entry.value,
    default: entry.value === "none",
  }));
  return new ModalBuilder()
    .setCustomId(EVENT_FORM_ID)
    .setTitle(t("Event planen", "Plan an event"))
    .addLabelComponents(
      label(t("Name", "Name"))
        .setTextInputComponent(text("name", { max: 120, min: 2, placeholder: t("z. B. Morgenshow", "e.g. Morning show") })),
      label(t("Sender", "Station"), t("Name oder Kurzname des Senders", "Name or key of the station"))
        .setTextInputComponent(text("station", { max: 120, placeholder: "Groove Salad" })),
      label(t("Sprachkanal", "Voice channel"))
        .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId("voice")
          .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setMinValues(1).setMaxValues(1)),
      label(t("Start", "Start"), t("TT.MM.JJJJ HH:MM, JJJJ-MM-TT HH:MM oder HH:MM", "DD.MM.YYYY HH:MM, YYYY-MM-DD HH:MM or HH:MM"))
        .setTextInputComponent(text("start", { max: 40, placeholder: t("z. B. 01.10.2026 20:00", "e.g. 2026-10-01 20:00") })),
      label(t("Wiederholung", "Repeat"))
        .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId("repeat").setMinValues(1).setMaxValues(1).addOptions(repeatOptions)),
    );
}

/** { name, stationRaw, voiceChannel, startRaw, repeat } from the submitted event form. */
export function readEventForm(fields) {
  let voiceChannel;
  try {
    voiceChannel = fields?.getSelectedChannels?.("voice")?.first?.() || null;
  } catch {
    voiceChannel = null;
  }
  return {
    name: safeTextValue(fields, "name"),
    stationRaw: safeTextValue(fields, "station"),
    voiceChannel,
    startRaw: safeTextValue(fields, "start"),
    repeat: safeSelectValues(fields, "repeat")[0] || "none",
  };
}

// ---- report a problem (now-playing panel) ----

export function buildProblemReportModal({ t }) {
  return new ModalBuilder()
    .setCustomId(PROBLEM_REPORT_FORM_ID)
    .setTitle(t("Problem melden", "Report a problem"))
    .addLabelComponents(
      label(t("Was ist los?", "What is wrong?"))
        .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId("reason").setMinValues(1).setMaxValues(1)
          .addOptions(PROBLEM_REASONS.map((reason) => ({ label: t(reason.de, reason.en), value: reason.value })))),
      label(t("Mehr dazu (optional)", "More about it (optional)"), t("Was hast du gehört oder gesehen?", "What did you hear or see?"))
        .setTextInputComponent(text("detail", { style: TextInputStyle.Paragraph, required: false, max: 500 })),
    );
}

/** { ok, reason, detail } - reason is one of PROBLEM_REASONS. */
export function readProblemReport(fields) {
  const reason = safeSelectValues(fields, "reason")[0] || "";
  if (!PROBLEM_REASONS.some((entry) => entry.value === reason)) return { ok: false, reason: "", detail: "" };
  return { ok: true, reason, detail: safeTextValue(fields, "detail").replace(/\s+/g, " ").slice(0, 500) };
}

export function problemReasonLabel(reason, t = (de) => de) {
  const entry = PROBLEM_REASONS.find((item) => item.value === reason);
  return entry ? t(entry.de, entry.en) : reason;
}
