/* Chimpions Arena — non-invasive AAA presentation/UX layer.
   Keeps battle rules in app.js/engine.js untouched and enhances rendered DOM. */
(() => {
  'use strict';

  const TUTORIALS = Object.freeze({
    tactical: '/tutorials/tactical.webp',
    'ban-counter': '/tutorials/ban-counter.webp',
    triple: '/tutorials/triple.webp',
    'team-tag': '/tutorials/team-tag.webp'
  });
  const MODE_NAMES = Object.freeze({
    tactical: 'Tactical',
    'ban-counter': 'Ban & Counter',
    triple: 'Triple Clash',
    'team-tag': 'Team Tag 2v2'
  });
  const coarsePointer = matchMedia('(hover: none), (pointer: coarse)');
  let pinnedTutorial = null;
  let enhanceQueued = false;

  const qs = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');

  function selectedMode() {
    return qs('.mode-option input[name="mode"]:checked')?.value ||
      localStorage.getItem('chimpions:mode') || 'tactical';
  }

  function tutorialElements() {
    const showcase = qs('#modeShowcase');
    const img = qs('#modeTutorialImg');
    return { showcase, img };
  }

  function setTutorial(mode, { pin = false } = {}) {
    if (!TUTORIALS[mode]) return;
    const { showcase, img } = tutorialElements();
    if (!showcase || !img) return;
    if (img.getAttribute('src') !== TUTORIALS[mode]) img.setAttribute('src', TUTORIALS[mode]);
    img.hidden = false;
    img.closest('.tutorial-frame')?.querySelector('.tutorial-error-copy')?.remove();
    img.alt = `${MODE_NAMES[mode] || mode} — how to play`;
    img.dataset.mode = mode;
    showcase.dataset.tutorial = mode;
    showcase.classList.remove('tutorial-load-error');
    showcase.classList.add('show-tutorial');
    if (pin) {
      pinnedTutorial = mode;
      showcase.classList.add('tutorial-pinned');
    } else {
      showcase.classList.remove('tutorial-pinned');
    }
    const heading = qs('.tutorial-heading', showcase);
    if (heading) heading.dataset.mode = MODE_NAMES[mode] || mode;
    const toggle = qs('.tutorial-mobile-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = `Hide ${MODE_NAMES[mode] || 'mode'} tutorial`;
    }
  }

  function hideTutorial({ force = false } = {}) {
    const { showcase } = tutorialElements();
    if (!showcase) return;
    if (pinnedTutorial && !force) return;
    pinnedTutorial = null;
    showcase.classList.remove('show-tutorial', 'tutorial-pinned');
    const toggle = qs('.tutorial-mobile-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'View selected mode tutorial';
    }
  }

  function ensureTutorialDialog() {
    if (qs('#aaaTutorialDialog')) return qs('#aaaTutorialDialog');
    const dialog = document.createElement('dialog');
    dialog.id = 'aaaTutorialDialog';
    dialog.className = 'aaa-tutorial-dialog';
    dialog.innerHTML = `
      <button class="aaa-dialog-close" type="button" aria-label="Close tutorial">×</button>
      <div class="aaa-dialog-kicker">LEARN HOW TO PLAY</div>
      <h2 id="aaaTutorialTitle">Mode tutorial</h2>
      <img id="aaaTutorialFullImage" alt="">
      <p>Press Esc or use the close button to return to the arena.</p>`;
    document.body.append(dialog);
    qs('.aaa-dialog-close', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function openTutorialDialog(mode) {
    if (!TUTORIALS[mode]) return;
    const dialog = ensureTutorialDialog();
    const title = qs('#aaaTutorialTitle', dialog);
    const img = qs('#aaaTutorialFullImage', dialog);
    title.textContent = `${MODE_NAMES[mode] || mode} — How it works`;
    img.src = TUTORIALS[mode];
    img.alt = `${MODE_NAMES[mode] || mode} tutorial`;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function bindModeTutorials() {
    const picker = qs('.arena-home .mode-picker');
    const showcase = qs('#modeShowcase');
    if (!picker || !showcase) return;

    qsa('.mode-option[data-mode]', picker).forEach(label => {
      if (label.dataset.aaaTutorialBound === '1') return;
      label.dataset.aaaTutorialBound = '1';
      const mode = label.dataset.mode;
      const input = qs('input[name="mode"]', label);
      const preview = () => setTutorial(mode);
      label.addEventListener('pointerenter', preview);
      label.addEventListener('focusin', preview);
      label.addEventListener('pointerleave', () => {
        requestAnimationFrame(() => {
          if (pinnedTutorial) setTutorial(pinnedTutorial, { pin: true });
          else hideTutorial({ force: true });
        });
      });
      // app.js also owns a mouseleave handler; this later handler restores a pinned selection.
      label.addEventListener('mouseleave', () => {
        requestAnimationFrame(() => {
          if (pinnedTutorial) setTutorial(pinnedTutorial, { pin: true });
        });
      });
      label.addEventListener('focusout', event => {
        if (!label.contains(event.relatedTarget) && !pinnedTutorial) hideTutorial({ force: true });
      });
      input?.addEventListener('change', () => {
        qsa('.mode-option[data-mode]', picker).forEach(item => item.removeAttribute('aria-current'));
        label.setAttribute('aria-current', 'true');
        setTutorial(mode, { pin: true });
      });
      label.addEventListener('dblclick', event => {
        event.preventDefault();
        setTutorial(mode, { pin: true });
        openTutorialDialog(mode);
      });
    });

    const checked = qs('input[name="mode"]:checked', picker)?.closest('.mode-option');
    checked?.setAttribute('aria-current', 'true');

    if (!qs('.tutorial-mobile-toggle', picker.parentElement)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tutorial-mobile-toggle';
      button.setAttribute('aria-controls', 'modeShowcase');
      button.setAttribute('aria-expanded', 'false');
      button.textContent = 'View selected mode tutorial';
      picker.insertAdjacentElement('afterend', button);
      button.addEventListener('click', () => {
        const active = selectedMode();
        if (showcase.classList.contains('tutorial-pinned')) hideTutorial({ force: true });
        else setTutorial(active, { pin: true });
      });
    }

    const frame = qs('.tutorial-frame', showcase);
    if (frame && frame.dataset.aaaExpandBound !== '1') {
      frame.dataset.aaaExpandBound = '1';
      frame.setAttribute('role', 'button');
      frame.tabIndex = 0;
      frame.setAttribute('aria-label', 'Open tutorial full size');
      const expand = document.createElement('span');
      expand.className = 'tutorial-expand-hint';
      expand.textContent = '↗ FULL SIZE';
      frame.append(expand);
      const open = () => openTutorialDialog(showcase.dataset.tutorial || selectedMode());
      frame.addEventListener('click', open);
      frame.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
  }

  function clearTeamTagLink(pair) {
    if (!pair) return;
    pair.classList.remove('team-linked');
    pair.removeAttribute('data-linked-attribute');
    qsa('.team-stat-linked', pair).forEach(node => node.classList.remove('team-stat-linked'));
  }

  function linkTeamTagStat(stat) {
    const pair = stat?.closest('.mode-team-tag .player-slot .team-pair');
    if (!pair) return;
    const attribute = stat.dataset.stat;
    if (!attribute) return;
    clearTeamTagLink(pair);
    pair.classList.add('team-linked');
    pair.dataset.linkedAttribute = attribute;
    qsa(`[data-stat="${esc(attribute)}"]`, pair).forEach(node => node.classList.add('team-stat-linked'));
  }

  function bindTeamTagDelegation() {
    const app = qs('#app');
    if (!app || app.dataset.aaaTeamDelegation === '1') return;
    app.dataset.aaaTeamDelegation = '1';
    app.addEventListener('pointerover', event => {
      const stat = event.target.closest?.('.mode-team-tag .player-slot .team-pair [data-stat]');
      if (stat) linkTeamTagStat(stat);
    });
    app.addEventListener('pointerout', event => {
      const stat = event.target.closest?.('.mode-team-tag .player-slot .team-pair [data-stat]');
      if (!stat) return;
      if (stat.contains(event.relatedTarget)) return;
      clearTeamTagLink(stat.closest('.team-pair'));
    });
    app.addEventListener('focusin', event => {
      const stat = event.target.closest?.('.mode-team-tag .player-slot .team-pair [data-stat]');
      if (stat) linkTeamTagStat(stat);
    });
    app.addEventListener('focusout', event => {
      const stat = event.target.closest?.('.mode-team-tag .player-slot .team-pair [data-stat]');
      if (stat && !stat.closest('.team-pair')?.contains(event.relatedTarget)) clearTeamTagLink(stat.closest('.team-pair'));
    });
  }

  function enhanceBattlePanels() {
    const arena = qs('.arena');
    if (!arena) return;

    const instruction = qs('.center-round-instruction', arena);
    if (instruction && instruction.dataset.aaaEnhanced !== '1') {
      instruction.dataset.aaaEnhanced = '1';
      const raw = instruction.textContent.trim();
      let helper = '';
      if (arena.classList.contains('mode-team-tag')) helper = 'ONE PICK CONTROLS BOTH ACTIVE CARDS';
      else if (arena.classList.contains('mode-triple')) helper = 'PICK 3 · THIRD PICK AUTO-LOCKS';
      else if (arena.classList.contains('mode-ban-counter')) helper = 'DEFENDER BANS · CHOOSER COUNTERS';
      else if (arena.classList.contains('mode-tactical')) helper = 'LAST STAT LOCKED · 1 RESERVE SWAP';
      if (helper) instruction.insertAdjacentHTML('beforeend', `<small class="aaa-instruction-helper">${helper}</small>`);
      instruction.setAttribute('aria-label', `${raw}. ${helper}`);
    }

    const triple = qs('.mode-triple .triple-control small', arena);
    if (triple && !qs('.triple-pips', triple.parentElement)) {
      const match = triple.textContent.match(/(\d)\s*\/\s*3/);
      const count = Number(match?.[1] || 0);
      const pips = document.createElement('div');
      pips.className = 'triple-pips';
      pips.setAttribute('aria-hidden', 'true');
      pips.innerHTML = [0,1,2].map(i => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
      triple.insertAdjacentElement('afterend', pips);
    }

    const ban = qs('.mode-ban-counter .ban-control', arena);
    if (ban && !qs('.aaa-role-badge', ban)) {
      ban.insertAdjacentHTML('afterbegin', '<span class="aaa-role-badge"><b>DEFENDER</b><small>YOU BAN FIRST</small></span>');
    }

    const swap = qs('.mode-tactical #swap', arena);
    if (swap) {
      swap.title = 'Reserve Swap — one use per player per match';
      swap.dataset.once = '1× ONLY';
    }

    const pair = qs('.mode-team-tag .player-slot .team-pair', arena);
    if (pair && !qs('.team-link-rail', pair)) {
      pair.insertAdjacentHTML('afterbegin', '<span class="team-link-rail" aria-hidden="true"><i></i></span>');
    }

    qsa('.card .art img', arena).forEach(img => {
      img.decoding = 'async';
      img.draggable = false;
      img.setAttribute('fetchpriority', 'high');
    });

    qsa('.team-tag-ranking .top-two', arena).forEach((node, i) => {
      node.dataset.rank = String(i + 1);
    });
  }

  function enhanceResult() {
    const result = qs('.match-result');
    if (!result || result.dataset.aaaResult === '1') return;
    result.dataset.aaaResult = '1';
    result.insertAdjacentHTML('afterbegin', '<div class="aaa-result-atmosphere" aria-hidden="true"><i></i><i></i><i></i><i></i></div>');
  }

  function enhanceImages() {
    qsa('#modeTutorialImg').forEach(img => {
      img.decoding = 'async';
      img.loading = 'eager';
      img.setAttribute('fetchpriority', 'high');
    });
    qsa('.opponent-card-art img').forEach(img => {
      img.decoding = 'async';
      img.draggable = false;
    });
  }

  function enhance() {
    bindModeTutorials();
    bindTeamTagDelegation();
    enhanceBattlePanels();
    enhanceResult();
    enhanceImages();
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => {
      enhanceQueued = false;
      enhance();
    });
  }

  // Tutorial errors should never be replaced by the generic card placeholder.
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.id !== 'modeTutorialImg') return;
    event.stopImmediatePropagation();
    const showcase = qs('#modeShowcase');
    const frame = img.closest('.tutorial-frame');
    showcase?.classList.add('tutorial-load-error', 'show-tutorial');
    if (frame && !qs('.tutorial-error-copy', frame)) {
      frame.insertAdjacentHTML('beforeend', `<div class="tutorial-error-copy"><b>TUTORIAL SIGNAL LOST</b><span>${MODE_NAMES[img.dataset.mode] || 'Mode'} artwork could not be decoded.</span><small>Try a hard refresh. The game itself is still playable.</small></div>`);
    }
    img.hidden = true;
  }, true);

  // Preload the four verified high-resolution tutorial assets.
  Object.values(TUTORIALS).forEach(src => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  });

  const observer = new MutationObserver(queueEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', queueEnhance, { once: true });
  queueEnhance();
})();
