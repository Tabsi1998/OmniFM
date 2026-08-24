"""Idempotent demo seed for the OmniFM Owner Dashboard.

Inserts a few clearly-labelled DEMO premium licenses and guild dashboard
configs so the owner dashboard renders realistic data in the preview.
Safe to run multiple times.
"""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
db = client[os.environ["DB_NAME"]]
now = datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


DEMO_LICENSES = [
    {
        "_licenseId": "demo-ultimate-01", "id": "demo-ultimate-01",
        "plan": "ultimate", "tier": "ultimate", "seats": 3, "active": True,
        "contactEmail": "studio@nightwave.gg",
        "linkedServerIds": ["100000000000000001", "100000000000000002"],
        "source": "stripe", "createdAt": iso(now - timedelta(days=42)),
        "expiresAt": iso(now + timedelta(days=323)),
    },
    {
        "_licenseId": "demo-pro-01", "id": "demo-pro-01",
        "plan": "pro", "tier": "pro", "seats": 2, "active": True,
        "contactEmail": "admin@lofilounge.io",
        "linkedServerIds": ["100000000000000003"],
        "source": "stripe", "createdAt": iso(now - timedelta(days=17)),
        "expiresAt": iso(now + timedelta(days=13)),
    },
    {
        "_licenseId": "demo-pro-02", "id": "demo-pro-02",
        "plan": "pro", "tier": "pro", "seats": 1, "active": True,
        "contactEmail": "owner@synthcity.fm",
        "linkedServerIds": ["100000000000000004"],
        "source": "coupon", "createdAt": iso(now - timedelta(days=5)),
        "expiresAt": iso(now + timedelta(days=25)),
    },
    {
        "_licenseId": "demo-ultimate-02", "id": "demo-ultimate-02",
        "plan": "ultimate", "tier": "ultimate", "seats": 5, "active": True,
        "contactEmail": "team@bassdrop.network",
        "linkedServerIds": ["100000000000000005", "100000000000000006", "100000000000000007"],
        "source": "stripe", "createdAt": iso(now - timedelta(days=88)),
        "expiresAt": iso(now + timedelta(days=277)),
    },
    {
        "_licenseId": "demo-pro-expired", "id": "demo-pro-expired",
        "plan": "pro", "tier": "pro", "seats": 1, "active": True,
        "contactEmail": "hello@retrowave.club",
        "linkedServerIds": ["100000000000000008"],
        "source": "stripe", "createdAt": iso(now - timedelta(days=400)),
        "expiresAt": iso(now - timedelta(days=6)),
    },
]

for lic in DEMO_LICENSES:
    db.licenses.replace_one({"_licenseId": lic["_licenseId"]}, lic, upsert=True)

DEMO_GUILDS = {
    "guilds": {
        "100000000000000001": {"name": "NightWave HQ", "defaultStation": "synthwave"},
        "100000000000000003": {"name": "Lofi Lounge", "defaultStation": "lofi"},
        "100000000000000005": {"name": "BassDrop Network", "defaultStation": "dnb"},
    }
}
db.dashboard.replace_one({"_id": "config"}, {"_id": "config", **DEMO_GUILDS}, upsert=True)

redemptions = {
    "redemptions": {
        "sess_demo_1": {"sessionId": "sess_demo_1", "email": "team@bassdrop.network", "tier": "ultimate", "seats": 5, "processedAt": iso(now - timedelta(days=88))},
        "sess_demo_2": {"sessionId": "sess_demo_2", "email": "admin@lofilounge.io", "tier": "pro", "seats": 2, "processedAt": iso(now - timedelta(days=17))},
        "sess_demo_3": {"sessionId": "sess_demo_3", "email": "owner@synthcity.fm", "tier": "pro", "seats": 1, "processedAt": iso(now - timedelta(days=5))},
    }
}
db.coupons.replace_one({"_id": "redemptions"}, {"_id": "redemptions", **redemptions}, upsert=True)

print("Seeded", db.licenses.count_documents({}), "licenses (incl. demo).")
print("Demo seed complete.")
