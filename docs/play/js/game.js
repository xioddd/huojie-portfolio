/* 活结 · 游戏主逻辑 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function applyPhoneLayout() {
    const native = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
      && window.Capacitor.isNativePlatform());
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const short = Math.min(window.innerWidth, window.innerHeight) <= 520
      || Math.max(window.innerWidth, window.innerHeight) <= 980;
    const on = native || (coarse && short);
    const root = document.documentElement;
    root.classList.toggle("is-phone-app", on);
    if (!on) {
      root.style.removeProperty("--phone-win-zoom");
      root.style.removeProperty("--phone-browser-left");
      root.style.removeProperty("--phone-browser-width");
      root.style.removeProperty("--phone-browser-height");
      return;
    }
    const icons = 58;
    const bar = 26;
    const gap = 6;
    const chatW = Math.round(Math.min(Math.max(window.innerWidth * 0.30, 215), 275));
    root.style.setProperty("--phone-chat", `${chatW}px`);
    const availW = Math.max(160, window.innerWidth - icons - chatW - gap * 3);
    const availH = Math.max(120, window.innerHeight - bar - gap * 2);
    const zoom = Math.max(0.42, Math.min(availW / 820, availH / 620, 1));
    root.style.setProperty("--phone-win-zoom", String(zoom));
    // 网页框左缘保持原位，向右拉近聊天框，只留一小段间距
    const midW = Math.max(160, window.innerWidth - icons - chatW - gap * 2);
    const keepLeft = Math.max(180, Math.round(midW * 0.62));
    const side = Math.max(12, Math.round((midW - keepLeft) / 2));
    const visualLeft = icons + gap + side;
    const visualW = Math.max(keepLeft, midW - side - 8);
    const visualH = Math.max(120, window.innerHeight - (gap + 22) - (bar + gap + 12));
    root.style.setProperty("--phone-browser-left", `${visualLeft}px`);
    root.style.setProperty("--phone-browser-width", `${Math.round(visualW / zoom)}px`);
    root.style.setProperty("--phone-browser-height", `${Math.round(visualH / zoom)}px`);
  }

  const state = {
    chapter: "prologue",
    flags: Object.create(null),
    history: [],
    page: "home",
    chatLog: [],
    chatTitle: "与梁穗聊天中",
    chatOpen: true,
    groupChat: false,
    members: ["玩家", "梁穗"],
    exposure: 0,
    keepClicks: 0,
    puzzleOrder: [],
    timeline: [],
    evidence: {},
    pendingChoice: null,
    archSection: "home",
  };

  const CHAPTER_LABEL = {
    prologue: "序章",
    ch1: "第一章 · 牵命人",
    ch2: "第二章 · 她让我走",
    ch3: "第三章 · 未离开",
    ch4: "第四章 · 松手",
    ending: "尾声 · 接绳",
    epilogue: "尾声",
  };

  function flag(k, v) {
    if (v === undefined) return !!state.flags[k];
    state.flags[k] = v;
    save();
  }

  function save() {
    try {
      localStorage.setItem("huojie_save", JSON.stringify({
        chapter: state.chapter,
        flags: state.flags,
        page: state.page,
        chatLog: state.chatLog.slice(-400),
        chatTitle: state.chatTitle,
        groupChat: state.groupChat,
        members: state.members || ["玩家", "梁穗"],
        archSection: state.archSection || "home",
        pendingChoice: state.pendingChoice || null,
      }));
    } catch (_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem("huojie_save");
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(state.flags, d.flags || {});
      if (d.chapter) state.chapter = d.chapter;
      if (d.page) state.page = d.page;
      if (Array.isArray(d.chatLog)) {
        state.chatLog = d.chatLog.filter(m =>
          !(m && m.cls === "sys" && typeof m.text === "string" && m.text.includes("私人聊天已变为群聊"))
        );
      }
      if (d.chatTitle) state.chatTitle = d.chatTitle;
      if (d.groupChat) state.groupChat = !!d.groupChat;
      if (d.archSection) state.archSection = d.archSection;
      if (Array.isArray(d.members) && d.members.length) {
        state.members = d.members.slice();
      } else if (d.groupChat) {
        // 旧存档：群聊开着但没存成员名单 → 默认含「梁绫」
        state.members = ["玩家", "梁穗", "梁绫"];
      }
      if (d.pendingChoice && Array.isArray(d.pendingChoice.options)) {
        state.pendingChoice = d.pendingChoice;
      }
      // 修复旧存档：序章误触发的第二章房间标记
      if (state.chapter === "prologue" || state.chapter === "ch1") {
        if (state.flags.ch2_intro) delete state.flags.ch2_intro;
        if (state.flags.folder_ready && !state.flags.ch2_done) delete state.flags.folder_ready;
        if (state.flags.room_sent && !state.flags.ch2_done) delete state.flags.room_sent;
      }
      // 旧存档已进第二章但未记 room_sent：补上，避免房间入口消失
      if (["ch2", "ch3", "ch4", "ending", "epilogue"].includes(state.chapter) && !state.flags.room_sent) {
        if (state.flags.ch2_intro || state.flags.ch2_done || state.flags.box_open) {
          state.flags.room_sent = true;
        }
      }
      // 牵绳娘对话未真正播完时，允许重进触发（清掉误写的 saw_legend）
      if (state.flags.saw_legend && !state.flags.prologue_glitch) {
        delete state.flags.saw_legend;
      }
      // 旧存档：房间线已走完则补记学校对话完成，避免重弹错序
      if (state.flags.room_sent || state.flags.sui_looking_room) {
        state.flags.school_chat_done = true;
      }
      // 申请表惊吓中断残留
      if (state.flags.ch1_glitch_view) delete state.flags.ch1_glitch_view;
      // 旧存档：已发过「把发现发给梁穗」且对话里出现过铁门，但未存 plan_ring_clicked
      if (state.flags.told_plan && !state.flags.saw_materials && !state.flags.plan_ring_clicked) {
        const doorSaid = (state.chatLog || []).some(m =>
          m && typeof m.text === "string" && m.text.includes("后面真的有一扇铁门")
        );
        if (doorSaid) state.flags.plan_ring_clicked = true;
      }
      // 旧存档：时间线已完却卡在河边问答——改为直接可修曝光
      if (state.flags.ch3_truth && !state.flags.exposure_done && !state.flags.fake_riverside) {
        state.flags.fake_riverside = true;
      }
      if (state.pendingChoice?.hook === "riverside:news") {
        state.pendingChoice = {
          hook: "expose:open",
          options: [{ text: "打开三号染池照片并修复曝光" }],
        };
      }
      if (state.pendingChoice?.hook === "ch3:open_archive") {
        state.pendingChoice = null;
      }
      // 旧对话：墙面照改为聊天点开，去掉口头「帮我看看照片」
      (state.chatLog || []).forEach(m => {
        if (m && m.text === "地面有一道旧绳槽，一直通到木板底下……你帮我看看照片。") {
          m.text = "地面有一道旧绳槽，一直通到木板底下……";
        }
      });
      syncChapterTheme();
    } catch (_) {}
  }

  function setChapter(c) {
    state.chapter = c;
    $("#chapter-label").textContent = CHAPTER_LABEL[c] || c;
    syncChapterTheme();
    tickClock();
    save();
  }

  /** 第三章：弹窗 / 照片查看等改为绿系（工业档案窗本身已是绿系） */
  function syncChapterTheme() {
    const on = state.chapter === "ch3";
    document.body.classList.toggle("theme-ch3", on);
    $("#modal")?.classList.toggle("theme-ch3", on);
  }

  function toast(msg, ms = 2800) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function flicker() {
    const el = $("#flicker");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 450);
  }

  /* ---------- BGM / SFX ---------- */
  const BGM_TRACKS = {
    title: { files: ["assets/audio/bgm_title.mp3", "assets/audio/bgm_title.ogg"], vol: 0.5 },
    museum: { files: ["assets/audio/bgm_museum.mp3", "assets/audio/bgm_museum.ogg"], vol: 0.3 },
    horror: { files: ["assets/audio/bgm_horror.mp3", "assets/audio/bgm_horror.ogg"], vol: 0.4 },
    investigate: { files: ["assets/audio/bgm_investigate.mp3", "assets/audio/bgm_investigate.ogg"], vol: 0.25 },
    hope: { files: ["assets/audio/bgm_hope.mp3", "assets/audio/bgm_hope.ogg"], vol: 0.45 },
    memory: { files: ["assets/audio/bgm_memory.mp3", "assets/audio/bgm_memory.ogg"], vol: 0.3 },
    forest: { files: ["assets/audio/bgm_forest.mp3", "assets/audio/bgm_forest.ogg", "assets/audio/bgm_forest.m4a"], vol: 0.42 },
    ending: { files: ["assets/audio/bgm_ending.mp3", "assets/audio/bgm_ending.ogg"], vol: 0.4 },
    collapsing: { files: ["assets/audio/bgm_collapsing.m4a"], vol: 0.16 },
  };
  const SFX_TRACKS = {
    bell_1: { files: ["assets/audio/sfx_bell_1.mp3", "assets/audio/sfx_bell_1.ogg"], vol: 0.22 },
    bell_2: { files: ["assets/audio/sfx_bell_2.mp3", "assets/audio/sfx_bell_2.ogg"], vol: 0.22 },
    bell_3: { files: ["assets/audio/sfx_bell_3.mp3", "assets/audio/sfx_bell_3.ogg"], vol: 0.24 },
    text_flood: { files: ["assets/audio/sfx_text_flood.mp3", "assets/audio/sfx_text_flood.ogg"], vol: 0.4 },
    lock_tick: { files: ["assets/audio/sfx_lock_tick.mp3", "assets/audio/sfx_lock_tick.ogg"], vol: 0.35 },
    rain_flood: { files: ["assets/audio/sfx_rain_flood.mp3", "assets/audio/sfx_rain_flood.ogg"], vol: 0.19 },
  };
  let currentBgm = null;
  let bgmAudio = null;
  let activeFloodSfx = null;
  let activeBellSfx = null;
  let activeRainSfx = null;

  function isNativeAudio() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
      && window.Capacitor.isNativePlatform());
  }

  function pickAudioSrc(files) {
    if (!files || !files.length) return "";
    const probe = document.createElement("audio");
    for (const src of files) {
      const ext = src.split(".").pop().toLowerCase();
      const type = ext === "mp3" ? "audio/mpeg"
        : ext === "m4a" ? "audio/mp4"
          : ext === "ogg" ? "audio/ogg" : "";
      if (!type || probe.canPlayType(type) !== "") return src;
    }
    return files[0];
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function fadeAudio(audio, target, ms, onDone) {
    if (!audio) { onDone?.(); return; }
    audio._fadeToken = (audio._fadeToken || 0) + 1;
    const token = audio._fadeToken;
    if (audio._fadeRaf) cancelAnimationFrame(audio._fadeRaf);
    const start = audio.volume;
    const t0 = performance.now();
    const dur = Math.max(160, ms || 800);
    const step = (now) => {
      if (!audio || audio._fadeToken !== token) return;
      const p = Math.min(1, (now - t0) / dur);
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * easeInOut(p)));
      if (p < 1) {
        audio._fadeRaf = requestAnimationFrame(step);
      } else {
        audio._fadeRaf = null;
        audio.volume = Math.max(0, Math.min(1, target));
        onDone?.();
      }
    };
    audio._fadeRaf = requestAnimationFrame(step);
  }

  function detachAudioLoop(audio) {
    if (!audio || !audio._loopHandlers) return;
    const h = audio._loopHandlers;
    if (h.timeupdate) audio.removeEventListener("timeupdate", h.timeupdate);
    if (h.ended) audio.removeEventListener("ended", h.ended);
    audio._loopHandlers = null;
    audio._loopEnabled = false;
  }

  function attachAudioLoop(audio, enabled = true) {
    detachAudioLoop(audio);
    if (!audio || !enabled) {
      if (audio) audio.loop = false;
      return;
    }
    audio._loopEnabled = true;
    const native = isNativeAudio();
    audio.loop = !native;
    const handlers = {};
    if (native) {
      const rewindLead = 0.18;
      handlers.timeupdate = () => {
        if (!audio._loopEnabled || audio._retired) return;
        const d = audio.duration;
        if (!Number.isFinite(d) || d < 1.5) return;
        if (audio.currentTime >= d - rewindLead) {
          audio.currentTime = 0;
          if (audio.paused) audio.play().catch(() => {});
        }
      };
      audio.addEventListener("timeupdate", handlers.timeupdate);
    }
    handlers.ended = () => {
      if (!audio._loopEnabled || audio._retired) return;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    };
    audio.addEventListener("ended", handlers.ended);
    audio._loopHandlers = handlers;
  }

  function retireAudio(audio, fade = 500) {
    if (!audio) return;
    audio._retired = true;
    detachAudioLoop(audio);
    fadeAudio(audio, 0, fade, () => {
      audio.pause();
      try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
    });
  }

  function createBgmAudio(id, opts = {}) {
    const track = BGM_TRACKS[id];
    if (!track) return null;
    const audio = new Audio(pickAudioSrc(track.files));
    audio.preload = "auto";
    audio.volume = 0;
    attachAudioLoop(audio, opts.loop !== false);
    return audio;
  }

  function playRainFlood(opts = {}) {
    if (activeRainSfx && !activeRainSfx.paused) {
      fadeAudio(activeRainSfx, opts.volume != null ? opts.volume : SFX_TRACKS.rain_flood.vol, 400);
      return activeRainSfx;
    }
    stopSfx(activeRainSfx, 0);
    activeRainSfx = playSfx("rain_flood", {
      loop: true,
      volume: opts.volume != null ? opts.volume : SFX_TRACKS.rain_flood.vol,
    });
    return activeRainSfx;
  }

  function stopRainFlood(fade = 800) {
    if (activeRainSfx) {
      activeRainSfx._retired = true;
      detachAudioLoop(activeRainSfx);
    }
    stopSfx(activeRainSfx, fade);
    activeRainSfx = null;
  }

  function playBgm(id, opts = {}) {
    const track = BGM_TRACKS[id];
    if (!track) return;
    const vol = opts.volume != null ? opts.volume : track.vol;
    const fade = opts.fade != null ? opts.fade : 1100;
    const loop = opts.loop !== false;

    // 回忆杀/森林投影 BGM：在第四章结束前，不要被其他 BGM 打断
    if (flag("_recollection_bgm_active") && id !== "forest") return;

    if (currentBgm === id && bgmAudio && !bgmAudio._retired) {
      attachAudioLoop(bgmAudio, loop);
      if (bgmAudio.paused) {
        bgmAudio.play().then(onBgmPlaying).catch(() => markBgmBlocked());
      } else {
        onBgmPlaying();
      }
      fadeAudio(bgmAudio, vol, Math.min(fade, 900));
      return;
    }

    const next = createBgmAudio(id, { loop });
    if (!next) return;
    const prev = bgmAudio;
    bgmAudio = next;
    currentBgm = id;

    if (prev && prev !== next) retireAudio(prev, fade);

    next.play().then(onBgmPlaying).catch(() => markBgmBlocked());
    fadeAudio(next, vol, fade);
  }

  function playSfx(id, opts = {}) {
    const track = SFX_TRACKS[id];
    if (!track) return null;
    const a = new Audio(pickAudioSrc(track.files));
    a.preload = "auto";
    a.volume = opts.volume != null ? opts.volume : track.vol;
    attachAudioLoop(a, !!opts.loop);
    a.play().catch(() => {});
    return a;
  }

  function stopSfx(audio, fade = 300) {
    if (!audio) return;
    audio._retired = true;
    detachAudioLoop(audio);
    fadeAudio(audio, 0, fade, () => {
      audio.pause();
      try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
    });
  }

  function onBgmPlaying() {
    const hint = $("#boot-hint");
    if (hint) hint.textContent = "建议佩戴耳机 · 约 40 分钟";
  }

  function markBgmBlocked() {
    const boot = $("#boot-screen");
    const hint = $("#boot-hint");
    if (boot && !boot.classList.contains("hidden") && hint) {
      hint.textContent = "点击屏幕开启音乐 · 建议佩戴耳机";
    }
  }

  function resumeBgmIfNeeded() {
    if (bgmAudio && bgmAudio.paused && currentBgm) {
      bgmAudio.play().then(onBgmPlaying).catch(() => {});
    } else if (!currentBgm && $("#boot-screen") && !$("#boot-screen").classList.contains("hidden")) {
      playBgm("title", { fade: 500 });
    }
  }

  function startTitleBgm() {
    playBgm("title", { fade: 900 });
  }

  function stopBgm(fade = 500) {
    const prev = bgmAudio;
    bgmAudio = null;
    currentBgm = null;
    if (!prev) return;
    retireAudio(prev, fade);
  }

  function shouldPlayHorrorBgm() {
    if (flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue") return false;
    if (flag("_hope_active") || flag("_forest_active")) return false;
    if (state.page === "qianshengniang") return true;
    if (flag("_horror_active")) return true;
    if (flag("ch3_truth") || flag("exposure_done") || flag("ch4_started")) return true;
    if (state.chapter === "ch3" || state.chapter === "ch4") return true;
    return false;
  }

  /** 回忆 BGM：梁穗冒雨跑回家（street_flood）起，不要等水彩回忆杀 */
  function startRecollectionBgm() {
    flag("_forest_active", true);
    flag("_recollection_bgm_active", true);
    playBgm("forest", { fade: 700, volume: 0.42 });
    playRainFlood({ volume: 0.04 });
  }

  function playDesktopBgm() {
    if (currentBgm === "collapsing") return;
    if (flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue") {
      playBgm("ending");
      return;
    }
    if (flag("_forest_active") || flag("_hope_active")) {
      playBgm("forest", { fade: 900, volume: 0.42 });
      return;
    }
    if (shouldPlayHorrorBgm()) playBgm("horror");
    else playBgm("museum");
  }

  function playInvestigateBgm() {
    if (flag("ending_started") || flag("_hope_active") || flag("_forest_active")) return;
    playBgm("investigate", { fade: 700 });
  }

  function setHorrorMoment(on) {
    if (on) flag("_horror_active", true);
    else {
      delete state.flags._horror_active;
      save();
    }
  }

  async function blackout(ms = 700) {
    let el = $("#blackout");
    if (!el) {
      el = document.createElement("div");
      el.id = "blackout";
      el.className = "blackout";
      document.body.appendChild(el);
    }
    el.classList.add("on");
    await wait(ms);
    el.classList.remove("on");
  }

  function openWin(id) {
    const w = $(`#win-${id}`);
    if (!w) return;
    w.classList.remove("hidden");
    w.style.zIndex = String(20 + (++openWin.z || (openWin.z = 20)));
    if (id === "browser") renderPage(state.page);
    if (id === "folder") renderFolder();
    if (id === "archive") goArchive(state.archSection || "home");
    if (id === "filebox") renderFileBox();
  }
  openWin.z = 20;

  function closeWin(id) {
    $(`#win-${id}`)?.classList.add("hidden");
  }

  /* ---------- Chat ---------- */
  function chatMsg(who, text, cls, opts = {}) {
    const map = { sui: "sui", 梁穗: "sui", sys: "sys", player: "player", 玩家: "player", ling: "ling", 梁绫: "ling" };
    const resolvedCls = cls || map[who] || "sui";
    appendChatDom(who, text, resolvedCls);
    if (!opts.silent) {
      state.chatLog.push({ who, text, cls: resolvedCls });
      if (state.chatLog.length > 400) state.chatLog.splice(0, state.chatLog.length - 400);
      save();
      beep(who);
    }
  }

  function chatImg(who, imgKey, caption = "", cls) {
    const map = { sui: "sui", 梁穗: "sui", player: "player", 玩家: "player", ling: "ling", 梁绫: "ling" };
    const resolvedCls = cls || map[who] || "sui";
    appendChatImgDom(who, imgKey, caption, resolvedCls);
    state.chatLog.push({ type: "img", who, imgKey, caption, cls: resolvedCls });
    if (state.chatLog.length > 400) state.chatLog.splice(0, state.chatLog.length - 400);
    save();
    beep(who);
  }

  function beep(who) {
    try {
      const a = new AudioContext();
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = who === "梁绫" || who === "ling" ? 220 : 660;
      g.gain.value = 0.03;
      o.connect(g); g.connect(a.destination);
      o.start(); o.stop(a.currentTime + 0.06);
    } catch (_) {}
  }

  function chatAvatarKey(who, cls) {
    if (cls === "sys" || who === "sys") return null;
    if (cls === "player" || who === "玩家") return "avatar_player";
    if (cls === "ling" || who === "梁绫") return "avatar_ling";
    return "avatar_sui";
  }

  function chatAvatarHtml(who, cls) {
    const key = chatAvatarKey(who, cls);
    if (!key) return "";
    const src = HJ.ASSETS && HJ.ASSETS[key];
    if (src) return `<img class="msg-avatar" src="${src}" alt="" draggable="false">`;
    return `<div class="msg-avatar placeholder" aria-hidden="true"></div>`;
  }

  function appendChatDom(who, text, cls) {
    const body = $("#chat-body");
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    if (who !== "sys" && cls !== "sys") {
      div.classList.add("has-avatar");
      div.innerHTML = `${chatAvatarHtml(who, cls)}<div class="msg-body"><span class="who">${escapeHtml(who)}</span><div class="msg-text">${escapeHtml(text)}</div></div>`;
    } else {
      div.textContent = text;
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function appendChatImgDom(who, imgKey, caption, cls) {
    const body = $("#chat-body");
    const div = document.createElement("div");
    div.className = `msg img-msg ${cls} has-avatar`;
    const src = (HJ.ASSETS && HJ.ASSETS[imgKey]) || "";
    const hint = caption == null ? "点击查看大图" : caption;
    div.innerHTML = `
      ${chatAvatarHtml(who, cls)}
      <div class="msg-body">
        <span class="who">${escapeHtml(who)}</span>
        <button type="button" class="chat-img-btn" data-chat-img="${escapeHtml(imgKey)}" data-chat-caption="${escapeHtml(caption || "")}">
          <div class="chat-img-frame">${src
            ? `<img src="${src}" alt="" draggable="false">`
            : `<div class="img-ph thumb"><span class="ph-label">［图片］</span></div>`}
          </div>
          ${hint ? `<span class="chat-img-hint">${escapeHtml(hint)}</span>` : ""}
        </button>
      </div>`;
    const btn = div.querySelector(".chat-img-btn");
    const img = div.querySelector(".chat-img-frame img");
    const markOrient = (el) => {
      if (!btn || !el || !el.naturalWidth) return;
      btn.classList.toggle("is-landscape", el.naturalWidth >= el.naturalHeight);
      btn.classList.toggle("is-portrait", el.naturalWidth < el.naturalHeight);
    };
    if (img) {
      if (img.complete && img.naturalWidth) markOrient(img);
      else img.addEventListener("load", () => markOrient(img), { once: true });
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function openCroppedCluePhoto() {
    let showingBack = false;
    // 背面先预载，翻面时不再等解码闪黑底
    const backSrc = HJ.ASSETS && HJ.ASSETS.ritual_cropped_back;
    if (backSrc) {
      const pre = new Image();
      pre.src = backSrc;
    }
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>梁穗发来的照片</h3>
      <button type="button" class="photo-flip" id="crop-flip" title="点击翻转">
        <div id="crop-flip-stage" class="photo-flip-stage">
          <div class="photo-flip-face is-front">${HJ.ph("ritual_cropped", "portrait fit-contain")}</div>
          <div class="photo-flip-face is-back" aria-hidden="true">${HJ.ph("ritual_cropped_back", "portrait fit-contain")}</div>
        </div>
      </button>
      <p class="caption" id="crop-cap-1">红绳延伸到画面右侧，像是被人裁掉了一截。</p>
      <p class="caption" id="crop-cap-2">点击照片查看背面</p>
    `, {
      onClose: () => {
        flag("saw_cropped_clue", true);
        const r = openCroppedCluePhoto._waitResolve;
        openCroppedCluePhoto._waitResolve = null;
        r?.();
      }
    });
    $("#crop-flip")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showingBack = !showingBack;
      const stage = $("#crop-flip-stage");
      const c1 = $("#crop-cap-1");
      const c2 = $("#crop-cap-2");
      if (!stage || !c1 || !c2) return;
      stage.classList.toggle("is-back", showingBack);
      const backFace = stage.querySelector(".is-back");
      if (backFace) backFace.setAttribute("aria-hidden", showingBack ? "false" : "true");
      if (showingBack) {
        c1.textContent = "背面字迹：今年轮到你解结。";
        c2.textContent = "再点照片看正面";
      } else {
        c1.textContent = "红绳延伸到画面右侧，像是被人裁掉了一截。";
        c2.textContent = "点击照片查看背面";
      }
    });
  }

  /** 等玩家打开并关闭「梁穗发来的裁切照片」后再继续 */
  function waitCroppedClueViewed() {
    if (flag("saw_cropped_clue")) return Promise.resolve();
    return new Promise(resolve => {
      openCroppedCluePhoto._waitResolve = resolve;
    });
  }

  function openDyehouseSidePhoto(caption) {
    showPhoto("dyehouse_side", caption || "梁穗发来的现场照片", "wide", {
      onClose: () => {
        flag("saw_dyehouse_side", true);
        const r = waitDyehouseSideViewed._resolve;
        waitDyehouseSideViewed._resolve = null;
        r?.();
      }
    });
  }

  /** 等玩家点开并关闭第三章侧门现场照后再继续 */
  function waitDyehouseSideViewed() {
    if (flag("saw_dyehouse_side")) return Promise.resolve();
    return new Promise(resolve => {
      waitDyehouseSideViewed._resolve = resolve;
    });
  }

  function restoreChat() {
    const body = $("#chat-body");
    body.innerHTML = "";
    state.chatLog.forEach(m => {
      if (m.type === "img") {
        // 侧门照不显示图下说明文字
        const cap = m.imgKey === "dyehouse_side" ? "" : (m.caption || "");
        if (m.imgKey === "dyehouse_side" && m.caption) m.caption = "";
        appendChatImgDom(m.who, m.imgKey, cap, m.cls || "sui");
      } else appendChatDom(m.who, m.text, m.cls || "sui");
    });
    body.scrollTop = body.scrollHeight;
    setChatTitle(state.chatTitle || "与梁穗聊天中");
    if (state.groupChat) setGroup(true, state.members);
    restoreGroupChatUI();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function chatChoices(opts, hook) {
    const box = $("#chat-choices");
    box.innerHTML = "";
    if (hook) {
      state.pendingChoice = {
        hook,
        options: opts.map(o => ({ text: o.text, asSys: !!o.asSys })),
      };
      save();
    }
    opts.forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.text;
      b.onclick = () => {
        state.pendingChoice = null;
        save();
        box.innerHTML = "";
        if (o.asSys) chatMsg("sys", o.text, "sys");
        else chatMsg("玩家", o.text, "player");
        o.onSelect?.();
      };
      box.appendChild(b);
    });
  }

  function clearChoices() {
    $("#chat-choices").innerHTML = "";
    if (state.pendingChoice) {
      state.pendingChoice = null;
      save();
    }
  }

  /** 刷新后把未点完的选项重新画出来，并接到续跑钩子 */
  function restorePendingChoices() {
    const p = state.pendingChoice;
    if (!p?.hook || !Array.isArray(p.options) || !p.options.length) return false;
    openWin("chat");
    const box = $("#chat-choices");
    box.innerHTML = "";
    p.options.forEach(opt => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = opt.text;
      b.onclick = async () => {
        box.innerHTML = "";
        const hook = p.hook;
        state.pendingChoice = null;
        save();
        if (opt.asSys) chatMsg("sys", opt.text, "sys");
        else chatMsg("玩家", opt.text, "player");
        if (hook && hook.startsWith("gate:")) {
          const key = hook.slice(5);
          flag("gate_" + key, true);
          resumeInterruptedFlows();
          return;
        }
        const fn = CHOICE_RESUME[hook];
        if (fn) {
          try { await fn(opt.text); }
          catch (err) {
            console.error(err);
            toast("剧情续跑出错了。可从调查资料继续，或重新开始。");
          }
        } else {
          resumeInterruptedFlows();
        }
      };
      box.appendChild(b);
    });
    toast("检测到未完成的发言选项，请点击继续。");
    return true;
  }

  function setChatTitle(t) {
    state.chatTitle = t;
    $("#chat-title").textContent = t;
    save();
  }

  function setGroup(on, members) {
    state.groupChat = on;
    const win = $("#win-chat");
    const mem = $("#chat-members");
    const eye = $("#chat-eye");
    if (on) {
      win.classList.add("group-mode");
      state.members = (members && members.length)
        ? members.slice()
        : ["玩家", "梁穗", "梁绫"];
      // 第二章点人阶段：强制名单含可点的「梁绫」
      if (flag("ch2_group") && !flag("ling_photos_done") && !state.members.includes("梁绫")) {
        state.members = ["玩家", "梁穗", "梁绫"];
      }
      setChatTitle("活结（3）");
      mem.classList.remove("hidden");
      mem.innerHTML = "群成员：" + state.members.map(m => {
        if (m === "梁绫") return `<button type="button" data-member="梁绫">梁绫</button>`;
        return m;
      }).join(" · ");
      mem.querySelector("[data-member]")?.addEventListener("click", showLingCard);
    } else {
      win.classList.remove("group-mode");
      state.members = ["玩家", "梁穗"];
      setChatTitle("与梁穗聊天中");
      mem.classList.add("hidden");
      eye.classList.add("hidden");
    }
    save();
  }

  /** 刷新后还原群聊成员条（含可点的梁绫）与红眼追随 */
  function restoreGroupChatUI() {
    const midCh2Ling = flag("ch2_group") && !flag("ling_photos_done") && !flag("ch2_done");
    if (state.groupChat || midCh2Ling) {
      setGroup(true, state.members?.includes("梁绫") ? state.members : ["玩家", "梁穗", "梁绫"]);
      if (midCh2Ling) {
        showEye(true);
        if (ch2Horror._move) window.removeEventListener("mousemove", ch2Horror._move);
        const eye = $("#chat-eye");
        const move = (e) => {
          const r = $("#win-chat").getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 100;
          const y = ((e.clientY - r.top) / r.height) * 100;
          eye.style.setProperty("--ex", x + "%");
          eye.style.setProperty("--ey", y + "%");
        };
        window.addEventListener("mousemove", move);
        ch2Horror._move = move;
      }
    }
  }

  function showEye(on) {
    const eye = $("#chat-eye");
    eye.classList.toggle("hidden", !on);
    if (on) {
      // 群聊跟随鼠标：眼睛透明修改1（rope_eye）
      const src = (HJ.ASSETS && HJ.ASSETS.rope_eye) || "";
      eye.innerHTML = src
        ? `<img class="chat-eye-img" src="${src}" alt="" draggable="false">`
        : spindleEyeSVG("chat-eye-svg");
    } else {
      eye.innerHTML = "";
    }
  }

  function spindleEyeSVG(cls = "") {
    return `<svg class="${cls}" viewBox="0 0 120 48" aria-hidden="true">
      <path d="M8,24 C28,4 92,4 112,24 C92,44 28,44 8,24 Z" fill="none" stroke="#c42b2b" stroke-width="2.2"/>
      <path d="M14,24 C32,10 88,10 106,24 C88,38 32,38 14,24 Z" fill="none" stroke="#8b1a1a" stroke-width="1" opacity=".7"/>
      <circle cx="60" cy="24" r="7" fill="#5a0808" stroke="#1a0505" stroke-width="2"/>
      <path d="M54,24 C56,20 58,22 60,24 C62,26 64,22 66,24 C64,28 62,26 60,24 C58,22 56,28 54,24 Z" fill="#c42b2b" opacity=".9"/>
      <path d="M66,28 Q72,36 78,40" fill="none" stroke="#c42b2b" stroke-width="1.2" opacity=".75"/>
    </svg>`;
  }

  function ensureBlackout() {
    let el = $("#blackout");
    if (!el) {
      el = document.createElement("div");
      el.id = "blackout";
      el.className = "blackout";
      document.body.appendChild(el);
    }
    return el;
  }

  function ensureScareEye() {
    let el = $("#scare-eye");
    if (!el) {
      el = document.createElement("div");
      el.id = "scare-eye";
      el.className = "scare-eye";
      document.body.appendChild(el);
    }
    const src = HJ.ASSETS && HJ.ASSETS.rope_eye;
    el.innerHTML = src
      ? `<img src="${src}" alt="">`
      : spindleEyeSVG("scare-eye-svg");
    return el;
  }

  function ropeEyeHTML() {
    const src = HJ.ASSETS && HJ.ASSETS.rope_eye;
    if (src) {
      return `<div class="red-eye-symbol has-img" title="红线眼睛"><img src="${src}" alt="红线眼睛" draggable="false"></div>`;
    }
    return `<div class="red-eye-symbol" title="红线眼睛">${spindleEyeSVG()}<span class="eye-tail"></span></div>`;
  }

  async function showScareEye(ms = 1400) {
    const el = ensureScareEye();
    el.classList.add("on");
    await wait(ms);
    el.classList.remove("on");
  }

  function ropeWebHTML() {
    return `<div class="rope-web" aria-hidden="true">
      <svg viewBox="0 0 400 240" preserveAspectRatio="none">
        <g class="rope-layer-1">
          <path d="M-10,40 C60,20 120,80 200,50 S340,10 410,60"/>
          <path d="M-10,120 C80,90 140,160 220,110 S320,70 410,130"/>
          <path d="M20,-5 C40,80 90,140 70,250"/>
          <path d="M180,-5 C160,70 210,150 190,250"/>
          <path d="M320,-5 C300,90 350,130 340,250"/>
          <path d="M-10,200 C100,180 180,220 280,190 S380,210 410,180"/>
        </g>
        <g class="rope-layer-2">
          <path d="M-10,70 C90,110 150,30 250,90 S350,50 410,100"/>
          <path d="M-10,160 C70,140 160,200 240,150 S330,180 410,160"/>
          <path d="M100,-5 C120,100 80,160 130,250"/>
          <path d="M260,-5 C240,80 280,140 250,250"/>
          <path d="M50,250 C120,200 200,230 300,190 S380,220 410,200"/>
          <path d="M-10,30 C50,100 200,20 300,80 S370,40 410,70"/>
        </g>
      </svg>
    </div>`;
  }

  function revealFolder() {
    $("#icon-folder").classList.remove("hidden");
  }

  function revealArchiveIcon() {
    flag("archive_ready", true);
    $("#icon-archive")?.classList.remove("hidden");
    save();
  }

  function revealFileBoxIcon() {
    $("#icon-filebox")?.classList.remove("hidden");
  }

  /** 染坊文件箱独立窗口（不进民俗馆） */
  function openFileBox() {
    revealFileBoxIcon();
    playInvestigateBgm();
    openWin("filebox");
  }

  function renderFileBox() {
    const body = $("#filebox-body");
    if (!body) return;
    const nextNight = !flag("read_night");
    const nextEquip = !flag("read_equip");
    const nextTimeline = flag("read_night") && flag("read_equip") && !flag("timeline_done");
    body.innerHTML = `
      <div class="filebox-site">
        <h2>文件箱内容</h2>
        <div class="filebox-card">
          <h4>牵命人名册</h4>
          ${HJ.ph("roster", "wide")}
          <p>多名牵命人旁注：辍学、未婚、长期留乡、负责终身照护。</p>
          <p>梁绫 / 梁穗：固命礼状态——等待完成</p>
          <div class="old-note">他们记录谁留下，却从不记录谁想离开。——梁绫</div>
        </div>
        <div class="filebox-card">
          <h4>接绳方案</h4>
          ${HJ.ph("care_plan", "doc-full")}
          <div class="kv">养老互助中心 · 卫生服务中心 · 专业看护岗位 · 申请县「回乡人才基金」</div>
          <div class="old-note">一个人不该负责另一个人的一生。把照护做成公共事，绳才能一节一节接下去。</div>
        </div>
        <div class="filebox-card">
          <h4>材料递交信封（未寄出）</h4>
          ${HJ.ph("envelope", "wide")}
          <p>收件人：县民政办公室　日期：2009年7月16日</p>
        </div>
        <div class="filebox-next">
          <h3>下一步</h3>
          <p>请对照工业区登记档案，查阅值守登记与设备事故记录。</p>
          <p style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn-inline" data-open-arch="night">${nextNight ? "查阅夜间值守登记" : "再看夜间值守登记"}</button>
            <button type="button" class="btn-inline" data-open-arch="equip">${nextEquip ? "查阅设备检查记录" : "再看设备检查记录"}</button>
            ${nextTimeline ? `<button type="button" class="btn-inline gold" id="btn-timeline-from-mat">还原最后二十五分钟</button>` : ""}
          </p>
        </div>
        <button type="button" class="btn-inline ghost" data-open-arch="home">打开工业区登记档案</button>
      </div>`;
    bindFileBox();
  }

  function bindFileBox() {
    const body = $("#filebox-body");
    if (!body) return;
    body.querySelectorAll("[data-open-arch]").forEach(b => {
      b.onclick = () => {
        const sec = b.dataset.openArch || "home";
        openWin("archive");
        goArchive(sec);
        playInvestigateBgm();
      };
    });
    $("#btn-timeline-from-mat")?.addEventListener("click", openTimelinePuzzle);
  }

  function showLingCard() {
    if (!flag("ch2_group")) return;
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>成员资料 · 梁绫</h3>
      <div class="profile-grid">
        ${HJ.ph("member_card_ling", "square")}
        <div class="kv">
          <div><b>昵称：</b>梁绫</div>
          <div><b>加入时间：</b>2009年7月15日 21:47</div>
          <div><b>最后位置：</b>绛水镇旧染坊</div>
          <div><b>状态：</b>未离开</div>
          <p style="margin-top:12px">附件（共两张）：</p>
          <p><button type="button" class="linkish hl" id="open-2147">① 2009年过绳节_21时47分.jpg</button></p>
          <p><button type="button" class="linkish hl" id="open-side-2009">② 染坊侧门_2009年7月15日.jpg</button></p>
        </div>
      </div>
    `);
    $("#open-2147")?.addEventListener("click", () => {
      closeModal();
      openModal(`
        <button type="button" class="modal-close" data-x>×</button>
        ${HJ.ph("photo_2147", "wide")}
        <p class="caption">拍摄时间：2009年7月15日 21:47 — 末班车离开十七分钟后。边缘可见坐轮椅的女人背对镜头，朝旧染坊移动。</p>
      `, {
        onClose: () => {
          if (!flag("saw_2147")) {
            flag("saw_2147", true);
            save();
            toast("还有一张附件。");
          }
          // 未看完第二张则回到资料卡
          if (!flag("saw_side_2009")) setTimeout(() => showLingCard(), 200);
          else tryAfterLingPhotos();
        }
      });
    });
    $("#open-side-2009")?.addEventListener("click", () => {
      closeModal();
      openModal(`
        <button type="button" class="modal-close" data-x>×</button>
        ${HJ.ph("dyehouse_side_2009", "wide")}
        <p class="caption">拍摄时间：2009年7月15日夜</p>
      `, {
        onClose: () => {
          if (!flag("saw_side_2009")) {
            flag("saw_side_2009", true);
            save();
            revealFolder();
          }
          if (!flag("saw_2147")) {
            toast("请先查看附件①。");
            setTimeout(() => showLingCard(), 200);
            return;
          }
          tryAfterLingPhotos();
        }
      });
    });
  }

  /** 两张姐姐当晚照片都看过 → 触发离群与去染坊 */
  function tryAfterLingPhotos() {
    if (!flag("saw_2147") || !flag("saw_side_2009")) return;
    if (flag("ling_photos_done")) return;
    flag("ling_photos_done", true);
    save();
    setTimeout(() => lingLeavesCh2(), 400);
  }

  async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function sequence(steps, pace = 900) {
    for (const s of steps) {
      if (typeof s === "number") await wait(s);
      else if (typeof s === "function") await s();
      else if (s.type === "msg") {
        chatMsg(s.who, s.text, s.cls);
        await wait(s.delay != null ? s.delay : pace);
      } else if (s.type === "typing") {
        const t = document.createElement("div");
        t.className = "msg sys"; t.textContent = s.text || "梁穗正在输入…";
        $("#chat-body").appendChild(t);
        await wait(s.ms || 1800);
        t.remove();
      }
    }
  }

  /** 等待玩家点选项；gateKey 用于刷新后续跑（已点过则跳过）
   *  opts.asSys：点后以系统提示进聊天，不进玩家气泡
   */
  function waitChoice(text = "继续", gateKey, opts = {}) {
    if (gateKey && flag("gate_" + gateKey)) return Promise.resolve();
    return new Promise(resolve => {
      chatChoices([{
        text,
        asSys: !!opts.asSys,
        onSelect: () => {
          if (gateKey) flag("gate_" + gateKey, true);
          resolve();
        }
      }], gateKey ? ("gate:" + gateKey) : ("wait:" + text));
    });
  }

  /** 刷新后：按存档旗标重进未完成的长对话 */
  function resumeInterruptedFlows() {
    // 已有专用 pending 按钮时，先让玩家点
    if (state.pendingChoice?.options?.length) return;

    // 序章开场未发完博物馆链接
    if (flag("intro_chat") && !flag("museum_link") && !flag("searched_rope") &&
        (state.chapter === "prologue" || !["ch1","ch2","ch3","ch4","ending","epilogue"].includes(state.chapter))) {
      startIntroChat();
      return;
    }
    // 名单追问未完成
    if (flag("ask_namelist_chat") && !flag("ask_namelist")) {
      afterPhotoNamelistChat();
      return;
    }
    // 牵绳娘怕选项后未完成
    if (flag("prologue_glitch") && !flag("sui_ask_photo") && !flag("ask_namelist_chat")) {
      chatChoices([{
        text: "可你说过，姐姐不像会投河的人。",
        onSelect: async () => {
          await sequence([
            { type: "msg", who: "梁穗", text: "对。她对我很好。是她让我离开这个镇子，去过自己本来应该过的生活。" },
            { type: "msg", who: "梁穗", text: "她很坚强。而且她当时告诉过我，她还有一件很重要的事情要做。" },
            600,
            { type: "msg", who: "梁穗", text: "我会弄清楚当年究竟发生了什么。", delay: 2200 },
          ]);
          flag("sui_ask_photo", true);
          await afterPhotoNamelistChat();
        }
      }], "qiansheng:doubt");
      return;
    }
    // 剪刀确认后的安慰选项
    if (flag("scissors_guilt") && !flag("ch2_done") && !flag("ch2_group")) {
      chatChoices([
        { text: "是你姐姐让你走的。", onSelect: () => ch2Horror() },
        { text: "她不希望你留下。", onSelect: () => ch2Horror() },
      ], "scissors:comfort");
      return;
    }
    // 已看过剪刀且答对结论，但内疚对话未开始
    if (flag("msg_scissors") && flag("ch2_confirmed") && !flag("scissors_guilt") && !flag("ch2_done") && !flag("ch2_group")) {
      afterConfirmedLeave();
      return;
    }
    // 第三章到达后：侧门对话 / 「收到」未完成
    if (flag("ch3_arrived") && !flag("gate_ch3_recv") && !flag("ch3_done")) {
      ch3Arrive();
      return;
    }
    // 河边图后第三章收束
    if (flag("riverside_ling_done") && !flag("ch3_done")) {
      afterRiversideFromLing();
      return;
    }
    // 第三章：已发给梁穗但文件箱流程未走完（关图/刷新会卡在这里）
    if (flag("told_plan") && !flag("saw_materials") && !flag("ch3_done")) {
      chatChoices([{
        text: "继续查看铁门附近的现场",
        onSelect: () => onTellPlan()
      }], "plan:continue");
      return;
    }
    // 文件箱已看，尚未读完值守/设备或未还原时间线
    if (flag("saw_materials") && !flag("timeline_done") && !flag("ch3_done")) {
      offerMaterialsNextStep();
      return;
    }
    // 时间线已完、等修复曝光（跳过河边旧闻问答）
    if (flag("ch3_truth") && !flag("exposure_done") && !flag("ch3_done")) {
      chatChoices([{
        text: "打开三号染池照片并修复曝光",
        onSelect: () => openExposure()
      }], "expose:open");
      return;
    }
    // 第三章已完、第四章未起
    if (flag("ch3_done") && !flag("ch4_started") && !flag("ch4_ritual_link") && !flag("ending_started")) {
      chatChoices([{
        text: "继续第四章 · 听梁穗说话",
        onSelect: () => ch4Start()
      }], "ch4:continue");
      return;
    }
    // 第四章中途
    if (flag("ch4_started") && !flag("ch4_ritual_link") && !flag("ending_started")) {
      ch4Start();
      return;
    }
    if (flag("gate_ending_photo_back") && !flag("ending_started") && !flag("epilogue_complete")) {
      (async () => {
        flag("epilogue_started", true);
        save();
        await showAct1FinaleModal();
        flag("ending_started", true);
        setChapter("ending");
        markGameCleared();
        await runEpilogueSequence();
      })();
      return;
    }
    if (flag("epilogue_await_news") && !flag("epilogue_news_done")) {
      openWin("browser");
      go("search_hekui");
      toast("点击新闻继续尾声。");
      return;
    }
    if (flag("epilogue_started") && flag("epilogue_news_done") && !flag("epilogue_complete")) {
      setTimeout(() => runEpilogueSequence(), 600);
      return;
    }
  }

  const CHOICE_RESUME = {
    "qiansheng:doubt": async () => {
      await sequence([
        { type: "msg", who: "梁穗", text: "对。她对我很好。是她让我离开这个镇子，去过自己本来应该过的生活。" },
        { type: "msg", who: "梁穗", text: "她很坚强。而且她当时告诉过我，她还有一件很重要的事情要做。" },
        600,
        { type: "msg", who: "梁穗", text: "我会弄清楚当年究竟发生了什么。", delay: 2200 },
      ]);
      flag("sui_ask_photo", true);
      await afterPhotoNamelistChat();
    },
    "namelist:go": async () => {
      flag("ask_namelist", true);
    },
    "scissors:comfort": async () => { await ch2Horror(); },
    "ch3:open_folder": async () => { openWin("folder"); },
    "riverside:news": async () => {
      // 旧存档仍挂着「打开河边旧闻」时，改为进曝光修复
      flag("fake_riverside", true);
      openExposure();
    },
    "ch4:ritual": async () => {
      flag("ch4_ritual_link", true);
      openWin("browser");
      go("ritual_system");
    },
    "expose:open": async () => { openExposure(); },
    "ch4:continue": async () => { ch4Start(); },
    "plan:continue": async () => { onTellPlan(); },
    "materials:next": async (text) => {
      if (String(text || "").includes("设备")) go("equip_log");
      else go("night_log");
    },
    "materials:timeline": async () => { openTimelinePuzzle(); },
  };

  /* ---------- Modal ---------- */
  let modalOnClose = null;
  /** 从姐姐房间热区进入子界面时，关闭弹窗应回到房间全景而非调查资料 */
  let roomSubReturn = false;

  function roomModalOpts() {
    return roomSubReturn ? { onClose: () => openRoom() } : {};
  }

  function openModal(html, opts = {}) {
    const m = $("#modal");
    const p = $("#modal-panel");
    modalOnClose = typeof opts.onClose === "function" ? opts.onClose : null;
    syncChapterTheme();
    p.classList.remove("finale-photo-panel", "photo-view-panel", "photo-view-notitle", "combo-lock-panel", "timeline-puzzle-panel", "choice-quiz-panel");
    if (opts.panelClass) p.classList.add(opts.panelClass);
    if (typeof html === "string" && /photo-stage|img-ph|room-view|profile-grid|photo-flip/.test(html)) {
      p.classList.add("photo-view-panel");
      if (!/<h3[\s>]/.test(html)) p.classList.add("photo-view-notitle");
    }
    p.innerHTML = html;
    m.classList.remove("hidden");
    p.querySelector("[data-x]")?.addEventListener("click", closeModal);
  }
  function closeModal() {
    staggerBoardReveal._gen = (staggerBoardReveal._gen || 0) + 1;
    const endingOpen = !!$("#reset-game");
    const cb = modalOnClose;
    modalOnClose = null;
    $("#modal").classList.add("hidden");
    $("#modal-panel").innerHTML = "";
    $("#modal-panel")?.classList.remove("finale-photo-panel", "photo-view-panel", "photo-view-notitle", "combo-lock-panel", "timeline-puzzle-panel", "choice-quiz-panel");
    if (endingOpen) {
      revealRestart();
      revealFolder();
      toast("可随时点桌面或任务栏的「重新开始」；调查资料里保留了关键证据。");
    }
    cb?.();
  }

  /**
   * 分镜／回忆框：图片与文字按文档顺序交替慢浮现（图→文→图→文…）
   * 底部操作按钮等全部播完再显现。
   */
  function staggerBoardReveal(root = $("#modal-panel"), opts = {}) {
    if (!root) return Promise.resolve();
    const fadeMs = opts.fadeMs ?? 1700;
    const gapMs = opts.gapMs ?? 900;
    root.classList.add("board-stagger");

    const ctas = [...root.querySelectorAll(".mem-nav, .btn-inline, .origin-recall-btn")].filter(
      (el) => !el.classList.contains("modal-close")
    );
    ctas.forEach((el) => el.classList.add("board-stagger-wait"));

    const pieces = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (el.classList.contains("modal-close") || el.closest(".mem-nav")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (el.matches("button") || el.closest("button")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (el.matches("h3")) return NodeFilter.FILTER_SKIP;
        // 回忆杀进度「1 / n」不参与分镜浮现
        if (el.matches(".memory-board > .caption")) return NodeFilter.FILTER_REJECT;

        if (el.classList.contains("pupil-frame")) return NodeFilter.FILTER_ACCEPT;
        if (el.classList.contains("img-ph")) {
          if (el.closest(".pupil-frame")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        if (
          el.classList.contains("mem-line") ||
          el.classList.contains("mem-whisper") ||
          el.classList.contains("old-note") ||
          el.classList.contains("caption")
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (el.tagName === "P") return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    let node = walker.nextNode();
    while (node) {
      pieces.push(node);
      node = walker.nextNode();
    }

    if (!pieces.length) {
      ctas.forEach((el) => el.classList.remove("board-stagger-wait"));
      return Promise.resolve();
    }

    pieces.forEach((el) => {
      el.classList.add("sb-piece");
      el.classList.remove("is-in");
    });

    return (async () => {
      const token = (staggerBoardReveal._gen = (staggerBoardReveal._gen || 0) + 1);
      for (const el of pieces) {
        if (staggerBoardReveal._gen !== token || !el.isConnected) return;
        el.classList.add("is-in");
        await wait(Math.max(gapMs, Math.floor(fadeMs * 0.55)));
      }
      if (staggerBoardReveal._gen !== token) return;
      await wait(Math.floor(fadeMs * 0.45));
      if (staggerBoardReveal._gen !== token) return;
      ctas.forEach((el) => {
        if (el.isConnected) el.classList.remove("board-stagger-wait");
      });
    })();
  }

  /* ---------- Navigation ---------- */
  const ARCHIVE_PAGE_MAP = {
    dyehouse_archive: "home",
    plan_compare: "plans",
    night_log: "night",
    equip_log: "equip",
  };

  function go(page, push = true) {
    // 文件箱：独立窗口，不进民俗馆
    if (page === "materials") {
      if (push && state.page !== page) state.history.push(state.page);
      state.page = page;
      syncBgmForPage(page);
      save();
      openFileBox();
      return;
    }
    // 工业区档案栏目：一律在档案窗口打开，不进民俗馆
    if (ARCHIVE_PAGE_MAP[page]) {
      if (push && state.page !== page) state.history.push(state.page);
      state.page = page;
      state.archSection = ARCHIVE_PAGE_MAP[page];
      syncBgmForPage(page);
      save();
      openWin("archive");
      return;
    }
    if (push && state.page !== page) state.history.push(state.page);
    state.page = page;
    renderPage(page);
    syncBgmForPage(page);
    save();
  }

  function back() {
    const prev = state.history.pop();
    if (prev) {
      state.page = prev;
      renderPage(prev);
      syncBgmForPage(prev);
      save();
    } else go("home", false);
  }

  function syncBgmForPage(page) {
    if (currentBgm === "collapsing") return;
    if ($("#boot-screen") && !$("#boot-screen").classList.contains("hidden")) return;
    if ($("#intro-screen") && !$("#intro-screen").classList.contains("hidden") && $("#desktop")?.classList.contains("hidden")) return;
    if ($("#desktop")?.classList.contains("hidden")) return;
    if (page === "qianshengniang") playBgm("horror", { fade: 800 });
    else if (page === "ending_home") playBgm("ending", { fade: 900 });
    else if (["plan_compare", "materials", "dyehouse_archive", "night_log", "equip_log"].includes(page)) {
      playInvestigateBgm();
    } else if (!flag("_horror_active") || flag("_hope_active") || flag("_forest_active") || flag("ending_started")) {
      playDesktopBgm();
    }
  }

  function setAddr(path) {
    $("#addr-bar").textContent = "https://jiangshui-folk.local" + path;
  }

  /* ---------- Pages ---------- */
  function renderPage(page) {
    const body = $("#browser-body");
    const win = $("#win-browser");
    const map = {
      home: pageHome,
      intro: pageIntro,
      list: pageList,
      news: pageNews,
      contact: pageContact,
      search_rope: pageSearchRope,
      news_2016: pageNews2016,
      news_2015: pageNews2015,
      news_2014: pageNews2014,
      news_2012: pageNews2012,
      news_2009: pageNews2009,
      photo_gallery: pagePhotoGallery,
      related_news: pageRelatedNews,
      search_ling: pageSearchLing,
      news_ling_craft: pageNewsLingCraft,
      search_sui: pageSearchSui,
      news_sui_math: pageNewsSuiMath,
      qianshengniang: pageQianshengniang,
      akui: pageAkui,
      honor: pageHonor,
      school: pageSchool,
      application: pageApplication,
      app_back: pageAppBack,
      dyehouse_archive: pageDyeArchive,
      plan_compare: pagePlanCompare,
      night_log: pageNightLog,
      equip_log: pageEquipLog,
      materials: pageMaterials,
      riverside_q: pageRiversideQ,
      notice: pageNotice,
      ritual_system: pageRitualSystem,
      ending_home: pageEndingHome,
      search_hekui: pageSearchHekui,
      news_2009_fixed: pageNews2009Fixed,
    };
    const fn = map[page] || pageHome;
    body.innerHTML = fn();
    bindPage(page, body);

    // 牵绳娘红眼：整桌正中顶层；离开该页即移除
    setQianshengDesktopEye(page === "qianshengniang");

    if (page === "qianshengniang") {
      win?.classList.add("unknown-site");
      const title = win?.querySelector(".win-title");
      if (title) title.textContent = "未知页面";
      setAddr("/???");
      $("#addr-bar").textContent = "about:blank · 来源未知";
    } else {
      win?.classList.remove("unknown-site");
      const title = win?.querySelector(".win-title");
      if (title) title.textContent = "绛水镇过绳节民俗馆";
    }
  }

  function siteShell(active, content, opts = {}) {
    if (opts.ghost) return content;
    return `<div class="site">
      <header class="site-header">
        <h1 class="site-logo">绛水镇过绳节民俗馆</h1>
        <p class="site-tag">一根绳，两条命 · 不离不弃</p>
        <nav class="site-nav">
          <button type="button" data-nav="intro" class="${active==="intro"?"active":""}">节日介绍</button>
          ${!(flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue")
            ? `<button type="button" data-nav="list" class="${active==="list"?"active":""}">参加名单</button>`
            : ""}
          <button type="button" data-nav="news" class="${active==="news"?"active":""}">民俗资讯</button>
          <button type="button" data-nav="contact" class="${active==="contact"?"active":""}">联系我们</button>
          ${flag("ch3_done") || state.chapter === "ch4" || state.chapter === "ending" || state.chapter === "epilogue" ? `<button type="button" data-nav="notice" class="${active==="notice"?"active":""}">活动公告</button>` : ""}
          ${state.chapter === "ending" || state.chapter === "epilogue" ? `<button type="button" data-nav="ending_home" class="${active==="ending_home"?"active":""}">接绳互助登记</button>` : ""}
        </nav>
      </header>
      <div class="site-content">${content}</div>
    </div>`;
  }

  function pageHome() {
    // 主页即节日介绍：直接展示文案与黑白起源图
    return pageIntro();
  }

  function pageIntro() {
    setAddr("/festival/intro");
    return siteShell("intro", `
      <h2>节日介绍 · 过绳节</h2>
      <p>过绳节是绛水镇最重要的民俗活动。相传家人以红绳相连，象征永不离弃。节日期间举行祭绳、伴命礼与固命礼，由「牵命人」照护「被牵人」，以绳为证，以结为誓。</p>
      <h3>牵命人与被牵人</h3>
      <p>若家中有人病弱，便从同辈中选出「命硬」者与其系上伴命结。被选中者称为牵命人，须留乡、照护、不离不弃——这被镇上视作最高的家庭美德。</p>
      <h3>最早的起源</h3>
      ${HJ.ph("origin_flood", "wide")}
      <p class="caption">绛水镇第一次过绳节复原图</p>
      <div class="old-note">
        洪水阻路，镇民以绳为引。<br>
        前方渡水，后方拉绳。<br>
        老弱由众人接送，药食由长绳传递。
      </div>
      <p>插图中并无人把红绳绑在彼此手腕上。洪水淹没街道时，镇民将长绳固定在古树与河岸石桩，沿绳渡水、递送药箱食物，岸上人共同拉紧绳索。</p>
      ${flag("ending_started") ? `<div class="notice-banner" style="margin-top:20px"><h3>关于停止举行固命礼的通知</h3><p>经调查，过往伴命仪式存在未经本人同意、档案记录不实等问题。即日起停止固命礼及牵命人指定制度。</p></div>` : ""}
    `);
  }

  function pageList() {
    setAddr("/namelist");
    if (flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue") {
      return siteShell("list", `
        <h2>参加名单</h2>
        <div class="notice-banner">
          <h3>该栏目已撤下</h3>
          <p>固命礼及牵命人指定制度已停止。本年度不再公示仪式名单。</p>
        </div>
      `);
    }
    // 梁穗提示之后，名单才「加载」出来；此前即使点开也看不到阿葵
    const showRoster = flag("ask_namelist") || flag("namelist_loaded") || flag("clicked_akui");

    let extra = "";
    if (showRoster) {
      extra = `<div class="card-block" style="margin-top:16px">
        <h4>2016年仪式名单（节选）</h4>
        <div class="kv">
          <div>梁穗——牵命人　状态：未完成　备注：<span style="color:#8b1a1a">逃绳者</span></div>
          <div><button type="button" class="linkish hl" data-go="akui">阿葵</button>——牵命人　伴命者：阿童　状态：待行固命礼</div>
        </div>
      </div>`;
    }
    return siteShell("list", `
      <h2>参加名单</h2>
      <p>${showRoster
        ? "本年度过绳节相关登记如下（节选）。"
        : "本年度过绳节参加家庭登记仍在整理中。部分历史名单可在资讯检索中查阅。"}</p>
      ${!showRoster ? `<p class="caption">数据同步中……若页面内容不全，请稍后再试。</p>` : ""}
      ${extra}
    `);
  }

  function pageNews() {
    setAddr("/news");
    const epilogue = flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue";
    return siteShell("news", `
      <h2>民俗资讯</h2>
      <p>本栏目由绛水镇文化站整理发布，收录过绳节相关筹备通告、人物事迹与历年活动档案。</p>
      ${epilogue ? "" : `
      <p>七月十五临近，本年度祭绳、伴命礼与固命礼仍将在梁氏宗祠举行。文化站称：以绳为证，以结为誓，把「不离不弃」写成一镇人共同遵守的规矩。</p>
      <div class="old-note">
        近期稿件方向：筹备工作通报、守绳之家表彰、往届活动回顾。<br>
        编辑部提示：部分较早年份的影像与名录仍在数字化中，页面加载或有延迟。
      </div>`}
      <p class="caption">本站资讯为地方档案转载，内容以文化站审核稿为准。</p>
    `);
  }

  function pageContact() {
    setAddr("/contact");
    return siteShell("contact", `
      <h2>联系我们</h2>
      <p>绛水镇文化站 · 过绳节民俗馆编辑部</p>
      <p>地址：梁氏宗祠东侧厢房</p>
      <p class="caption">本站为游戏内模拟网站，无真实联络功能。</p>
    `);
  }

  function pageSearchRope() {
    setAddr("/search?q=过绳节");
    return siteShell("news", `
      <h2>搜索结果：过绳节</h2>
      <div class="search-result" data-go="news_2016">
        ${HJ.ph("liang_shouyi_2016", "thumb")}
        <div>
          <div class="meta">2016年</div>
          <h4>2016年绛水镇过绳节筹备工作正式开始</h4>
          <p class="abs">本年度过绳节将于七月十五日在梁氏宗祠举行，由镇民俗文化负责人梁守义主持。</p>
        </div>
      </div>
      <div class="search-result" data-go="news_2015">
        ${HJ.ph("chen_sisters_2015", "thumb")}
        <div>
          <div class="meta">2015年</div>
          <h4>姐妹相守不离弃，表彰「模范姐妹」</h4>
          <p class="abs">陈向阳为照顾妹妹放弃进城机会；妹妹陈小芽乖巧懂事、成绩优异。姐妹二人获评「模范姐妹」。</p>
        </div>
      </div>
      <div class="search-result" data-go="news_2014">
        ${HJ.ph("li_chunsheng_2014", "thumb")}
        <div>
          <div class="meta">2014年</div>
          <h4>默默坚守二十载：李春生父慈子孝传佳话</h4>
          <p class="abs">自1994年固命礼完成以来，牵命人李春生长期留乡照护父亲李老伯，至今已整整二十年。</p>
        </div>
      </div>
      <div class="search-result" data-go="news_2012">
        ${HJ.ph("shou_sheng_family", "thumb")}
        <div>
          <div class="meta">2012年</div>
          <h4>兄长留乡照护幼妹，获评「守绳之家」</h4>
          <p class="abs">镇民梁永安主动放弃婚配与外出工作的机会，留在家中照护患病妹妹及年迈亲人。</p>
        </div>
      </div>
      <div class="search-result" data-go="news_2009">
        ${HJ.ph("group_2009_thumb", "thumb")}
        <div>
          <div class="meta">2009年</div>
          <h4>2009年过绳节活动回顾</h4>
          <p class="abs">2009年过绳节于梁氏宗祠举行，多户家庭参加伴命仪式。当晚，一名参与仪式的梁姓女子失踪。</p>
        </div>
      </div>
    `);
  }

  function pageNews2016() {
    setAddr("/news/2016-prep");
    return siteShell("news", `
      <h2>2016年绛水镇过绳节筹备工作正式开始</h2>
      <p>2016年过绳节将于七月十五日在梁氏宗祠举行。本年度活动包括祭绳、伴命礼与固命礼。仪式将继续由绛水镇民俗文化负责人梁守义主持。</p>
      ${HJ.ph("liang_shouyi_2016", "wide")}
      <p class="caption">梁守义主持2016年过绳节筹备仪式。</p>
      <button type="button" class="btn-inline ghost" data-go="search_rope">返回搜索结果</button>
    `);
  }

  function pageNews2014() {
    setAddr("/news/2014-twenty-years");
    return siteShell("news", `
      <h2>默默坚守二十载：李春生父慈子孝传佳话</h2>
      <p>2014年过绳节前夕，文化站回访了一户普通家庭：牵命人<strong>李春生</strong>，被牵人<strong>李老伯</strong>。父子二人自<strong>1994年</strong>完成固命礼以来，李春生便长期留乡，负责照护父亲——至今已整整二十年。</p>
      <p>名册旁注写着「长子，已签」。李春生不爱多谈，只说日子是一天天过的，「绳既结了，就该守着。」邻里提起他，常用的词仍是「本分」「孝顺」。</p>
      ${HJ.ph("li_chunsheng_2014", "wide")}
      <p class="caption">李春生与父亲李老伯：固命礼完成二十周年回访。</p>
      <div class="old-note">采访摘录：「没有什么特别。该守的，就守着。」</div>
      <button type="button" class="btn-inline ghost" data-go="search_rope">返回搜索结果</button>
    `);
  }

  function pageNews2012() {
    setAddr("/news/2012-shousheng");
    return siteShell("news", `
      <h2>兄长留乡照护幼妹，获评「守绳之家」</h2>
      <p>梁永安自幼与妹妹感情深厚。妹妹患病后，他主动放弃前往广州工作的机会，也没有再考虑婚配，决定留在家中照顾妹妹与年迈母亲。</p>
      <p>多年来，他始终坚守牵命人的责任，用自己的选择诠释了绛水镇「不离不弃」的传统。</p>
      ${HJ.ph("shou_sheng_family", "wide")}
      <p class="caption">梁永安一家获评2012年度「守绳之家」。</p>
      <div class="old-note">采访：「家里需要我，我就不能走。」</div>
      <button type="button" class="btn-inline ghost" data-go="search_rope">返回搜索结果</button>
    `);
  }

  function pageNews2015() {
    setAddr("/news/2015-model-sisters");
    return siteShell("news", `
      <h2>姐妹相守不离弃，表彰「模范姐妹」</h2>
      <p>2015年过绳节期间，文化站特别表彰一对姐妹：牵命人<strong>陈向阳</strong>（大姐，已立），被牵人<strong>陈小芽</strong>。陈向阳把照顾妹妹当作本分，为此放弃了前往大城市的机会；妹妹陈小芽乖巧懂事，成绩优异，不肯辜负姐姐的照护。姐妹二人被镇上称为「模范姐妹」。</p>
      <p>据介绍，二人早在固命礼完成后便鲜少分开。陈向阳说，绳结打上了，人就不能先松手。「妹妹定了，我也就定了。」</p>
      ${HJ.ph("chen_sisters_2015", "wide")}
      <p class="caption">陈向阳与妹妹陈小芽获评2015年度「模范姐妹」。</p>
      <div class="old-note">采访摘录：「姐妹不分开，镇上就少一桩事。」</div>
      <button type="button" class="btn-inline ghost" data-go="search_rope">返回搜索结果</button>
    `);
  }

  function pageSearchLing() {
    setAddr("/search?q=梁绫");
    return siteShell("news", `
      <h2>搜索结果：梁绫</h2>
      <div class="search-result" data-go="news_ling_craft">
        ${HJ.ph("ling_rope_craft", "thumb")}
        <div>
          <div class="meta">2008年</div>
          <h4>轮椅上的巧手：梁绫教孩子们用绳子编出小世界</h4>
          <p class="abs">镇民梁绫心灵手巧，常在宗祠侧厢义务指导镇上小朋友学习绳结与编织工艺。</p>
        </div>
      </div>
    `);
  }

  function pageNewsLingCraft() {
    setAddr("/news/2008-ling-craft");
    return siteShell("news", `
      <h2>轮椅上的巧手：梁绫教孩子们用绳子编出小世界</h2>
      <p>在绛水镇，提起「梁绫」，许多孩子会先想起她手里那截红绳，而不是轮椅。</p>
      <p>梁绫自幼腿脚不便，却把绳子玩得出神入化。每到周末，她便坐在梁氏宗祠东侧厢房门口，把旧绳头、彩线和小木珠摊开，教镇上的小朋友打结、编辫、绕成小挂饰与香囊。孩子们围在她身边，一边学，一边笑；她也总说：「绳子会听话的，你耐心一点就好。」</p>
      <p>文化站工作人员表示，梁绫的义务教学既保留了过绳节相关的手工艺传统，也让孩子们在游戏里学会互相递绳、彼此帮忙。「她自己坐着，却把一屋子的人都连起来了。」</p>
      ${HJ.ph("ling_rope_craft", "wide")}
      <p class="caption">梁绫在宗祠侧厢指导小朋友用红绳编织小工艺品。</p>
      <div class="old-note">梁绫：「人可以走不动，手不能闲着。绳子编好了，心里也会亮一点。」</div>
      <button type="button" class="btn-inline ghost" data-go="search_ling">返回搜索结果</button>
    `);
  }

  function pageSearchSui() {
    setAddr("/search?q=梁穗");
    return siteShell("news", `
      <h2>搜索结果：梁穗</h2>
      <div class="search-result" data-go="news_sui_math">
        ${HJ.ph("sui_math_2008", "thumb")}
        <div>
          <div class="meta">2008年</div>
          <h4>绛水中学梁穗获县高中数学竞赛二等奖</h4>
          <p class="abs">绛水中学2006级学生梁穗（1991年生）在县级高中数学竞赛中表现优异，捧回二等奖。</p>
        </div>
      </div>
    `);
  }

  function pageNewsSuiMath() {
    setAddr("/news/2008-sui-math");
    return siteShell("news", `
      <h2>绛水中学梁穗获县高中数学竞赛二等奖</h2>
      <p>昨日，县教育局公布本年度高中数学竞赛获奖名单。绛水中学<strong>2006级</strong>学生<strong>梁穗</strong>（1991年生）以扎实的解题功底与沉稳的临场表现，获得二等奖，为本镇争得了荣誉。</p>
      <p>据班主任介绍，梁穗平时寡言，却极爱钻研题目，常在课余把难题写满整本草稿。「她说想靠自己的分数，走到更远的地方去看看。」</p>
      <p>校长在校门口简短祝贺时表示，希望更多学子像梁穗一样，把根留在书本上，把目光投向镇外的广阔天地。</p>
      ${HJ.ph("sui_math_2008", "wide")}
      <p class="caption">2008年县高中数学竞赛颁奖现场：梁穗（绛水中学2006级）上台领奖。</p>
      <div class="old-note">梁穗（领奖感言摘录）：「谢谢大家，我会继续努力下去。」</div>
      <button type="button" class="btn-inline ghost" data-go="search_sui">返回搜索结果</button>
    `);
  }

  function pageNews2009() {
    setAddr("/news/2009-review");
    const fixed = flag("ending_started");
    if (fixed) return pageNews2009Fixed();
    return siteShell("news", `
      <h2>2009年过绳节活动回顾</h2>
      <p>2009年过绳节于七月十五日在梁氏宗祠举行。当晚，多户家庭参加伴命仪式与固命礼。仪式结束后，一名参加活动的梁姓女子失踪。次日清晨，村民在绛水河下游发现其轮椅及一段被剪断的红绳。</p>
      <div class="two-cols">
        <div class="card-block">
          <h4>活动照片</h4>
          <p>五至六张档案缩略图</p>
          <button type="button" class="btn-inline" data-go="photo_gallery">打开活动照片</button>
        </div>
        <div class="card-block">
          <h4>相关旧闻</h4>
          <p>失踪与河边发现</p>
          <button type="button" class="btn-inline" data-go="related_news">打开相关旧闻</button>
        </div>
      </div>
      <button type="button" class="btn-inline ghost" data-go="search_rope">返回搜索结果</button>
    `);
  }

  function pageNews2009Fixed() {
    setAddr("/news/2009-review");
    return siteShell("news", `
      <h2>梁绫死于旧染坊事故，投河说法不实</h2>
      <p>（原标题「河边发现空轮椅，梁姓女子疑似投河」已更正）</p>
      ${HJ.ph("ritual_full", "wide")}
      <div class="kv">
        <div><b>被牵人：</b>梁绫</div>
        <div><b>原指定牵命人：</b>梁穗</div>
        <div><b>本人签名：</b>无</div>
        <div><b>固命礼状态：</b>从未完成</div>
      </div>
    `);
  }

  function pagePhotoGallery() {
    setAddr("/news/2009/photos");
    return siteShell("news", `
      <h2>2009年活动照片</h2>
      <div class="gallery">
        ${[1,2,3,4,5].map(i => `<div class="gallery-item"><div class="img-ph thumb"><span class="ph-label">档案缩略图 ${i}</span></div><div class="g-title">过绳节现场 ${i}</div></div>`).join("")}
        <div class="gallery-item" data-open-ritual>
          ${HJ.ph("ritual_cropped", "thumb clickable highlight")}
          <div class="g-title">2009年过绳节·伴命仪式合影</div>
        </div>
      </div>
      <button type="button" class="btn-inline ghost" data-go="news_2009">返回</button>
    `);
  }

  function pageRelatedNews() {
    setAddr("/news/2009/riverside");
    return siteShell("news", `
      <h2>河边发现空轮椅，梁姓女子疑似投河</h2>
      <p>2009年7月15日晚，一名梁姓女子在过绳节结束后失踪。次日清晨，村民在绛水河下游发现其轮椅及一段被剪断的红绳。据家属反映，该女子失踪前曾与亲人发生争执。目前搜寻工作仍在进行中。</p>
      <p class="caption">发现时间记录：2009年7月16日早晨 5:40</p>
      <p>相关关键词：
        <span>梁姓女子</span> ·
        <span>剪断红绳</span> ·
        <button type="button" class="linkish hl" data-go="qianshengniang">牵绳娘</button>
      </p>
      <button type="button" class="btn-inline ghost" data-go="news_2009">返回</button>
    `);
  }

  /** 红眼挂到整个桌面正中央顶层（不限于浏览器窗内） */
  function setQianshengDesktopEye(on) {
    let el = $("#qiansheng-desktop-eye");
    if (!on) {
      el?.remove();
      return;
    }
    const src = (HJ.ASSETS && HJ.ASSETS.rope_eye_qiansheng) || (HJ.ASSETS && HJ.ASSETS.rope_eye) || "";
    if (!el) {
      el = document.createElement("div");
      el.id = "qiansheng-desktop-eye";
      el.className = "qiansheng-desktop-eye";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    el.innerHTML = src
      ? `<img src="${src}" alt="" draggable="false">`
      : spindleEyeSVG();
    // 重播浮现动画
    el.style.animation = "none";
    const img = el.querySelector("img, svg");
    if (img) img.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    if (img) img.style.animation = "";
  }

  function pageQianshengniang() {
    const src = (HJ.ASSETS && HJ.ASSETS.qianshengniang) || "";
    const bg = src
      ? `<div class="qiansheng-bg" aria-hidden="true"><img src="${src}" alt="" draggable="false"></div>`
      : `<div class="qiansheng-bg is-ph" aria-hidden="true">${HJ.ph("qianshengniang", "cover")}</div>`;
    return `
      <div class="unknown-page qiansheng-page">
        ${bg}
        <div class="qiansheng-fg">
          <p class="unknown-label">来源未知 · 未收录于民俗馆目录</p>
          <h2>牵绳娘</h2>
          <p>相传七年前，镇中一名牵命人不愿履行职责，在固命礼当晚剪断红绳，独自离开绛水镇。被留下的病弱女子无法承受亲人的背弃，当夜投河而死。</p>
          <p>从此，每逢过绳节，镇中便会出现一名手握红绳的湿衣女子。若有牵命人拒绝自己的使命，她便会顺着红绳找到那个人，将灾厄带给被抛下的亲人。</p>
          <p class="ghost-line">牵命人一旦剪绳，绳子的另一端必有人偿命。</p>
          <button type="button" class="eye-back" id="ghost-eye-back" title="返回">
            <svg viewBox="0 0 64 36" width="52" height="28" aria-hidden="true">
              <path d="M2 18 Q32 2 62 18 Q32 34 2 18 Z" fill="none" stroke="currentColor" stroke-width="2.2"/>
              <circle cx="32" cy="18" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/>
              <circle cx="32" cy="18" r="2.8" fill="currentColor"/>
            </svg>
            <span>返回</span>
          </button>
        </div>
      </div>`;
  }

  function pageAkui() {
    setAddr("/ritual/2016/hekui");
    return siteShell("list", `
      <h2>2016年伴命仪式参加者</h2>
      <div class="profile-grid">
        ${HJ.ph("hekui_id", "portrait")}
        <div class="kv">
          <div><b>姓名：</b>何葵</div>
          <div><b>年龄：</b>十八岁</div>
          <div><b>伴命者：</b>何童</div>
          <div><b>关系：</b>姐弟</div>
          <div><b>伴命原因：</b>何童患有癫痫，需要长期照护</div>
          <div><b>仪式日期：</b>七月十五</div>
          <div><b>申请状态：</b>家属同意</div>
          <div><b>本人意愿：</b>自愿</div>
        </div>
      </div>
      <ul class="attach-list">
        <li><button type="button" data-go="application">《伴命仪式家庭申请表》</button></li>
        <li><button type="button" data-go="honor">《牵命人荣誉介绍》</button></li>
      </ul>
    `);
  }

  function pageHonor() {
    setAddr("/promo/hekui");
    return siteShell("news", `
      <h2>十八岁女孩主动留乡，照顾患病弟弟</h2>
      <p>何葵自幼品学兼优，与弟弟感情深厚。得知自己被选为牵命人后，她主动放弃外出求学的机会，决定留在家中陪伴弟弟。她用自己的选择，诠释了绛水镇「不离不弃」的传统。</p>
      ${HJ.ph("hekui_promo", "wide")}
      <p class="caption">何葵自愿放弃外出求学，决定留乡照顾弟弟。</p>
      <p>图片来源：<button type="button" class="linkish hl" data-go="school">绛水中学优秀毕业生专栏</button></p>
      <button type="button" class="btn-inline ghost" data-go="akui">返回</button>
    `);
  }

  function pageSchool() {
    setAddr("/external/jiangshui-middle/graduate");
    return siteShell("news", `
      <h2>绛水中学 · 优秀毕业生专栏</h2>
      ${HJ.ph("hekui_full_admit", "wide")}
      <div class="kv">
        <div><b>何葵</b></div>
        <div>录取学校：岭南工业大学</div>
        <div>报到日期：八月二十五日</div>
      </div>
      <div class="old-note">班主任祝语：愿你走出绛水镇，看见更大的世界。</div>
      <button type="button" class="btn-inline ghost" data-go="honor">返回</button>
    `);
  }

  function pageApplication() {
    setAddr("/ritual/2016/hekui/form");
    return siteShell("list", `
      <h2>《伴命仪式家庭申请表》</h2>
      <div class="form-sheet">
        <div>牵命人：何葵</div>
        <div>伴命者：何童</div>
        <div>申请理由：姐弟情深，姐姐愿承担照护责任</div>
        <div>监护人意见：同意</div>
        <div>监护人签名：何秀兰</div>
        <div style="margin-top:12px">牵命人本人意见：<span class="blank"></span></div>
        <div>牵命人本人签名：<span class="blank"></span></div>
        <div class="stamp">审核结果：本人自愿，准予参加。</div>
      </div>
      <p style="margin-top:12px"><button type="button" class="btn-inline" data-go="app_back">查看背面</button>
      <button type="button" class="btn-inline ghost" data-go="akui">返回</button></p>
    `);
  }

  function pageAppBack() {
    setAddr("/ritual/2016/hekui/form-back");
    const glitch = flag("ch1_glitch_view");
    const draw2 = glitch ? "app_back_draw2_look" : "app_back_draw2";
    return siteShell("list", `
      <h2>申请表 · 背面</h2>
      <div class="drawing-board">
        <p style="font-size:14px;color:#5a4030">（空白处一行歪歪扭扭的铅笔字）</p>
        <p style="font-size:18px;font-family:var(--font-display)">我不要姐姐留下。</p>
        <div class="drawing-row">
          ${HJ.ph("app_back_draw1", "thumb clickable")}
          ${HJ.ph(draw2, "thumb clickable")}
        </div>
        ${glitch ? `
          <p class="red-tiny">见证人：梁绫</p>
          <p class="caption" style="color:#8b1a1a">画中弟弟抬起头，正望着你。</p>
        ` : ""}
      </div>
      <button type="button" class="btn-inline ghost" data-go="application">返回正面</button>
    `);
  }

  function pageDyeArchive() {
    setAddr("/archive/dyehouse");
    // 浏览器内也提供入口，同时引导去桌面档案窗口
    return siteShell("news", `
      <h2>绛水镇工业区登记档案 · 旧染坊</h2>
      <p>该档案已保存到桌面。也可在此直接查阅：</p>
      <ul class="attach-list">
        <li><button type="button" data-go="plan_compare">建筑平面图</button></li>
        <li><button type="button" data-go="equip_log">设备检查记录</button></li>
        <li><button type="button" data-go="night_log">夜间值守登记</button></li>
      </ul>
      <p><button type="button" class="btn-inline gold" id="open-desk-archive">在桌面档案窗口中打开</button></p>
    `);
  }

  function pagePlanCompare() {
    setAddr("/archive/dyehouse/plans");
    const found = flag("found_pool_door");
    return siteShell("news", `
      <h2>建筑平面图</h2>
      <p class="caption">绛水染厂平面对照档案：左为2009年原始图，右为2016年现状图。</p>
      ${HJ.ph("plan_compare", "plan-full" + (found ? " diff" : ""))}
      ${found ? `
        <p class="caption" style="color:#8b1a1a">两边皆有「原料堆放区侧门」。<br>差异在原料区内：2009「三号地下染池检修门」→ 2016「废料储藏墙（木板封死）」。</p>
      ` : `
        <p class="caption">两图布局大致相同。</p>
      `}
      ${!found ? `<button type="button" class="btn-inline" id="btn-compare">进入对比模式</button>` :
        (!flag("saw_materials")
          ? `<div class="notice-banner"><h3>发现异常</h3><p>三号染池入口在2009年后被封闭。</p>
        <button type="button" class="btn-inline" id="btn-tell-sui">${flag("told_plan") ? "继续查看现场（铁门 / 文件箱）" : "把发现发给梁穗"}</button></div>`
          : `<div class="notice-banner"><h3>已记录</h3><p>三号染池入口在2009年后被封闭。文件箱可在桌面「文件箱」窗口回看。</p></div>`)}
      <button type="button" class="btn-inline ghost" data-go="dyehouse_archive">返回</button>
    `);
  }

  function pageNightLog() {
    setAddr("/archive/dyehouse/night");
    return siteShell("news", `
      <h2>夜间值守登记 · 2009年7月15日</h2>
      <div class="form-sheet">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><th align="left">时间</th><th align="left">姓名</th><th align="left">进入地点</th><th align="left">离开时间</th></tr>
          <tr><td>21:47</td><td>梁绫</td><td>旧染坊侧门</td><td><button type="button" class="linkish hl" id="blank-leave">（空白）</button></td></tr>
          <tr><td>21:54</td><td>梁守义</td><td>旧染坊侧门</td><td>22:18</td></tr>
          <tr><td>21:55</td><td>梁守义随行人员两名</td><td>旧染坊侧门</td><td>22:18</td></tr>
        </table>
      </div>
      <button type="button" class="btn-inline ghost" data-go="dyehouse_archive">返回</button>
    `);
  }

  function pageEquipLog() {
    setAddr("/archive/dyehouse/equip");
    return siteShell("news", `
      <h2>设备检查记录</h2>
      <div class="old-note">三号牵引架长期受潮，禁止强行回收主绳。</div>
      <h3>2009年7月15日临时事故记录</h3>
      <div class="form-sheet form-sheet-log">
        <div class="wiped-hex log-entry" aria-label="22:04 事故日志">
          <div class="wh-meta">[22:04] INCIDENT_LOG　facility=DYEHOUSE/POOL-3　status=OPEN</div>
          <pre class="wh-dump">主牵引绳突然收紧。三号染架向西侧倒塌。
地下染池检修出口被木架堵塞。暴雨导致河水沿排水口倒灌。</pre>
          <div class="wh-meta">tag=STRUCTURAL_COLLAPSE · DRAIN_BACKFLOW</div>
        </div>
        <div class="wiped-hex log-entry is-purged" aria-label="被强制抹除的日志行">
          <div class="wh-meta">[22:12] ENTRY_RETRACT opcode=0x07　operator=L.SY　CRC=FAIL</div>
          <pre class="wh-dump">0000  e7 8e b0 e5 9c ba e5 8f  af e8 83 bd e6 9c 89 e4  |................|
0010  ba ba e8 a2 ab e5 9b b0  e3 80 82 00 00 FF FF XX  |............????|
0020  2a 20 50 55 52 47 45 44  20 2a 20 2d 2d 2d 2d 2d  |* PURGED * -----|
*</pre>
          <div class="wh-hint">〈此行已被强制抹除〉</div>
        </div>
        <p class="caption">记录撤回时间：22:12　撤回人：梁守义</p>
      </div>
      ${flag("read_night") && flag("read_equip") && !flag("timeline_done") ?
        `<button type="button" class="btn-inline gold" id="btn-timeline">还原最后二十五分钟</button>` : ""}
      <button type="button" class="btn-inline ghost" data-go="dyehouse_archive">返回</button>
    `);
  }

  function pageMaterials() {
    // 兼容旧入口：内容已迁至独立窗口
    setTimeout(openFileBox, 0);
    return siteShell("news", `
      <h2>文件箱已移至桌面</h2>
      <p>染坊文件箱现为独立窗口，不再挂在民俗馆下。</p>
      <p><button type="button" class="btn-inline gold" id="btn-open-filebox">打开染坊文件箱</button></p>
    `);
  }

  function pageRiversideQ() {
    setAddr("/news/2009/riverside/q");
    return siteShell("news", `
      <h2>河边发现的轮椅说明了什么？</h2>
      <div class="choice-q" id="riverside-choice">
        <button type="button" data-wrong>梁绫独自前往河边。</button>
        <button type="button" data-wrong>梁绫从染坊逃出后投河。</button>
        <button type="button" data-right>有人在事故后布置了投河现场。</button>
      </div>
    `);
  }

  function pageNotice() {
    setAddr("/notice/urgent");
    const epilogue = flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue";
    if (epilogue) {
      return siteShell("notice", `
        <div class="notice-banner">
          <h3>绛水镇第一届绳艺作品展示活动</h3>
          <p>即日起开展。欢迎镇民携带自家红绳、编结手艺与旧时绳结前来参展、观摩。</p>
          <p>作品不限新旧，重在把「绳」写成互助与手艺。</p>
          <p>展出地点：梁氏宗祠　开放时间：每日上午至傍晚</p>
        </div>
      `);
    }
    return siteShell("notice", `
      <div class="notice-banner">
        <h3>过绳节重要通知</h3>
        <p>因今晚可能出现暴雨，2016年固命礼提前至 <b>19:30</b> 举行。</p>
        <p>仪式地点：梁氏宗祠　主持人：梁守义</p>
        <p>牵命人：何葵　伴命者：何童　仪式状态：等待开始</p>
      </div>
      ${flag("ch4_ritual_link") ? `<button type="button" class="btn-inline gold" data-go="ritual_system">打开仪式展示系统（编辑端）</button>` : ""}
    `);
  }

  function pageRitualSystem() {
    setAddr("/internal/ritual-display");
    const chips = [
      { ev: "sui", id: "a", text: "「不要怪阿穗」的留言" },
      { ev: "sui", id: "b", text: "梁绫准备的车票和剪刀" },
      { ev: "ling", id: "c", text: "三号染池事故记录" },
      { ev: "ling", id: "d", text: "河边假现场照片" },
      { ev: "kui", id: "e", text: "何葵完整大学录取照片" },
      { ev: "kui", id: "f", text: "何童写下「我不要姐姐留下」" },
    ];
    // Fisher–Yates：每次进入页面打乱证据池顺序，避免与结论一一对齐
    for (let i = chips.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chips[i], chips[j]] = [chips[j], chips[i]];
    }
    const poolHtml = chips.map(c =>
      `<button type="button" class="ev-chip" data-ev="${c.ev}" data-id="${c.id}">${c.text}</button>`
    ).join("");
    return siteShell("news", `
      <h2>绛水镇过绳节仪式展示系统</h2>
      <p>请将对应证据拖入（或点击选择后点结论）官方说法下方。</p>
      <div class="evidence-board" id="ev-board">
        <div class="claim" data-claim="sui">
          <h4>① 梁穗自愿成为牵命人，后因畏惧逃离。</h4>
          <div class="drop-zone" data-need="2"></div>
        </div>
        <div class="claim" data-claim="ling">
          <h4>② 梁绫因被抛弃投河，死后成牵绳娘。</h4>
          <div class="drop-zone" data-need="2"></div>
        </div>
        <div class="claim" data-claim="kui">
          <h4>③ 何葵自愿放弃求学，决定终身照顾弟弟。</h4>
          <div class="drop-zone" data-need="2"></div>
        </div>
      </div>
      <div class="evidence-pool" id="ev-pool">
        ${poolHtml}
      </div>
      <p id="ev-hint" class="caption">选中证据后，再点击对应结论区域放入。</p>
    `);
  }

  function pageEndingHome() {
    setAddr("/mutual-aid");
    return siteShell("ending_home", `
      <h2>接绳互助登记</h2>
      <p>就医与随访由卫生服务中心负责。日常照护由养老互助中心排班，并由专业看护人员承担主干工作。岗位建设可向县政府申请「回乡人才基金」支持。</p>
      <p>可搜索：<button type="button" class="hot-link" data-q="何葵">何葵</button>　<button type="button" class="hot-link" data-q="接绳互助">接绳互助</button></p>
    `);
  }

  function pageSearchHekui() {
    setAddr("/search?q=后续报道");
    const pickEpilogue = (flag("epilogue_started") || flag("epilogue_await_news")) && !flag("epilogue_news_done");
    const read1 = flag("epilogue_news1_read");
    const read2 = flag("epilogue_news2_read");
    const showFinish = pickEpilogue && read1 && read2;
    return siteShell("news", `
      <h2>搜索结果：后续报道</h2>
      <div class="search-result${pickEpilogue && !read1 ? " is-epilogue-pick" : ""}${read1 ? " is-epilogue-read" : ""}"${pickEpilogue ? ' data-go="epilogue_news1"' : ' style="cursor:default"'}>
        ${HJ.ph("hekui_station", "thumb")}
        <div>
          <h4>恭喜何葵同学顺利入读岭南工业大学</h4>
          ${pickEpilogue && !read1 ? `<p class="caption epilogue-pick-hint">点击查看</p>` : ""}
          ${read1 ? `<p class="caption epilogue-read-mark">已读</p>` : ""}
        </div>
      </div>
      <div class="search-result epilogue-news-second${pickEpilogue && !read2 ? " is-epilogue-pick" : ""}${read2 ? " is-epilogue-read" : ""}"${pickEpilogue ? ' data-go="epilogue_news2"' : ' style="cursor:default"'}>
        ${HJ.ph("epilogue_mutual_center", "thumb")}
        <div>
          <h4>养老互助中心与卫生服务中心建成启用</h4>
          <p class="abs">接绳互助政策落地 · 回乡人才补贴已发放 · 专业照护排班启动</p>
          ${pickEpilogue && !read2 ? `<p class="caption epilogue-pick-hint">点击查看</p>` : ""}
          ${read2 ? `<p class="caption epilogue-read-mark">已读</p>` : ""}
        </div>
      </div>
      ${showFinish ? `
      <div class="epilogue-search-finish">
        <button type="button" class="btn-inline gold epilogue-close-btn" id="epilogue-life-back">看来，事情已然结束。尘埃落定，我也能回到自己的生活中去了。</button>
      </div>` : ""}
    `);
  }

  /* ---------- Bind page events ---------- */
  function bindPage(page, root) {
    root.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => go(b.dataset.nav));
    root.querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
      const t = b.dataset.go;
      if (t === "akui") {
        const first = !flag("clicked_akui");
        flag("clicked_akui", true);
        if (state.chapter === "prologue") setChapter("ch1");
        go(t);
        if (first) {
          openWin("chat");
          sequence([
            { type: "msg", who: "sys", text: "—— 序章结束 · 第一章：牵命人 ——", cls: "sys" },
          ]);
        }
        return;
      }
      if (t === "qianshengniang") onEnterQianshengniang();
      if (t === "school") onEnterSchool();
      if (t === "honor") {
        flag("saw_honor", true);
        trySendLookingForRoom();
      }
      if (t === "application") {
        flag("saw_application", true);
        trySendLookingForRoom();
      }
      if (t === "app_back") onEnterAppBack();
      if (t === "related_news") flag("saw_related", true);
      go(t);
    });
    root.querySelectorAll("[data-q]").forEach(b => b.onclick = () => doSearch(b.dataset.q));
    root.querySelectorAll(".search-result[data-go]").forEach(b => {
      b.onclick = () => {
        const t = b.dataset.go;
        if (t === "epilogue_news1") {
          onEpilogueNewsOpen("hekui");
          return;
        }
        if (t === "epilogue_news2") {
          onEpilogueNewsOpen("mutual");
          return;
        }
        if (t === "news_2016") onRead2016();
        if (t === "news_2012") onRead2012();
        if (t === "news_2009") flag("read_2009", true);
        go(t);
      };
    });
    root.querySelector("#epilogue-life-back")?.addEventListener("click", () => {
      finishEpilogueNews();
    });

    if (page === "photo_gallery") {
      root.querySelector("[data-open-ritual]")?.addEventListener("click", openRitualPhoto);
    }
    if (page === "list" && flag("ask_namelist")) {
      flag("namelist_loaded", true);
      flag("prologue_list", true);
    }
    if (page === "qianshengniang") {
      $("#ghost-eye-back")?.addEventListener("click", () => {
        back();
      });
      // 进入未知页时若对话未触发过，再试一次（兼容旧存档卡死）
      if (!flag("prologue_glitch")) onEnterQianshengniang();
    }
    if (page === "dyehouse_archive") {
      $("#open-desk-archive")?.addEventListener("click", () => {
        revealArchiveIcon();
        openWin("archive");
      });
    }
    if (page === "plan_compare") {
      $("#btn-compare")?.addEventListener("click", () => {
        flag("found_pool_door", true);
        toast("发现异常：三号染池入口在2009年后被封闭。");
        go("plan_compare", false);
      });
      $("#btn-tell-sui")?.addEventListener("click", onTellPlan);
    }
    if (page === "night_log") {
      flag("read_night", true);
      $("#blank-leave")?.addEventListener("click", () => {
        toast("未查询到梁绫离开旧染坊的记录。");
        flag("ling_no_leave", true);
      });
      if (flag("saw_materials") && !flag("timeline_done") && !flag("ch3_done")) {
        setTimeout(offerMaterialsNextStep, 500);
      }
    }
    if (page === "equip_log") {
      flag("read_equip", true);
      $("#btn-timeline")?.addEventListener("click", openTimelinePuzzle);
      // re-render button visibility
      if (flag("read_night") && flag("read_equip") && !flag("timeline_done") && !root.querySelector("#btn-timeline")) {
        go("equip_log", false);
      }
      if (flag("saw_materials") && !flag("timeline_done") && !flag("ch3_done")) {
        setTimeout(offerMaterialsNextStep, 500);
      }
    }
    if (page === "materials") {
      $("#btn-open-filebox")?.addEventListener("click", openFileBox);
    }
    if (page === "riverside_q") {
      root.querySelectorAll("[data-wrong]").forEach(b => b.onclick = () => toast("证据似乎并不支持这个结论。"));
      root.querySelector("[data-right]")?.addEventListener("click", onRiversideCorrect);
    }
    if (page === "ritual_system") bindEvidence();
    if (page === "app_back") bindAppBackDrawings(root);
  }

  function bindAppBackDrawings(root) {
    root.querySelector('[data-img="app_back_draw1"]')?.addEventListener("click", () => {
      showPhoto("app_back_draw1", "申请表背面 · 画一", "wide fit-contain");
    });
    const draw2El = root.querySelector('[data-img="app_back_draw2"], [data-img="app_back_draw2_look"]');
    draw2El?.addEventListener("click", () => {
      const key = flag("ch1_glitch_view") ? "app_back_draw2_look" : "app_back_draw2";
      openModal(`
        <button type="button" class="modal-close" data-x>×</button>
        ${HJ.ph(key, "wide fit-contain")}
        <p class="caption">申请表背面 · 画二</p>
      `, {
        onClose: () => {
          if (!flag("ch1_horror")) triggerCh1Horror();
        }
      });
    });
  }

  function doSearch(q) {
    q = (q || "").trim();
    if (q === "过绳节") {
      flag("searched_rope", true);
      go("search_rope");
    } else if (q === "梁绫") {
      flag("searched_ling", true);
      go("search_ling");
    } else if (q === "牵绳娘") {
      onEnterQianshengniang();
      go("qianshengniang");
    } else if (q === "梁穗") {
      flag("searched_sui", true);
      go("search_sui");
    } else if ((q === "何葵" || q === "接绳互助" || q === "后续报道") &&
        (state.chapter === "ending" || state.chapter === "epilogue" || flag("ending_started") || flag("epilogue_await_news"))) {
      go("search_hekui");
    } else {
      toast("没有找到与「" + q + "」直接相关的结果。试试「过绳节」「梁绫」或「梁穗」。");
    }
  }

  /* ---------- Prologue flows ---------- */
  function onRead2016() {
    if (flag("msg_2016")) return;
    flag("msg_2016", true);
    flag("read_2016", true);
    openWin("chat");
    sequence([
      300,
      { type: "msg", who: "玩家", text: "我点开了2016年那条。站在宗祠门口的人……你认识吗？", cls: "player" },
      700,
      { type: "msg", who: "梁穗", text: "这是梁守义。" },
      { type: "msg", who: "梁穗", text: "七年前，我和姐姐的仪式也是他主持的。" },
    ]);
  }

  function onRead2012() {
    if (flag("msg_2012")) return;
    flag("msg_2012", true);
    openWin("chat");
    sequence([
      300,
      { type: "msg", who: "玩家", text: "这条「守绳之家」……看着不太像普通表彰新闻。", cls: "player" },
      700,
      { type: "msg", who: "梁穗", text: "我记得他。" },
      { type: "msg", who: "梁穗", text: "小时候大家都夸他孝顺。" },
    ]);
  }

  function openRitualPhoto() {
    const showFull = flag("saw_full_photo");
    // 惊吓闪回后永远只显示正常原图
    const imgKey = showFull ? "ritual_full" : "ritual_cropped";
    const phClass = imgKey === "ritual_cropped" ? "portrait fit-contain" : "wide fit-contain";
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>2009年过绳节合影</h3>
      <div class="photo-stage" id="ritual-stage">
        ${HJ.ph(imgKey, phClass)}
        ${ropeWebHTML()}
      </div>
      <p class="caption">梁绫与家人参加伴命仪式。仪式结束后，梁绫于当晚失踪。</p>
      <p>图片来源：绛水镇文化站旧档案</p>
      <p>文件编号：<button type="button" class="linkish hl" id="file-no">JS-09-0715-18</button></p>
      <div id="ritual-extra"></div>
    `);
    if (showFull) {
      $("#ritual-extra").innerHTML = `
        <div class="old-note">
          被牵人：梁绫<br>牵命人：梁穗<br>固命礼状态：未完成
        </div>
        <p class="caption">原图右侧出现年轻时的梁穗。红绳另一端系在她手上。</p>
      `;
    }
    $("#file-no")?.addEventListener("click", showFullRitual);

    if (!flag("saw_full_photo")) {
      toast("点开下方「文件编号」查看未裁切原图。");
    }
  }

  async function showFullRitual() {
    if (flag("saw_full_photo") && flag("ask_namelist_chat")) {
      toast("原图已经看过了。");
      return;
    }
    const stage = $("#ritual-stage");
    if (!stage) return;
    const web = stage.querySelector(".rope-web");
    const webHtml = web ? web.outerHTML : ropeWebHTML();

    // 第一次：正常原图 → 黑屏 scare → 恐怖版闪几下 → 回到正常原图（此后不再出现恐怖版）
    if (!flag("saw_full_photo")) {
      flag("saw_full_photo", true);
      stage.classList.remove("warped");
      stage.innerHTML = HJ.ph("ritual_full", "wide fit-contain") + webHtml;
      $("#ritual-extra").innerHTML = `
        <div class="old-note">
          被牵人：梁绫<br>牵命人：梁穗<br>固命礼状态：未完成
        </div>
        <p class="caption">未裁切原图：右侧是年轻的梁穗，红绳另一端系在她手上。</p>
      `;
      revealFolder();
      toast("找到未裁切原图了。");

      await wait(2000);
      setHorrorMoment(true);
      playBgm("horror", { volume: 0.42, fade: 500 });

      flicker();
      await wait(200);
      flicker();
      await wait(120);

      const bo = $("#blackout") || (() => {
        const el = document.createElement("div");
        el.id = "blackout";
        el.className = "blackout";
        document.body.appendChild(el);
        return el;
      })();
      bo.classList.add("on");
      await wait(650);

      flag("saw_full_horror", true);
      stage.classList.remove("warped");
      stage.style.opacity = "1";
      stage.innerHTML = HJ.ph("ritual_full_horror", "wide fit-contain") + webHtml;
      $("#ritual-extra").innerHTML = `
        <div class="old-note">
          被牵人：梁绫<br>牵命人：梁穗<br>固命礼状态：未完成
        </div>
        <p class="caption" style="color:#8b1a1a">梁绫的脸……变得不对劲。</p>
      `;
      await wait(180);
      bo.classList.remove("on");
      toast("照片变了。");

      for (let i = 0; i < 3; i++) {
        flicker();
        stage.style.opacity = "0.15";
        await wait(90);
        stage.style.opacity = "1";
        await wait(160);
      }
      await wait(280);

      stage.innerHTML = HJ.ph("ritual_full", "wide fit-contain") + webHtml;
      $("#ritual-extra").innerHTML = `
        <div class="old-note">
          被牵人：梁绫<br>牵命人：梁穗<br>固命礼状态：未完成
        </div>
        <p class="caption">照片又恢复了。可刚才那一下……</p>
      `;
      stage.style.opacity = "1";

      setHorrorMoment(false);
      playDesktopBgm();

      if (!flag("msg_found_full")) {
        flag("msg_found_full", true);
        await wait(500);
        openWin("chat");
        await sequence([
          { type: "msg", who: "玩家", text: "找到了。原图右边还有一个人——是你。红绳另一端系在你手上。", cls: "player", delay: 2000 },
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "……果然。他们把我裁掉了。", delay: 2000 },
        ], 1600);
      }
    } else {
      stage.classList.remove("warped");
      stage.innerHTML = HJ.ph("ritual_full", "wide fit-contain") + webHtml;
      $("#ritual-extra").innerHTML = `
        <div class="old-note">
          被牵人：梁绫<br>牵命人：梁穗<br>固命礼状态：未完成
        </div>
        <p class="caption">未裁切原图：右侧是年轻的梁穗，红绳另一端系在她手上。</p>
      `;
    }
  }

  async function afterPhotoNamelistChat() {
    if (flag("ask_namelist")) return;
    if (!flag("ask_namelist_chat")) {
      flag("ask_namelist_chat", true);
      closeModal();
      openWin("chat");
    } else {
      openWin("chat");
    }
    await waitChoice("那你知道今年过绳节是谁参加的吗？", "namelist_ask");
    if (!flag("gate_namelist_hint")) {
      await sequence([
        { type: "typing", ms: 1200 },
        { type: "msg", who: "梁穗", text: "我不知道。我刚回镇子，具体名单我还没问过别人。", delay: 2200 },
        { type: "typing", ms: 1100 },
        { type: "msg", who: "梁穗", text: "你可以再看看民俗馆网站上的「参加名单」。那个站有时候加载特别慢，第一次经常出不来——多点开一次试试。", delay: 3000 },
      ], 1600);
      flag("gate_namelist_hint", true);
    }
    flag("ask_namelist", true);
    chatChoices([{
      text: "好，我去看看参加名单。",
    }], "namelist:go");
  }

  async function onEnterQianshengniang() {
    // 已播过牵绳娘对话则不再触发；未播完可重复进入重试（修：曾提前写 saw_legend 导致卡死）
    if (flag("prologue_glitch")) return;
    if (onEnterQianshengniang._timer) clearTimeout(onEnterQianshengniang._timer);

    toast("这个页面……好像不太对劲。");
    // 约 5 秒：红眼浮现后屏闪 +「你已经看到了」
    onEnterQianshengniang._timer = setTimeout(async () => {
      if (state.page !== "qianshengniang") return;
      if (flag("prologue_glitch")) return;
      flag("prologue_glitch", true);
      flag("saw_legend", true);
      playBgm("horror", { fade: 800 });
      flicker();
      await wait(220);
      flicker();
      const tip = document.createElement("div");
      tip.className = "tiny-glitch";
      tip.textContent = "你已经看到了";
      document.body.appendChild(tip);
      await wait(1800);
      tip.remove();
      const search = $("#site-search");
      if (search) search.value = "梁穗";
      flag("auto_search_sui", true);
      openWin("chat");
      await sequence([
        300,
        { type: "msg", who: "玩家", text: "……页面自己闪了一下。搜索栏里也出现了你的名字。", cls: "player" },
        600,
        { type: "msg", who: "玩家", text: "这个「牵绳娘」的故事……写的是你，还有你姐姐吧？", cls: "player" },
        800,
        { type: "msg", who: "梁穗", text: "这个故事以前没有。" },
        { type: "msg", who: "梁穗", text: "至少我离开的时候，镇上还没有什么「牵绳娘」。" },
        { type: "msg", who: "梁穗", text: "他们写的那个逃走的人，应该是我。" },
        { type: "msg", who: "梁穗", text: "那个投河的人……是我姐姐。" },
      ]);
      chatChoices([{
        text: "可你说过，姐姐不像会投河的人。",
        onSelect: async () => {
          await sequence([
            { type: "msg", who: "梁穗", text: "对。她对我很好。是她让我离开这个镇子，去过自己本来应该过的生活。" },
            { type: "msg", who: "梁穗", text: "她很坚强。而且她当时告诉过我，她还有一件很重要的事情要做。" },
            600,
            { type: "msg", who: "梁穗", text: "我会弄清楚当年究竟发生了什么。", delay: 2200 },
          ]);
          flag("sui_ask_photo", true);
          // 恐怖版不会再跳，无需回去看照片，直接问名单
          await afterPhotoNamelistChat();
        }
      }], "qiansheng:doubt");
    }, 5000);
  }

  // 旧红绳名单流程已改为「参加名单」加载；保留空壳避免残留调用
  async function prologueHorror() {
    await afterPhotoNamelistChat();
  }

  /* ---------- Chapter 1 ---------- */
  function onEnterSchool() {
    flag("saw_school", true);
    flag("msg_school", true);
    flag("school_chat_done", true);
    save();
    trySendLookingForRoom();
  }

  function onEnterAppBack() {
    flag("msg_app_back", true);
    flag("saw_application", true);
    trySendLookingForRoom();
  }

  async function triggerCh1Horror() {
    if (flag("ch1_horror")) return;
    flag("ch1_horror", true);
    setHorrorMoment(true);
    playBgm("horror", { volume: 0.42, fade: 500 });

    // 1) 整桌面屏闪
    flicker();
    await wait(200);
    flicker();
    await wait(160);

    // 2) 变黑再变亮
    const bo = ensureBlackout();
    bo.classList.add("on");
    await wait(700);
    bo.classList.remove("on");
    await wait(280);

    // 3) 桌面正中眼睛符号
    const eye = ensureScareEye();
    eye.classList.add("on");
    await wait(1000);

    // 4) 第二幅画异变，停留并持续屏闪
    flag("ch1_glitch_view", true);
    go("app_back", false);
    toast("画变了。");
    for (let i = 0; i < 4; i++) {
      flicker();
      await wait(200);
      await wait(260);
    }
    await wait(1100);

    // 5) 再屏闪 / 短暂黑屏，变回原样（与仪式照惊吓同逻辑）
    flicker();
    await wait(140);
    flicker();
    await wait(100);
    bo.classList.add("on");
    await wait(450);
    eye.classList.remove("on");
    delete state.flags.ch1_glitch_view;
    save();
    go("app_back", false);
    bo.classList.remove("on");
    toast("画又恢复了。可刚才那一下……");

    setHorrorMoment(false);
    playDesktopBgm();

    // 须等玩家看过学校「班主任祝语」页并聊完，才进房间线
    await trySendLookingForRoom();
  }

  /**
   * 房间线顺序：
   * 1) 看过申请表惊吓 + 荣誉介绍 + 学校班主任页（不另弹聊天，留给玩家自己看图对照）
   * 2) 稍等几秒 → 系统「想起了什么」→「对了！……姐姐的房间里可能有……我去找找」→ 离线
   * 3) 再隔几秒 →「我到姐姐的房间了……」+ 全景
   */
  async function trySendLookingForRoom() {
    if (flag("sui_looking_room") || flag("room_sent")) return;
    if (!flag("ch1_horror") || !flag("saw_application") || !flag("saw_honor")) return;
    if (!flag("school_chat_done")) return;
    if (trySendLookingForRoom._busy) return;
    trySendLookingForRoom._busy = true;

    flag("sui_looking_room", true);
    save();
    // 班主任对话结束后，稍等几秒再发
    await wait(2800);
    if (flag("room_sent")) {
      trySendLookingForRoom._busy = false;
      return;
    }
    openWin("chat");
    await sequence([
      400,
      { type: "msg", who: "sys", text: "梁穗好像想起了什么重要的事情", cls: "sys" },
      600,
      { type: "msg", who: "梁穗", text: "对了！……姐姐的房间里可能有……我去找找。" },
      { type: "msg", who: "sys", text: "梁穗暂时离线", cls: "sys" },
    ]);
    setChatTitle("梁穗 · 离线");
    await wait(3500);
    await trySendRoomPanorama();
    trySendLookingForRoom._busy = false;
  }

  /** 「去找找」之后隔几秒：重新上线并发来房间全景 */
  async function trySendRoomPanorama() {
    if (flag("room_sent")) return;
    if (!flag("sui_looking_room")) return;
    flag("room_sent", true);
    flag("ch2_intro", true);
    flag("folder_ready", true);
    setChapter("ch2");
    revealFolder();
    setChatTitle("与梁穗聊天中");
    openWin("chat");
    await sequence([
      400,
      { type: "msg", who: "sys", text: "梁穗重新上线", cls: "sys" },
      { type: "msg", who: "梁穗", text: "我到姐姐的房间了。" },
      { type: "msg", who: "梁穗", text: "妈妈这些年一直锁着这里，里面几乎没有变过。" },
      { type: "msg", who: "梁穗", text: "我拍了全景，你帮我看看有没有不对劲的地方。" },
    ]);
    chatImg("梁穗", "room_panorama", "姐姐的房间 · 全景");
    await sequence([
      { type: "msg", who: "玩家", text: "好，我打开看看。", cls: "player" },
      { type: "msg", who: "sys", text: "—— 第一章结束 · 桌面出现「调查资料」——", cls: "sys" },
    ]);
    toast("桌面新增文件夹：调查资料");
  }

  /* ---------- Chapter 2 ---------- */
  function fileBtn(id, iconKey, iconLabel, fileName, extraClass = "") {
    return `
      <button type="button" class="file-item ${extraClass}" id="${id}">
        <div class="file-thumb">${HJ.phIcon(iconKey, iconLabel)}</div>
        <span class="file-name">${fileName}</span>
      </button>`;
  }

  function showPhoto(key, caption, phClass = "wide", opts = {}) {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      ${HJ.ph(key, phClass)}
      <p class="caption">${caption || ""}</p>
    `, opts);
  }

  function renderFolder() {
    const body = $("#folder-body");
    const items = [];
    const hasAny = flag("folder_ready") || flag("archive_ready") || flag("ch2_done") ||
      flag("clicked_akui") || flag("ending_started") || flag("has_cropped_clue") || flag("intro_chat") ||
      flag("saw_full_photo") || flag("saw_full_horror") ||
      ["ch2", "ch3", "ch4", "ending", "epilogue"].includes(state.chapter);

    items.push(`<p class="folder-hint">调查过程中保存的资料会集中在这里，可随时回看。</p><div class="folder-grid">`);

    // —— 开局线索：梁穗发来的裁切照 ——
    if (flag("has_cropped_clue") || flag("intro_chat") || flag("ending_started")) {
      items.push(fileBtn("open-cropped-clue", "ritual_cropped", "裁切照片", "梁穗发来的照片.jpg"));
    }

    // —— 何葵相关（仪式照/录取照不进资料夹，仅网站内查看）——
    if (flag("saw_application") || flag("msg_app_back") || flag("ending_started")) {
      items.push(fileBtn("open-hekui-form", "app_back_draw1", "申请表", "何葵_伴命申请表.jpg"));
    }
    if (flag("ending_started")) {
      items.push(fileBtn("open-hekui-station", "hekui_station", "车站送别", "何葵_已报到.jpg"));
    }

    // —— 梁绫相关 / 死因 ——
    // 姐姐的房间：须学校照 + 申请表（含惊吓）看完，梁穗发来全景后才出现
    if (flag("room_sent") || ["ch3", "ch4", "ending", "epilogue"].includes(state.chapter)) {
      items.push(fileBtn("open-room", "room_panorama", "姐姐的房间", "姐姐的房间.jpg"));
    }
    if (flag("box_open") || flag("ch2_confirmed") || flag("ch2_done") || flag("ending_started")) {
      items.push(fileBtn("open-box-kit", "scissors", "铁盒三件", "铁盒_车票剪刀合影.jpg"));
    }
    if (flag("saw_2147") || flag("ending_started")) {
      items.push(fileBtn("open-2147-file", "photo_2147", "21:47 照片", "2009_21时47分.jpg"));
    }
    if (flag("saw_side_2009") || flag("ending_started")) {
      items.push(fileBtn("open-side-2009-file", "dyehouse_side_2009", "侧门旧照", "染坊侧门_2009.jpg"));
    }
    if (flag("saw_materials") || flag("ending_started")) {
      items.push(fileBtn("open-materials-file", "roster", "文件箱", "染坊_文件箱内容.jpg"));
    }
    if (flag("exposure_done") || flag("ch3_done") || flag("ending_started")) {
      items.push(fileBtn("open-dye-final", "dye_pool_lv1", "染池·出手抓绳", "三号染池_出手抓绳.jpg"));
      items.push(fileBtn("open-dye-head", "dye_pool_lv2", "染池·半头", "三号染池_池沿半头.jpg"));
    } else if ((flag("ch3_truth") || flag("fake_riverside")) && !flag("ch3_done")) {
      items.push(fileBtn("open-dye-pool-file", "dye_pool_dark", "三号染池", "三号染池_待修复.jpg"));
    }
    if (flag("fake_riverside") || flag("saw_riverside_ling") || flag("exposure_done") || flag("ending_started")) {
      items.push(fileBtn("open-riverside-file", "riverside_fake", "河边假现场", "河边_2009年7月16日.jpg"));
    }

    // —— 其它 ——
    if (flag("ch4_started") || flag("ch4_ritual_link") || flag("ending_started")) {
      items.push(fileBtn("open-burned-note", "burned_note", "烧毁纸条", "一张烧毁的纸条.jpg"));
    }
    if (flag("ending_started")) {
      items.push(fileBtn("open-sisters-final", "sisters_final", "姐妹合影", "姐妹合影_终章.jpg"));
      items.push(fileBtn("open-restart-file", "live_knot_avatar", "重新开始", "重新开始.lnk", "link-file"));
    }

    items.push(`</div>`);

    if (!hasAny) {
      body.innerHTML = `<p class="folder-hint">尚无资料。推进剧情后，文件会出现在这里。</p>`;
    } else {
      body.innerHTML = items.join("");
    }

    $("#open-cropped-clue")?.addEventListener("click", () => {
      openCroppedCluePhoto();
    });
    $("#open-room")?.addEventListener("click", openRoom);
    $("#open-materials-file")?.addEventListener("click", () => {
      openFileBox();
    });
    $("#open-2147-file")?.addEventListener("click", () => {
      showPhoto("photo_2147", "2009年7月15日 21:47 — 梁绫朝旧染坊方向移动。");
    });
    $("#open-side-2009-file")?.addEventListener("click", () => {
      showPhoto("dyehouse_side_2009", "2009年7月15日夜 — 姐姐拍摄的原料堆放区侧门。");
    });
    $("#open-riverside-file")?.addEventListener("click", () => {
      showPhoto("riverside_fake", "河边_2009年7月16日.jpg");
    });
    $("#open-dye-pool-file")?.addEventListener("click", () => openExposure());
    $("#open-dye-final")?.addEventListener("click", () => {
      showPhoto("dye_pool_lv1", "手从染池伸出，抓住发黑红绳。");
    });
    $("#open-dye-head")?.addEventListener("click", () => {
      showPhoto("dye_pool_lv2", "手扣住池沿，半个人头从发黑池水中冒出。");
    });
    $("#open-dye-hand")?.addEventListener("click", () => {
      showPhoto("dye_pool_lv2", "手扣住池沿，半个人头从发黑池水中冒出。");
    });
    $("#open-hekui-form")?.addEventListener("click", () => {
      openWin("browser");
      go("application");
    });
    $("#open-hekui-station")?.addEventListener("click", () => {
      showPhoto("hekui_station", "何葵已报到岭南工业大学。何童照护已由接绳互助安排。");
    });
    $("#open-box-kit")?.addEventListener("click", () => {
      openModal(`
        <button type="button" class="modal-close" data-x>×</button>
        <h3>铁盒里的三样东西</h3>
        ${HJ.ph("bus_ticket", "wide")}
        <p class="caption">车票：2009.7.15 21:30 旧染坊后门 → 广州</p>
        ${HJ.ph("scissors", "wide")}
        <p class="caption">剪刀 · 刀柄缠发黑红绳</p>
        ${HJ.ph("sisters_photo", "wide")}
        <p class="caption">姐妹合影（可在铁盒调查中查看背面）</p>
      `);
    });
    $("#open-burned-note")?.addEventListener("click", () => {
      showPhoto("burned_note", "不要怪阿穗。是我让她走的。——绫");
    });
    $("#open-sisters-final")?.addEventListener("click", () => {
      showPhoto("sisters_final", "结已经解开了。");
    });
    $("#open-restart-file")?.addEventListener("click", confirmRestart);
  }

  function revealRestart() {
    $("#icon-restart")?.classList.remove("hidden");
    $("#taskbar-restart")?.classList.remove("hidden");
  }

  function confirmRestart() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <div class="ending-screen" style="min-height:auto;padding:28px 16px">
        <h2 style="font-size:24px">重新开始？</h2>
        <p style="opacity:.75;margin:12px 0 20px">将清除当前进度与聊天记录，从头进入游戏。通关后解锁的「章节重玩」不会被清掉。</p>
        <button type="button" class="btn-inline gold" id="reset-confirm">清除进度并重开</button>
        <button type="button" class="btn-inline ghost" id="reset-cancel" style="border-color:#c9a227;color:#c9a227">取消</button>
      </div>
    `);
    $("#reset-confirm")?.addEventListener("click", () => {
      stopSfx(activeFloodSfx, 0);
      activeFloodSfx = null;
      stopSfx(activeBellSfx, 0);
      activeBellSfx = null;
      stopRainFlood(0);
      stopBgm(200);
      localStorage.removeItem("huojie_save");
      location.reload();
    });
    $("#reset-cancel")?.addEventListener("click", closeModal);
  }

  const CLEAR_KEY = "huojie_cleared";

  function isGameCleared() {
    try { return localStorage.getItem(CLEAR_KEY) === "1"; } catch (_) { return false; }
  }

  function syncPhoneClearedUi() {
    document.documentElement.classList.toggle("is-game-cleared", isGameCleared());
  }

  function markGameCleared() {
    try { localStorage.setItem(CLEAR_KEY, "1"); } catch (_) {}
    syncPhoneClearedUi();
    revealChapterSelectIcon();
  }

  function revealChapterSelectIcon() {
    if (!isGameCleared()) return;
    $("#icon-chapters")?.classList.remove("hidden");
    $("#taskbar-chapters")?.classList.remove("hidden");
  }

  /** 各章干净起点快照：只含入口解锁，避免半截 gate 软锁 */
  const CHAPTER_STARTS = {
    ch1: {
      chapter: "ch1",
      page: "akui",
      chatTitle: "与梁穗聊天中",
      flags: {
        intro_chat: true, museum_link: true, has_cropped_clue: true, saw_cropped_clue: true,
        searched_rope: true, saw_full_photo: true, ask_namelist_chat: true, ask_namelist: true,
        namelist_loaded: true, clicked_akui: true, prologue_glitch: true, sui_ask_photo: true,
        gate_intro_hello: true, gate_intro_photo_sent: true, gate_intro_after_crop: true,
        gate_intro_town: true, gate_intro_museum: true, gate_namelist_hint: true, gate_namelist_ask: true,
      },
      note: "—— 已跳转到第一章开头 · 牵命人 ——",
    },
    ch2: {
      chapter: "ch2",
      page: "intro",
      chatTitle: "梁穗 · 离线",
      flags: {
        intro_chat: true, museum_link: true, has_cropped_clue: true, saw_cropped_clue: true,
        searched_rope: true, saw_full_photo: true, ask_namelist_chat: true, ask_namelist: true,
        namelist_loaded: true, clicked_akui: true, prologue_glitch: true, sui_ask_photo: true,
        gate_intro_hello: true, gate_intro_photo_sent: true, gate_intro_after_crop: true,
        saw_school: true, school_chat_done: true, saw_honor: true, saw_application: true,
        msg_app_back: true, ch1_horror: true, folder_ready: true, room_sent: true,
        ch2_intro: true, sui_looking_room: true,
      },
      note: "—— 已跳转到第二章开头 · 调查姐姐的房间 ——",
    },
    ch3: {
      chapter: "ch3",
      page: "intro",
      chatTitle: "与梁穗聊天中",
      flags: {
        intro_chat: true, museum_link: true, has_cropped_clue: true, saw_cropped_clue: true,
        searched_rope: true, saw_full_photo: true, ask_namelist: true, namelist_loaded: true,
        clicked_akui: true, folder_ready: true, room_sent: true, ch2_intro: true,
        sui_looking_room: true, box_open: true, msg_scissors: true, ch2_confirmed: true,
        scissors_guilt: true, ch2_group: true, ling_photos_done: true, saw_2147: true,
        saw_side_2009: true, saw_calendar: true, saw_desk: true, saw_sisters_back: true,
        puzzle_done: true, envelope_opened: true, ch2_done: true,
      },
      note: "—— 已跳转到第三章开头 · 未离开 ——",
    },
    ch4: {
      chapter: "ch4",
      page: "notice",
      chatTitle: "与梁穗聊天中",
      flags: {
        intro_chat: true, museum_link: true, has_cropped_clue: true, folder_ready: true,
        room_sent: true, clicked_akui: true, archive_ready: true, ch2_done: true,
        found_pool_door: true, told_plan: true, plan_ring_clicked: true, saw_materials: true,
        read_night: true, read_equip: true, timeline_done: true, ch3_truth: true,
        exposure_done: true, fake_riverside: true, riverside_ling_done: true,
        ch3_done: true, gate_ch3_to_notice: true,
      },
      note: "—— 已跳转到第四章开头 · 松手 ——",
    },
    epilogue: {
      chapter: "epilogue",
      page: "ending_home",
      chatTitle: "与梁穗聊天中",
      flags: {
        intro_chat: true, museum_link: true, has_cropped_clue: true, folder_ready: true,
        room_sent: true, clicked_akui: true, archive_ready: true, ch2_done: true,
        found_pool_door: true, told_plan: true, plan_ring_clicked: true, saw_materials: true,
        read_night: true, read_equip: true, timeline_done: true, ch3_truth: true,
        exposure_done: true, fake_riverside: true, riverside_ling_done: true,
        ch3_done: true, gate_ch3_to_notice: true,
        ch4_started: true, ch4_ritual_link: true,
        gate_ch4_offer: true, gate_ch4_note_shown: true, gate_ch4_after_read: true,
        gate_ch4_after_then: true, gate_ch4_after_photo: true, gate_ch4_ritual_scene: true,
        _replay_epilogue: true,
      },
      note: "—— 已跳转到尾声 ——",
    },
  };

  function openChapterSelect() {
    if (!isGameCleared()) {
      toast("通关尾声后，即可使用章节重玩。");
      return;
    }
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>章节重玩</h3>
      <p>从指定章节干净起点继续。将<strong>覆盖当前进度</strong>；不会清除「已通关」标记。</p>
      <div class="chapter-pick">
        <button type="button" class="btn-inline gold" data-jump="prologue">序章开头</button>
        <button type="button" class="btn-inline gold" data-jump="ch1">第一章开头 · 牵命人</button>
        <button type="button" class="btn-inline gold" data-jump="ch2">第二章开头 · 她让我走</button>
        <button type="button" class="btn-inline gold" data-jump="ch3">第三章开头 · 未离开</button>
        <button type="button" class="btn-inline gold" data-jump="ch4">第四章开头 · 松手</button>
        <button type="button" class="btn-inline gold" data-jump="epilogue">尾声</button>
      </div>
      <button type="button" class="btn-inline ghost" id="chapter-cancel" style="border-color:#c9a227;color:#c9a227">取消</button>
    `);
    $$("#modal-panel [data-jump]").forEach(b => {
      b.onclick = () => jumpToChapterStart(b.dataset.jump);
    });
    $("#chapter-cancel")?.addEventListener("click", closeModal);
  }

  function jumpToChapterStart(id) {
    stopSfx(activeFloodSfx, 0);
    activeFloodSfx = null;
    stopSfx(activeBellSfx, 0);
    activeBellSfx = null;
    stopRainFlood(0);
    stopBgm(120);

    if (id === "prologue") {
      localStorage.removeItem("huojie_save");
      location.reload();
      return;
    }
    const snap = CHAPTER_STARTS[id];
    if (!snap) return;

    state.chapter = snap.chapter;
    state.flags = Object.create(null);
    Object.assign(state.flags, snap.flags || {});
    state.page = snap.page || "intro";
    state.history = [];
    state.pendingChoice = null;
    state.archSection = "home";
    state.groupChat = false;
    state.members = ["玩家", "梁穗"];
    state.chatTitle = snap.chatTitle || "与梁穗聊天中";
    state.chatLog = snap.note
      ? [{ who: "sys", text: snap.note, cls: "sys" }]
      : [];
    save();
    location.reload();
  }

  /* 工业区登记档案窗口（栏目内容全在此窗口，不跳民俗馆） */
  function setArchivePath(path) {
    const el = $("#archive-path");
    if (el) el.textContent = path;
  }

  function goArchive(section) {
    const body = $("#archive-body");
    if (!body) return;
    state.archSection = section || "home";
    const found = flag("found_pool_door");

    if (section === "plans") {
      setArchivePath("/registry/dyehouse/plans");
      body.innerHTML = `
        <div class="archive-site">
          <h2>建筑平面图</h2>
          <p class="arch-sub">PLAN · 2009 / 2016 COMPARE</p>
          <p style="font-size:13px;color:#a8b898;line-height:1.7;margin:0 0 12px">绛水染厂平面对照：左为2009年原始图，右为2016年现状图。</p>
          ${HJ.ph("plan_compare", "plan-full" + (found ? " diff" : ""))}
          ${found ? `
            <p class="archive-caption warn">两边皆有「原料堆放区侧门」。<br>差异在原料区内：2009「三号地下染池检修门」→ 2016「废料储藏墙（木板封死）」。</p>
          ` : `
            <p class="archive-caption">两图布局大致相同。</p>
          `}
          ${!found ? `<button type="button" class="btn-inline" id="btn-compare">进入对比模式</button>` :
            (!flag("saw_materials")
              ? `<div class="archive-warn"><h3>发现异常</h3><p style="margin:0 0 10px">三号染池入口在2009年后被封闭。</p>
            <button type="button" class="btn-inline" id="btn-tell-sui">${flag("told_plan") ? "继续查看现场（铁门 / 文件箱）" : "把发现发给梁穗"}</button></div>`
              : `<div class="archive-warn"><h3>已记录</h3><p>三号染池入口在2009年后被封闭。文件箱可在桌面「文件箱」窗口回看。</p></div>`)}
          <p style="margin-top:16px"><button type="button" class="btn-inline ghost" data-arch="home">返回档案首页</button></p>
        </div>`;
    } else if (section === "night") {
      setArchivePath("/registry/dyehouse/night");
      flag("read_night", true);
      body.innerHTML = `
        <div class="archive-site">
          <h2>夜间值守登记 · 2009年7月15日</h2>
          <p class="arch-sub">NIGHT LOG · DUTY REGISTER</p>
          <div class="archive-panel">
            <table>
              <tr><th>时间</th><th>姓名</th><th>进入地点</th><th>离开时间</th></tr>
              <tr><td>21:47</td><td>梁绫</td><td>旧染坊侧门</td><td><button type="button" class="linkish hl" id="blank-leave">（空白）</button></td></tr>
              <tr><td>21:54</td><td>梁守义</td><td>旧染坊侧门</td><td>22:18</td></tr>
              <tr><td>21:55</td><td>梁守义随行人员两名</td><td>旧染坊侧门</td><td>22:18</td></tr>
            </table>
          </div>
          <p style="margin-top:16px"><button type="button" class="btn-inline ghost" data-arch="home">返回档案首页</button></p>
        </div>`;
    } else if (section === "equip") {
      setArchivePath("/registry/dyehouse/equip");
      flag("read_equip", true);
      body.innerHTML = `
        <div class="archive-site">
          <h2>设备检查记录</h2>
          <p class="arch-sub">EQUIP · MAINTENANCE LOG</p>
          <div class="old-note" style="margin-bottom:12px">三号牵引架长期受潮，禁止强行回收主绳。</div>
          <h3 style="color:#a8c080;font-size:15px;margin:0 0 10px">2009年7月15日临时事故记录</h3>
          <div class="form-sheet form-sheet-log">
            <div class="wiped-hex log-entry" aria-label="22:04 事故日志">
              <div class="wh-meta">[22:04] INCIDENT_LOG　facility=DYEHOUSE/POOL-3　status=OPEN</div>
              <pre class="wh-dump">主牵引绳突然收紧。三号染架向西侧倒塌。
地下染池检修出口被木架堵塞。暴雨导致河水沿排水口倒灌。</pre>
              <div class="wh-meta">tag=STRUCTURAL_COLLAPSE · DRAIN_BACKFLOW</div>
            </div>
            <div class="wiped-hex log-entry is-purged" aria-label="被强制抹除的日志行">
              <div class="wh-meta">[22:12] ENTRY_RETRACT opcode=0x07　operator=L.SY　CRC=FAIL</div>
              <pre class="wh-dump">0000  e7 8e b0 e5 9c ba e5 8f  af e8 83 bd e6 9c 89 e4  |................|
0010  ba ba e8 a2 ab e5 9b b0  e3 80 82 00 00 FF FF XX  |............????|
0020  2a 20 50 55 52 47 45 44  20 2a 20 2d 2d 2d 2d 2d  |* PURGED * -----|
*</pre>
              <div class="wh-hint">〈此行已被强制抹除〉</div>
            </div>
            <p class="caption">记录撤回时间：22:12　撤回人：梁守义</p>
          </div>
          ${flag("read_night") && flag("read_equip") && !flag("timeline_done") ?
            `<p style="margin-top:14px"><button type="button" class="btn-inline gold" id="btn-timeline">还原最后二十五分钟</button></p>` : ""}
          <p style="margin-top:16px"><button type="button" class="btn-inline ghost" data-arch="home">返回档案首页</button></p>
        </div>`;
    } else {
      setArchivePath("/registry/dyehouse");
      body.innerHTML = `
        <div class="archive-site">
          <h2>绛水镇工业区登记档案</h2>
          <p class="arch-sub">REGISTRY / DYEHOUSE · 梁穗转发</p>
          <p style="font-size:13px;color:#a8b898;line-height:1.7">旧染坊相关建筑、设备与值守记录。请选择栏目查阅。</p>
          <div class="archive-nav">
            <button type="button" data-arch="plans"><span>建筑平面图</span><span class="tag">PLAN</span></button>
            <button type="button" data-arch="equip"><span>设备检查记录</span><span class="tag">EQUIP</span></button>
            <button type="button" data-arch="night"><span>夜间值守登记</span><span class="tag">NIGHT LOG</span></button>
          </div>
          <div class="archive-stamp">保存于桌面 · 可重复打开</div>
        </div>`;
    }

    bindArchive(section);
    save();
  }

  function bindArchive(section) {
    const body = $("#archive-body");
    if (!body) return;
    body.querySelectorAll("[data-arch]").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.arch;
        const pageByArch = { home: "dyehouse_archive", plans: "plan_compare", equip: "equip_log", night: "night_log" };
        if (pageByArch[k]) go(pageByArch[k], false);
        else goArchive(k);
      };
    });
    if (section === "plans") {
      $("#btn-compare")?.addEventListener("click", () => {
        flag("found_pool_door", true);
        toast("发现异常：三号染池入口在2009年后被封闭。");
        go("plan_compare", false);
      });
      $("#btn-tell-sui")?.addEventListener("click", onTellPlan);
    }
    if (section === "night") {
      $("#blank-leave")?.addEventListener("click", () => {
        toast("未查询到梁绫离开旧染坊的记录。");
        flag("ling_no_leave", true);
      });
      if (flag("saw_materials") && !flag("timeline_done") && !flag("ch3_done")) {
        setTimeout(offerMaterialsNextStep, 500);
      }
    }
    if (section === "equip") {
      $("#btn-timeline")?.addEventListener("click", openTimelinePuzzle);
      if (flag("saw_materials") && !flag("timeline_done") && !flag("ch3_done")) {
        setTimeout(offerMaterialsNextStep, 500);
      }
    }
  }

  function openRoom() {
    playInvestigateBgm();
    roomSubReturn = false;
    const boxLocked = !flag("saw_calendar");
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>姐姐的房间</h3>
      <div class="room-view">
        ${HJ.ph("room_panorama", "wide fit-contain")}
        <button type="button" class="hotspot" style="left:47%;top:42%;width:36%;height:40%" data-hs="desk" aria-label="书桌"></button>
        <button type="button" class="hotspot" style="left:38%;top:1%;width:16%;height:31%" data-hs="cal" aria-label="旧日历"></button>
        <button type="button" class="hotspot ${boxLocked?"locked":""}" style="left:39%;top:76%;width:12%;height:18%" data-hs="box" aria-label="红色铁盒"></button>
      </div>
      <p class="caption">房间里有些东西可以动手翻看。</p>
    `);
    $$(".hotspot").forEach(h => h.onclick = () => {
      const k = h.dataset.hs;
      roomSubReturn = true;
      if (k === "desk") openDeskPuzzle();
      if (k === "cal") openCalendar();
      if (k === "box") {
        if (!flag("saw_calendar")) { toast("铁盒锁着，暂时打不开。"); return; }
        openBoxLock();
      }
    });
  }

  function openDeskPuzzle() {
    playInvestigateBgm();
    flag("saw_desk", true);
    if (flag("envelope_opened") || flag("puzzle_done")) {
      showAdmitFromEnvelope();
      return;
    }
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>书桌抽屉</h3>
      <p class="caption">抽屉深处有一只折好的牛皮纸袋，封口用浆糊粘死；旁边压着一本薄薄的日记本，翻开在七月那一页。</p>
      <div class="desk-finds">
        <div class="envelope-stage" id="envelope-stage">
          ${HJ.ph("admit_envelope", "wide")}
          <button type="button" class="envelope-seal" id="envelope-seal" title="拆开封口">
            <span class="seal-strip"></span>
            <span class="seal-hint">点这里拆开封口</span>
          </button>
        </div>
        <div class="diary-preview">
          ${HJ.ph("ling_diary_0715", "wide")}
          <button type="button" class="btn-inline ghost diary-read-btn" id="read-ling-diary">阅读日记</button>
        </div>
      </div>
      <p style="margin-top:12px"><button type="button" class="btn-inline" id="open-envelope-seal">拆开牛皮纸袋封口</button></p>
    `, roomModalOpts());
    const openSeal = () => openEnvelopeSeal();
    $("#envelope-seal")?.addEventListener("click", openSeal);
    $("#open-envelope-seal")?.addEventListener("click", openSeal);
    $("#read-ling-diary")?.addEventListener("click", showLingDiary);
  }

  async function openEnvelopeSeal() {
    if (flag("envelope_opening")) return;
    flag("envelope_opening", true);
    const seal = $("#envelope-seal");
    const btn = $("#open-envelope-seal");
    seal?.classList.add("tearing");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "封口撕开……";
    }
    await wait(700);
    flag("envelope_opened", true);
    flag("puzzle_done", true);
    delete state.flags.envelope_opening;
    save();
    showAdmitFromEnvelope(true);
  }

  function showLingDiary() {
    flag("saw_ling_diary", true);
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>梁绫的日记</h3>
      <p class="caption">2009年7月13日　天气：小雨</p>
      ${HJ.ph("ling_diary_0715", "wide fit-contain")}
      ${flag("envelope_opened") || flag("puzzle_done")
        ? `<p style="margin-top:12px"><button type="button" class="btn-inline ghost" id="back-to-admit">返回复印件</button></p>`
        : `<p style="margin-top:12px"><button type="button" class="btn-inline ghost" id="back-to-desk">返回抽屉</button></p>`}
    `, roomModalOpts());
    $("#back-to-admit")?.addEventListener("click", () => showAdmitFromEnvelope());
    $("#back-to-desk")?.addEventListener("click", () => openDeskPuzzle());
  }

  function showAdmitFromEnvelope(justOpened = false) {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>录取通知书 · 复印件</h3>
      <p class="caption">${justOpened
        ? "牛皮纸袋被拆开。里面不是原件，而是一份发灰的复印件，边缘有复印机的黑边。"
        : "牛皮纸袋里留下的录取通知书复印件。"}</p>
      ${HJ.ph("admit_front", "doc-full fit-contain")}
      <p style="margin-top:12px">
        <button type="button" class="btn-inline ghost" id="read-ling-diary-2">阅读旁边的日记</button>
      </p>
    `, roomModalOpts());
    $("#read-ling-diary-2")?.addEventListener("click", showLingDiary);
  }

  function openCalendar() {
    playInvestigateBgm();
    flag("saw_calendar", true);
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>2009年旧日历</h3>
      ${HJ.ph("calendar_0715", "wide")}
      <div class="kv"><b>20:00</b>　固命礼<br><b>21:30</b>　末班车</div>
    `, roomModalOpts());
    if (!flag("msg_cal")) {
      flag("msg_cal", true);
      chatMsg("梁穗", "那天晚上九点半，确实有一班离开绛水镇的车。旧染坊后门就是它离镇前的最后一站。");
    }
  }

  function openBoxLock() {
    if (flag("box_open")) {
      openBoxContents();
      return;
    }
    playInvestigateBgm();
    const digits = [0, 0, 0, 0];
    const TARGET = "0715";
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <div class="combo-lock">
        <h3>红色铁盒</h3>
        <p class="combo-hint">四位转轮锁 · 拨到正确数字才会打开</p>
        <div class="combo-plate" aria-label="四位数字转轮密码锁">
          <div class="combo-rivets" aria-hidden="true"></div>
          <div class="combo-wheels" id="combo-wheels">
            ${[0, 1, 2, 3].map((i) => `
              <div class="combo-col" data-i="${i}">
                <button type="button" class="combo-tick up" data-dir="1" aria-label="上拨">▴</button>
                <div class="combo-window">
                  <div class="combo-strip" id="combo-strip-${i}">
                    ${[0,1,2,3,4,5,6,7,8,9].map((n) => `<span>${n}</span>`).join("")}
                  </div>
                </div>
                <button type="button" class="combo-tick down" data-dir="-1" aria-label="下拨">▾</button>
              </div>
            `).join("")}
          </div>
          <div class="combo-latch" id="combo-latch" aria-hidden="true">锁扣</div>
        </div>
        <p class="caption combo-cap">上下拨动滚轮。到位即开，无需确认。</p>
      </div>
    `, { ...roomModalOpts(), panelClass: "combo-lock-panel" });

    const syncStrip = (i) => {
      const strip = $(`#combo-strip-${i}`);
      if (strip) strip.style.transform = `translateY(-${digits[i] * 10}%)`;
    };
    [0, 1, 2, 3].forEach(syncStrip);

    let opening = false;
    const tryUnlock = () => {
      if (opening) return;
      if (digits.map(String).join("") !== TARGET) return;
      opening = true;
      const latch = $("#combo-latch");
      latch?.classList.add("open");
      $("#combo-wheels")?.classList.add("unlocked");
      toast("咔哒——锁开了。");
      flag("box_open", true);
      save();
      setTimeout(() => openBoxContents(), 700);
    };

    $$(".combo-col").forEach((col) => {
      const i = Number(col.dataset.i);
      col.querySelectorAll(".combo-tick").forEach((btn) => {
        btn.onclick = () => {
          if (opening) return;
          const dir = Number(btn.dataset.dir);
          digits[i] = (digits[i] + dir + 10) % 10;
          syncStrip(i);
          playSfx("lock_tick");
          col.classList.remove("tick");
          void col.offsetWidth;
          col.classList.add("tick");
          tryUnlock();
        };
      });
      const win = col.querySelector(".combo-window");
      if (win) {
        win.onwheel = (e) => {
          e.preventDefault();
          if (opening) return;
          digits[i] = (digits[i] + (e.deltaY > 0 ? 1 : -1) + 10) % 10;
          syncStrip(i);
          playSfx("lock_tick");
          tryUnlock();
        };
      }
    });
  }

  function openBoxContents() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>铁盒里的三样东西</h3>
      <div class="card-block" style="margin-bottom:10px">
        <h4>长途汽车票</h4>
        ${HJ.ph("bus_ticket", "wide box-kit-ph")}
        <p>2009年7月15日 21:30　旧染坊后门 → 广州（大学城方向）</p>
      </div>
      <div class="card-block" style="margin-bottom:10px">
        <h4>剪刀</h4>
        ${HJ.ph("scissors", "wide clickable box-kit-ph")}
        <button type="button" class="btn-inline" id="click-scissors">查看剪刀</button>
      </div>
      <div class="card-block">
        <h4>姐妹旧照片</h4>
        <div id="sisters-photo-stage" class="photo-flip-stage wide-flip" role="button" tabindex="0" title="点击翻转">
          <div class="photo-flip-face is-front">${HJ.ph("sisters_photo", "wide")}</div>
          <div class="photo-flip-face is-back" aria-hidden="true">${HJ.ph("sisters_photo_back", "wide")}</div>
        </div>
        <p class="caption" id="sisters-photo-cap">点击照片查看背面</p>
        <div class="btn-row sisters-photo-btns">
          <button type="button" class="btn-inline" id="flip-sisters-photo">查看背面</button>
          <button type="button" class="btn-inline gold" id="ch2-confirm">整理结论</button>
        </div>
      </div>
    `, roomModalOpts());
    let sistersBack = false;
    const backSrc = HJ.ASSETS && HJ.ASSETS.sisters_photo_back;
    if (backSrc) { const pre = new Image(); pre.src = backSrc; }
    const flipSisters = () => {
      sistersBack = !sistersBack;
      const stage = $("#sisters-photo-stage");
      const cap = $("#sisters-photo-cap");
      const btn = $("#flip-sisters-photo");
      if (!stage) return;
      stage.classList.toggle("is-back", sistersBack);
      const backFace = stage.querySelector(".is-back");
      if (backFace) backFace.setAttribute("aria-hidden", sistersBack ? "false" : "true");
      if (cap) cap.textContent = sistersBack
        ? "背面字迹（再点可翻回正面）"
        : "点击照片查看背面";
      if (btn) btn.textContent = sistersBack ? "翻回正面" : "查看背面";
      if (sistersBack) flag("saw_sisters_back", true);
    };
    $("#sisters-photo-stage")?.addEventListener("click", flipSisters);
    $("#flip-sisters-photo")?.addEventListener("click", flipSisters);
    $("#click-scissors")?.addEventListener("click", onScissors);
    $("#ch2-confirm")?.addEventListener("click", onCh2Confirm);
  }

  async function onScissors() {
    if (flag("msg_scissors")) {
      if (flag("ch2_confirmed") && !flag("scissors_guilt") && !flag("ch2_group") && !flag("ch2_done")) {
        await afterConfirmedLeave();
      }
      return;
    }
    flag("msg_scissors", true);
    openWin("chat");
    await sequence([
      { type: "msg", who: "梁穗", text: "这就是姐姐当年给我的剪刀，她让我剪断伴命绳的。" },
    ]);
    if (flag("ch2_confirmed") && !flag("scissors_guilt") && !flag("ch2_group")) {
      await afterConfirmedLeave();
    } else {
      toast("答对铁盒结论后，对话会继续。");
    }
  }

  function onCh2Confirm() {
    if (flag("ch2_confirmed")) {
      if (flag("msg_scissors") && !flag("scissors_guilt") && !flag("ch2_group") && !flag("ch2_done")) {
        afterConfirmedLeave();
      } else {
        toast("已确认过：梁绫主动送梁穗离开。");
      }
      return;
    }
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>梁穗当年为什么离开绛水镇？</h3>
      <div class="choice-q">
        <button type="button" data-w>她嫌弃需要照顾的姐姐。</button>
        <button type="button" data-r>她在姐姐的帮助下逃离固命礼。</button>
        <button type="button" data-w>她不知道姐姐当晚会参加仪式。</button>
      </div>
    `, { ...roomModalOpts(), panelClass: "choice-quiz-panel" });
    $$("[data-w]").forEach(b => b.onclick = () => toast("再看看车票、剪刀、照片背面，还有书桌里的日记。"));
    $("[data-r]").onclick = () => {
      flag("ch2_confirmed", true);
      toast("已确认：梁绫主动送梁穗离开。");
      roomSubReturn = false;
      closeModal();
      if (!flag("msg_scissors")) {
        chatMsg("sys", "还可以再查看铁盒里的剪刀。");
        return;
      }
      afterConfirmedLeave();
    };
  }

  /** 答对「主动送走」之后：妹妹自我怀疑 → 玩家安慰 → 梁绫进群 */
  async function afterConfirmedLeave() {
    if (flag("scissors_guilt") || flag("ch2_group") || flag("ch2_done")) return;
    if (!flag("ch2_confirmed") || !flag("msg_scissors")) return;
    if (afterConfirmedLeave._busy) return;
    afterConfirmedLeave._busy = true;
    try {
      flag("scissors_guilt", true);
      openWin("chat");
      await sequence([
        { type: "msg", who: "梁穗", text: "姐姐坚强、勇敢又有主见。她让我离开以后，明明说了有更重要的事，又怎么会投河呢。" },
        { type: "msg", who: "梁穗", text: "我是不是当时就不应该离开？是不是留下，姐姐就不会出事？我是不是真的抛下了姐姐，我是罪人吗？" },
      ]);
      chatChoices([
        {
          text: "是你姐姐让你走的。",
          onSelect: () => ch2Horror()
        },
        {
          text: "她不希望你留下。",
          onSelect: () => ch2Horror()
        },
      ], "scissors:comfort");
    } finally {
      afterConfirmedLeave._busy = false;
    }
  }

  async function ch2Horror() {
    clearChoices();
    flicker();
    setGroup(true);
    showEye(true);
    const eye = $("#chat-eye");
    const move = (e) => {
      const r = $("#win-chat").getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      eye.style.setProperty("--ex", x + "%");
      eye.style.setProperty("--ey", y + "%");
    };
    window.addEventListener("mousemove", move);
    ch2Horror._move = move;
    await sequence([
      { type: "msg", who: "梁穗", text: "怎么变成群聊了？你把谁拉进来了？" },
      { type: "msg", who: "梁穗", text: "第三个名字是谁？为什么我看不清？" },
      { type: "msg", who: "sys", text: "点击群成员「梁绫」查看资料。", cls: "sys" },
    ]);
    flag("ch2_group", true);
  }

  async function lingLeavesCh2() {
    chatMsg("梁绫", "我送她走了。", "ling");
    await wait(1000);
    const msgs = $$("#chat-body .msg.ling");
    msgs.forEach(m => m.classList.add("fade-text"));
    await wait(1000);
    msgs.forEach(m => m.remove());
    setGroup(false);
    showEye(false);
    if (ch2Horror._move) window.removeEventListener("mousemove", ch2Horror._move);
    await sequence([
      { type: "msg", who: "梁穗", text: "刚才发生了什么？" },
      500,
      { type: "msg", who: "玩家", text: "……你姐姐加入了群聊。她留下了两张当晚的照片。", cls: "player" },
      400,
      { type: "msg", who: "sys", text: "梁穗正在输入……她的心情似乎久久不能平复。", cls: "sys", delay: 2800 },
      { type: "typing", ms: 3200 },
      { type: "msg", who: "梁穗", text: "姐姐……是姐姐来了吗……" },
      900,
      { type: "msg", who: "梁穗", text: "我知道了。是姐姐。" },
      { type: "msg", who: "梁穗", text: "她一直在陪着我。直到现在，还在帮我、帮大家把事情的真相查清楚……" },
      800,
    ]);
    await ch2End();
  }

  async function ch2End() {
    await sequence([
      { type: "msg", who: "梁穗", text: "我想，我要去染坊看看。等我到了，我会给你发消息。" },
      { type: "msg", who: "sys", text: "梁穗正在前往旧染坊", cls: "sys" },
    ]);
    setChatTitle("梁穗 · 正在前往旧染坊");
    setChapter("ch3");
    flag("ch2_done", true);
    chatMsg("sys", "—— 第二章结束 · 第三章：未离开 ——");
    setTimeout(ch3Arrive, 7200);
  }

  /* ---------- Chapter 3 ---------- */
  async function ch3Arrive() {
    if (flag("ch3_done") || ch3Arrive._busy) return;
    ch3Arrive._busy = true;
    try {
      if (!flag("ch3_arrived_run")) {
        flag("ch3_arrived_run", true);
        flag("ch3_arrived", true);
        setChatTitle("与梁穗聊天中");
        openWin("chat");
        await sequence([
          1200,
          { type: "msg", who: "梁穗", text: "我到了。" },
          { type: "msg", who: "梁穗", text: "大门已经锁死了。原料堆放区那边有扇侧门，是虚掩着的。" },
          { type: "msg", who: "梁穗", text: "我拍了张给你看。" },
        ]);
        if (!state.chatLog.some(m => m.type === "img" && m.imgKey === "dyehouse_side")) {
          chatImg("梁穗", "dyehouse_side", "");
        }
        await wait(400);
        toast("点开照片看一看。");
      } else if (!flag("saw_dyehouse_side") &&
                 !state.chatLog.some(m => m.type === "img" && m.imgKey === "dyehouse_side")) {
        // 旧存档曾直接弹窗：补发进聊天
        chatImg("梁穗", "dyehouse_side", "");
        toast("点开照片看一看。");
      }
      await waitDyehouseSideViewed();
      if (!flag("gate_ch3_side_photo")) {
        openWin("chat");
        await sequence([
          { type: "msg", who: "梁穗", text: "你看现在这张。跟姐姐当晚那张侧门照，是同一扇门——只是角度不同，她那张更旧。" },
        ]);
        flag("gate_ch3_side_photo", true);
      }
      openWin("chat");
      await waitChoice("……这么多年了，好像一切都没有变", "ch3_unchanged");
      if (!flag("gate_ch3_side_done")) {
        await sequence([
          { type: "msg", who: "梁穗", text: "你帮我找一下染坊以前的平面图，好吗？我这边信号不太好。" },
        ]);
        flag("gate_ch3_side_done", true);
        revealArchiveIcon();
      } else if (flag("archive_ready")) {
        revealArchiveIcon();
      }
      await ch3ArriveResume();
    } finally {
      ch3Arrive._busy = false;
    }
  }

  async function ch3ArriveResume() {
    if (flag("ch3_done") || flag("gate_ch3_recv")) {
      if (flag("gate_ch3_recv") && !flag("ch3_done")) {
        revealArchiveIcon();
      }
      return;
    }
    if (!flag("gate_ch3_side_done")) {
      // 侧门对照后尚未走完，回到完整到达流程
      await ch3Arrive();
      return;
    }
    openWin("chat");
    await waitChoice("收到，我去工业登记档案那儿找找线索。", "ch3_recv");
    revealArchiveIcon();
  }

  async function onTellPlan() {
    // 已看完文件箱则不再重开；否则允许关图/刷新后续跑
    if (flag("saw_materials")) return;
    if (onTellPlan._busy) return;
    onTellPlan._busy = true;
    try {
      openWin("chat");
      if (!flag("told_plan")) {
        flag("told_plan", true);
        await sequence([
          { type: "msg", who: "梁穗", text: "我面前就是那面墙。墙上的木板看起来是后来钉上去的。" },
          { type: "msg", who: "梁穗", text: "地面有一道旧绳槽，一直通到木板底下……" },
        ]);
        if (!state.chatLog.some(m => m.type === "img" && m.imgKey === "wall_ring")) {
          chatImg("梁穗", "wall_ring", "");
        }
        await wait(400);
        toast("点开照片看一看。");
      } else if (!flag("plan_ring_clicked") &&
                 !state.chatLog.some(m => m.type === "img" && m.imgKey === "wall_ring")) {
        // 旧存档曾直接弹窗：补发进聊天
        chatImg("梁穗", "wall_ring", "");
        toast("点开照片看一看。");
      }
      if (!flag("plan_ring_clicked")) {
        // 等玩家从聊天点开墙面近照并放大铁环
        return;
      }
      if (!flag("gate_plan_board_msg")) {
        showPlanRingCloseup();
        return;
      }
      // 铁门照已在聊天里，等玩家自己点开
      if (!flag("saw_materials")) {
        if (!state.chatLog.some(m => m.type === "img" && m.imgKey === "pool3_door")) {
          chatImg("梁穗", "pool3_door", "");
          toast("点开照片看一看。");
        }
        return;
      }
    } finally {
      onTellPlan._busy = false;
    }
  }

  function openWallRingFromChat() {
    if (!flag("plan_ring_clicked")) showPlanWallModal();
    else if (!flag("gate_plan_board_msg")) showPlanRingCloseup();
    else showPhoto("wall_ring", "废料储藏墙近照", "wide");
  }

  function openPool3DoorFromChat() {
    if (!flag("gate_plan_board_msg")) {
      toast("请先从墙面近照看清铁环。");
      return;
    }
    showPlanDoorModal();
  }

  function showPlanWallModal() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>墙面近照</h3>
      ${HJ.ph("wall_ring", "wide clickable")}
      <p class="caption">地面有一道旧绳槽，一直通向这块后来钉上的木板。</p>
      <p class="caption">木板下方挂着一只生锈铁环，环上似乎还缠着绳子。</p>
      <p class="caption">放大铁环，才能看清绳子究竟去了哪里。</p>
      <button type="button" class="btn-inline" id="click-ring">放大铁环 · 看绳子去向</button>
    `);
    const goRing = async () => {
      if (!flag("plan_ring_clicked")) flag("plan_ring_clicked", true);
      showPlanRingCloseup();
    };
    $("#click-ring")?.addEventListener("click", goRing);
  }

  /** 铁环特写：点明「绳钻进墙」后再进铁门 */
  function showPlanRingCloseup() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>铁环特写</h3>
      ${HJ.ph("wall_ring", "wide")}
      <p class="caption">近看：铁环上缠着一截发黑的红绳。</p>
      <p class="caption"><b>绳子好像钻进了墙里面</b>——末端没有散在外面，而是从木板缝隙伸入。</p>
      <p class="caption">绳从绳槽来，经铁环进墙缝：墙后面应当还有通路。</p>
      <button type="button" class="btn-inline" id="btn-after-ring">拆开木板 · 看墙后是什么</button>
    `);
    $("#btn-after-ring")?.addEventListener("click", async () => {
      closeModal();
      if (!flag("gate_plan_board_msg")) {
        openWin("chat");
        await sequence([
          { type: "msg", who: "梁穗", text: "绳子果然钻进去了……我把外面的木板拆开。" },
          { type: "msg", who: "梁穗", text: "后面真的有一扇铁门。红绳那一侧，就是通往这里的。" },
        ]);
        flag("gate_plan_board_msg", true);
      }
      if (!state.chatLog.some(m => m.type === "img" && m.imgKey === "pool3_door")) {
        chatImg("梁穗", "pool3_door", "");
      }
      await wait(400);
      toast("点开照片看一看。");
    });
  }

  function showPlanDoorModal() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>三号染池铁门</h3>
      <div class="room-view">
        ${HJ.ph("pool3_door", "wide fit-contain")}
        <button type="button" class="hotspot" style="left:22%;top:8%;width:48%;height:62%" data-hs="door" aria-label="三号染池铁门"></button>
        <button type="button" class="hotspot" style="left:68%;top:58%;width:28%;height:36%" data-hs="files" aria-label="生锈文件箱"></button>
      </div>
      <p class="caption">木板拆开后，是锈死的铁门。牌子上写着：三号染池　非工作人员禁止进入。</p>
      <p class="caption">顺着刚才那截钻进墙缝的红绳方向，便通到了这里。</p>
    `);
    const doorEggs = [
      "前面的区域，以后再来探索吧~",
      "阿穗一个人把那些木板都拆掉了吗……当真是恐怖如斯……",
    ];
    $$("#modal-panel .hotspot").forEach(h => h.onclick = async () => {
      const k = h.dataset.hs;
      if (k === "door") {
        toast(doorEggs[Math.floor(Math.random() * doorEggs.length)]);
        return;
      }
      if (k !== "files") return;
      closeModal();
      if (!flag("saw_materials")) {
        flag("saw_materials", true);
        revealFolder();
        revealFileBoxIcon();
        save();
        openFileBox();
        await sequence([
          { type: "msg", who: "sys", text: "请继续查阅「夜间值守登记」与「设备检查记录」。", cls: "sys" },
        ]);
        toast("桌面解锁「文件箱」；亦可从调查资料回看");
      } else {
        openFileBox();
      }
      offerMaterialsNextStep();
    });
  }

  /** 文件箱之后：聊天给可点的下一步，避免卡在信封页不知道怎么走 */
  function offerMaterialsNextStep() {
    if (flag("timeline_done") || flag("ch3_done")) return;
    if (!flag("saw_materials")) return;
    openWin("chat");
    if (!flag("read_night") || !flag("read_equip")) {
      const opts = [];
      if (!flag("read_night")) {
        opts.push({
          text: "打开夜间值守登记",
          onSelect: () => go("night_log")
        });
      }
      if (!flag("read_equip")) {
        opts.push({
          text: "打开设备检查记录",
          onSelect: () => go("equip_log")
        });
      }
      if (opts.length) chatChoices(opts, "materials:next");
      return;
    }
    chatChoices([{
      text: "还原最后二十五分钟",
      onSelect: () => openTimelinePuzzle()
    }], "materials:timeline");
  }

  function openTimelinePuzzle() {
    // 时间槽排对即通过，进入结论对话
    playInvestigateBgm();
    const slots = [
      { t: "21:47", need: "ling_enter" },
      { t: "21:54", need: "shouyi_enter" },
      { t: "22:04", need: "collapse" },
      { t: "22:12", need: "withdraw" },
    ];
    const events = [
      { id: "ling_enter", text: "梁绫经侧门来到旧染坊" },
      { id: "shouyi_enter", text: "梁守义带两名随行人员进入染坊。" },
      { id: "collapse", text: "主牵引绳收紧，三号染架倒塌；检修口被堵。" },
      { id: "withdraw", text: "梁守义撤回******" },
      { id: "decoy_river", text: "梁绫离开染坊，独自前往河边。" },
      { id: "decoy_leave", text: "梁守义等人于倒塌前已全部撤离。" },
    ].sort(() => Math.random() - 0.5);

    const placed = Object.create(null); // t -> eventId
    let selectedEvent = null;

    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>还原最后二十五分钟</h3>
      <p class="caption">对照值守登记与事故记录：将下方<strong>事件卡片</strong>点选后，填入左侧对应<strong>时间槽</strong>。</p>
      <div class="timeline-board" id="tl-board">
        <div class="timeline-rail" id="tl-slots"></div>
        <div class="timeline-pool" id="tl-pool"></div>
      </div>
      <div class="timeline-actions">
        <button type="button" class="btn-inline ghost" id="tl-reset">清空重排</button>
        <button type="button" class="btn-inline gold" id="tl-check">串起线索</button>
      </div>
    `, { panelClass: "timeline-puzzle-panel" });

    const slotsEl = $("#tl-slots");
    const poolEl = $("#tl-pool");

    function renderSlots() {
      slotsEl.innerHTML = slots.map((s, i) => {
        const ev = events.find(e => e.id === placed[s.t]);
        return `
          <div class="tl-slot ${ev ? "filled" : ""} ${selectedEvent ? "pickable" : ""}" data-time="${s.t}">
            <div class="tl-slot-meta">
              <span class="tl-slot-time">${s.t}</span>
            </div>
            <div class="tl-slot-body">${ev ? escapeHtml(ev.text) : "（空 · 点选事件后点此填入）"}</div>
            ${i < slots.length - 1 ? `<div class="tl-rope" aria-hidden="true"></div>` : ""}
          </div>`;
      }).join("");
      slotsEl.querySelectorAll(".tl-slot").forEach(el => {
        el.onclick = () => {
          const t = el.dataset.time;
          if (placed[t] && !selectedEvent) {
            // 取回
            delete placed[t];
            selectedEvent = null;
            renderAll();
            return;
          }
          if (!selectedEvent) {
            toast("请先点选下方一张事件卡。");
            return;
          }
          // 若该事件已在别的槽，先清掉
          Object.keys(placed).forEach(k => {
            if (placed[k] === selectedEvent) delete placed[k];
          });
          placed[t] = selectedEvent;
          selectedEvent = null;
          renderAll();
        };
      });
    }

    function renderPool() {
      const used = new Set(Object.values(placed));
      poolEl.innerHTML = events.map(e => {
        const gone = used.has(e.id);
        const on = selectedEvent === e.id;
        return `<button type="button" class="tl-event ${gone ? "used" : ""} ${on ? "on" : ""}" data-id="${e.id}" ${gone ? "disabled" : ""}>
          ${escapeHtml(e.text)}
        </button>`;
      }).join("");
      poolEl.querySelectorAll(".tl-event:not([disabled])").forEach(b => {
        b.onclick = () => {
          selectedEvent = b.dataset.id === selectedEvent ? null : b.dataset.id;
          renderAll();
        };
      });
    }

    function renderAll() {
      renderSlots();
      renderPool();
    }
    renderAll();

    $("#tl-reset").onclick = () => {
      Object.keys(placed).forEach(k => delete placed[k]);
      selectedEvent = null;
      renderAll();
    };

    $("#tl-check").onclick = () => {
      const ok = slots.every(s => placed[s.t] === s.need);
      if (!ok) {
        toast("时间与事件尚未对齐。再对照档案试试。");
        slotsEl.classList.add("tl-shake");
        setTimeout(() => slotsEl.classList.remove("tl-shake"), 450);
        return;
      }
      slotsEl.classList.add("linked");
      setTimeout(() => finishTimelinePuzzle(), 600);
    };
  }

  async function finishTimelinePuzzle() {
    if (flag("timeline_done") && flag("ch3_truth")) {
      if (!flag("exposure_done")) {
        openWin("chat");
        chatChoices([{
          text: "打开三号染池照片并修复曝光",
          onSelect: () => openExposure()
        }], "expose:open");
      }
      return;
    }
    flag("timeline_done", true);
    save();
    closeModal();
    openWin("chat");
    await sequence([
      { type: "msg", who: "sys", text: "结论：梁守义在梁绫之后进入染坊。", cls: "sys" },
      { type: "msg", who: "sys", text: "染架倒塌时，他仍在现场。", cls: "sys" },
      { type: "msg", who: "sys", text: "他知道三号染池可能有人被困，却撤回了事故记录。", cls: "sys" },
      600,
      { type: "msg", who: "梁穗", text: "铁门能打开。里面全是倒下来的木架。" },
      { type: "typing", ms: 2800 },
      { type: "msg", who: "梁穗", text: "我找到姐姐了。" },
      800,
      { type: "msg", who: "梁穗", text: "她在三号染池下面。木架堵住了出口。她手腕上还戴着爸爸以前送她的银镯。" },
      { type: "msg", who: "sys", text: "请修复三号染池现场照片的曝光。", cls: "sys" },
    ]);
    flag("ch3_truth", true);
    flag("fake_riverside", true);
    toast("已确认：梁绫死在三号染池。请修复现场照片曝光。");
    revealFolder();
    chatChoices([{
      text: "打开三号染池照片并修复曝光",
      onSelect: () => openExposure()
    }], "expose:open");
    setTimeout(() => {
      if (!flag("exposure_done") && !$("#exp-stage")) openExposure();
    }, 600);
  }

  function openExposure() {
    if (flag("exposure_done")) return;
    // 已在看曝光弹窗：只续进度，不要整窗重建（否则会像「又弹了个小窗」）
    const modalOpen = $("#modal") && !$("#modal").classList.contains("hidden");
    const live = $("#exp-stage") && $("#exp-btn");
    if (modalOpen && live) {
      const step = Math.max(1, Math.min(3, Number(state.flags.exposure_step) || 1));
      applyExposure(step);
      return;
    }
    clearChoices();
    const resumeAt = Number(state.flags.exposure_step) || 0;
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>三号染池现场照片</h3>
      <div class="exposure-stage photo-stage" id="exp-stage">
        ${HJ.ph("dye_pool_dark", "wide")}
      </div>
      <p class="caption" id="exp-cap">光线很暗，只能看见倒塌的木架和发黑的染池水面。</p>
      <button type="button" class="btn-inline gold" id="exp-btn">修复照片曝光</button>
    `);
    const bindNext = (n) => {
      const btn = $("#exp-btn");
      if (!btn) return;
      btn.onclick = (e) => {
        e?.stopPropagation?.();
        applyExposure(n);
      };
    };
    bindNext(1);
    if (resumeAt >= 1 && !flag("dye_horror_done")) {
      applyExposure(Math.min(3, Math.max(1, resumeAt)));
    } else {
      state.flags.exposure_step = 0;
      save();
    }
  }

  function setExposureImage(key) {
    const stage = $("#exp-stage");
    if (!stage) return;
    const src = HJ.ASSETS[key];
    const img = stage.querySelector("img");
    if (src && img) {
      img.src = src;
      img.alt = HJ.IMAGES[key] || key;
      return;
    }
    stage.innerHTML = HJ.ph(key, "wide");
  }

  function applyExposure(level) {
    state.exposure = level;
    state.flags.exposure_step = level;
    save();
    const stage = $("#exp-stage");
    const cap = $("#exp-cap");
    const btn = $("#exp-btn");
    if (!stage || !cap || !btn) {
      toast("照片窗口已关闭，请从调查资料打开「三号染池_待修复.jpg」");
      return;
    }

    if (level === 1) {
      setExposureImage("dye_pool_lv1");
      cap.textContent = "调亮之后——倒塌木架下方，隐约多出一截发黑的红绳。";
      btn.textContent = "继续调亮";
      btn.classList.remove("hidden");
      btn.onclick = (e) => {
        e?.stopPropagation?.();
        applyExposure(2);
      };
      return;
    }

    if (level === 2) {
      setExposureImage("dye_pool_lv2");
      cap.textContent = "";
      btn.textContent = "继续调亮";
      btn.classList.remove("hidden");
      btn.onclick = (e) => {
        e?.stopPropagation?.();
        applyExposure(3);
      };
      return;
    }

    if (level >= 3) {
      btn.classList.add("hidden");
      dyePoolHorrorClimax();
    }
  }

  const DYE_FLOOD_WORDS = [
    "你的责任", "不得逃避", "一绳一牵", "永远留下", "终身陪伴",
    "不该这样", "爱是尊重", "不是枷锁", "不该束缚", "你要好好的",
    "不是她的错", "都够了", "结束一切", "就在今天", "帮帮我",
    "救救小葵", "村子", "罪有应得",
    "留下", "牵住", "固命", "陪到底", "别松手",
    "回来", "为什么", "阿穗", "姐姐", "银镯",
    "不是投河", "是染池", "他看见了", "撤回", "空白",
    "剪不断", "活结", "死结", "跟我走", "别走",
    "责任在你", "命绳", "过绳节", "梁守义", "三号染池",
  ];

  /** 陡变铜铃：整段循环垫在红字下，结束再淡出 */
  function playClimaxBell() {
    stopSfx(activeBellSfx, 120);
    activeBellSfx = playSfx("bell_3", { volume: 0.22, loop: true });
    return activeBellSfx;
  }

  async function dyePoolHorrorClimax() {
    if (flag("dye_horror_done")) return;
    flag("dye_horror_done", true);
    const stage = $("#exp-stage");
    const cap = $("#exp-cap");
    if (!stage) return;

    flicker();
    playClimaxBell();
    stage.innerHTML = HJ.ph("dye_pool_lv3", "wide");
    if (cap) cap.textContent = "画面陡变——那只手扣住了池沿……";
    await wait(1400);

    await runDyeTextFlood();
    stopSfx(activeBellSfx, 900);
    activeBellSfx = null;

    // 黑屏后回到 31
    const bo = ensureBlackout();
    bo.classList.add("on");
    await wait(900);
    if (stage) {
      stage.innerHTML = HJ.ph("dye_pool_dark", "wide");
    }
    if (cap) cap.textContent = "照片又变回了最初那张暗照。倒塌的木架，发黑的染池……像什么都没发生过。";
    const btn = $("#exp-btn");
    if (btn) btn.classList.add("hidden");
    bo.classList.remove("on");
    await wait(700);

    // 聊天提示音 + 群聊，梁绫只上传河边图（不再弹出「私人聊天已变为群聊」系统提示）
    beep("梁绫");
    openWin("chat");
    setGroup(true);
    setChatTitle("活结（3）");
    await wait(800);
    chatImg("梁绫", "riverside_fake", "河边_2009年7月16日.jpg", "ling");
    chatMsg("sys", "梁绫上传了一张图片。点击查看。", "sys");
    toast("点击聊天中的图片查看。");
  }

  async function runDyeTextFlood() {
    let el = $("#dye-text-flood");
    if (!el) {
      el = document.createElement("div");
      el.id = "dye-text-flood";
      el.className = "dye-text-flood";
      document.body.appendChild(el);
    }
    el.innerHTML = "";
    el.classList.add("on");
    if (bgmAudio && currentBgm === "horror") fadeAudio(bgmAudio, 0.1, 400);
    // 红字刷屏：不要额外 glitch／刷屏 SFX，只压低 BGM
    stopSfx(activeFloodSfx, 0);
    activeFloodSfx = null;
    const total = DYE_FLOOD_WORDS.length * 7; // 更密、铺满更久
    for (let i = 0; i < total; i++) {
      const span = document.createElement("span");
      span.className = "dye-flood-word";
      span.textContent = DYE_FLOOD_WORDS[i % DYE_FLOOD_WORDS.length];
      span.style.left = `${2 + Math.random() * 92}%`;
      span.style.top = `${2 + Math.random() * 92}%`;
      span.style.fontSize = `${12 + Math.floor(Math.random() * 30)}px`;
      span.style.transform = `rotate(${(Math.random() - 0.5) * 20}deg)`;
      // 同帧多刷一两个，铺更满
      el.appendChild(span);
      if (i % 3 === 0) {
        const extra = document.createElement("span");
        extra.className = "dye-flood-word";
        extra.textContent = DYE_FLOOD_WORDS[(i + 5) % DYE_FLOOD_WORDS.length];
        extra.style.left = `${2 + Math.random() * 92}%`;
        extra.style.top = `${2 + Math.random() * 92}%`;
        extra.style.fontSize = `${11 + Math.floor(Math.random() * 22)}px`;
        extra.style.transform = `rotate(${(Math.random() - 0.5) * 24}deg)`;
        el.appendChild(extra);
      }
      await wait(42);
    }
    await wait(1100);
    if (bgmAudio && currentBgm === "horror") fadeAudio(bgmAudio, BGM_TRACKS.horror.vol, 800);
    el.classList.remove("on");
    el.innerHTML = "";
  }

  async function showFakeRiverside() {
    if (flag("saw_riverside_ling")) {
      showPhoto("riverside_fake", "河边_2009年7月16日.jpg");
      return;
    }
    flag("saw_riverside_ling", true);
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>河边_2009年7月16日.jpg</h3>
      ${HJ.ph("riverside_fake", "wide")}
    `, {
      onClose: () => afterRiversideFromLing()
    });
  }

  async function afterRiversideFromLing() {
    if (flag("ch3_done") && flag("gate_ch3_to_notice")) {
      // 已走完核心，可能卡在公告／第四章入口
      if (!flag("ch4_started")) {
        openWin("chat");
        await waitChoice("听梁穗继续说", "ch3_to_ch4", { asSys: true });
        ch4Start();
      }
      return;
    }
    if (!flag("riverside_ling_done")) {
      flag("riverside_ling_done", true);
      await sequence([
        400,
        { type: "msg", who: "sys", text: "梁绫已离开群聊。", cls: "sys" },
      ]);
      setGroup(false);
      setChatTitle("与梁穗聊天中");
      openWin("chat");
      await wait(600);
    }
    openWin("chat");
    if (!flag("gate_river_name")) {
      await sequence([
        { type: "typing", ms: 1600 },
        { type: "msg", who: "梁穗", text: "那是梁守义的手。" },
        { type: "msg", who: "梁穗", text: "是他把姐姐的轮椅放到了河边。" },
      ]);
      flag("gate_river_name", true);
    }
    await waitChoice("……他伪造了投河现场？", "river_fake");
    if (!flag("gate_river_after_fake")) {
      await sequence([
        { type: "typing", ms: 1400 },
        { type: "msg", who: "梁穗", text: "他知道姐姐死在染坊，却还是编出了投河的故事。" },
      ]);
      flag("gate_river_after_fake", true);
    }
    await waitChoice("我记下了。", "river_note");
    if (!flag("ch3_done")) {
      await sequence([
        { type: "msg", who: "sys", text: "已确认：梁绫死在三号染池；梁守义布置河边现场，并制造了「牵绳娘」传说。", cls: "sys" },
        800,
        { type: "typing", ms: 1500 },
        { type: "msg", who: "梁穗", text: "我已经报警了。" },
        1000,
        { type: "msg", who: "sys", text: "—— 第三章结束 ——", cls: "sys" },
      ]);
      flag("exposure_done", true);
      flag("fake_riverside", true);
      flag("ch3_done", true);
      setChapter("ch4");
      revealFolder();
      toast("已保存到调查资料：三号染池现场、河边假现场");
    }
    await waitChoice("查看民俗馆紧急公告", "ch3_notice");
    if (!flag("gate_ch3_to_notice")) {
      chatMsg("sys", "民俗馆网站弹出过绳节重要通知。", "sys");
      openWin("browser");
      go("notice");
      flag("gate_ch3_to_notice", true);
    }
    await wait(800);
    await waitChoice("听梁穗继续说", "ch3_to_ch4", { asSys: true });
    ch4Start();
  }

  async function onRiversideCorrect() {
    flag("fake_riverside", true);
    toast("已确认：梁绫投河的说法是伪造的。");
    chatMsg("sys", "已确认：河边轮椅是伪造现场。请修复三号染池照片曝光。");
    if (!flag("exposure_done") && flag("ch3_truth")) {
      chatChoices([{
        text: "打开三号染池照片并修复曝光",
        onSelect: () => openExposure()
      }], "expose:open");
      setTimeout(() => {
        if (!flag("exposure_done") && !$("#exp-stage")) openExposure();
      }, 600);
    }
  }

  /* ---------- Chapter 4 ---------- */
  async function ch4Start() {
    if (flag("ch4_ritual_link") || flag("ending_started")) return;
    if (ch4Start._busy) return;
    ch4Start._busy = true;
    try {
      if (!flag("ch4_started") || !flag("gate_ch4_offer")) {
        flag("ch4_started", true);
        await sequence([
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "他把仪式提前了。", delay: 2000 },
          { type: "msg", who: "梁穗", text: "他应该已经知道我们打开了三号染池。", delay: 2200 },
          600,
          { type: "msg", who: "梁穗", text: "我现在回宗祠。", delay: 1800 },
          { type: "msg", who: "sys", text: "梁穗正在前往梁氏宗祠……", cls: "sys", delay: 2200 },
          2500,
          { type: "typing", ms: 1800 },
          { type: "msg", who: "梁穗", text: "我妈在宗祠外面拦住了我。", delay: 2000 },
          { type: "msg", who: "梁穗", text: "她给了我一样东西。", delay: 1800 },
        ], 2000);
        flag("gate_ch4_offer", true);
      }
      openWin("chat");
      await waitChoice("看看是什么", "ch4_see", { asSys: true });
      if (!flag("gate_ch4_note_shown")) {
        openModal(`
          <button type="button" class="modal-close" data-x>×</button>
          <h3>一张烧毁的纸条</h3>
          ${HJ.ph("burned_note", "wide")}
          <div class="old-note">不要怪阿穗。是我让她走的。明天我会把名册和接绳方案送出去。——绫</div>
        `);
        await wait(1500);
        flag("gate_ch4_note_shown", true);
      }
      await waitChoice("我看完了，你说", "ch4_read");
      if (!flag("gate_ch4_after_read")) {
        await sequence([
          { type: "msg", who: "梁穗", text: "这是姐姐留下的。我妈一直把它藏着。", delay: 2400 },
          { type: "typing", ms: 1600 },
          { type: "msg", who: "梁穗", text: "「那天晚上，你姐姐回来过。她说是她让你走的，让我不要去追你。」", delay: 2800 },
        ], 2000);
        flag("gate_ch4_after_read", true);
      }
      await waitChoice("你一时间不知道该说什么。这个时候，除却静静地听着梁穗讲这个久远而悲伤的故事以外，似乎没有什么更好的选择了。", "ch4_then", { asSys: true });
      if (!flag("gate_ch4_after_then")) {
        await sequence([
          { type: "typing", ms: 1400 },
          { type: "msg", who: "梁穗", text: "「她还说，第二天会把那些名单交出去。我害怕别人知道是我们逼你留下，所以把留言烧了。」", delay: 3000 },
          900,
          { type: "msg", who: "梁穗", text: "我问她，那张照片是不是她寄的。", delay: 2200 },
          { type: "msg", who: "梁穗", text: "她说：是我。我不敢打电话，也不敢直接告诉你。", delay: 2600 },
        ], 2000);
        flag("gate_ch4_after_then", true);
      }
      await waitChoice("……原来，照片是你妈妈寄给的。", "ch4_photo");
      if (!flag("gate_ch4_after_photo")) {
        await sequence([
          { type: "typing", ms: 1500 },
          { type: "msg", who: "梁穗", text: "「照片背面的话，是你姐姐以前写在铁盒上的。她说，这个结迟早要有人解开。」", delay: 2800 },
          800,
          { type: "msg", who: "梁穗", text: "可现在已经没有时间了。阿葵马上要被带进去。", delay: 2200 },
        ], 2000);
        flag("gate_ch4_after_photo", true);
      }
      await waitChoice("你进宗祠了吗？", "ch4_hall");
      if (!flag("gate_ch4_ritual_scene")) {
        openModal(`
          <button type="button" class="modal-close" data-x>×</button>
          <h3>固命礼现场</h3>
          ${HJ.ph("ritual_scene", "wide")}
          <p>梁穗拍来了现场的照片，固命礼似乎已经开始了。</p>
        `);
        await wait(1000);
        await sequence([
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "宗祠里的电脑正在展示仪式名单，页面还开着编辑端。", delay: 2400 },
          { type: "msg", who: "梁穗", text: "我把地址发给你。", delay: 1800 },
        ], 2000);
        flag("gate_ch4_ritual_scene", true);
      }
      flag("ch4_ritual_link", true);
      chatChoices([{
        text: "打开仪式展示系统",
        onSelect: () => {
          openWin("browser");
          go("ritual_system");
        }
      }], "ch4:ritual");
    } finally {
      ch4Start._busy = false;
    }
  }

  function bindEvidence() {
    let selected = null;
    const placed = { sui: [], ling: [], kui: [] };
    $$("#ev-pool .ev-chip").forEach(chip => {
      chip.onclick = () => {
        $$(".ev-chip").forEach(c => c.style.outline = "");
        chip.style.outline = "2px solid #c9a227";
        selected = chip;
      };
    });
    $$("#ev-board .claim").forEach(claim => {
      claim.onclick = () => {
        if (!selected) return;
        const key = claim.dataset.claim;
        if (selected.dataset.ev !== key) {
          toast("这条证据与该说法不对应。");
          return;
        }
        const zone = claim.querySelector(".drop-zone");
        zone.appendChild(selected);
        selected.disabled = true;
        selected.classList.add("in-zone");
        placed[key].push(selected.dataset.id);
        selected = null;
        if (placed.sui.length >= 2 && placed.ling.length >= 2 && placed.kui.length >= 2) {
          onEvidenceComplete();
        }
      };
    });
  }

  async function onEvidenceComplete() {
    toast("三组证据配对完成。");
    const board = $("#ev-board");
    board.insertAdjacentHTML("afterend", `
      <div class="old-note">
        系统更正：梁穗没有自愿；梁绫没有投河；何葵与何童都没有同意这场仪式。
      </div>
      <button type="button" class="btn-inline gold" id="publish-truth">在仪式屏幕上公开更正</button>
    `);
    $("#publish-truth").onclick = publishTruth;
  }

  async function publishTruth() {
    closeModal();
    const screen = $("#ritual-bigscreen");
    const body = $("#ritual-bigscreen-body");
    if (!screen || !body) return;
    body.innerHTML = `
      <div class="rbs-content">
        <p class="rbs-line">梁穗没有签字。</p>
        <p class="rbs-line">梁绫没有投河。</p>
        <p class="rbs-line">何葵没有同意。</p>
        <p class="rbs-headline">没有本人同意的牵命，不是承诺，是强迫。</p>
        <p class="rbs-warn">管理员正在撤回更正内容。</p>
        <button type="button" class="keep-btn" id="keep-1">保留公开记录</button>
        <p class="rbs-status" id="keep-status"></p>
      </div>
    `;
    screen.classList.remove("hidden");
    screen.setAttribute("aria-hidden", "false");
    state.keepClicks = 0;
    $("#keep-1").onclick = () => {
      state.keepClicks++;
      const st = $("#keep-status");
      if (state.keepClicks === 1) st.textContent = "梁守义撤回了梁穗的记录——再次点击保留。";
      if (state.keepClicks === 2) st.textContent = "梁守义撤回了梁绫的记录——再次点击保留。";
      if (state.keepClicks >= 3) {
        st.textContent = "公开记录已保存。";
        $("#keep-1")?.remove();
        setTimeout(() => {
          screen.classList.add("hidden");
          screen.setAttribute("aria-hidden", "true");
          body.innerHTML = "";
          floodSequence();
        }, 900);
      }
    };
  }

  async function floodSequence() {
    openWin("chat");
    await sequence([
      { type: "msg", who: "sys", text: "何葵：我愿意照顾我弟弟，呵护他，让他健康成长。但我也想见见外面的世界，我想，这样的我有能力给弟弟带来更好的生活。", cls: "sys", delay: 7800 },
      { type: "msg", who: "sys", text: "何童：我不要姐姐留下，我是坚强的男子汉。我不想成为一辈子被姐姐照顾的那个人。", cls: "sys", delay: 7200 },
      { type: "typing", ms: 1800 },
      { type: "msg", who: "梁穗", text: "梁守义还在命令仪式继续……", delay: 3600 },
      1400,
      { type: "msg", who: "sys", text: "宗祠外一声巨响。雨势忽然拧紧——雷贴着屋脊滚过去，风把灯笼扯得乱晃，远处传来闷闷的、越来越近的水声，像整条河翻过岸来。", cls: "sys" },
    ]);
    await wait(2800);
    playRainFlood({ volume: 0.2 });
    if (bgmAudio && currentBgm === "horror") fadeAudio(bgmAudio, 0.22, 900);
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <div class="storyboard">
        <div class="storyboard-frame">${HJ.ph("flood_1", "wide")}<p class="caption">或许是老堤年久失修，或许是老天都觉得太过不公，或许真的是心愿未了的牵绳娘又一次回到了这片养育她的土地上；今日的暴雨气势汹汹地朝着这个传统的村落涌来。暴涨的洪水一时间吞没了村子的青石板巷，浑浊急流冲过灯笼影，木桶、碎板与纸屑一同被卷向深处。等到人们意识过来的时候，一切似乎都太晚了。</p></div>
        <div class="storyboard-frame">${HJ.ph("flood_2", "wide")}<p class="caption">廊下有人挤作一团；屋里，何葵跪在何童膝前，窗外已是半淹的巷道。</p></div>
        <div class="storyboard-frame">${HJ.ph("flood_3", "wide")}<p class="caption">有人下到水里想接应，但是齐腰而又湍急的水流此刻就像天堑一般横亘在众人和阿葵姐弟面前，叫人难以跨越——更别说把姐弟俩从高台上救下来了。</p></div>
      </div>
      <p>雨打在瓦檐上连成一片白噪，巷里只有水流砸在石板、撞开巷门的闷响。有人高喊：把绳子解下来，拉一条过去！梁守义仍挡在门前，声音几乎被水声吞掉：……老祖宗定下的规矩，你们都忘了吗——伴命结，伴命结不能断！</p>
      <button type="button" class="btn-inline gold origin-recall-btn" id="origin-recall">冥冥之中，你感觉似乎有什么意志，一开始就被曲解了。霎时间，民俗馆里写的过绳节起源，撞进你的意识最深处。</button>
    `);
    staggerBoardReveal();
    $("#origin-recall").onclick = originRecall;
  }

  async function originRecall() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>绛水镇第一次过绳节复原图</h3>
      ${HJ.ph("origin_flood", "wide")}
      <div class="old-note">洪水阻路，镇民以绳为引。前方渡水，后方拉绳。老弱由众人接送，药食由长绳传递。</div>
      <p>红绳最早不是用来绑住人的。它是用来搭路的。</p>
      <button type="button" class="btn-inline gold" id="origin-realize">你意识到，绳子，从来就不是绑住大家的束缚，而是施以援手的救赎。</button>
    `);
    staggerBoardReveal();
    $("#origin-realize").onclick = async () => {
      if (originRecall._busy) return;
      originRecall._busy = true;
      try {
        openWin("chat");
        await sequence([
          { type: "msg", who: "梁穗", text: "我家就在宗祠旁边。门前那棵古树上还有旧绳——左邻右舍家里，也都收着各自的红绳。" },
        ]);
        startRecollectionBgm();
        cutKnotSequence();
      } finally {
        originRecall._busy = false;
      }
    };
  }

  async function cutKnotSequence() {
    const steps = [
      {
        title: "",
        html: `
          <div class="storyboard">
            <div class="storyboard-frame">${HJ.ph("street_flood", "wide")}<p class="caption">梁穗冒雨跑回梁家——暴雨倾盆下的石板巷里，只剩一个奔跑的剪影。家里那温暖而又微弱的灯光，近在咫尺；仿佛是小时候站在门口等她回家的姐姐阿绫，手里的那一盏灯笼。</p></div>
            <div class="storyboard-frame">${HJ.ph("tree_rope", "wide")}<p class="caption">梁家门前古树缠着褪色长红绳，那是七年前留下的东西。</p></div>
          </div>
          <p class="mem-line">梁穗冒雨跑回梁家，她找到了七年前姐姐递给她的那把剪刀——那是姐姐让她剪开红绳的那把剪子。何素琴也追到门前，她看着面前的小女儿，一瞬间仿佛是又回到了那个令她不愿再回想的夜晚。</p>`,
        next: "她抓住了梁穗的手"
      },
      {
        title: "",
        watercolor: true,
        html: `
          ${HJ.ph("hesuqin_grab", "wide")}
          <p class="mem-line">何素琴看见女儿手里的剪刀，立刻抓住她的手。</p>
          <p class="mem-line"><b>「你已经剪断过一次了。不能再剪第二次。」</b></p>
          <p class="mem-whisper">她抓得很紧。仿佛只要继续抓住这根绳，七年前的一切就没有发生过。她优秀的两个孩子，仍然在她耳边谈笑风生，笑着闹着，问她晚上吃什么。</p>`,
        next: "梁穗看向母亲的眼睛，那里面的情绪万万千千……"
      },
      {
        title: "",
        pupil: true,
        html: `
          <div class="pupil-frame">${HJ.ph("pupil_sisters", "wide")}</div>
          <p class="mem-line">雨声很远。何素琴的瞳孔里，先映出的不是此刻的洪水——</p>
          <p class="mem-line">而是许多年前：梁绫坐在轮椅上，梁穗扶着她。两个人彼此拉住，像在渡一条没有水的河。</p>
          <p class="mem-whisper">她突然想起——姐姐从来不是只会被照顾的人。她们也曾互相帮助。</p>`,
        next: "倒影继续变化"
      },
      {
        title: "",
        pupil: true,
        html: `
          <div class="pupil-frame">${HJ.ph("pupil_evidence", "wide")}</div>
          <p class="mem-line">倒影一转，变成手机屏幕上的公开证据，还有那张被烧毁的留言：</p>
          <div class="old-note">不要怪阿穗。是我让她走的。<br>明天我会把名册和接绳方案送出去。——绫</div>
          <p class="mem-whisper">七年前，梁绫拿着这张纸对她说过话。她没有听完，也没有交给梁穗。</p>`,
        next: "……"
      },
      {
        title: "",
        html: `
          ${HJ.ph("hesuqin_tear", "wide")}
          <p class="mem-line">何素琴慢慢闭上眼睛。雨混着泪，从脸颊滑下来。</p>
          <p class="mem-line">她抓住女儿的手指，一节一节松开。</p>`,
        next: "听她说话"
      },
      {
        title: "",
        html: `
          ${HJ.ph("hesuqin_release", "wide")}
          <p class="mem-line">「七年前，我没有让你姐姐把话说完。」</p>
          <p class="mem-line"><b>「这一次，你剪吧。」</b></p>
          <p class="mem-whisper">她松开的不是亲情，是那根把人勒死的结。</p>`,
        next: null,
        final: true
      }
    ];

    let i = 0;
    startRecollectionBgm();
    const show = () => {
      const s = steps[i];
      openModal(`
        <button type="button" class="modal-close" data-x>×</button>
        <div class="memory-board${s.pupil ? " recall-pupil" : ""}">
          ${s.title ? `<h3>${s.title}</h3>` : ""}
          <div class="mem-step">${s.html}</div>
          <div class="mem-nav">
            ${s.final
              ? `<button type="button" class="btn-inline gold" id="cut-knot">剪开伴命结中被勒死的绳头</button>`
              : `<button type="button" class="btn-inline gold" id="mem-next">${s.next || "继续"}</button>`}
          </div>
          <p class="caption">${i + 1} / ${steps.length}</p>
        </div>
      `);
      staggerBoardReveal();
      if (s.final) {
        $("#cut-knot").onclick = afterCutAllowed;
      } else {
        $("#mem-next").onclick = () => {
          i++;
          show();
        };
      }
    };
    show();
  }

  function afterCutAllowed() {
    flag("_hope_active", true);
    flag("_forest_active", true);
    flag("_recollection_bgm_active", true);
    playBgm("forest", { fade: 1200, volume: 0.42 });
    playRainFlood({ volume: 0.08 });
    toast("伴命结已解除。家家户户的红绳，可以重新拿出来了。");
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>重新接绳</h3>
      <p>雨还在下。左邻右舍跑出来，手里也都攥着自家的红绳——有人从宅邸门前的古树上解下，有人从屋里抱出过节存下的长绳。</p>
      <p>有人专管搓拧编股，有人盯着打能承重、事后又能松开的活结，把合绳系上梁家古树；廊下另有人收拾竹背篮、毛巾和纱布。</p>
      ${HJ.ph("rope_path_long", "wide")}
      <p class="caption">何素琴扶着树干，与岸上拽绳的人一起守住这一头：「别松。我们在这里。」</p>
      <button type="button" class="btn-inline gold" id="send-route">顺着合绳 · 下到水里</button>
    `);
    staggerBoardReveal();
    $("#send-route").onclick = rescueSequence;
  }

  async function rescueSequence() {
    flag("_forest_active", true);
    flag("_recollection_bgm_active", true);
    playBgm("forest", { fade: 900, volume: 0.42 });
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>合绳渡水</h3>
      <p>梁永安探进急流，扣住合绳：前面探路，后面各抓一段；岸上的人当锚，不许整股被冲跑。</p>
      <div class="storyboard">
        <div class="storyboard-frame">${HJ.ph("rescue_1", "wide")}<p class="caption">暴雨夜里，石板巷的洪水已经及腰。编拧成股的粗红合绳从梁家古树方向伸进急流——梁永安走在最前，双手死扣绳身，一脚一脚试探落点；身后邻居沿同一股绳错落站开，每人抓住自己那一段，身体迎水侧倾。近岸几个壮劳力当锚，脚跟死蹬湿石，把绳头拽住；岸上一人举手喊节拍，让绳队一段一段往前挪。</p></div>
        <div class="storyboard-frame">${HJ.ph("rescue_2", "wide")}<p class="caption">绳队往巷心深处又推进了一截，水已没过胸口。合绳仍是生命线，但分工更细了：有人背上竹背篮，腾出双手仍抠住红绳；有人把一叠还算干的毛巾高高托在臂弯里；有人腰间别着纱布卷，准备随时裹暖、包扎。另有一人略走在上游，用竹竿拨开漂来的木板和碎灯笼；还有人蹲下去，检查合绳衔接处的绳结有没有咬紧。</p></div>
        <div class="storyboard-frame">${HJ.ph("rescue_3", "wide")}<p class="caption">湍流尽头，宗祠方向那处高台仍孤立在水中。粗红合绳已勒近台沿——最前两人贴住湿石稳住身形，七八只手同时伸上去，把何葵与她搀着的何童一把一把接下水；有人用竹背篮托稳身躯，立刻有人把湿透的肩背裹上毛巾。更靠岸的人已排成一道人廊，拽住合绳，把姐弟往后方高处送最后几米。</p></div>
      </div>
      <p>合绳咬住古树的那一头始终没松。何葵扶着何童，被一双手一双手接过湍流——有人托，有人裹，有人往高处拽。</p>
      <button type="button" class="btn-inline gold" id="to-ending">救援结束</button>
    `);
    staggerBoardReveal();
    $("#to-ending").onclick = endingSequence;
  }

  let epilogueNewsWaiter = null;

  function waitEpilogueNewsButton() {
    return new Promise((resolve) => {
      epilogueNewsWaiter = resolve;
    });
  }

  function finishEpilogueNews() {
    flag("epilogue_news_done", true);
    delete state.flags.epilogue_await_news;
    save();
    epilogueNewsWaiter?.();
    epilogueNewsWaiter = null;
  }

  const EPILOGUE_BRIEFINGS = {
    hekui: {
      winTitle: "绛水镇民生简报 · 教育",
      meta: "绛水镇民生简报 · 教育",
      title: "恭喜何葵同学顺利入读岭南工业大学",
      img: "hekui_station",
      lines: [
        "今年秋天，何葵按时赴岭南工业大学报到。学籍系统显示：录取状态正常，学籍已注册。",
        "客车旁，乡亲来送。何童朝姐姐挥了挥手。两个人的手腕上，都没有再系那根绳。",
      ],
      flag: "epilogue_news1_read",
    },
    mutual: {
      winTitle: "绛水镇民生简报 · 民生",
      meta: "绛水镇民生简报 · 民生",
      title: "养老互助中心与卫生服务中心建成启用",
      imgs: [
        { key: "epilogue_mutual_center", caption: "绛水镇养老互助中心" },
        { key: "epilogue_health_center", caption: "绛水镇卫生服务中心" },
      ],
      lines: [
        "绛水镇养老互助中心、镇卫生服务中心已于近日建成并投入运行。",
        "县政府核定的《接绳互助照护办法》与随访规范同步施行；「回乡人才基金」首批岗位补贴已发放到位，专职照护与随访岗位完成招聘。",
        "何童的日常照护纳入互助中心排班，卫生服务中心已为他建立健康档案并安排定期随访。",
      ],
      flag: "epilogue_news2_read",
    },
  };

  function onEpilogueNewsOpen(which) {
    const cfg = EPILOGUE_BRIEFINGS[which];
    if (!cfg) return;
    const inEpilogue = flag("epilogue_await_news") || flag("epilogue_started");
    if (!inEpilogue) {
      if (which === "hekui") showPhoto("hekui_station", "何葵已报到岭南工业大学。");
      else openEpilogueMutualPhotos();
      return;
    }
    if (flag("epilogue_news_done")) {
      openEpilogueBriefing(which);
      return;
    }
    openEpilogueBriefing(which);
    flag(cfg.flag, true);
    save();
    if (state.page === "search_hekui") go("search_hekui");
  }

  function epilogueBriefingImages(cfg) {
    if (cfg.imgs?.length) {
      return cfg.imgs.map(({ key, caption }) => `
        <figure class="epilogue-news-fig">
          ${HJ.ph(key, "wide")}
          ${caption ? `<figcaption class="caption epilogue-news-cap">${escapeHtml(caption)}</figcaption>` : ""}
        </figure>`).join("");
    }
    return cfg.img ? HJ.ph(cfg.img, "wide") : "";
  }

  function openEpilogueMutualPhotos() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <h3>养老互助中心与卫生服务中心</h3>
      <figure class="epilogue-news-fig">${HJ.ph("epilogue_mutual_center", "wide")}<figcaption class="caption">绛水镇养老互助中心</figcaption></figure>
      <figure class="epilogue-news-fig">${HJ.ph("epilogue_health_center", "wide")}<figcaption class="caption">绛水镇卫生服务中心</figcaption></figure>
    `);
  }

  function renderEpilogueBriefing(which) {
    const body = $("#briefing-body");
    const cfg = EPILOGUE_BRIEFINGS[which];
    if (!body || !cfg) return;
    body.innerHTML = `
      <article class="epilogue-news">
        <p class="epilogue-news-meta">${escapeHtml(cfg.meta)}</p>
        <h3>${escapeHtml(cfg.title)}</h3>
        ${epilogueBriefingImages(cfg)}
        ${cfg.lines.map((t) => `<p class="epilogue-news-p">${escapeHtml(t)}</p>`).join("")}
        <p class="epilogue-news-actions">
          <button type="button" class="btn-inline ghost" id="briefing-back">返回搜索结果</button>
        </p>
      </article>`;
    $("#briefing-back")?.addEventListener("click", () => closeWin("briefing"));
  }

  function openEpilogueBriefing(which) {
    const cfg = EPILOGUE_BRIEFINGS[which];
    if (!cfg) return;
    $("#briefing-title").textContent = cfg.winTitle;
    $("#briefing-close")?.classList.toggle("hidden", flag("epilogue_await_news") && !flag("epilogue_news_done"));
    renderEpilogueBriefing(which);
    openWin("briefing");
  }

  function epilogueMallScene() {
    showEpilogueScreen();
    return new Promise((resolve) => {
      $("#epilogue-screen").innerHTML = `
        <div class="epilogue-mall">
          <p class="epilogue-line epilogue-mall-title">几个月后，你在一家商场闲逛。</p>
          <div class="epilogue-mall-map">
            ${HJ.ph("epilogue_mall", "wide")}
            <button type="button" class="epilogue-shop-hotspot" id="ep-lottery-shop" aria-label="刮刮乐抽奖"></button>
          </div>
          <p class="epilogue-hint">点击彩票店</p>
        </div>`;
      $("#ep-lottery-shop")?.addEventListener("click", () => resolve());
    });
  }

  function epilogueLotteryHint() {
    showEpilogueScreen();
    return new Promise((resolve) => {
      $("#epilogue-screen").innerHTML = `
        <div class="epilogue-beat">
          <p class="epilogue-sub" style="font-size:15px;color:#d8c8a8;margin-bottom:28px">你感觉自己今天手气不错，想买张彩票看看会不会中大奖。</p>
          <button type="button" class="btn-inline gold" id="ep-enter-lottery">进去看看</button>
        </div>`;
      $("#ep-enter-lottery")?.addEventListener("click", () => resolve());
    });
  }

  function showEpilogueScreen() {
    ["browser", "chat", "folder", "archive", "filebox", "briefing"].forEach((id) => closeWin(id));
    $("#modal")?.classList.add("hidden");
    $("#modal-panel").innerHTML = "";
    $("#desktop")?.classList.add("hidden");
    $("#desktop")?.setAttribute("aria-hidden", "true");
    const ep = $("#epilogue-screen");
    ep?.classList.remove("hidden");
    ep?.setAttribute("aria-hidden", "false");
  }

  function hideEpilogueScreen() {
    const ep = $("#epilogue-screen");
    ep?.classList.add("hidden");
    ep?.classList.remove("is-staff", "is-to-black");
    ep?.setAttribute("aria-hidden", "true");
    ep && (ep.innerHTML = "");
    $("#desktop")?.classList.remove("hidden");
    $("#desktop")?.setAttribute("aria-hidden", "false");
  }

  function epilogueBeat(text, holdMs = 2800) {
    showEpilogueScreen();
    return new Promise(async (resolve) => {
      $("#epilogue-screen").innerHTML = `
        <div class="epilogue-beat"><p class="epilogue-line">${escapeHtml(text)}</p></div>`;
      await wait(holdMs);
      resolve();
    });
  }

  function epilogueNarration(lines, holdMs = 3800) {
    showEpilogueScreen();
    return new Promise(async (resolve) => {
      $("#epilogue-screen").innerHTML = `
        <div class="epilogue-beat">
          ${lines.map((t) => `<p class="epilogue-sub">${escapeHtml(t)}</p>`).join("")}
        </div>`;
      await wait(holdMs);
      resolve();
    });
  }

  function epilogueScratchLottery() {
    showEpilogueScreen();
    return new Promise((resolve) => {
      $("#epilogue-screen").innerHTML = `
        <div class="epilogue-panel">
          <p class="epilogue-label">福利刮刮乐</p>
          <div class="scratch-wrap" id="scratch-wrap">
            <div class="scratch-prize">
              <div class="scratch-prize-inner">
                <span class="prize-tier">特殊奖项</span>
                <span class="prize-name">智能手机 1 台</span>
                <span class="prize-note">活动编号 4406-****</span>
              </div>
            </div>
            <canvas class="scratch-canvas" id="scratch-canvas"></canvas>
          </div>
          <p class="epilogue-hint">刮开涂层查看结果</p>
          <div class="epilogue-actions">
            <button type="button" class="btn-inline ghost" id="ep-skip-scratch">跳过</button>
            <button type="button" class="btn-inline gold hidden" id="ep-scratch-done">继续</button>
          </div>
        </div>`;

      const wrap = $("#scratch-wrap");
      const canvas = $("#scratch-canvas");
      const doneBtn = $("#ep-scratch-done");
      let finished = false;
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const revealPrize = () => {
        if (finished) return;
        finished = true;
        canvas.style.pointerEvents = "none";
        doneBtn?.classList.remove("hidden");
      };

      $("#ep-skip-scratch")?.addEventListener("click", () => { revealPrize(); done(); });
      doneBtn?.addEventListener("click", done);

      if (!wrap || !canvas) {
        done();
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#9a9080";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      for (let i = 0; i < 28; i++) {
        ctx.fillRect(Math.random() * rect.width, Math.random() * rect.height, 36, 2);
      }
      ctx.fillStyle = "#6a6458";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("刮开此处", rect.width / 2, rect.height / 2);

      let drawing = false;
      const scratchAt = (x, y) => {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
      };
      const sampleCleared = () => {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let clear = 0;
        for (let i = 3; i < img.data.length; i += 4) {
          if (img.data[i] === 0) clear++;
        }
        return clear / (img.data.length / 4);
      };

      const onMove = (clientX, clientY) => {
        if (!drawing) return;
        const r = canvas.getBoundingClientRect();
        scratchAt(clientX - r.left, clientY - r.top);
        if (sampleCleared() > 0.38) revealPrize();
      };

      canvas.addEventListener("pointerdown", (e) => {
        drawing = true;
        canvas.setPointerCapture(e.pointerId);
        onMove(e.clientX, e.clientY);
      });
      canvas.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));
      canvas.addEventListener("pointerup", () => { drawing = false; });
      canvas.addEventListener("pointerleave", () => { drawing = false; });
    });
  }

  async function epiloguePhoneChat() {
    showEpilogueScreen();
    playBgm("collapsing", { fade: 1400, volume: 0.16, loop: true });
    const lingAv = (HJ.ASSETS && HJ.ASSETS.avatar_ling_epilogue) || "";
    const meAv = (HJ.ASSETS && HJ.ASSETS.avatar_player) || "";
    const lingFace = lingAv
      ? `<img src="${lingAv}" alt="">`
      : `<span>绫</span>`;
    const meFace = meAv
      ? `<img src="${meAv}" alt="">`
      : `<span>我</span>`;

    $("#epilogue-screen").innerHTML = `
      <div class="epilogue-phone is-chat" id="epilogue-phone">
        <div class="ep-phone-notch"></div>
        <div class="ep-phone-status">
          <span>04:17</span>
          <span class="ep-phone-signal">无服务</span>
        </div>
        <div class="ep-phone-header">
          <span class="ep-phone-back" aria-hidden="true">‹</span>
          <span class="ep-phone-name">绫娘</span>
          <span class="ep-phone-more" aria-hidden="true">···</span>
        </div>
        <div class="ep-phone-chat" id="ep-phone-chat"></div>
        <div class="ep-phone-composer" id="ep-phone-composer">
          <div class="ep-phone-bar">点击下方回复</div>
        </div>
      </div>`;

    const chat = $("#ep-phone-chat");
    const composer = $("#ep-phone-composer");

    const scrollChat = () => {
      chat.scrollTop = chat.scrollHeight;
    };

    const addRow = (side, html, extraClass = "") => {
      const row = document.createElement("div");
      row.className = `ep-phone-row is-${side} ${extraClass}`.trim();
      row.innerHTML = html;
      chat.appendChild(row);
      scrollChat();
      return row;
    };

    const typeInto = async (el, text, msPerChar = 42) => {
      el.textContent = "";
      for (let i = 0; i < text.length; i++) {
        el.textContent += text[i];
        scrollChat();
        await wait(msPerChar);
      }
    };

    const addLing = async (text, delay = 900) => {
      await wait(delay);
      const typingMs = Math.min(2600, Math.max(1400, text.length * 22));
      const typing = addRow("ling", `
        <div class="ep-phone-av">${lingFace}</div>
        <div class="ep-phone-bubble is-typing"><span></span><span></span><span></span></div>
      `, "is-typing-row");
      await wait(typingMs);
      typing.remove();
      const row = addRow("ling", `
        <div class="ep-phone-av">${lingFace}</div>
        <div class="ep-phone-bubble is-ling"></div>
      `);
      await typeInto(row.querySelector(".ep-phone-bubble"), text, 38);
      await wait(900);
    };

    const addMe = async (text) => {
      addRow("me", `
        <div class="ep-phone-bubble is-me">${escapeHtml(text)}</div>
        <div class="ep-phone-av is-me">${meFace}</div>
      `);
      await wait(520);
    };

    const waitPick = (options) => new Promise((resolve) => {
      composer.innerHTML = options.map((opt, i) =>
        `<button type="button" class="ep-phone-choice" data-i="${i}">${escapeHtml(opt.text)}</button>`
      ).join("");
      composer.querySelectorAll(".ep-phone-choice").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const opt = options[Number(btn.dataset.i)];
          composer.innerHTML = `<div class="ep-phone-bar">发送中…</div>`;
          await addMe(opt.text);
          composer.innerHTML = `<div class="ep-phone-bar">绫娘正在输入</div>`;
          resolve(opt.id);
        });
      });
    });

    composer.innerHTML = `<div class="ep-phone-bar">绫娘正在输入</div>`;

    await addLing("好久不见。前阵子，多谢你的帮助了。贸然打扰你，实在是抱歉。", 900);

    composer.innerHTML = `<div class="ep-phone-bar">选择回复</div>`;
    await waitPick([{
      id: "ask",
      text: "……绫娘？你、你是阿穗的姐姐？！你怎么能联系到我？",
    }]);

    await addLing("我在绛水镇被困旧染坊而死后，因为执念未散，无法进入轮回。最初几年，我一直停留在绛水镇附近；后来我逐渐发现，自己能够顺着人的“念”离开这里。", 800);
    await addLing("在这七年里，我看见了很多事情：有人被冤枉；有人失踪以后无人寻找；有人明知道真相，却因为害怕选择闭嘴；有人求救，却没人听见。", 900);

    composer.innerHTML = `<div class="ep-phone-bar">选择回复</div>`;
    const branch = await waitPick([
      { id: "a", text: "你看到这些，内心应该不会好受吧……" },
      { id: "b", text: "那为什么，现在我却可以和你交流呢？" },
    ]);

    if (branch === "a") {
      await addLing("心有志而事不成，确实很痛苦。但是绛水镇的经历，让我发现你可以通过电磁波与我交流沟通，这让我看到了一些希望。", 700);
    } else {
      await addLing("具体我也说不清楚原因。本来我就这样飘荡在世间，或许有一天会忘记所有。但是绛水镇的经历，让我发现你可以通过电磁波与我交流沟通，这让我看到了一些希望。", 700);
    }

    await addLing("在绛水镇的经历中，我能够从碎片信息里理解另一个人。你没有亲临现场、没有法力、没有通灵能力，甚至不知道我究竟是什么样的存在；但是你依靠推理、勇气、判断和与阿穗之间的沟通，最终改变了现实。我能够看见一些被掩埋的真相，而你，拥有把真相变成行动的能力。", 1000);
    await addLing("电信号是阳间非常特殊的东西——声音可以变成电流，文字可以变成数据。人的话能够在没有“人”的地方存在。双方都可以在某个瞬间影响“信息”。我用了七年，弄出一个极不稳定的“接口”。通过这部手机，我能传输给你文字、图片、音频，甚至是异常数据。", 1100);

    composer.innerHTML = `<div class="ep-phone-bar">选择回复</div>`;
    await waitPick([{
      id: "kpi",
      text: "……绫姐，如果你去地府打工，应该是阎王爷麾下kpi最高的鬼吧。",
    }]);

    await addLing("唉，那效率也太低了，你是真看得起我。", 600);
    await addLing("鬼生太短，搞不出阴阳门、招魂镜；感觉那都是阎王爷手下的博士生才能做出来的东西。我用七年时间才做出了一个“接口”，又在刚才帮你中了奖；“作弊”次数差不多都用完啦。", 800);

    composer.innerHTML = `<div class="ep-phone-bar">选择回复</div>`;
    await waitPick([{
      id: "cheat",
      text: "这种作弊，已经很强了。",
    }]);

    await addLing("好啦，言归正传。这一次，有了新的故事，不是我们镇上的。", 700);
    await addLing("你还愿意听吗？", 900);

    composer.innerHTML = `<div class="ep-phone-bar">无法回复</div>`;
    await wait(2000);
  }

  async function epilogueScreenOff() {
    const ep = $("#epilogue-screen");
    const phone = $("#epilogue-phone");
    const bo = $("#screen-blackout");
    ep?.classList.add("is-to-black");
    phone?.classList.add("is-off");
    if (bo) {
      bo.classList.add("slow");
      bo.classList.remove("hidden");
      bo.setAttribute("aria-hidden", "false");
      void bo.offsetWidth;
      requestAnimationFrame(() => bo.classList.add("on"));
    }
    await wait(3600);
    await wait(1400);
    showStaffCredits();
    await wait(240);
    if (bo) {
      bo.classList.add("credits-reveal");
      void bo.offsetWidth;
      bo.classList.remove("on");
    }
    await wait(800);
    $(".staff-roll")?.classList.add("is-revealing");
    await wait(2200);
    if (bo) {
      bo.classList.add("hidden");
      bo.classList.remove("slow", "credits-reveal");
      bo.setAttribute("aria-hidden", "true");
    }
  }

  function showStaffCredits() {
    const ep = $("#epilogue-screen");
    if (ep) {
      ep.classList.remove("hidden");
      ep.classList.add("is-staff");
      ep.setAttribute("aria-hidden", "false");
      ep.innerHTML = `
      <div class="staff-roll is-entering">
        <p class="staff-game">活结</p>
        <p><span>文案</span>頔</p>
        <p><span>制作</span>頔</p>
        <p><span>感谢</span>青堇</p>
        <p><span>BGM</span>Forest Mixtape、Collapsing World</p>
        <div class="staff-actions">
          <button type="button" class="btn-inline ghost" id="reset-game">清除进度并重开</button>
          <button type="button" class="btn-inline gold" id="ending-chapters">章节重玩</button>
        </div>
      </div>`;
    }
    $("#reset-game")?.addEventListener("click", () => {
      localStorage.removeItem("huojie_save");
      location.reload();
    });
    $("#ending-chapters")?.addEventListener("click", () => {
      hideEpilogueScreen();
      openChapterSelect();
    });
  }

  function showAct1FinaleModal() {
    return new Promise((resolve) => {
      openModal(`
        <div class="finale-photo">
          ${HJ.ph("sisters_final", "finale-fill")}
          <button type="button" class="btn-inline gold finale-photo-btn" id="act1-finale-next">……</button>
        </div>
      `);
      $("#modal-panel")?.classList.add("finale-photo-panel");
      $("#act1-finale-next")?.addEventListener("click", () => {
        closeModal();
        resolve();
      });
    });
  }

  function showFinalCreditsModal() {
    openModal(`
      <button type="button" class="modal-close" data-x>×</button>
      <div class="ending-screen">
        ${HJ.ph("sisters_final", "wide")}
        <h2>结已经解开了。</h2>
        <p style="opacity:.75;margin-top:12px">牵绳娘的故事结束了。<br>绫娘的故事，才刚刚开始。</p>
        <p style="margin-top:28px;font-size:14px;opacity:.6">《活结》· 游戏结束</p>
        <p style="margin-top:16px"><button type="button" class="btn-inline ghost" id="reset-game" style="border-color:#c9a227;color:#c9a227">清除进度并重开</button></p>
        <p style="margin-top:10px"><button type="button" class="btn-inline gold" id="ending-chapters">章节重玩</button></p>
        <p class="caption" style="margin-top:12px;opacity:.7">关闭后也可在桌面找到「章节重玩」／「重新开始」</p>
      </div>
    `);
    $("#reset-game")?.addEventListener("click", () => {
      localStorage.removeItem("huojie_save");
      location.reload();
    });
    $("#ending-chapters")?.addEventListener("click", openChapterSelect);
  }

  async function startEpilogueReplay() {
    if (startEpilogueReplay._busy) return;
    startEpilogueReplay._busy = true;
    try {
      delete state.flags._replay_epilogue;
      save();
      closeModal();
      stopRainFlood(0);
      playBgm("ending", { fade: 1600 });
      flag("epilogue_started", true);
      await showAct1FinaleModal();
      flag("ending_started", true);
      setChapter("epilogue");
      markGameCleared();
      await runEpilogueSequence();
    } finally {
      startEpilogueReplay._busy = false;
    }
  }

  async function runEpilogueSequence() {
    if (runEpilogueSequence._busy) return;
    runEpilogueSequence._busy = true;
    try {
    if (!flag("epilogue_news_done")) {
      if (bgmAudio) fadeAudio(bgmAudio, 0, 1600);
      await wait(900);
      playBgm("ending", { fade: 900 });

      flag("epilogue_await_news", true);
      save();

      openWin("chat");
      await sequence([
        { type: "msg", who: "sys", text: "几个月后。", cls: "sys" },
        { type: "msg", who: "sys", text: "你在民俗馆搜了搜后续。", cls: "sys", delay: 1200 },
      ]);

      openWin("browser");
      go("search_hekui");

      await waitEpilogueNewsButton();
    }

    ["browser", "chat", "folder", "archive", "filebox", "briefing"].forEach((id) => closeWin(id));
    closeModal();

    if (!flag("epilogue_mall_done")) {
      await epilogueMallScene();
      await epilogueLotteryHint();
      flag("epilogue_mall_done", true);
      save();
    }

    if (!flag("epilogue_scratch_done")) {
      await epilogueScratchLottery();
      flag("epilogue_scratch_done", true);
      save();
    }

    await epilogueNarration([
      "你核对了三遍：活动是真的，彩票站是真的，快递单也是真的。",
      "厂商存在，领奖流程也正规。",
      "唯一查不到的，是这部手机的序列号。",
    ], 4200);
    await epilogueBeat("快递到了。", 2000);
    await epilogueBeat("开机。", 1600);
    await epiloguePhoneChat();
    await epilogueScreenOff();

    flag("epilogue_complete", true);
    save();
    revealRestart();
    revealFolder();
    } finally {
      runEpilogueSequence._busy = false;
    }
  }

  async function endingSequence() {
    closeModal();
    stopRainFlood(1400);
    openWin("chat");
    await waitChoice(
      "一根绳可以绑住一个人，但是许多根绳拧成股，却能托住一群人。大家各出一截，合在一起，才能把人送过难走的路。",
      "ending_rope"
    );
    setGroup(true);
    showEye(false);
    await sequence([
      { type: "typing", text: "梁绫正在输入…", ms: 2000 },
      { type: "msg", who: "梁绫", text: "……终于，阿葵能去更远的地方，追逐属于她的人生。", cls: "ling", delay: 4500 },
      { type: "typing", text: "梁绫正在输入…", ms: 1800 },
      { type: "msg", who: "梁绫", text: "我相信，坚强的小童，也能写好属于他自己的故事。", cls: "ling", delay: 4200 },
    ]);
    setGroup(false);
    await sequence([
      { type: "msg", who: "sys", text: "梁守义因隐瞒事故、撤回记录、布置假现场、伪造自愿材料被带走调查。固命礼公告撤下。", cls: "sys", delay: 7000 },
      { type: "msg", who: "sys", text: "镇子上的人们为死去的梁绫立下了一座碑，就在梁家古树的边上。她不是投河的牵绳娘，她是梁绫——一个一心为了镇子发展，有勇有谋的好姑娘。她对镇子、对居民们的尊重与爱，被记录在口口相传的故事里；风卷云舒，吹走了一段波澜壮阔的过往。", cls: "sys", delay: 12000 },
      { type: "msg", who: "sys", text: "那以后，绛水镇的每一场雨，大家都认为是绫娘回家了——她回到了这片生她养她的土地，来看看大家过得好不好。但是她也不仅仅属于这里——她是一场温柔的雨，属于一片更广阔的天空。", cls: "sys", delay: 10000 },
    ]);

    await waitChoice("阿穗的那张照片背后，好像发生了什么变化。", "ending_photo_back", { asSys: true });

    flag("epilogue_started", true);
    save();
    await showAct1FinaleModal();

    // 第四章结束：Forest Mixtape 淡出，切尾声 BGM
    delete state.flags._hope_active;
    delete state.flags._recollection_bgm_active;
    delete state.flags._forest_active;
    playBgm("ending", { fade: 1600 });

    flag("ending_started", true);
    setChapter("ending");
    markGameCleared();

    await runEpilogueSequence();
  }

  /* ---------- Boot & wiring ---------- */
  function tickClock() {
    // 游戏内日期：过绳节当天为2016年7月15日；尾声已过数月
    const epilogue = flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue";
    $("#clock").textContent = epilogue ? "2016年10月20日" : "2016年7月15日";
  }

  function revealMuseum() {
    $("#icon-browser")?.classList.remove("hidden");
    flag("museum_link", true);
  }

  function enterDesktop() {
    $("#boot-screen").classList.add("hidden");
    $("#intro-screen").classList.add("hidden");
    $("#intro-screen").setAttribute("aria-hidden", "true");
    $("#desktop").classList.remove("hidden");
    $("#desktop").setAttribute("aria-hidden", "false");
    openWin("chat");
    revealRestart();

    // 先恢复历史聊天，避免中途重进记录清空
    let startedFreshIntro = false;
    if (state.chatLog.length) {
      restoreChat();
      appendChatDom("sys", "—— 已恢复之前的聊天记录 ——", "sys");
    } else if (!flag("intro_chat")) {
      flag("intro_chat", true);
      startedFreshIntro = true;
      startIntroChat();
    }

    // 已拿到网址（或进度已过序章开场）才显示并打开民俗馆
    const museumReady = flag("museum_link") || flag("searched_rope") || flag("saw_full_photo") ||
      flag("clicked_akui") || ["ch1", "ch2", "ch3", "ch4", "ending", "epilogue"].includes(state.chapter);
    if (museumReady) {
      revealMuseum();
      const restorePage = state.page && state.page !== "home" ? state.page : "intro";
      if (ARCHIVE_PAGE_MAP[restorePage]) {
        go(restorePage, false);
        // 民俗馆仍可放在一边，先打开档案
        openWin("browser");
        renderPage("intro");
      } else if (restorePage === "materials") {
        openWin("browser");
        renderPage("intro");
        if (flag("saw_materials")) openFileBox();
      } else {
        openWin("browser");
        go(restorePage, false);
      }
      playDesktopBgm();
      resumeBgmIfNeeded();
    } else {
      // 开场只聊天：继续标题曲，或压低为调查氛围前的安静
      playBgm("title", { volume: 0.35, fade: 800 });
    }

    // 恢复桌面图标
    if (flag("has_cropped_clue") || flag("folder_ready") || flag("ch2_done") || flag("clicked_akui") || flag("ending_started") ||
        state.chapter === "ch2" || state.chapter === "ch3" || state.chapter === "ch4" || state.chapter === "ending" || state.chapter === "epilogue") {
      revealFolder();
    }
    if (flag("archive_ready") || flag("gate_ch3_side_done")) {
      revealArchiveIcon();
    }
    if (flag("saw_materials") || flag("ending_started")) {
      revealFileBoxIcon();
    }
    if (flag("ending_started") || state.chapter === "ending" || state.chapter === "epilogue") {
      markGameCleared();
      revealRestart();
    }
    revealChapterSelectIcon();
    syncPhoneClearedUi();
    $("#chapter-label").textContent = CHAPTER_LABEL[state.chapter] || "序章";
    syncChapterTheme();

    // 刷新后：优先还原未点的发言选项；否则按旗标续跑中断剧情
    if (!startedFreshIntro) {
      const restored = restorePendingChoices();
      if (!restored) resumeInterruptedFlows();
    }

    // 第三章尚未到达：补触发（与选项恢复不冲突）
    if (flag("ch2_done") && !flag("ch3_done") && !flag("ch3_arrived_run") && !flag("ch3_arrived")) {
      setTimeout(ch3Arrive, 1000);
    } else if (flag("ch2_done") && !flag("ch3_done") && (flag("gate_ch3_side_done") || flag("archive_ready") || flag("gate_ch3_recv"))) {
      revealArchiveIcon();
    }

    if (flag("_replay_epilogue")) {
      setTimeout(() => startEpilogueReplay(), 500);
    }
  }

  async function startIntroChat() {
    if (flag("museum_link") || startIntroChat._busy) return;
    startIntroChat._busy = true;
    try {
      openWin("chat");
      if (!flag("gate_intro_hello")) {
        await sequence([
          { type: "msg", who: "sys", text: "梁穗已添加你为联系人", cls: "sys", delay: 900 },
          { type: "typing", ms: 1400 },
          { type: "msg", who: "梁穗", text: "在吗？有件事……我想跟你说一下。", delay: 2000 },
        ], 1600);
      }
      await waitChoice("在的，怎么了？", "intro_hello");

      if (!flag("gate_intro_photo_sent")) {
        await sequence([
          { type: "typing", ms: 1600 },
          { type: "msg", who: "梁穗", text: "我收到一张奇怪的照片，但是我不知道寄件人是谁。", delay: 2600 },
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "我发给你看看。", delay: 1400 },
        ], 1800);
        flag("has_cropped_clue", true);
        revealFolder();
        chatImg("梁穗", "ritual_cropped", "点击查看");
        await wait(400);
        toast("先点开照片看一看。");
        flag("gate_intro_photo_sent", true);
      } else {
        flag("has_cropped_clue", true);
        revealFolder();
        if (!flag("saw_cropped_clue")) toast("先点开照片看一看。");
      }

      await waitCroppedClueViewed();
      await waitChoice("这张照片……右边是不是被裁掉了？", "intro_cropped");

      if (!flag("gate_intro_after_crop")) {
        await sequence([
          { type: "typing", ms: 1400 },
          { type: "msg", who: "梁穗", text: "对。照片里是我姐姐梁绫。七年了。镇上一直说她是因为我逃走才投的河——可我总觉得不对。", delay: 2800 },
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "……毕业了，也该回去查查当年到底发生了什么了。", delay: 2600 },
        ], 1800);
        flag("gate_intro_after_crop", true);
      }
      await waitChoice("所以你回绛水镇了？", "intro_town");

      if (!flag("gate_intro_after_town")) {
        await sequence([
          { type: "typing", ms: 1200 },
          { type: "msg", who: "梁穗", text: "对。我怀疑民俗馆的旧档案里，还留着这张照片的未裁切原图。", delay: 2400 },
          { type: "typing", ms: 1400 },
          { type: "msg", who: "梁穗", text: "可是村里信号太差，网页经常打不开。我把「绛水镇过绳节民俗馆」的链接发给你——你那边网稳定，能不能帮我在网站上把原图找出来？", delay: 3000 },
        ], 1800);
        flag("gate_intro_after_town", true);
      }
      await waitChoice("好。我去网站上找未裁切的原图。", "intro_museum");

      // 发来网址后才解锁并打开民俗馆
      revealMuseum();
      openWin("browser");
      go("intro", false);
      playDesktopBgm();

      if (!flag("gate_intro_thanks")) {
        await sequence([
          { type: "typing", ms: 1100 },
          { type: "msg", who: "梁穗", text: "谢谢你。真的。", delay: 1600 },
          { type: "msg", who: "sys", text: "桌面出现「民俗馆」。线索已保存到「调查资料」。", cls: "sys", delay: 2000 },
        ], 1600);
        flag("gate_intro_thanks", true);
      }
      toast("民俗馆已解锁");
    } finally {
      startIntroChat._busy = false;
    }
  }

  function bindIntro() {
    let page = 0;
    const pages = $$("#intro-pages .intro-page");
    const dots = $$("#intro-dots span");
    const show = (i) => {
      pages.forEach((p, idx) => p.classList.toggle("active", idx === i));
      dots.forEach((d, idx) => d.classList.toggle("on", idx === i));
      $("#btn-intro-next").textContent = i >= pages.length - 1 ? "打开桌面" : "继续";
    };

    // 标题页：一进来就播；若被浏览器拦截，点屏幕任意处立刻开声
    startTitleBgm();
    const boot = $("#boot-screen");
    const unlockTitle = () => {
      if (!boot || boot.classList.contains("hidden")) return;
      playBgm("title", { fade: 400 });
    };
    boot?.addEventListener("pointerdown", unlockTitle);
    window.addEventListener("keydown", unlockTitle, { once: false });

    $("#btn-prologue").onclick = () => {
      playBgm("title", { fade: 400 });
      $("#boot-screen").classList.add("hidden");
      $("#intro-screen").classList.remove("hidden");
      $("#intro-screen").setAttribute("aria-hidden", "false");
      page = 0;
      show(0);
    };
    $("#btn-intro-next").onclick = () => {
      if (page < pages.length - 1) {
        page++;
        show(page);
      } else {
        enterDesktop();
      }
    };
    $("#btn-intro-skip").onclick = () => enterDesktop();
  }

  function bindUI() {
    bindIntro();

    $$(".desk-icon").forEach(ic => {
      ic.onclick = () => {
        resumeBgmIfNeeded();
        if (ic.id === "icon-restart") {
          confirmRestart();
          return;
        }
        if (ic.id === "icon-chapters") {
          openChapterSelect();
          return;
        }
        if (ic.dataset.open === "browser" && !flag("museum_link") && !flag("searched_rope") &&
            !["ch1", "ch2", "ch3", "ch4", "ending", "epilogue"].includes(state.chapter)) {
          toast("等梁穗把民俗馆链接发过来再打开。");
          return;
        }
        if (ic.dataset.open === "archive" && !flag("archive_ready")) {
          toast("工业档案尚未解锁。");
          return;
        }
        if (ic.dataset.open === "filebox" && !flag("saw_materials")) {
          toast("文件箱尚未解锁。");
          return;
        }
        openWin(ic.dataset.open);
        if (ic.dataset.open === "browser") playDesktopBgm();
        if (ic.dataset.open === "archive" || ic.dataset.open === "filebox") playInvestigateBgm();
      };
    });
    $("#taskbar-restart")?.addEventListener("click", confirmRestart);
    $("#taskbar-chapters")?.addEventListener("click", openChapterSelect);
    $$("[data-close]").forEach(b => b.onclick = () => closeWin(b.dataset.close));
    $$("[data-min]").forEach(b => b.onclick = () => closeWin(b.dataset.min));

    $("#btn-back").onclick = back;
    $("#btn-home").onclick = () => go(state.chapter === "ending" || state.chapter === "epilogue" ? "ending_home" : "intro");
    $("#search-form").onsubmit = (e) => {
      e.preventDefault();
      doSearch($("#site-search").value);
    };
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") closeModal();
    });
    $("#chat-body")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-chat-img]");
      if (!btn) return;
      const key = btn.dataset.chatImg;
      if (key === "ritual_cropped") openCroppedCluePhoto();
      else if (key === "room_panorama") openRoom();
      else if (key === "riverside_fake") showFakeRiverside();
      else if (key === "dyehouse_side") openDyehouseSidePhoto(btn.dataset.chatCaption || "");
      else if (key === "wall_ring") openWallRingFromChat();
      else if (key === "pool3_door") openPool3DoorFromChat();
      else showPhoto(key, btn.dataset.chatCaption || "", "portrait fit-contain");
    });
  }

  // init
  load();
  applyPhoneLayout();
  bindUI();
  tickClock();
  setInterval(tickClock, 30000);
  window.addEventListener("pagehide", () => stopBgm(0));
  window.addEventListener("resize", applyPhoneLayout);
  window.addEventListener("orientationchange", applyPhoneLayout);
})();
