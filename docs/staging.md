# Staging: OmniFM zum Ausprobieren neben dem echten Bot

Staging ist ein zweites OmniFM auf demselben Server. Dort läuft ein Branch,
bevor er in Produktion geht: eigene Test-Bots, eigene Datenbank, eigene
Website. Produktion merkt davon nichts.

| | Produktion | Staging |
|---|---|---|
| Ordner | `/opt/omnifm` (dein Checkout) | daneben: `../omnifm-staging` |
| Dienste | `omnifm-backend`, `-frontend`, `-bot` | `omnifm-staging-backend`, `-frontend`, `-bot` |
| Ports | 3000 / 8001 / 8002 | 3100 / 8101 / 8102 |
| Datenbank | `<DB_NAME>` | `<DB_NAME>_staging` |
| Discord-Bots | die echten | eigene Test-Bots |
| Backup, Alarme | ja | nein |

## Einmal einrichten

1. **Test-Bots anlegen:** https://discord.com/developers/applications →
   *New Application* → z. B. „OmniFM Staging Commander“. Unter *Bot* den Token
   kopieren. Für jeden Worker, den du testen willst, eine weitere Application.
   Die Test-Bots lädst du nur auf einen Testserver ein.
2. **Subdomain im Nginx Proxy Manager:** *Hosts → Proxy Hosts → Add Proxy Host*
   - Domain: `staging.omnifm.xyz`, Forward: `http://<Server-IP>:3100`
   - Reiter *Custom locations*: Location `/api`, Forward `http://<Server-IP>:8101`
   - Reiter *SSL*: neues Let's-Encrypt-Zertifikat, *Force SSL* an.
   - Beim DNS-Anbieter einen A-Record `staging` auf die Server-IP setzen.
3. **Auf dem Server, im Produktions-Ordner:**
   ```bash
   bash scripts/staging.sh setup --domain staging.omnifm.xyz
   bash scripts/staging.sh deploy main
   ```
   `setup` zeigt den Owner-Token von Staging an. Er ist ein anderer als in
   Produktion.
4. **Owner-Konsole von Staging** öffnen (`https://staging.omnifm.xyz/owner`,
   mit dem Staging-Token) → *Discord & Bots*: die Tokens der Test-Bots
   eintragen → speichern → `bash scripts/staging.sh deploy main` startet den
   Bot mit ihnen.

## Einen Branch ausprobieren

```bash
bash scripts/staging.sh deploy fix/mein-branch
bash scripts/staging.sh status
node scripts/phase6-live-check.mjs --base-url https://staging.omnifm.xyz --skip-logs --skip-api
```

Passt alles, wird der PR gemergt und Produktion wie immer mit `./update.sh`
aktualisiert.

## Anhalten und entfernen

```bash
bash scripts/staging.sh stop      # Dienste anhalten, alles bleibt liegen
bash scripts/staging.sh remove    # Dienste und Ordner weg; die Datenbank bleibt
```
