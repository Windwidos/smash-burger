# Smash Burger – Online-Multiplayer

Das Kartenspiel „Smash Burger“ (hellofun!) als Browser-Spiel für 2–6 Personen. Jede Person spielt auf ihrem eigenen Handy.

## Starten

```
npm start
```

Dann `http://localhost:3000` öffnen. Wer im selben WLAN ist, verbindet sich über die angezeigte `http://192.168.x.x:3000`-Adresse.

Keine Abhängigkeiten nötig – nur Node.js ≥ 18.

## Ablauf

1. Eine Person eröffnet einen Tisch und bekommt einen 4-stelligen Code.
2. Die anderen treten mit dem Code bei (oder über den geteilten Link `/?room=CODE`).
3. Der Gastgeber kann Bots dazuholen und startet das Spiel.

Wer die Verbindung verliert, kann die Seite einfach neu laden. Bleibt jemand länger als 25 Sekunden weg, spielt ein Bot den Zug.

## Dateien

- `public/engine.js` – komplette Spiellogik (Regeln, Züge, Bots). Wird von Server und Browser genutzt.
- `server.js` – HTTP-Server mit Server-Sent Events, verwaltet die Tische im Speicher.
- `public/app.js`, `art.js`, `style.css` – Oberfläche.
- `test/sim.js` – spielt 600 Bot-Partien und prüft die Regeln (`npm test`).

## Online stellen

Läuft auf jedem Node-Host mit dauerhaftem Prozess (z. B. Render, Railway, Fly.io): Startbefehl `npm start`, der Port kommt aus `PORT`.
Nicht geeignet für reine Serverless-Hosts wie Vercel, weil die Tische im Arbeitsspeicher liegen.
