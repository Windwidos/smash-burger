/* Smash Burger – Shop-Katalog (Münzen, Tablett-Designs, Emotes, In-App-Käufe). Server und Browser nutzen ihn. */
(function (root, factory) {
  const S = factory();
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.SmashShop = S;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tablett-Designs (Aussehen nur per CSS-Klasse skin-<id>). price 0 = gratis, supporter = nur für Unterstützer:innen.
  // level = ab diesem Level kaufbar (Statussymbole), reward = gratis ab diesem Level (nicht kaufbar).
  const TRAYS = [
    { id: 'classic', name: 'Klassisch Rot', price: 0 },
    { id: 'wood', name: 'Holzbrett', price: 250 },
    { id: 'diner', name: 'Diner-Blau', price: 250, level: 3 },
    { id: 'mint', name: 'Pastell-Minze', price: 250, level: 3 },
    { id: 'picnic', name: 'Picknick', price: 400, level: 6 },
    { id: 'neon', name: 'Neon-Nacht', price: 500, level: 10 },
    { id: 'space', name: 'Weltall', price: 600, level: 15 },
    { id: 'grill', name: 'Grillmeister-Tablett', price: 0, reward: 10 },
    { id: 'legend', name: 'Legenden-Tablett', price: 0, reward: 30 },
    { id: 'gold', name: 'Goldtablett', price: 0, supporter: true },
  ];

  // Emotes: im Spiel antippen, alle am Tisch sehen die Sprechblase.
  const EMOTES = [
    { id: 'yum', icon: '😋', text: 'Lecker!', pack: 'free' },
    { id: 'haha', icon: '😂', text: 'Haha!', pack: 'free' },
    { id: 'hi', icon: '👋', text: 'Hallo!', pack: 'free' },
    { id: 'gg', icon: '🤝', text: 'Gut gespielt!', pack: 'free' },
    { id: 'smash', icon: '🔥', text: 'Gesmasht!', pack: 'smash' },
    { id: 'cry', icon: '😭', text: 'Mein Burger!', pack: 'smash' },
    { id: 'slow', icon: '🐢', text: 'Zu langsam!', pack: 'smash' },
    { id: 'kiss', icon: '🤌', text: "Chef's Kiss!", pack: 'smash' },
    { id: 'revenge', icon: '😈', text: 'Rache!', pack: 'smash' },
    { id: 'crown', icon: '👑', text: 'Küchenchef!', pack: 'gold' },
  ];

  const PACKS = [
    { id: 'emotes-smash', pack: 'smash', name: 'Smash-Pack', price: 300 },
    { id: 'emotes-gold', pack: 'gold', name: 'Küchenchef-Emote', price: 0, supporter: true },
  ];

  // Google-Play-Produkte (In-App-Produkte in der Play Console mit genau diesen IDs anlegen).
  const IAP = [
    { id: 'muenzen_300', coins: 300, label: '300 Münzen', price: '0,99 €' },
    { id: 'muenzen_1000', coins: 1000, label: '1.000 Münzen', price: '2,99 €', tag: 'Beliebt' },
    { id: 'muenzen_2500', coins: 2500, label: '2.500 Münzen', price: '5,99 €', tag: 'Bester Wert' },
    { id: 'unterstuetzer', coins: 500, supporter: true, label: 'Unterstützer:in', price: '2,99 €' },
    // Themen-Packs (einmaliger Kauf): eigener Hintergrund, neue Zutaten, 2 Spezial-Burger, wechselnde Speisekarte.
    { id: 'pack_mexiko', theme: 'mexico', coins: 0, label: 'Fiesta Mexicana', price: '0,99 €' },
    { id: 'pack_hawaii', theme: 'hawaii', coins: 0, label: 'Aloha Hawaii', price: '0,99 €' },
    { id: 'pack_westen', theme: 'western', coins: 0, label: 'Wilder Westen', price: '0,99 €' },
    { id: 'pack_grusel', theme: 'halloween', coins: 0, label: 'Gruselküche', price: '0,99 €' },
    { id: 'pack_winter', theme: 'winter', coins: 0, label: 'Winterzauber', price: '0,99 €' },
  ];

  const themeItem = theme => 'theme:' + theme;
  function ownsTheme(profile, theme) {
    return !!profile && (profile.owned || []).includes(themeItem(theme));
  }
  const themePacks = () => IAP.filter(p => p.theme);

  // Münzen pro Spiel und durch freiwillige Werbung.
  function gameCoins(won, burgers) {
    return 10 + burgers * 5 + (won ? 15 : 0);
  }
  // Rewarded videos: a small bonus on top of playing, not a replacement for it (or for buying coins).
  const AD_COINS = 15;
  const COIN_ADS_PER_DAY = 3; // "Video ansehen: +15 Münzen" im Shop
  const DOUBLES_PER_DAY = 5; // "Belohnung ×2" nach einer Runde

  const itemId = {
    tray: id => 'tray:' + id,
    pack: id => 'pack:' + id,
  };

  function trayById(id) { return TRAYS.find(t => t.id === id); }
  function packById(id) { return PACKS.find(p => p.id === id); }
  function iapById(id) { return IAP.find(p => p.id === id); }

  // level = the player's current level (needed for the level rewards).
  function ownsTray(profile, id, level) {
    const t = trayById(id);
    if (!t) return false;
    if (t.supporter) return !!profile.supporter;
    if (t.reward) return (level || 1) >= t.reward;
    return t.price === 0 || (profile.owned || []).includes(itemId.tray(id));
  }

  // Trays that became available (to buy or as a reward) between two levels – for the level-up message.
  function unlockedBetween(fromLevel, toLevel) {
    return TRAYS.filter(t => {
      const at = t.reward || t.level;
      return at && at > fromLevel && at <= toLevel;
    });
  }

  function ownsPack(profile, pack) {
    if (pack === 'free') return true;
    const p = PACKS.find(x => x.pack === pack);
    if (!p) return false;
    if (p.supporter) return !!profile.supporter;
    return (profile.owned || []).includes(itemId.pack(p.id));
  }

  function ownedEmotes(profile) {
    return EMOTES.filter(e => ownsPack(profile, e.pack));
  }

  return {
    TRAYS, EMOTES, PACKS, IAP, AD_COINS, COIN_ADS_PER_DAY, DOUBLES_PER_DAY, gameCoins, itemId, trayById, packById, iapById,
    ownsTray, unlockedBetween, ownsPack, ownedEmotes, themeItem, ownsTheme, themePacks,
  };
});
