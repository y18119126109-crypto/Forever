/* Shared by the web page and Electron. Guides never submit or change settings. */
(() => {
  const SEEN_KEY = 'swagger-guide-v1';
  const PROGRESS_KEY = 'swagger-guide-progress-v1';
  const $ = (selector) => document.querySelector(selector);
  const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
  const read = (storage, key) => {
    try { return JSON.parse(window[storage].getItem(key) || 'null'); } catch { return null; }
  };
  const write = (storage, key, value) => {
    try { window[storage].setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const visible = (node) => node && node.getClientRects().length
    && getComputedStyle(node).visibility !== 'hidden';
  let active = null;
  let dialog;
  let tooltip;
  let helpOwner = null;
  let helpPinned = false;
  let closeTimer;
  let frame = 0;
  const helpEntries = new Map();

  function closeHelp() {
    clearTimeout(closeTimer);
    if (!tooltip) return;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.hidden = true;
    helpOwner?.setAttribute('aria-expanded', 'false');
    helpOwner = null;
    helpPinned = false;
  }

  function positionHelp() {
    if (!helpOwner || !visible(helpOwner)) { closeHelp(); return; }
    const rect = helpOwner.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const top = rect.bottom + 10 + box.height <= innerHeight - 12
      ? rect.bottom + 10 : Math.max(12, rect.top - box.height - 10);
    tooltip.style.left = `${clamp(rect.right - box.width, 12, innerWidth - box.width - 12)}px`;
    tooltip.style.top = `${top}px`;
  }

  function openHelp(button, pinned = false) {
    if (active) return;
    clearTimeout(closeTimer);
    helpOwner?.setAttribute('aria-expanded', 'false');
    helpOwner = button;
    helpPinned = pinned;
    const entry = helpEntries.get(button.dataset.helpFor);
    const info = typeof entry === 'function' ? entry() : entry;
    if (!info) return;
    tooltip.replaceChildren();
    const head = el('div', 'help-popover-head');
    const title = el('strong', '', info.title);
    title.id = 'field-help-title';
    const close = el('button', 'help-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭填写说明');
    close.addEventListener('click', () => {
      const owner = helpOwner;
      closeHelp();
      owner?.focus({ preventScroll: true });
      closeHelp();
    });
    head.append(title, close);
    tooltip.append(head, el('p', '', info.text));
    if (info.example) tooltip.append(el('div', 'help-example', info.example));
    if (info.docs?.length) {
      const docs = el('div', 'help-docs');
      info.docs.forEach(([name, url]) => {
        const link = el('a', '', `${name} ↗`);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        docs.append(link);
      });
      tooltip.append(docs);
    }
    tooltip.hidden = false;
    if (tooltip.showPopover && !tooltip.matches(':popover-open')) tooltip.showPopover();
    button.setAttribute('aria-expanded', 'true');
    positionHelp();
  }

  function deferCloseHelp() {
    clearTimeout(closeTimer);
    if (!helpPinned) closeTimer = setTimeout(() => {
      if (!tooltip.contains(document.activeElement) && document.activeElement !== helpOwner) closeHelp();
    }, 220);
  }

  function initFieldHelp() {
    tooltip = el('div', 'help-popover');
    tooltip.id = 'field-help';
    tooltip.hidden = true;
    tooltip.setAttribute('popover', 'manual');
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', '填写说明');
    document.body.append(tooltip);
    tooltip.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    tooltip.addEventListener('pointerleave', deferCloseHelp);
    tooltip.addEventListener('focusout', deferCloseHelp);

    document.querySelectorAll('[name="player-style"]').forEach((input) => {
      input.id ||= `style-${input.value}`;
    });
    Object.entries(window.SwaggerHelpContent?.fields || {}).forEach(([id, content]) => {
      const field = document.getElementById(id);
      const label = field?.closest('label') || $(`label[for="${id}"]`);
      if (!field || !label) return;
      helpEntries.set(id, content);
      const button = el('button', 'field-help-button', '?');
      button.type = 'button';
      button.dataset.helpFor = id;
      button.setAttribute('aria-label', `${typeof content === 'function' ? '查看' : content.title}填写说明`);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'field-help');
      const wrapper = el('div', 'field-with-help');
      // Keep original inputs and labels intact, including IME composition and drafts.
      if (label.classList.contains('wide-field')) {
        label.classList.remove('wide-field');
        wrapper.classList.add('wide-field');
      }
      if (label.classList.contains('appearance-option')) wrapper.classList.add('appearance-help');
      if (id === 'avatar-file') wrapper.classList.add('upload-help');
      label.before(wrapper);
      wrapper.append(label, button);
      const description = el('span', 'guide-sr-only');
      description.id = `help-description-${id}`;
      wrapper.append(description);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), description.id].filter(Boolean).join(' '));
      const update = () => {
        const info = typeof content === 'function' ? content() : content;
        description.textContent = `${info.text}${info.example ? ` 示例：${info.example}` : ''}`;
        button.setAttribute('aria-label', `${info.title}：填写说明`);
      };
      update();
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch' && !helpPinned) openHelp(button);
      });
      button.addEventListener('pointerleave', deferCloseHelp);
      button.addEventListener('focus', () => { if (helpOwner !== button) openHelp(button); });
      button.addEventListener('blur', deferCloseHelp);
      button.addEventListener('click', () => {
        if (helpOwner === button && helpPinned) closeHelp();
        else openHelp(button, true);
      });
      field.addEventListener('change', update);
    });
    ['ai-provider', 'voice-provider'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        closeHelp();
        refreshHelpDescriptions();
      });
    });
    document.addEventListener('pointerdown', (event) => {
      if (helpOwner && !tooltip.contains(event.target) && event.target !== helpOwner) closeHelp();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && helpOwner) {
        const owner = helpOwner;
        closeHelp();
        owner.focus({ preventScroll: true });
        // Focusing an already focused owner must not reopen the popover.
        closeHelp();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function refreshHelpDescriptions() {
    helpEntries.forEach((entry, id) => {
      const info = typeof entry === 'function' ? entry() : entry;
      const description = document.getElementById(`help-description-${id}`);
      if (description) description.textContent = `${info.text}${info.example ? ` 示例：${info.example}` : ''}`;
      $(`[data-help-for="${id}"]`)?.setAttribute('aria-label', `${info.title}：填写说明`);
    });
  }

  function radioSteps() {
    const style = document.documentElement.dataset.playerStyle;
    const stage = style === 'album'
      ? { target: '.album-lyrics', title: '跟着歌词听下去', text: '唱片下方会随播放进度显示当前歌词；没有歌词时会显示提示。助理在页面底部，随时可以继续对话。' }
      : style === 'glass'
        ? { target: '.clock-stage', title: '你的玻璃音乐桌面', text: '左侧是时钟和正在播放的唱片，右侧是队列与助理。你可以在 Lab 的「外观」页随时切换到经典电台或唱片沉浸。' }
        : { target: '.stage-switch', title: '时间、歌词，还有听众的故事', text: '用这三个按钮切换时间、滚动歌词和歌曲评论。音乐播放时也能随时切换。' };
    return [
      { title: '欢迎来到你的私人电台', text: '用一分钟认识 Forever。先了解播放和对话，再带你去 Lab 连接模型、选择声音。随时可以跳过，之后从「使用指南」重新查看。', note: '先逛一逛，不需要现在填写任何 Key。', next: '带我看看', welcome: true },
      { target: '.transport', title: '从播放一首歌开始', text: '中间是播放 / 暂停，两边切换上一首、下一首。方块停止播放，爱心收藏当前歌曲。歌曲结束后会自动续播。', note: '这里只做介绍，不会自动播放。' },
      { target: '.progress-row', title: '听到哪里，由你决定', text: ['glass', 'album'].includes(style) ? '拖动进度条跳到想听的部分，音量滑杆调整播放音量。切换外观也会保留当前音乐进度。' : '拖动进度条跳到想听的部分，VOL 调整播放音量。HIDE 可以收起播放条；图钉决定它是否随页面吸顶。' },
      style === 'album'
        ? { target: '.album-navigation', title: '像翻唱片一样选歌', text: '点两侧唱片或箭头切换歌曲；点当前封面播放或暂停。喜欢当前歌曲时，可以用播放控制区的爱心收藏。' }
        : { target: '.queue .section-bar', title: '接下来播放什么', text: style === 'glass' ? '队列显示即将播放的歌曲，点击歌曲就能切换。喜欢当前歌曲，可以用播放控制区的爱心收藏。' : '队列显示即将播放的歌曲，点击歌曲就能切换。爱心收藏后，可用播放条上的 FAV 筛选收藏（宽屏可见）。' },
      { target: '#composer', title: '把心情说给 DJ 听', text: '输入「来点轻松的爵士」或「接下来两小时只听白噪音」，按发送即可。麦克风按钮支持语音输入；电脑可在输入框外长按空格，手机可长按输入框。', note: '语音输入需系统 / 浏览器支持及麦克风权限，也可以一直使用文字。' },
      stage,
      { target: '.lab-button', title: '让电台真正属于你', text: 'Lab 是设置中心：连接助理的大模型、设置语音与音乐来源，再调整记忆、推荐和外观。我们接着看一遍，所有设置都可稍后填写。', next: '继续 · 认识 Lab', handoff: true }
    ];
  }

  const labSteps = [
    { target: '.settings-tabs', title: 'Lab：电台的设置中心', text: '身份、记忆、推荐、服务、声音、外观各有一个分页。每页独立保存；字段旁的问号可以查看填写方法和获取入口。', next: '从服务开始' },
    { page: 'integrations', target: '#ai-provider', title: '先连接助理的大脑', text: '选择模型服务商，再填 API 地址、模型 ID 和该服务商的 Key。首次用火山方舟可保留默认地址，从控制台复制已开通模型的 ID 和 Key。', note: '使用 Codex CLI 时先安装并登录，模型 ID 可留空。' },
    { page: 'integrations', target: '#voice-provider', title: '再为助理配一个声音', text: '语音服务负责朗读回复。火山语音需要语音控制台的独立 Key；若暂时不想配置，选择 Browser Speech 使用系统语音。', note: 'Voice / Reference ID 供 Fish Audio 使用；火山音色在「声音」页设置。' },
    { page: 'integrations', target: '#music-source', title: '选择网易云、QQ 或自动切换', text: '自动选择会先使用网易云，再以你自己的 QQMusicApi 兜底。网易云可扫码登录；QQ 音乐需先独立运行 QQMusicApi，再填写地址与可选 Cookie。' },
    { page: 'integrations', target: '[data-save-section="integrations"]', title: '填写后，记得保存并同步', text: '每个分页都有自己的保存按钮。切页只保留草稿，不会自动提交。已保存的 Key 显示为掩码，输入框留空会保留原 Key。', note: '引导不会替你保存或清除任何内容。' },
    { page: 'voice', target: '#speaker-select', title: '先选音色，再听听效果', text: '火山语音可以选官方音色，微调语速、情绪和声音风格。先在「服务」页保存语音连接，再用本页「生成试听」，满意后保存声音。', note: '自定义 Speaker ID 可留空；复刻音色需与资源类型匹配。' },
    { page: 'profile', target: '#genre-tags', title: '告诉 DJ 你的长期偏好', text: '风格标签用逗号分隔。在记忆里写喜欢的歌手、收听习惯和不想听的内容，帮助助理理解你。', note: '例如：工作时少人声，深夜喜欢爵士。' },
    { page: 'recommendation', target: '.response-mode-options label', title: '选择 DJ 怎么回应你', text: '直接播放保留原有体验；歌单卡片会在对话中展示本次推荐；互动选择会在需求模糊时先给出几个可点击方向。临时指令仍可覆盖常规推荐比例。' },
    { page: 'identity', target: '#assistant-name', title: '给你的 DJ 一个名字', text: '设置助理名称，上传自己的头像。所有修改先预览，再点本页「保存并同步」。' },
    { page: 'appearance', target: '.appearance-option', title: '换一种听音乐的方式', text: '经典电台、唱片沉浸、玻璃桌面，选一个喜欢的外观，保存后电台实时切换，音乐继续播放。' },
    { title: '准备好，开始你的节目', text: '建议先配置「服务」，再到「声音」试听。任何字段不确定，都可以悬停或点击旁边的问号；以后也能从顶部重新打开引导。', next: '去配置服务', finish: true }
  ];

  function ensureDialog() {
    if (dialog) return;
    dialog = el('dialog', 'guide-dialog');
    dialog.setAttribute('aria-labelledby', 'guide-title');
    dialog.setAttribute('aria-describedby', 'guide-text');
    dialog.innerHTML = `
      <svg class="guide-shade" aria-hidden="true"><path fill-rule="evenodd"></path></svg>
      <div class="guide-ring" aria-hidden="true"></div>
      <div class="guide-cursor" aria-hidden="true"><svg viewBox="0 0 30 36"><path d="M3 2v27l7-7 6 11 5-3-6-10h11z"/></svg></div>
      <section class="guide-card">
        <div class="guide-card-top"><span class="guide-chapter"></span><button class="guide-skip" type="button">跳过引导</button></div>
        <div class="guide-welcome-mark" aria-hidden="true">↗</div>
        <div class="guide-copy"><p class="guide-counter" aria-live="polite"></p>
        <h2 id="guide-title"></h2><p id="guide-text"></p><p class="guide-note"></p></div>
        <div class="guide-meter" aria-hidden="true"><span></span></div>
        <footer class="guide-actions"><button class="guide-back" type="button">上一步</button><button class="guide-next" type="button"></button></footer>
        <span class="guide-keyboard">← → 切换步骤 · Esc 跳过</span>
      </section>`;
    document.body.append(dialog);
    dialog.querySelector('.guide-skip').addEventListener('click', () => finish(false));
    dialog.querySelector('.guide-back').addEventListener('click', () => showStep(active.index - 1));
    dialog.querySelector('.guide-next').addEventListener('click', next);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => { if (active) finish(false); });
    document.addEventListener('keydown', (event) => {
      if (!active) return;
      // Do not let Space / Escape reach the radio's recording and focus shortcuts.
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); showStep(active.index - 1); }
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener('keyup', (event) => {
      if (active) event.stopImmediatePropagation();
    }, true);
  }

  function saveProgress() {
    if (active) write('sessionStorage', PROGRESS_KEY, { scope: active.scope, index: active.index, time: Date.now() });
  }

  function showStep(index) {
    if (!active) return;
    active.index = clamp(index, 0, active.steps.length - 1);
    const step = active.steps[active.index];
    if (step.page) active.setPage?.(step.page);
    active.target = step.target ? $(step.target) : null;
    if (!visible(active.target)) active.target = null;
    dialog.querySelector('.guide-chapter').textContent = active.scope === 'radio' ? '01 / 认识你的电台' : '02 / 让 DJ 更懂你';
    dialog.querySelector('.guide-counter').textContent = `${String(active.index + 1).padStart(2, '0')} / ${String(active.steps.length).padStart(2, '0')}`;
    dialog.querySelector('#guide-title').textContent = step.title;
    dialog.querySelector('#guide-text').textContent = step.text;
    const note = dialog.querySelector('.guide-note');
    note.textContent = step.note || '';
    note.hidden = !step.note;
    dialog.querySelector('.guide-next').textContent = step.next || '下一步 →';
    dialog.querySelector('.guide-back').disabled = active.index === 0;
    dialog.querySelector('.guide-copy').scrollTop = 0;
    dialog.querySelector('.guide-meter span').style.width = `${100 * (active.index + 1) / active.steps.length}%`;
    dialog.classList.toggle('guide-welcome', Boolean(step.welcome));
    active.observer?.disconnect();
    if (active.target) {
      active.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = active.target.getBoundingClientRect();
      const cardHeight = dialog.querySelector('.guide-card').offsetHeight;
      if (innerWidth <= 760 && innerHeight - rect.bottom < cardHeight + 28
        && rect.top < cardHeight + 28) {
        // Reserve a clear area above the mobile card instead of covering the control.
        window.scrollBy({ top: rect.top - (active.scope === 'lab' ? 148 : 64), behavior: 'instant' });
      }
      active.observer?.observe(active.target);
    }
    saveProgress();
    layout();
    dialog.querySelector('.guide-next').focus({ preventScroll: true });
    queueLayout();
  }

  function layout() {
    if (!active) return;
    const card = dialog.querySelector('.guide-card');
    const ring = dialog.querySelector('.guide-ring');
    const cursor = dialog.querySelector('.guide-cursor');
    const w = innerWidth;
    const h = innerHeight;
    const cw = Math.min(386, w - 28);
    card.style.width = `${cw}px`;
    card.style.maxHeight = `${h - 28}px`;
    let ch = card.offsetHeight;
    let r = visible(active.target) ? active.target.getBoundingClientRect() : null;
    if (r && (r.bottom < 0 || r.top > h)) r = null;
    const topInset = active.scope === 'lab' && !active.target?.matches('.settings-tabs') ? 130 : 10;
    const box = r ? {
      left: clamp(r.left - 8, 6, w - 30),
      right: clamp(r.right + 8, 30, w - 6),
      top: clamp(r.top - 8, topInset, h - 32),
      bottom: clamp(r.bottom + 8, topInset + 24, h - 6)
    } : null;
    let x = (w - cw) / 2;
    let y = (h - ch) / 2;
    if (box) {
      if (w > 760 && w - box.right > cw + 34) {
        x = box.right + 20;
        y = clamp(box.top, 14, h - ch - 14);
      } else if (w > 760 && box.left > cw + 34) {
        x = box.left - cw - 20;
        y = clamp(box.top, 14, h - ch - 14);
      } else {
        x = clamp((box.left + box.right - cw) / 2, 14, w - cw - 14);
        const below = h - box.bottom - 32;
        const above = box.top - 32;
        const placeBelow = below >= ch || (above < ch && below >= above);
        card.style.maxHeight = `${Math.max(160, placeBelow ? below : above)}px`;
        ch = card.offsetHeight;
        y = placeBelow ? box.bottom + 18 : box.top - ch - 18;
      }
      ring.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.right - box.left}px;height:${box.bottom - box.top}px`;
      cursor.style.left = `${clamp(box.right - 14, 10, w - 40)}px`;
      cursor.style.top = `${clamp(box.bottom - 14, 10, h - 42)}px`;
    }
    card.style.left = `${x}px`;
    card.style.top = `${Math.max(10, y)}px`;
    ring.hidden = cursor.hidden = !box;
    const shade = dialog.querySelector('.guide-shade');
    shade.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const hole = box ? ` M${box.left},${box.top} H${box.right} V${box.bottom} H${box.left} Z` : '';
    shade.querySelector('path').setAttribute('d', `M0,0 H${w} V${h} H0 Z${hole}`);
  }

  function queueLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; layout(); positionHelp(); });
  }

  function finish(completed, configure = false) {
    if (!active) return;
    const previous = active;
    write('localStorage', SEEN_KEY, { ...(read('localStorage', SEEN_KEY) || {}), [active.scope]: completed ? 'done' : 'skipped' });
    write('sessionStorage', PROGRESS_KEY, null);
    active.observer?.disconnect();
    active = null;
    dialog.close();
    document.documentElement.classList.remove('guide-open');
    if (previous.scope === 'lab') previous.setPage?.(configure ? 'integrations' : previous.originalPage);
    previous.restore?.();
    previous.focus?.focus({ preventScroll: true });
  }

  function next() {
    if (!active) return;
    const step = active.steps[active.index];
    if (step.handoff) {
      finish(true);
      write('sessionStorage', PROGRESS_KEY, { scope: 'lab', index: 0, time: Date.now() });
      location.assign('/debug.html');
    } else if (active.index === active.steps.length - 1) finish(true, true);
    else showStep(active.index + 1);
  }

  function initialize(scope, options = {}) {
    ensureDialog();
    const start = (index = 0) => {
      if (active) return;
      closeHelp();
      const restore = options.prepare?.();
      active = {
        scope, index, steps: scope === 'radio' ? radioSteps() : labSteps,
        setPage: options.setPage, originalPage: options.getPage?.() || 'identity',
        focus: document.activeElement, restore, observer: new ResizeObserver(queueLayout)
      };
      document.documentElement.classList.add('guide-open');
      dialog.showModal();
      showStep(index);
    };
    document.querySelectorAll('[data-start-guide]').forEach((button) => {
      button.addEventListener('click', () => start());
    });
    const progress = read('sessionStorage', PROGRESS_KEY);
    const seen = read('localStorage', SEEN_KEY) || {};
    if (progress?.scope === scope && Date.now() - progress.time < 86400000) start(progress.index);
    else if (!seen[scope]) start();
  }
  window.addEventListener('resize', queueLayout);
  window.addEventListener('scroll', queueLayout, true);
  window.visualViewport?.addEventListener('resize', queueLayout);
  window.SwaggerGuide = {
    initRadio: (options) => initialize('radio', options),
    initLab: (options) => { initFieldHelp(); initialize('lab', options); },
    refreshHelp: refreshHelpDescriptions,
    closeHelp
  };
})();
