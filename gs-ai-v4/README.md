# GS AI V4 — GS CREATIVE

V4 macht aus dem MVP eine verkaufsnahe SaaS-Basis.

## Neu
- 14-Tage-Testphase bei Registrierung
- Basic CHF 29 / Monat — 100 KI-Generierungen
- Pro CHF 69 / Monat — 500 KI-Generierungen
- Business CHF 149 / Monat — 2'000 KI-Generierungen
- monatlicher Nutzungszähler und serverseitige Limits
- Admin-Statistik-Endpunkt (`ADMIN_EMAIL`)
- Billing-/Checkout-Endpunkt vorbereitet; **keine echten Zahlungen aktiviert**
- bestehend: sichere Sessions, bcrypt-Passwörter, SQLite, Firmenprofile, Projekte, serverseitige KI

## Start lokal
1. Node.js 20+ installieren
2. Ordner öffnen
3. `npm install`
4. `.env.example` nach `.env` kopieren und `SESSION_SECRET` setzen
5. Optional `OPENAI_API_KEY` setzen
6. Optional `ADMIN_EMAIL` auf deine Login-E-Mail setzen
7. `npm start`
8. Browser: `http://localhost:3000`

## Vor echtem Verkauf noch nötig
- produktionsreifer Session-Store (nicht MemoryStore)
- HTTPS + Hosting + Backups
- E-Mail-Verifikation und Passwort-Reset
- Rate Limiting, CSRF-/Security-Hardening, Logging
- Datenschutz/AGB/Impressum passend zur Schweiz
- Zahlungsanbieter + Webhooks serverseitig verbinden
- Tests der Abolimits und Billing-Zustände

## Hinweis
V4 ist ein Entwicklungs-MVP. Checkout gibt absichtlich `501` zurück, bis ein echter Zahlungsanbieter sicher serverseitig integriert wurde.
