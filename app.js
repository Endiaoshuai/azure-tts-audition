/* ==========================================================================
   Azure 中文配音音色全量盲测档案 · Interactive Studio Player & Comparator
   ========================================================================== */

(function () {
  'use strict';

  const SPEEDS = [1.0, 1.1, 1.18];
  let speedIndex = 0;

  let allVoices = [];
  let driveFolderUrl = 'https://drive.google.com/drive/folders/1JYRJ0SeZInyzh-uEDjgn7Lm86k6QKzpP?usp=sharing';

  let activeTab = 'all';
  let activeGender = 'all';
  let qingOnly = false;
  let searchQuery = '';

  let currentUid = null;
  let pinnedAUid = 'free-hd-08_xiaoxiao2_hdflash';
  let lastComparableBUid = 'paid-p06_mei_joyful';
  let autoCycle = false;
  let isPlaying = false;

  // Web Audio API Visualizer state
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let sourceConnected = false;

  // DOM Elements
  const audioEl = document.getElementById('studio-audio');
  const gridEl = document.getElementById('voice-cards-grid');
  const countTextEl = document.getElementById('results-count-text');
  const searchInput = document.getElementById('voice-search-input');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeToggleLabel = document.getElementById('theme-toggle-label');
  const driveFolderBtn = document.getElementById('drive-folder-btn');
  const footerDriveLink = document.getElementById('footer-drive-link');

  const deckPlayBtn = document.getElementById('deck-play-btn');
  const deckPrevBtn = document.getElementById('deck-prev-btn');
  const deckNextBtn = document.getElementById('deck-next-btn');
  const deckTitleEl = document.getElementById('deck-track-title');
  const deckSubEl = document.getElementById('deck-track-sub');
  const deckAbBtn = document.getElementById('deck-ab-btn');
  const deckCycleBtn = document.getElementById('deck-cycle-btn');
  const deckSpeedBtn = document.getElementById('deck-speed-btn');
  const deckCopySsmlBtn = document.getElementById('deck-copy-ssml-btn');
  const deckCurTime = document.getElementById('deck-cur-time');
  const deckDurTime = document.getElementById('deck-dur-time');
  const deckSeekSlider = document.getElementById('deck-seek-slider');
  const canvas = document.getElementById('waveform-canvas');
  const ctx2d = canvas ? canvas.getContext('2d') : null;

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function buildSsml(v) {
    const innerText = v.text || '';
    let body = innerText;
    if (v.prosody && (v.prosody.rate || v.prosody.pitch)) {
      const rateAttr = v.prosody.rate ? ` rate="${v.prosody.rate}"` : '';
      const pitchAttr = v.prosody.pitch ? ` pitch="${v.prosody.pitch}"` : '';
      body = `<prosody${rateAttr}${pitchAttr}>${body}</prosody>`;
    }
    if (v.style) {
      body = `<mstts:express-as style="${v.style}">${body}</mstts:express-as>`;
    }
    return [
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">',
      `  <voice name="${v.voice}">`,
      `    ${body}`,
      '  </voice>',
      '</speak>',
    ].join('\n');
  }

  function copyWithFeedback(text, btnEl, restoredText) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
    btnEl.textContent = '已复制 ✓';
    setTimeout(() => {
      btnEl.textContent = restoredText;
    }, 1300);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    ta.remove();
  }

  function getVoiceByUid(uid) {
    return allVoices.find((v) => v.uid === uid) || null;
  }

  function matchesGender(v) {
    if (activeGender === 'all') return true;
    const g = v.gender || '';
    if (activeGender === 'female') return g === '女声';
    if (activeGender === 'male') return g === '男声';
    if (activeGender === 'other') return g !== '女声' && g !== '男声';
    return true;
  }

  function getFilteredVoices() {
    const q = searchQuery.trim().toLowerCase();
    const list = allVoices.filter((v) => {
      if (activeTab === 'picked' && !v.picked) return false;
      if (activeTab !== 'all' && activeTab !== 'picked' && v.batch !== activeTab) return false;
      if (!matchesGender(v)) return false;
      if (qingOnly && !v.qingExact) return false;
      if (q) {
        const hay = [
          v.name,
          v.voice,
          v.style || '',
          v.desc || '',
          v.verdictNote || '',
          v.pickBadge || '',
          v.cautionBadge || '',
          v.gender || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Sort: picked items rank first when on 'picked' or 'all' tab
    if (activeTab === 'picked') {
      list.sort((a, b) => (a.pickRank || 99) - (b.pickRank || 99));
    } else if (activeTab === 'all') {
      list.sort((a, b) => {
        if (a.picked !== b.picked) return a.picked ? -1 : 1;
        if (a.picked && b.picked) return (a.pickRank || 99) - (b.pickRank || 99);
        return 0;
      });
    }
    return list;
  }

  function ensureWebAudio() {
    if (sourceConnected || !window.AudioContext && !window.webkitAudioContext) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      const src = audioCtx.createMediaElementSource(audioEl);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      sourceConnected = true;
      requestAnimationFrame(drawSpectrum);
    } catch (_) {
      // Ignore if restricted by browser autoplay/CORS
    }
  }

  function drawSpectrum() {
    requestAnimationFrame(drawSpectrum);
    if (!ctx2d || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#DE4816';
    const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--hairline-strong').trim() || '#C8C2B6';

    const bars = 20;
    const gap = 4;
    const barW = (w - gap * (bars - 1)) / bars;

    if (analyser && isPlaying && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      ctx2d.fillStyle = accentColor;
      for (let i = 0; i < bars; i++) {
        const val = dataArray[i + 1] || 0;
        const barH = Math.max(4, (val / 255) * (h - 6));
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barW, barH, 2);
        ctx2d.fill();
      }
    } else {
      ctx2d.fillStyle = mutedColor;
      for (let i = 0; i < bars; i++) {
        const barH = 4 + ((i * 7) % 9);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barW, barH, 2);
        ctx2d.fill();
      }
    }
  }

  function updateAbButtonLabel() {
    const pinV = getVoiceByUid(pinnedAUid);
    const shortA = pinV ? pinV.name.split('·')[0].trim().slice(0, 8) : 'A';
    if (currentUid && currentUid === pinnedAUid) {
      const bV = getVoiceByUid(lastComparableBUid);
      const shortB = bV ? bV.name.split('·')[0].trim().slice(0, 8) : 'B';
      deckAbBtn.textContent = `A→B 切到: ${shortB}`;
    } else {
      deckAbBtn.textContent = `B→A 切回: ${shortA}`;
    }
  }

  function playVoice(voice, fromCycle = false) {
    if (!voice) return;
    if (!fromCycle && currentUid === voice.uid) {
      if (audioEl.paused) {
        ensureWebAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
      return;
    }

    if (voice.uid !== pinnedAUid) {
      lastComparableBUid = voice.uid;
    }

    currentUid = voice.uid;
    ensureWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // Primary instant static stream + automatic Google Drive fallback
    const localSrc = `./audio/${voice.fileName}`;
    audioEl.onerror = () => {
      if (voice.driveDownloadUrl && audioEl.src !== voice.driveDownloadUrl) {
        audioEl.removeAttribute('crossorigin');
        audioEl.src = voice.driveDownloadUrl;
        audioEl.play().catch(() => {});
      }
    };
    audioEl.src = localSrc;
    audioEl.playbackRate = SPEEDS[speedIndex];

    deckTitleEl.textContent = voice.name;
    deckSubEl.textContent = `${voice.voice}${voice.style ? ' · style=' + voice.style : ''} · ${voice.pricing}`;
    deckDurTime.textContent = fmtTime(voice.duration);
    deckCurTime.textContent = '0:00';
    deckSeekSlider.value = '0';

    updateAbButtonLabel();
    audioEl.play().catch(() => {});
    renderGrid();
  }

  function stepTrack(delta) {
    const list = getFilteredVoices();
    if (!list.length) return;
    const idx = list.findIndex((x) => x.uid === currentUid);
    const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
    playVoice(list[nextIdx], true);
  }

  function renderGrid() {
    const list = getFilteredVoices();
    countTextEl.textContent = `当前展示 ${list.length} / ${allVoices.length} 款实测音频（全部原声 MP3 已同步公开至 Google 云盘）`;
    gridEl.innerHTML = '';

    list.forEach((v) => {
      const isCurrent = v.uid === currentUid;
      const playingNow = isCurrent && isPlaying;
      const isPinnedA = v.uid === pinnedAUid;

      const card = document.createElement('article');
      card.className = 'voice-card' + (isCurrent ? ' is-current' : '');
      card.id = `card-${v.uid}`;

      // Top row: Play button + Title + Meta badges
      const top = document.createElement('div');
      top.className = 'card-top';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'play-trigger';
      playBtn.id = `play-${v.uid}`;
      playBtn.setAttribute('aria-label', `播放 ${v.name}`);
      if (playingNow) {
        playBtn.innerHTML = '<span class="eq-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
      } else {
        playBtn.textContent = '▶';
      }
      playBtn.onclick = () => playVoice(v, false);

      const titleWrap = document.createElement('div');
      titleWrap.className = 'card-title-wrap';

      const titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      const h3 = document.createElement('h3');
      h3.className = 'card-title';
      h3.textContent = v.name;
      titleRow.appendChild(h3);

      const badges = document.createElement('div');
      badges.className = 'meta-badges';

      if (v.pickBadge) {
        const pb = document.createElement('span');
        pb.className = 'badge pick-badge';
        pb.textContent = v.pickBadge;
        badges.appendChild(pb);
      }

      if (v.cautionBadge) {
        const cb = document.createElement('span');
        cb.className = 'badge caution-badge';
        cb.textContent = v.cautionBadge;
        badges.appendChild(cb);
      }

      const tierBadge = document.createElement('span');
      tierBadge.className = 'badge ' + (v.isFree ? 'free-tier' : 'paid-tier');
      tierBadge.textContent = v.isFree ? '¥0 免费额度内' : v.pricing.split('（')[0];
      badges.appendChild(tierBadge);

      const durBadge = document.createElement('span');
      durBadge.className = 'badge';
      durBadge.textContent = `${v.gender || '语音'} · ${v.sampleRate} · ${v.duration.toFixed(1)}s`;
      badges.appendChild(durBadge);

      titleWrap.appendChild(titleRow);
      titleWrap.appendChild(badges);
      top.appendChild(playBtn);
      top.appendChild(titleWrap);

      // Middle: Description + Verdict note if present
      const middle = document.createElement('div');
      middle.style.display = 'flex';
      middle.style.flexDirection = 'column';
      middle.style.gap = '8px';

      const desc = document.createElement('p');
      desc.className = 'card-desc';
      desc.textContent = v.desc;
      middle.appendChild(desc);

      if (v.verdictNote) {
        const note = document.createElement('div');
        note.className = 'verdict-note' + (v.cautionBadge ? ' is-caution' : '');
        note.textContent = v.verdictNote;
        middle.appendChild(note);
      }

      // Bottom: Voice ID + Action Buttons (Pin A, Copy ID, Copy SSML, Google Drive link)
      const bottom = document.createElement('div');
      bottom.className = 'card-code-row';

      const codeSpan = document.createElement('code');
      codeSpan.className = 'voice-id-code';
      const voiceSpec = v.voice + (v.style ? ` (${v.style})` : '') + (v.prosody && v.prosody.rate ? ` [${v.prosody.rate}]` : '');
      codeSpan.textContent = voiceSpec;
      codeSpan.title = voiceSpec;

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.id = `pin-${v.uid}`;
      pinBtn.className = 'mini-btn' + (isPinnedA ? ' pinned-a' : '');
      pinBtn.textContent = isPinnedA ? 'A 基准 ✓' : '锁为 A 基准';
      pinBtn.onclick = () => {
        pinnedAUid = v.uid;
        updateAbButtonLabel();
        renderGrid();
      };

      const copyIdBtn = document.createElement('button');
      copyIdBtn.type = 'button';
      copyIdBtn.id = `copyid-${v.uid}`;
      copyIdBtn.className = 'mini-btn';
      copyIdBtn.textContent = '复制 ID';
      copyIdBtn.onclick = () => copyWithFeedback(v.voice, copyIdBtn, '复制 ID');

      const copySsmlBtn = document.createElement('button');
      copySsmlBtn.type = 'button';
      copySsmlBtn.id = `copyssml-${v.uid}`;
      copySsmlBtn.className = 'mini-btn';
      copySsmlBtn.textContent = 'SSML';
      copySsmlBtn.onclick = () => copyWithFeedback(buildSsml(v), copySsmlBtn, 'SSML');

      const driveLink = document.createElement('a');
      driveLink.id = `drive-${v.uid}`;
      driveLink.className = 'mini-btn';
      driveLink.href = v.driveViewUrl || driveFolderUrl;
      driveLink.target = '_blank';
      driveLink.rel = 'noopener noreferrer';
      driveLink.textContent = '云盘原档 ↗';
      driveLink.title = '在 Google 云盘中公开访问并下载此 MP3 原文件';

      actions.appendChild(pinBtn);
      actions.appendChild(copyIdBtn);
      actions.appendChild(copySsmlBtn);
      actions.appendChild(driveLink);

      bottom.appendChild(codeSpan);
      bottom.appendChild(actions);

      card.appendChild(top);
      card.appendChild(middle);
      card.appendChild(bottom);
      gridEl.appendChild(card);
    });
  }

  // Event Listeners
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab || 'all';
      renderGrid();
    });
  });

  document.querySelectorAll('[data-gender]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-gender]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeGender = chip.dataset.gender || 'all';
      renderGrid();
    });
  });

  const qingChip = document.getElementById('chip-qing-exact');
  if (qingChip) {
    qingChip.addEventListener('click', () => {
      qingOnly = !qingOnly;
      qingChip.classList.toggle('active', qingOnly);
      renderGrid();
    });
  }

  document.querySelectorAll('.verdict-pill-card').forEach((cardBtn) => {
    cardBtn.addEventListener('click', () => {
      const uid = cardBtn.dataset.uid;
      const v = getVoiceByUid(uid);
      if (v) {
        playVoice(v, false);
        const el = document.getElementById(`card-${uid}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value || '';
    renderGrid();
  });

  themeToggleBtn.addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    themeToggleLabel.textContent = isDark ? '深色录音棚' : '浅色纸感';
  });

  deckPlayBtn.addEventListener('click', () => {
    if (!currentUid) {
      const list = getFilteredVoices();
      if (list.length) playVoice(list[0], false);
      return;
    }
    if (audioEl.paused) {
      ensureWebAudio();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  });

  deckPrevBtn.addEventListener('click', () => stepTrack(-1));
  deckNextBtn.addEventListener('click', () => stepTrack(1));

  deckAbBtn.addEventListener('click', () => {
    const targetUid = currentUid === pinnedAUid ? lastComparableBUid : pinnedAUid;
    const targetVoice = getVoiceByUid(targetUid);
    if (targetVoice) playVoice(targetVoice, true);
  });

  deckCycleBtn.addEventListener('click', () => {
    autoCycle = !autoCycle;
    deckCycleBtn.classList.toggle('active', autoCycle);
    deckCycleBtn.textContent = autoCycle ? '顺序连播: 开' : '顺序连播: 关';
    if (autoCycle && (!currentUid || audioEl.paused)) {
      const list = getFilteredVoices();
      if (list.length) playVoice(list[0], true);
    }
  });

  deckSpeedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    const sp = SPEEDS[speedIndex];
    deckSpeedBtn.textContent = (sp === 1 ? '1.0' : String(sp)) + 'x';
    audioEl.playbackRate = sp;
  });

  deckCopySsmlBtn.addEventListener('click', () => {
    const v = getVoiceByUid(currentUid) || getVoiceByUid(pinnedAUid);
    if (!v) return;
    copyWithFeedback(buildSsml(v), deckCopySsmlBtn, '复制 SSML');
  });

  deckSeekSlider.addEventListener('input', () => {
    if (!audioEl.duration) return;
    audioEl.currentTime = (Number(deckSeekSlider.value) / 1000) * audioEl.duration;
  });

  audioEl.addEventListener('play', () => {
    isPlaying = true;
    deckPlayBtn.textContent = '⏸';
    renderGrid();
  });

  audioEl.addEventListener('pause', () => {
    isPlaying = false;
    deckPlayBtn.textContent = '▶';
    renderGrid();
  });

  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    deckCurTime.textContent = fmtTime(audioEl.currentTime);
    deckDurTime.textContent = fmtTime(audioEl.duration);
    deckSeekSlider.value = String(Math.round((audioEl.currentTime / audioEl.duration) * 1000));
  });

  audioEl.addEventListener('ended', () => {
    isPlaying = false;
    deckPlayBtn.textContent = '▶';
    deckSeekSlider.value = '1000';
    renderGrid();
    if (autoCycle) {
      setTimeout(() => {
        if (autoCycle) stepTrack(1);
      }, 320);
    }
  });

  // Initialize data from voices.json
  fetch('./voices.json')
    .then((res) => res.json())
    .then((data) => {
      allVoices = data.voices || [];
      if (data.driveFolderUrl) {
        driveFolderUrl = data.driveFolderUrl;
        driveFolderBtn.href = driveFolderUrl;
        footerDriveLink.href = driveFolderUrl;
      }
      updateAbButtonLabel();
      renderGrid();
      drawSpectrum();
    })
    .catch((err) => {
      countTextEl.textContent = '加载音色清单失败：' + String(err);
    });
})();
