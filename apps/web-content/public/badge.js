/*!
 * Verification badge for operators' own websites.
 *
 *   <script async src="https://SITE/badge.js" data-ttp-badge="BADGE_TOKEN"></script>
 *
 * Optional attributes: data-lang="en" (default "ru"), data-theme="dark".
 * Renders inside a shadow root so the host page's CSS can't restyle it, and always reads the live
 * status from this site (verified / revoked / not verified). The link goes to our verification page,
 * which is what a visitor should trust. Sends no cookies and stores nothing.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var origin = me && me.src ? new URL(me.src).origin : '';
  var TEXT = {
    ru: { verified: 'Проверенный туроператор', revoked: 'Проверка отозвана', not_verified: 'Не подтверждён', error: 'Статус проверки', since: 'с', brand: 'Проверено: Африка' },
    en: { verified: 'Verified tour operator', revoked: 'Verification revoked', not_verified: 'Not verified', error: 'Verification status', since: 'since', brand: 'Verified: Africa' },
  };
  var COLORS = { verified: '#0d7a4e', revoked: '#b3261e', not_verified: '#5d6b63', error: '#5d6b63' };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function icon(state) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '36');
    svg.setAttribute('aria-hidden', 'true');
    var c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '20'); c.setAttribute('cy', '20'); c.setAttribute('r', '18');
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'currentColor'); c.setAttribute('stroke-width', '3');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', state === 'verified' ? 'M12 20.5 L18 26.5 L28.5 14.5' : state === 'revoked' ? 'M14 14 L26 26 M26 14 L14 26' : 'M20 12 V22 M20 27.5 V28');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '3.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(c); svg.appendChild(p);
    return svg;
  }

  function render(root, state, data, t, dark) {
    var color = COLORS[state];
    var bg = dark ? '#161e1a' : '#ffffff';
    var fg = dark ? '#e5ece7' : '#12201a';
    var sub = dark ? '#9eaca4' : '#55625b';
    root.innerHTML = '';
    root.appendChild(el('style', {}, [
      ':host{all:initial;display:inline-block}' +
      'a{display:inline-flex;align-items:center;gap:10px;padding:8px 14px 8px 10px;border:1.5px solid ' + color + ';border-radius:12px;background:' + bg + ';color:' + fg + ';font:500 14px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;text-decoration:none;max-width:320px}' +
      'a:hover{box-shadow:0 0 0 3px ' + color + '33}a:focus-visible{outline:3px solid ' + color + ';outline-offset:2px}' +
      '.i{color:' + color + ';display:flex}.t{display:grid;gap:2px}.s{font-size:12px;color:' + sub + '}b{font-weight:650;color:' + color + '}',
    ]));
    var op = data && data.operator;
    var since = op && op.verifiedSince ? ' · ' + t.since + ' ' + new Date(op.verifiedSince).getUTCFullYear() : '';
    var href = op ? origin + '/operators/' + encodeURIComponent(op.slug) : origin + '/operators';
    var lines = [el('b', {}, [t[state]])];
    lines.push(el('span', { class: 's' }, [(op ? op.name + ' · ' : '') + t.brand + since]));
    root.appendChild(el('a', { href: href, target: '_blank', rel: 'noopener', title: t[state] + (op ? ': ' + op.name : '') }, [
      el('span', { class: 'i' }, [icon(state)]),
      el('span', { class: 't' }, lines),
    ]));
  }

  function mount(script) {
    if (script.getAttribute('data-ttp-mounted')) return;
    script.setAttribute('data-ttp-mounted', '1');
    var token = script.getAttribute('data-ttp-badge') || '';
    var t = TEXT[script.getAttribute('data-lang') === 'en' ? 'en' : 'ru'];
    var dark = script.getAttribute('data-theme') === 'dark';
    // A custom element, so the host page's own span/div/a rules can't match the badge's outer box.
    var host = document.createElement('ttp-verification-badge');
    script.parentNode.insertBefore(host, script.nextSibling);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    render(root, 'error', null, t, dark);
    fetch(origin + '/backend/public/badge/' + encodeURIComponent(token), { credentials: 'omit', mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (data) {
        var state = data && (data.state === 'verified' || data.state === 'revoked') ? data.state : 'not_verified';
        render(root, state, data, t, dark);
      })
      .catch(function () { render(root, 'error', null, t, dark); });
  }

  var scripts = document.querySelectorAll('script[data-ttp-badge]');
  for (var i = 0; i < scripts.length; i++) {
    if (!me || new URL(scripts[i].src, location.href).origin === origin) mount(scripts[i]);
  }
})();
