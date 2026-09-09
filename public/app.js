(function () {
  'use strict';

  const els = {
    cards: document.getElementById('cards'),
    banner: document.getElementById('banner'),
    bannerText: document.getElementById('bannerText'),
    statusPill: document.getElementById('statusPill'),
    statusText: document.getElementById('statusText'),
    refresh: document.getElementById('refreshBtn'),
    marketNote: document.getElementById('marketNote'),
    tracked: document.getElementById('trackedList'),
    tModel: document.getElementById('tModel'),
    tMode: document.getElementById('tMode'),
    tLatency: document.getElementById('tLatency'),
    tUpstream: document.getElementById('tUpstream')
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function setStatus(kind, text) {
    els.statusPill.className = 'pill pill--' + kind;
    els.statusText.textContent = text;
  }

  function normaliseSentiment(v) {
    const s = String(v || '').toLowerCase();
    if (s.indexOf('bull') !== -1) return 'bullish';
    if (s.indexOf('bear') !== -1) return 'bearish';
    return 'neutral';
  }

  function assetCard(a) {
    const mood = normaliseSentiment(a.sentiment);
    const score = Math.max(0, Math.min(100, Number(a.score) || 0));
    const drivers = Array.isArray(a.drivers) ? a.drivers.slice(0, 6) : [];

    return (
      '<article class="card card--' + mood + '">' +
        '<div class="card-top">' +
          '<h3 class="ticker">' + esc(a.ticker || '—') + '</h3>' +
          '<span class="verdict">' + esc(mood) + '</span>' +
        '</div>' +
        '<div class="score-row">' +
          '<span class="score">' + score + '</span>' +
          '<span class="score-unit">pulse index</span>' +
        '</div>' +
        '<div class="gauge"><span class="gauge-fill" data-w="' + score + '"></span></div>' +
        '<div class="gauge-ticks"><span>bearish</span><span>neutral</span><span>bullish</span></div>' +
        (a.summary ? '<p class="summary">' + esc(a.summary) + '</p>' : '') +
        (drivers.length
          ? '<div class="drivers">' +
              drivers.map((d) => '<span class="chip">' + esc(d) + '</span>').join('') +
            '</div>'
          : '') +
      '</article>'
    );
  }

  function rawCard(text) {
    return (
      '<article class="card card--neutral card--raw" style="grid-column:1/-1">' +
        '<div class="card-top"><h3 class="ticker">Model Output</h3>' +
        '<span class="verdict">unstructured</span></div>' +
        '<pre>' + esc(text) + '</pre>' +
      '</article>'
    );
  }

  function animateGauges() {
    requestAnimationFrame(() => {
      document.querySelectorAll('.gauge-fill').forEach((el) => {
        el.style.width = (el.getAttribute('data-w') || 0) + '%';
      });
    });
  }

  function render(payload) {
    const data = payload.data || {};
    const assets = Array.isArray(data.assets) ? data.assets : [];

    if (assets.length) {
      els.cards.innerHTML = assets.map(assetCard).join('');
      animateGauges();
    } else if (data.market_note) {
      els.cards.innerHTML = rawCard(data.market_note);
    } else {
      els.cards.innerHTML = rawCard('No sentiment content returned by the model.');
    }

    els.marketNote.textContent =
      assets.length && data.market_note ? data.market_note : data.market_note || '—';

    els.tracked.textContent = (payload.tracked || []).join('  ·  ') || '—';
    els.tModel.textContent = payload.model || '—';
    els.tMode.textContent = payload.mode === 'live' ? 'live model' : 'sample data';
    els.tLatency.textContent = payload.latency_ms != null ? payload.latency_ms + ' ms' : '—';
    els.tUpstream.textContent = payload.degraded
      ? (payload.upstream_status ? 'HTTP ' + payload.upstream_status : 'unavailable')
      : 'ok';

    if (payload.degraded) {
      setStatus('demo', 'sample data');
      els.banner.hidden = false;
      els.bannerText.textContent =
        (payload.notice || 'Live model call failed.') +
        (payload.upstream_error ? ' Upstream: ' + payload.upstream_error : '');
    } else {
      setStatus('live', 'live · qwen');
      els.banner.hidden = true;
    }
  }

  async function load() {
    els.refresh.disabled = true;
    els.refresh.classList.add('spinning');
    setStatus('idle', 'scanning…');

    try {
      const res = await fetch('/api/sentiment', { cache: 'no-store' });
      const json = await res.json();
      if (!json || json.success === false) throw new Error((json && json.error) || 'request failed');
      render(json);
    } catch (err) {
      setStatus('error', 'offline');
      els.banner.hidden = false;
      els.bannerText.textContent = 'Could not reach /api/sentiment — ' + err.message;
      els.cards.innerHTML = rawCard('Endpoint unreachable: ' + err.message);
      els.tMode.textContent = 'error';
    } finally {
      els.refresh.disabled = false;
      els.refresh.classList.remove('spinning');
    }
  }

  els.refresh.addEventListener('click', load);
  load();
})();
