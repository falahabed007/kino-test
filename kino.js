/* Kino-Kopfbereich der Bestellseite (Skill kino-bestellseite).
 *
 * Vier Modi, als Klasse auf #kino gesetzt; das CSS liest nur diese Klasse:
 *   kino--video      Laptop und PC: das Video folgt dem Scrollen
 *   kino--handy      Handy und Tablet hochkant: Bildfolge auf <canvas>
 *   kino--standbild  reduzierte Bewegung, Datensparmodus, langsames Netz, Handy quer
 *   kino--kurz       Ruecksprung von der Zahlung oder Aufruf mit #: nichts wird geladen
 *
 * Einstellungen als data-Attribute an #kino:
 *   data-video   Pfad zum Scrub-Video        (Standard assets/kino/hero-scrub.mp4)
 *   data-bilder  Zahl der Handy-Bilder       (ls assets/kino/m | wc -l)
 *   data-pfad    Ordner der Handy-Bilder     (Standard assets/kino/m)
 *   data-endung  webp oder jpg               (Standard webp)
 */
(() => {
  'use strict';
  const wurzel = document.getElementById('kino');
  if (!wurzel) return;

  const d = wurzel.dataset;
  const CFG = {
    video: d.video || 'assets/kino/hero-scrub.mp4',
    pfad: d.pfad || 'assets/kino/m',
    anzahl: Number(d.bilder) || 0,
    endung: d.endung || 'webp'
  };

  const buehne = wurzel.querySelector('.kino-buehne');
  const baender = [...wurzel.querySelectorAll('.kino-band')];
  const ende = wurzel.querySelector('.kino-ende');

  // ---- Modus -------------------------------------------------------------
  const HANDY = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)'
  ];
  const STANDBILD = [
    '(prefers-reduced-motion: reduce)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)'
  ];
  // Nur beim Laden pruefen: Der Sprung zur Karte setzt spaeter selbst ein #.
  const KURZ = (() => {
    const p = new URLSearchParams(location.search);
    return ['order', 'payment', 'session_id', 'paypal'].some(k => p.has(k)) || location.hash.length > 1;
  })();

  function kinoModus() {
    if (KURZ) return 'kurz';
    if (STANDBILD.some(q => matchMedia(q).matches)) return 'standbild';
    const netz = navigator.connection;
    if (netz && (netz.saveData || /2g$/.test(netz.effectiveType || ''))) return 'standbild';
    if (HANDY.some(q => matchMedia(q).matches)) return CFG.anzahl > 0 ? 'handy' : 'standbild';
    return 'video';
  }

  // ---- Fortschritt und Texte (gemeinsam fuer Video und Handy) --------------
  let ziel = 0, gezeigt = 0, raf = null, letzte = 0, zeichner = null;

  function fortschritt() {
    const r = wurzel.getBoundingClientRect();
    const weg = r.height - buehne.getBoundingClientRect().height;
    return weg > 0 ? Math.min(1, Math.max(0, -r.top / weg)) : 0;
  }

  // Baender: data-von/data-bis als Fortschritt 0..1. Deckkraft nur schreiben, wenn sie sich aendert.
  function deckkraft(p, von, bis, rampe) {
    if (p <= von - rampe || p >= bis + rampe) return 0;
    if (p < von) return (p - (von - rampe)) / rampe;
    if (p > bis) return 1 - (p - bis) / rampe;
    return 1;
  }
  function texte(p) {
    for (const b of baender) {
      const op = Math.round(deckkraft(p, +b.dataset.von, +b.dataset.bis, 0.04) * 100) / 100;
      if (b._op !== op) { b.style.opacity = op; b._op = op; }
    }
    if (ende) {
      const op = Math.round(Math.min(1, Math.max(0, (p - 0.82) / 0.1)) * 100) / 100;
      if (ende._op !== op) { ende.style.opacity = op; ende._op = op; }
    }
  }

  function tick(jetzt) {
    const dt = Math.min(100, jetzt - (letzte || jetzt));
    letzte = jetzt;
    gezeigt += (ziel - gezeigt) * (1 - Math.pow(1 - 0.16, dt / 16.667));
    if (Math.abs(ziel - gezeigt) < 0.0005) gezeigt = ziel;
    if (zeichner) zeichner(gezeigt);
    texte(gezeigt);
    if (gezeigt === ziel) { raf = null; letzte = 0; }
    else raf = requestAnimationFrame(tick);
  }
  function anfordern() { if (raf === null) raf = requestAnimationFrame(tick); }
  function beimScrollen() { ziel = fortschritt(); anfordern(); }

  // ---- Video (Laptop und PC) -------------------------------------------------
  function kinoVideo() {
    const video = wurzel.querySelector('.kino-video');
    const ctrl = new AbortController();
    let wartet = false, url = null, aktiv = true;

    wurzel.classList.add('kino-poster-an');
    (async () => {
      let wachhund = setTimeout(() => ctrl.abort(), 20000);   // 20 s ohne Fortschritt: Standbild bleibt
      try {
        const res = await fetch(CFG.video, { priority: 'low', signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const leser = res.body.getReader(), teile = [];
        for (;;) {
          const { done, value } = await leser.read();
          if (done) break;
          clearTimeout(wachhund);
          wachhund = setTimeout(() => ctrl.abort(), 20000);
          teile.push(value);
        }
        clearTimeout(wachhund);
        if (!aktiv) return;
        url = URL.createObjectURL(new Blob(teile, { type: 'video/mp4' }));
        video.src = url;
        video.addEventListener('loadeddata', () => { wurzel.classList.add('kino-bereit'); suche(); }, { once: true });
        video.load();
      } catch (e) {
        clearTimeout(wachhund);
        if (aktiv) wurzel.classList.add('kino-ohne-video');   // Poster bleibt, Seite ist vollstaendig
      }
    })();

    // Nie zwei Sprunge gleichzeitig: der naechste startet erst nach "seeked".
    function suche() {
      if (wartet || !video.duration) return;
      const t = Math.min(video.duration - 0.04, gezeigt * video.duration);
      if (Math.abs(video.currentTime - t) < 0.01) return;
      wartet = true;
      video.currentTime = t;
    }
    const nachSprung = () => { wartet = false; suche(); };
    video.addEventListener('seeked', nachSprung);

    zeichner = suche;
    return () => {
      aktiv = false;
      ctrl.abort();
      zeichner = null;
      video.removeEventListener('seeked', nachSprung);
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
      wurzel.classList.remove('kino-poster-an', 'kino-bereit', 'kino-ohne-video');
    };
  }

  // ---- Handy: Bildfolge auf <canvas> --------------------------------------------
  function kinoHandy() {
    const leinwand = wurzel.querySelector('.kino-leinwand');
    const ctx = leinwand.getContext('2d');
    const { anzahl, pfad, endung } = CFG;
    const bilder = new Array(anzahl);
    let gemalt = -1, aktiv = true;

    // Ladereihenfolge: erstes und letztes Bild, dann jedes 8., 4., 2., zuletzt alle.
    // So faehrt die Folge frueh, grob, und wird beim Weiterladen nur feiner.
    const reihe = [], schon = new Set();
    const dazu = i => { if (!schon.has(i)) { schon.add(i); reihe.push(i); } };
    dazu(0); dazu(anzahl - 1);
    for (const schritt of [8, 4, 2, 1]) for (let i = 0; i < anzahl; i += schritt) dazu(i);

    const datei = i => `${pfad}/f${String(i + 1).padStart(3, '0')}.${endung}`;
    let pos = 0;
    async function arbeiter() {
      while (aktiv && pos < reihe.length) {
        const i = reihe[pos++];
        const bild = new Image();
        bild.src = datei(i);
        try { await bild.decode(); } catch (e) { continue; }   // fehlt eins, springt der Nachbar ein
        if (!aktiv) return;
        bilder[i] = bild;
        wurzel.classList.add('kino-bereit');
        male(gezeigt);
      }
    }
    for (let n = 0; n < 4; n++) arbeiter();

    function naechstes(i) {
      for (let dd = 0; dd < anzahl; dd++) {
        if (bilder[i - dd]) return i - dd;
        if (bilder[i + dd]) return i + dd;
      }
      return -1;
    }

    function groesse() {
      const r = leinwand.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const b = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (b && h && (b !== leinwand.width || h !== leinwand.height)) {
        leinwand.width = b; leinwand.height = h; gemalt = -1; male(gezeigt);
      }
    }

    // fuellt die Leinwand wie object-fit: cover; malt nur, wenn sich das Bild aendert
    function male(p) {
      const i = naechstes(Math.round(p * (anzahl - 1)));
      if (i < 0 || i === gemalt) return;
      const bild = bilder[i], b = leinwand.width, h = leinwand.height;
      const s = Math.max(b / bild.naturalWidth, h / bild.naturalHeight);
      const w = bild.naturalWidth * s, hh = bild.naturalHeight * s;
      ctx.drawImage(bild, (b - w) / 2, (h - hh) / 2, w, hh);
      gemalt = i;
      leinwand.dataset.bild = i;
    }

    addEventListener('resize', groesse);
    groesse();
    zeichner = male;
    return () => {
      aktiv = false;
      zeichner = null;
      removeEventListener('resize', groesse);
      wurzel.classList.remove('kino-bereit');
    };
  }

  // ---- Auf- und Abbau, live bei Drehen, Groessenwechsel, Einstellungen ---------------
  let modus = null, abbau = null, seiteGeladen = false;

  function starte() {
    if (modus === 'video') abbau = kinoVideo();
    else if (modus === 'handy') abbau = kinoHandy();
    if (modus === 'video' || modus === 'handy') {
      addEventListener('scroll', beimScrollen, { passive: true });
      beimScrollen();
    } else {
      texte(1);   // Standbild zeigt die Endszene
    }
  }

  function setze() {
    const neu = kinoModus();
    if (neu === modus) return;
    if (abbau) { abbau(); abbau = null; }
    removeEventListener('scroll', beimScrollen);
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    if (modus) wurzel.classList.remove('kino--' + modus);
    modus = neu;
    wurzel.classList.add('kino--' + modus);
    wurzel.dataset.modus = modus;
    if (seiteGeladen) starte();
  }

  // Die Klasse sofort (die Hoehe steht damit vor dem ersten Scrollen),
  // geladen wird erst, wenn die Bestellseite fertig ist.
  setze();
  const los = () => { seiteGeladen = true; starte(); };
  const nachDerSeite = () => ('requestIdleCallback' in window)
    ? requestIdleCallback(los, { timeout: 1500 })
    : setTimeout(los, 300);
  if (document.readyState === 'complete') nachDerSeite();
  else addEventListener('load', nachDerSeite, { once: true });

  if (!KURZ) [...HANDY, ...STANDBILD].forEach(q => matchMedia(q).addEventListener('change', setze));
})();
