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


### JARVIS pausieren

Der Schalter oberhalb des Dashboards pausiert JARVIS für das angemeldete Konto. Der Zustand wird in SQLite gespeichert und bleibt nach Neustarts erhalten. Nur eine authentifizierte manuelle Änderung über `PUT /api/jarvis/control` mit `{ "paused": false }` aktiviert JARVIS wieder.

Die serverseitige Sperre umfasst `/api/generate`, `/api/speech` und `/api/actions/*` (einschliesslich der Google-Aktionsrouten, sobald diese integriert sind). Gesperrte Anfragen liefern HTTP 423 und `JARVIS_PAUSED`. Laufende KI-/Sprachanfragen werden mit AbortController abgebrochen; alte Ergebnisse werden auch nach erneuter Aktivierung verworfen. Mikrofon und Audiowiedergabe werden im Browser gestoppt; andere offene Tabs prüfen den Zustand alle zwei Sekunden. Bereits an externe Dienste übermittelte Aktionen können nicht rückgängig gemacht werden. Neue Hintergrundjobs müssen denselben persistenten Kontostatus unmittelbar vor dem externen Aufruf prüfen.

Regressionstest: `npm test` (temporäre Datenbank, simulierte KI, kein echter Mailversand oder Kalendertermin).


### Live Workspace

Das Dashboard wechselt nach einer gesprochenen oder getippten Aufgabe in die passende Ansicht (Social, Werbeanzeige, Wochenplan, Offerte, E-Mail-Entwurf, Termin-Entwurf, Übersicht oder Chat). `/api/jarvis/stream` liefert NDJSON mit `task`, `context`, `status`, `delta`, `done` und `error`. Es verwendet die Responses API als SSE-Stream, speichert ausschliesslich vollständige Antworten und zählt deren Nutzung. Browser und Server brechen laufende Streams bei Pause bzw. Verbindungsabbruch ab. Teilantworten werden weder als erledigt angezeigt noch automatisch gespeichert. Kurze Folgeanweisungen können die letzten zwei Gesprächsrunden aus derselben Sitzung verwenden.

Die Oberfläche rendert ausschliesslich Text und vordefinierte Komponenten, niemals vom Modell geliefertes HTML oder JavaScript. E-Mails und Termine sind explizit Entwürfe; diese Version löst keinen Mailversand oder Kalendereintrag aus. Die Google-Integration im separaten Branch bleibt unabhängig. Spracherkennung verwendet `SpeechRecognition`/`webkitSpeechRecognition` und benötigt Browserunterstützung sowie Mikrofonfreigabe; die Texteingabe bleibt immer verfügbar.

Validierung: `npm test` unter Node 22 prüft Streaming inklusive UTF-8-Fragmenten, Vollständigkeit, Speicherung/Nutzung, Ansichtenwahl, Pause und Kontentrennung.

## Google Workspace
Gmail send and Calendar insert are available through explicit, user-confirmed forms. Live generation remains a draft until the user reviews the recipient, full text or event dates and confirms the action. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a stable `SESSION_SECRET`. Optional `APP_BASE_URL` defaults to the Railway public URL. Register exactly `https://gs-ai-production.up.railway.app/api/google/callback` as the Google OAuth redirect URI, enable Gmail and Calendar APIs and authorize the account through the app. OAuth state is session-bound, expires after ten minutes and is consumed once. Tokens are encrypted with AES-256-GCM; status never returns tokens. Disconnect deletes local credentials. Action request IDs are stored durably: completed requests return the prior result, pending/uncertain requests are not automatically retried. After an uncertain response, inspect Gmail or Calendar before a new action. A pause aborts pending requests but cannot undo an action already accepted by Google.
