/* The album view shares the station's audio, queue and composer. */
(function (global) {
  let station;
  let actions;
  let enabled = false;
  let currentStyle = 'classic';
  let signature = '';
  let activeId = '';
  let lyricKey = '';
  const artwork = new Map();
  const lyricRequests = new Map();
  const cards = new Map();
  const $ = (id) => document.getElementById(id);
  const isProviderTrack = (id) =>
    /^\d{1,20}$/.test(String(id)) || /^qq:[A-Za-z0-9]{6,64}$/.test(String(id));

  async function coverFor(track) {
    if (artwork.has(track.id)) return artwork.get(track.id);
    const promise = (async () => {
      if (!isProviderTrack(track.id)) return null;
      try {
        const response = await fetch(`/api/track/${encodeURIComponent(track.id)}/artwork`);
        if (!response.ok) return null;
        const result = await response.json();
        return result.coverUrl || null;
      } catch {
        return null;
      }
    })();
    artwork.set(track.id, promise);
    return promise;
  }

  function setBackdrop(id, url) {
    if (id !== activeId || !enabled) return;
    $('album-glow').style.backgroundImage = url ? `url("${url}")` : '';
    document.querySelector('.app').style.setProperty('--cover-image', url ? `url("${url}")` : 'none');
    const thumb = $('player-cover');
    thumb.hidden = !url;
    if (url) thumb.src = url;
    else thumb.removeAttribute('src');
  }

  function makeCard(track) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'album-card';
    const art = document.createElement('div');
    art.className = 'album-art';
    const empty = document.createElement('span');
    empty.className = 'album-art-empty';
    empty.textContent = '暂无封面';
    const img = document.createElement('img');
    img.alt = `${track.title} · 专辑封面`;
    img.hidden = true;
    const action = document.createElement('span');
    action.className = 'album-play-mark';
    action.setAttribute('aria-hidden', 'true');
    action.textContent = '▶';
    art.append(empty, img, action);
    const artist = document.createElement('strong');
    artist.textContent = track.artist;
    const title = document.createElement('span');
    title.className = 'album-title';
    title.textContent = track.title;
    button.append(art, artist, title);
    button.addEventListener('click', () => {
      const s = station();
      const index = s.tracks.findIndex((item) => item.id === track.id);
      if (index < 0) return;
      if (index === s.currentIndex) actions.toggle();
      else actions.select(index);
    });
    const item = { button, img, empty, action, url: null };
    coverFor(track).then((url) => {
      if (!url) return;
      img.onload = () => {
        item.url = url;
        img.hidden = false;
        empty.hidden = true;
        setBackdrop(track.id, url);
      };
      img.onerror = () => {
        item.url = null;
        img.hidden = true;
        empty.hidden = false;
        setBackdrop(track.id, null);
      };
      img.src = url;
    });
    return item;
  }

  async function loadLyrics(track) {
    const s = station();
    if (s.lyricsByTrack.has(track.id) || lyricRequests.has(track.id)) return;
    const request = (async () => {
      try {
        if (!isProviderTrack(track.id)) {
          s.lyricsByTrack.set(track.id, []);
          return;
        }
        const response = await fetch(`/api/track/${encodeURIComponent(track.id)}/lyrics`);
        if (!response.ok) throw new Error('lyrics unavailable');
        const result = await response.json();
        s.lyricsByTrack.set(track.id, result.lines || []);
      } catch {
        s.lyricsByTrack.set(track.id, []);
      } finally {
        tick();
      }
    })();
    lyricRequests.set(track.id, request);
  }

  function tick() {
    if (!enabled || !station) return;
    const s = station();
    const track = s.tracks[s.currentIndex];
    if (!track) return;
    const lines = s.lyricsByTrack.get(track.id);
    let active = -1;
    if (lines) {
      for (let i = 0; i < lines.length && lines[i].time <= s.elapsed + 0.15; i++) active = i;
    }
    const key = `${track.id}:${active}:${lines?.length ?? 'loading'}`;
    if (lyricKey === key) return;
    lyricKey = key;
    const rows = [];
    if (!lines?.length) {
      const p = document.createElement('p');
      p.className = 'album-lyric-empty';
      p.textContent = lines ? '此刻，让音乐说话。' : '正在读取歌词…';
      rows.push(p);
    } else {
      for (let offset = -2; offset <= 2; offset++) {
        const p = document.createElement('p');
        const line = lines[active + offset];
        p.textContent = line?.text || '\u00a0';
        p.className = offset === 0 ? 'current' : Math.abs(offset) === 2 ? 'distant' : '';
        if (offset === 0 && line?.translation) p.title = line.translation;
        rows.push(p);
      }
    }
    $('album-lyrics').replaceChildren(...rows);
  }

  function render() {
    if (!enabled || !station) return;
    const s = station();
    const track = s.tracks[s.currentIndex];
    if (!track) return;
    const changed = activeId !== track.id;
    activeId = track.id;
    const nextSignature = s.tracks.map((t) => `${t.id}:${t.title}:${t.artist}`).join('|') + `:${s.currentIndex}`;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const visible = new Map();
      // Prefer closer neighbours so short queues never duplicate a record.
      [0, -1, 1, -2, 2].forEach((offset) => {
        const index = (s.currentIndex + offset + s.tracks.length) % s.tracks.length;
        const item = s.tracks[index];
        if (!visible.has(item.id)) visible.set(item.id, { item, offset, index });
      });
      cards.forEach((card, id) => {
        if (!visible.has(id)) {
          card.button.remove();
          cards.delete(id);
        }
      });
      visible.forEach(({ item, offset }) => {
        if (!cards.has(item.id)) {
          const card = makeCard(item);
          cards.set(item.id, card);
          $('album-deck').append(card.button);
        }
        const card = cards.get(item.id);
        card.button.style.setProperty('--offset', offset);
        card.button.style.setProperty('--distance', Math.abs(offset));
        card.button.style.setProperty('--angle', `${offset === 0 ? 0 : offset < 0 ? 18 : -18}deg`);
        card.button.style.zIndex = String(5 - Math.abs(offset));
        card.button.classList.toggle('is-current', offset === 0);
        card.button.setAttribute('aria-current', offset === 0 ? 'true' : 'false');
      });
      if (changed) {
        setBackdrop(activeId, cards.get(activeId)?.url || null);
        lyricKey = '';
      }
      $('album-position').textContent = `${String(s.currentIndex + 1).padStart(2, '0')} / ${String(s.tracks.length).padStart(2, '0')}`;
      $('album-previous').disabled = s.tracks.length < 2;
    }
    cards.forEach((card, id) => {
      const t = s.tracks.find((item) => item.id === id);
      card.action.textContent = s.playing && id === activeId ? 'Ⅱ' : '▶';
      card.button.setAttribute('aria-label',
        id === activeId ? `${s.playing ? '暂停' : '播放'} ${t.title}` : `切换到 ${t.title} · ${t.artist}`);
    });
    loadLyrics(track);
    tick();
  }

  function setStyle(style) {
    const next = ['album', 'glass'].includes(style) ? style : 'classic';
    if (currentStyle === next) return;
    currentStyle = next;
    enabled = next !== 'classic';
    actions.exitFocus();
    document.documentElement.dataset.playerStyle = next;
    document.querySelector('.album-stage').hidden = !enabled;
    $('album-lyrics').hidden = next !== 'album';
    if (enabled) {
      actions.expandPlayer();
      signature = '';
      activeId = '';
      render();
      renderQueueCovers();
    }
  }

  function renderQueueCovers() {
    if (currentStyle !== 'glass' || !station) return;
    document.querySelectorAll('.queue-item').forEach((row) => {
      const track = station().tracks[Number(row.dataset.index)];
      const holder = row.querySelector('.queue-avatar');
      if (!track || !holder || holder.querySelector('img') || !isProviderTrack(track.id)) return;
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.className = 'queue-cover';
      image.hidden = true;
      image.onload = () => { image.hidden = false; holder.classList.add('has-cover'); };
      image.onerror = () => { image.hidden = true; holder.classList.remove('has-cover'); };
      image.src = `/api/track/${encodeURIComponent(track.id)}/cover`;
      holder.append(image);
    });
  }

  global.AlbumView = {
    init(getStation, callbacks) {
      station = getStation;
      actions = callbacks;
      $('album-previous').addEventListener('click', actions.previous);
      $('album-next').addEventListener('click', actions.next);
      $('player-cover').addEventListener('error', () => { $('player-cover').hidden = true; });
      const deck = $('album-deck');
      deck.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') actions.previous();
        else actions.next();
      });
    },
    setStyle,
    render,
    renderQueueCovers,
    tick
  };
})(window);
