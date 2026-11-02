/* Smash Burger – Musik & Soundeffekte, komplett per Web Audio erzeugt (keine Audiodateien, keine Lizenzen).
   Musik: entspannter Lo-Fi-Café-Loop (E-Piano-Akkorde, Bass, leiser Beat, zufällige Marimba-Melodie).
   Sounds: kurz und leise, damit sie nicht nerven. */
window.SmashSound = (function () {
  'use strict';
  const LS = 'smashburger.audio';
  let prefs = { music: true, sfx: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(LS)) }; } catch { /* ignore */ }

  let ctx = null, master, musicBus, sfxBus, noiseBuf;
  let musicTimer = null, nextTime = 0, step = 0;

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    // Warm low-pass on the music so it stays in the background.
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2600;
    musicBus.connect(warm).connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = prefs.sfx ? 0.55 : 0;
    sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

  // ---------- Bausteine ----------

  function tone(bus, { f, f2, type = 'sine', t = 0, dur = 0.2, vol = 0.3, attack = 0.005, detune = 0, q }) {
    const at = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node = o.connect(g);
    if (q) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = q;
      node = g.connect(fl);
      fl.connect(bus);
    } else g.connect(bus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function noise(bus, { t = 0, dur = 0.2, vol = 0.2, type = 'bandpass', f = 1200, f2, q = 1 }) {
    const at = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, at);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(fl).connect(g).connect(bus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  // ---------- Soundeffekte ----------

  const SFX = {
    click: () => tone(sfxBus, { f: 1400, f2: 900, type: 'triangle', dur: 0.05, vol: 0.12 }),
    select: () => tone(sfxBus, { f: 700, f2: 980, type: 'sine', dur: 0.09, vol: 0.18 }),
    place: () => {
      tone(sfxBus, { f: 420, f2: 210, type: 'sine', dur: 0.14, vol: 0.45 });
      noise(sfxBus, { dur: 0.06, vol: 0.12, f: 2500, q: 0.7 });
    },
    discard: () => noise(sfxBus, { dur: 0.22, vol: 0.22, f: 2400, f2: 500, q: 0.8 }),
    complete: () => [72, 76, 79, 84].forEach((m, i) => tone(sfxBus, { f: hz(m), type: 'triangle', t: i * 0.08, dur: 0.35, vol: 0.28 })),
    burn: () => {
      noise(sfxBus, { dur: 0.9, vol: 0.3, type: 'lowpass', f: 1800, f2: 300 });
      for (let i = 0; i < 9; i++) noise(sfxBus, { t: Math.random() * 0.7, dur: 0.04, vol: 0.25, f: 3000 + Math.random() * 3000, q: 4 });
      tone(sfxBus, { f: 160, f2: 60, type: 'sine', dur: 0.6, vol: 0.3 });
    },
    steal: () => {
      noise(sfxBus, { dur: 0.25, vol: 0.25, f: 500, f2: 3500, q: 1.2 });
      tone(sfxBus, { f: hz(76), f2: hz(64), type: 'triangle', t: 0.18, dur: 0.18, vol: 0.2 });
    },
    swap: () => {
      noise(sfxBus, { dur: 0.3, vol: 0.2, f: 400, f2: 2500, q: 1 });
      noise(sfxBus, { t: 0.25, dur: 0.3, vol: 0.2, f: 2500, f2: 400, q: 1 });
    },
    dig: () => { for (let i = 0; i < 5; i++) noise(sfxBus, { t: i * 0.07, dur: 0.05, vol: 0.2, f: 900 + i * 300, q: 6 }); },
    turn: () => {
      tone(sfxBus, { f: hz(76), type: 'sine', dur: 0.5, vol: 0.22 });
      tone(sfxBus, { f: hz(81), type: 'sine', t: 0.12, dur: 0.6, vol: 0.2 });
    },
    coin: () => {
      tone(sfxBus, { f: hz(88), type: 'square', dur: 0.08, vol: 0.06 });
      tone(sfxBus, { f: hz(93), type: 'square', t: 0.07, dur: 0.18, vol: 0.06 });
    },
    emote: () => tone(sfxBus, { f: 500, f2: 900, type: 'sine', dur: 0.15, vol: 0.2 }),
    win: () => {
      [67, 72, 76, 79].forEach((m, i) => tone(sfxBus, { f: hz(m), type: 'triangle', t: i * 0.12, dur: 0.3, vol: 0.28 }));
      [72, 76, 79, 84].forEach(m => tone(sfxBus, { f: hz(m), type: 'triangle', t: 0.55, dur: 1.2, vol: 0.16 }));
    },
    lose: () => [67, 64, 60].forEach((m, i) => tone(sfxBus, { f: hz(m), type: 'triangle', t: i * 0.18, dur: 0.35, vol: 0.22 })),
  };

  function play(name) {
    if (!prefs.sfx || !SFX[name] || !init() || ctx.state !== 'running') return;
    SFX[name]();
  }

  // ---------- Musik ----------

  const BPM = 92;
  const EIGHTH = 60 / BPM / 2;
  // Fmaj7 – Dm7 – Gm7 – C7, je ein Takt; Akkordtöne (MIDI) und Bass.
  const CHORDS = [
    { notes: [53, 57, 60, 64], bass: 41 },
    { notes: [50, 53, 57, 60], bass: 38 },
    { notes: [55, 58, 62, 65], bass: 43 },
    { notes: [52, 55, 58, 60], bass: 36 },
  ];
  const MELODY = [72, 74, 77, 79, 81, 84]; // F-Dur-Pentatonik, hell und freundlich
  let lastMel = 77;

  function playAt(fn, time) {
    const delay = Math.max(0, time - ctx.currentTime);
    fn(delay);
  }

  function scheduleStep(time) {
    const bar = Math.floor(step / 8) % CHORDS.length;
    const pos = step % 8; // Achtel im Takt
    const ch = CHORDS[bar];
    const swing = pos % 2 === 1 ? EIGHTH * 0.18 : 0; // leichter Swing
    const t = time + swing;
    playAt(d => {
      if (pos === 0) {
        // E-Piano: weicher Akkord
        ch.notes.forEach((m, i) => tone(musicBus, { f: hz(m), type: i % 2 ? 'triangle' : 'sine', t: d + i * 0.012, dur: EIGHTH * 7, vol: 0.07, attack: 0.03, detune: (i - 1.5) * 4, q: 1600 }));
      }
      if (pos === 5 && Math.random() < 0.5) {
        ch.notes.slice(1).forEach(m => tone(musicBus, { f: hz(m + 12), type: 'sine', t: d, dur: EIGHTH * 2.5, vol: 0.035, attack: 0.02 }));
      }
      // Bass auf 1 und 3, manchmal ein Nachschlag
      if (pos === 0 || pos === 4) tone(musicBus, { f: hz(ch.bass), type: 'triangle', t: d, dur: EIGHTH * 3, vol: 0.2, attack: 0.01, q: 500 });
      if (pos === 7 && Math.random() < 0.4) tone(musicBus, { f: hz(ch.bass + 7), type: 'triangle', t: d, dur: EIGHTH, vol: 0.12, q: 500 });
      // Leiser Beat: Kick auf 1 und 3, Snap auf 2 und 4, Shaker auf allen Achteln
      if (pos === 0 || pos === 4) tone(musicBus, { f: 110, f2: 45, type: 'sine', t: d, dur: 0.25, vol: 0.28 });
      if (pos === 2 || pos === 6) noise(musicBus, { t: d, dur: 0.12, vol: 0.06, f: 1800, q: 1.5 });
      noise(musicBus, { t: d, dur: 0.05, vol: pos % 2 ? 0.018 : 0.03, type: 'highpass', f: 7000 });
      // Marimba-Melodie: zufällig, aber in kleinen Schritten
      if (Math.random() < (pos % 2 ? 0.18 : 0.42)) {
        const idx = MELODY.indexOf(lastMel);
        const next = MELODY[Math.max(0, Math.min(MELODY.length - 1, idx + Math.floor(Math.random() * 3) - 1))];
        lastMel = next;
        tone(musicBus, { f: hz(next), type: 'sine', t: d, dur: 0.4, vol: 0.07 });
        tone(musicBus, { f: hz(next + 12), type: 'sine', t: d, dur: 0.12, vol: 0.02 });
      }
    }, t);
  }

  function musicTick() {
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(nextTime);
      nextTime += EIGHTH;
      step++;
    }
  }

  function startMusic() {
    if (!prefs.music || !init() || musicTimer || ctx.state !== 'running') return;
    nextTime = ctx.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 3); // sanft einblenden
    musicTimer = setInterval(musicTick, 50);
  }

  function stopMusic() {
    if (!musicTimer) return;
    clearInterval(musicTimer);
    musicTimer = null;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  }

  // Browsers only allow audio after a tap: start everything on the first interaction.
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().then(() => { if (prefs.music) startMusic(); });
    else if (prefs.music) startMusic();
  }

  function save() {
    localStorage.setItem(LS, JSON.stringify(prefs));
  }

  function setMusic(on) {
    prefs.music = on;
    save();
    if (on) unlock();
    else stopMusic();
  }

  function setSfx(on) {
    prefs.sfx = on;
    save();
    if (init()) sfxBus.gain.value = on ? 0.55 : 0;
  }

  // Pause in the background (screen off, other app), continue when back.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') {
      stopMusic();
      ctx.suspend();
    } else {
      ctx.resume().then(() => { if (prefs.music) startMusic(); });
    }
  });
  window.addEventListener('pointerdown', unlock, { passive: true });

  return { play, setMusic, setSfx, get music() { return prefs.music; }, get sfx() { return prefs.sfx; } };
})();
