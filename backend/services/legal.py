"""Language detection and the public legal texts (imprint, privacy, terms).

Moved out of server.py (#200). server.py calls bind() with itself; names
defined in server.py are read as core.<name> at call time, and server.py
offers every function here as server.<name> again.
"""
from datetime import datetime
from datetime import timezone
import os
import re

core = None  # the server module, set by bind()


def bind(module):
    global core
    core = module


def extract_mailbox(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return ""
    bracket_match = re.search(r"<([^>]+)>", text)
    if bracket_match and bracket_match.group(1):
        return bracket_match.group(1).strip()
    plain_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.IGNORECASE)
    return plain_match.group(0) if plain_match else ""


def normalize_language(language, fallback="de"):
    value = str(language or "").strip().lower()
    if value.startswith("de"):
        return "de"
    if value.startswith("en"):
        return "en"
    fb = str(fallback or "de").strip().lower()
    return "en" if fb.startswith("en") else "de"


def resolve_language_from_accept_language(accept_language, fallback="de"):
    raw = str(accept_language or "").strip()
    if not raw:
        return core.normalize_language(None, fallback)
    for part in raw.split(","):
        token = part.split(";")[0].strip()
        if token:
            return core.normalize_language(token, fallback)
    return core.normalize_language(None, fallback)


def is_pro_trial_enabled():
    return (os.environ.get("PRO_TRIAL_ENABLED") or "1").strip() != "0"


def sanitize_offer_code(raw_code):
    return re.sub(r"[^A-Z0-9_-]", "", str(raw_code or "").strip().upper())[:50]


def build_public_legal_notice():
    public_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    fallback_email = core.extract_mailbox(core.system_setting("smtp", "from", "SMTP_FROM") or "")
    c = core.get_config_section("company")

    def val(field, env_key, default=""):
        v = str(c.get(field) or "").strip()
        if v:
            return v
        return str(os.environ.get(env_key) or "").strip() or default

    kleinunternehmer = bool(c.get("kleinunternehmer", True))
    legal = {
        "providerName": val("providerName", "LEGAL_PROVIDER_NAME"),
        "legalForm": val("legalForm", "LEGAL_LEGAL_FORM"),
        "representative": val("representative", "LEGAL_REPRESENTATIVE"),
        "streetAddress": val("streetAddress", "LEGAL_STREET_ADDRESS"),
        "postalCode": val("postalCode", "LEGAL_POSTAL_CODE"),
        "city": val("city", "LEGAL_CITY"),
        "country": val("country", "LEGAL_COUNTRY", "\u00d6sterreich"),
        "email": val("email", "LEGAL_EMAIL") or fallback_email,
        "phone": val("phone", "LEGAL_PHONE"),
        "website": val("website", "LEGAL_WEBSITE") or public_url,
        "businessPurpose": val("businessPurpose", "LEGAL_BUSINESS_PURPOSE"),
        "commercialRegisterNumber": val("commercialRegisterNumber", "LEGAL_COMMERCIAL_REGISTER_NUMBER"),
        "commercialRegisterCourt": val("commercialRegisterCourt", "LEGAL_COMMERCIAL_REGISTER_COURT"),
        "vatId": val("vatId", "LEGAL_VAT_ID"),
        "supervisoryAuthority": val("supervisoryAuthority", "LEGAL_SUPERVISORY_AUTHORITY"),
        "chamber": val("chamber", "LEGAL_CHAMBER"),
        "profession": val("profession", "LEGAL_PROFESSION"),
        "professionRules": val("professionRules", "LEGAL_PROFESSION_RULES"),
        "editorialResponsible": val("editorialResponsible", "LEGAL_EDITORIAL_RESPONSIBLE"),
        "mediaOwner": val("mediaOwner", "LEGAL_MEDIA_OWNER"),
        "mediaLine": val("mediaLine", "LEGAL_MEDIA_LINE"),
        "kleinunternehmer": kleinunternehmer,
        "taxNote": "Umsatzsteuerbefreit als Kleinunternehmer gem\u00e4\u00df \u00a7 6 Abs. 1 Z 27 UStG (keine Umsatzsteuer, kein USt-Ausweis)." if kleinunternehmer else "",
    }

    missing_core_fields = []
    if not legal["providerName"]:
        missing_core_fields.append("providerName")
    if not legal["streetAddress"]:
        missing_core_fields.append("streetAddress")
    if not legal["postalCode"]:
        missing_core_fields.append("postalCode")
    if not legal["city"]:
        missing_core_fields.append("city")
    if not legal["email"]:
        missing_core_fields.append("email")

    return {
        "legal": legal,
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _console_first():
    """What the owner typed in the console first, then the environment (#444):
    an old PRIVACY_* or TERMS_* line in .env must not hide a console value.
    Reads the stored section, so the console's defaults do not win over .env."""
    saved = core.load_owner_config_raw().get("company")
    saved = saved if isinstance(saved, dict) else {}

    def pick(field, env_key):
        return str(saved.get(field) or "").strip() or (os.environ.get(env_key) or "").strip()

    return pick


def build_public_privacy_notice():
    legal_notice = core.build_public_legal_notice()
    legal = legal_notice.get("legal", {})
    pick = _console_first()
    has_smtp = bool(core.system_setting("smtp", "host", "SMTP_HOST"))
    bot_id_candidate = str(core.directory_setting("discordBotList", "botId", "DISCORDBOTLIST_BOT_ID") or os.environ.get("BOT_1_CLIENT_ID") or "").strip()
    has_discordbotlist = core.config_bool(core.directory_setting("discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", False)) and bool(str(core.directory_setting("discordBotList", "token", "DISCORDBOTLIST_TOKEN") or "").strip()) and bool(re.match(r"^\d{17,22}$", bot_id_candidate))
    has_recognition = core.config_bool(core.system_setting("audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", False)) and bool(core.system_setting("audioRecognition", "apiKey", "ACOUSTID_API_KEY"))

    controller = {
        "name": pick("providerName", "PRIVACY_CONTROLLER_NAME") or legal.get("providerName", ""),
        "representative": pick("representative", "PRIVACY_CONTROLLER_REPRESENTATIVE") or legal.get("representative", ""),
        "streetAddress": pick("streetAddress", "PRIVACY_CONTROLLER_STREET_ADDRESS") or legal.get("streetAddress", ""),
        "postalCode": pick("postalCode", "PRIVACY_CONTROLLER_POSTAL_CODE") or legal.get("postalCode", ""),
        "city": pick("city", "PRIVACY_CONTROLLER_CITY") or legal.get("city", ""),
        "country": pick("country", "PRIVACY_CONTROLLER_COUNTRY") or legal.get("country", "") or "Österreich",
        "website": pick("website", "PRIVACY_CONTROLLER_WEBSITE") or legal.get("website", ""),
    }
    contact = {
        "email": pick("email", "PRIVACY_CONTACT_EMAIL") or legal.get("email", ""),
        "phone": pick("phone", "PRIVACY_CONTACT_PHONE") or legal.get("phone", ""),
    }
    dpo = {
        "name": pick("dpoName", "PRIVACY_DPO_NAME"),
        "email": pick("dpoEmail", "PRIVACY_DPO_EMAIL"),
    }
    hosting = {
        "provider": pick("hostingProvider", "PRIVACY_HOSTING_PROVIDER"),
        "location": pick("hostingLocation", "PRIVACY_HOSTING_LOCATION"),
    }
    authority = {
        "name": (os.environ.get("PRIVACY_AUTHORITY_NAME") or "").strip() or "Österreichische Datenschutzbehörde",
        "website": (os.environ.get("PRIVACY_AUTHORITY_WEBSITE") or "").strip() or "https://www.dsb.gv.at/",
    }

    missing_core_fields = []
    if not controller["name"]:
        missing_core_fields.append("controllerName")
    if not controller["streetAddress"]:
        missing_core_fields.append("controllerStreetAddress")
    if not controller["postalCode"]:
        missing_core_fields.append("controllerPostalCode")
    if not controller["city"]:
        missing_core_fields.append("controllerCity")
    if not contact["email"]:
        missing_core_fields.append("contactEmail")

    return {
        "controller": controller,
        "contact": contact,
        "dpo": dpo,
        "hosting": hosting,
        "authority": authority,
        "additionalRecipients": (os.environ.get("PRIVACY_ADDITIONAL_RECIPIENTS") or "").strip(),
        "customNote": (os.environ.get("PRIVACY_CUSTOM_NOTE") or "").strip(),
        "features": {
            "smtpEnabled": has_smtp,
            "discordBotListEnabled": has_discordbotlist,
            "recognitionEnabled": has_recognition,
            "stationPreviewEnabled": True,
            "localeStorageKey": "omnifm.web.locale",
        },
        "retention": {
            "logDays": core.parse_int(os.environ.get("LOG_MAX_DAYS"), 14),
            "songHistoryEnabled": core.config_bool(core.system_setting("songHistory", "enabled", "SONG_HISTORY_ENABLED", True), True),
            "songHistoryMaxPerGuild": core.parse_int(core.system_setting("songHistory", "maxPerGuild", "SONG_HISTORY_MAX_PER_GUILD", 100), 100),
            "listeningStatsEnabled": True,
            "scheduledEventsEnabled": True,
        },
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def build_public_terms_notice():
    legal_notice = core.build_public_legal_notice()
    legal = legal_notice.get("legal", {})
    c = core.get_config_section("company")
    public_url = (os.environ.get("PUBLIC_WEB_URL") or "").strip()
    fallback_email = core.extract_mailbox(core.system_setting("smtp", "from", "SMTP_FROM") or "")
    has_smtp = bool(core.system_setting("smtp", "host", "SMTP_HOST"))

    operator = {
        "providerName": legal.get("providerName", ""),
        "representative": legal.get("representative", ""),
        "businessPurpose": legal.get("businessPurpose", ""),
        "website": legal.get("website", "") or public_url,
    }
    pick = _console_first()
    contact = {
        "email": pick("email", "TERMS_CONTACT_EMAIL")
        or (os.environ.get("PRIVACY_CONTACT_EMAIL") or "").strip()
        or legal.get("email", "")
        or fallback_email,
        "website": pick("website", "TERMS_SUPPORT_URL")
        or legal.get("website", "")
        or public_url,
        "effectiveDate": pick("effectiveDate", "TERMS_EFFECTIVE_DATE"),
        # The console's default ("Österreichisches Recht") comes last.
        "governingLaw": pick("governingLaw", "TERMS_GOVERNING_LAW") or str(c.get("governingLaw") or "").strip(),
    }

    missing_core_fields = []
    if not operator["providerName"]:
        missing_core_fields.append("providerName")
    if not contact["email"]:
        missing_core_fields.append("contactEmail")
    if not contact["website"]:
        missing_core_fields.append("website")

    return {
        "operator": operator,
        "contact": contact,
        "service": {
            "discordBotEnabled": True,
            "dashboardEnabled": True,
            "stationPreviewEnabled": True,
            "scheduledEventsEnabled": True,
            "customStationsEnabled": True,
        },
        "billing": {
            # No purchase on the website any more (#321); Premium comes to Discord.
            "premiumCheckoutEnabled": False,
            "paymentProvider": "",
            "emailDeliveryEnabled": has_smtp,
            "trialEnabled": core.is_pro_trial_enabled(),
        },
        "customNote": (os.environ.get("TERMS_CUSTOM_NOTE") or "").strip(),
        "missingCoreFields": missing_core_fields,
        "isConfigured": len(missing_core_fields) == 0,
        "basis": ["DISCORD_TERMS", "AUSTRIAN_SERVICE_TERMS", "STREAM_RIGHTS_NOTICE"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


__all__ = [
    "extract_mailbox",
    "normalize_language",
    "resolve_language_from_accept_language",
    "is_pro_trial_enabled",
    "sanitize_offer_code",
    "build_public_legal_notice",
    "build_public_privacy_notice",
    "build_public_terms_notice",
]
