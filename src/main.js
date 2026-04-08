// ─── YourSound CK-1 ─ Main Audio Engine ─────────────────────────────────────

const state = {
  recording: false,
  startTime: null,
  timerInterval: null,
  recordedChunks: [],
  mediaRecorder: null,
  audioCtx: null,
  analyserL: null,
  analyserR: null,
  gainNodes: { sys: null, mic: null, mix: null },
  streams: { sys: null, mic: null, cam: null, scr: null },
  sources: { sys: true, mic: true, cam: false, scr: false },
  clipTimeout: null,
  gains: { sys: 75, mic: 82, mix: 60 },
  engineReady: false,
};

// ─── Knob Renderer ────────────────────────────────────────────────────────────
function drawKnob(canvas, value) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = w / 2 - 4;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const angle = startAngle + (value / 100) * (endAngle - startAngle);

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, startAngle, endAngle);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, startAngle, angle);
  const grad = ctx.createLinearGradient(0, h, w, 0);
  grad.addColorStop(0, '#5030cc'); grad.addColorStop(1, '#9c6fff');
  ctx.strokeStyle = grad; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();

  const bodyGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 2, cx, cy, r - 6);
  bodyGrad.addColorStop(0, '#1e2238'); bodyGrad.addColorStop(1, '#0d1020');
  ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();

  const tickLen = 9;
  const tx = cx + (r - 12) * Math.cos(angle), ty = cy + (r - 12) * Math.sin(angle);
  const tx2 = cx + (r - 21) * Math.cos(angle), ty2 = cy + (r - 21) * Math.sin(angle);
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx2, ty2);
  ctx.strokeStyle = '#9c6fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.shadowColor = '#7c4dff'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
}

function initKnobs() {
  document.querySelectorAll('.knob').forEach(canvas => {
    const id = canvas.id.replace('knob-', '');
    let dragging = false, startY = 0, startVal = 0;
    drawKnob(canvas, state.gains[id] ?? 75);

    canvas.addEventListener('mousedown', e => {
      dragging = true; startY = e.clientY; startVal = state.gains[id] ?? 75; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const val = Math.min(100, Math.max(0, startVal + Math.round(-(e.clientY - startY) * 0.7)));
      state.gains[id] = val;
      drawKnob(canvas, val);
      const el = document.getElementById(`val-${id}`);
      if (el) el.textContent = val;
      applyGain(id, val);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  });
}

function applyGain(id, value) {
  const v = value / 100;
  if (id === 'sys' && state.gainNodes.sys) state.gainNodes.sys.gain.setTargetAtTime(v, state.audioCtx.currentTime, 0.01);
  if (id === 'mic' && state.gainNodes.mic) state.gainNodes.mic.gain.setTargetAtTime(v, state.audioCtx.currentTime, 0.01);
  if (id === 'mix' && state.gainNodes.mix) state.gainNodes.mix.gain.setTargetAtTime(v, state.audioCtx.currentTime, 0.01);
}

// ─── VU Meters ────────────────────────────────────────────────────────────────
const SEGS = 16, GREEN_T = 10, YELLOW_T = 13;

function buildVuColumns() {
  ['vuLeft', 'vuRight'].forEach(id => {
    const col = document.getElementById(id);
    col.innerHTML = '';
    for (let i = 0; i < SEGS; i++) {
      const s = document.createElement('div');
      s.className = 'vu-seg';
      col.appendChild(s);
    }
  });
}

function setVuLevel(colId, level) {
  const segs = document.getElementById(colId).querySelectorAll('.vu-seg');
  const lit = Math.round(level * SEGS);
  segs.forEach((s, i) => {
    s.className = 'vu-seg' + (i < lit ? (i < GREEN_T ? ' lit-green' : i < YELLOW_T ? ' lit-yellow' : ' lit-red') : '');
  });
}

function updateVuMeters(l, r) {
  setVuLevel('vuLeft', l); setVuLevel('vuRight', r);
  if (l > 0.94 || r > 0.94) triggerClip();
}

function triggerClip() {
  const bar = document.getElementById('clipBar');
  bar.classList.add('clipping');
  clearTimeout(state.clipTimeout);
  state.clipTimeout = setTimeout(() => bar.classList.remove('clipping'), 400);
}

// ─── Audio Engine ─────────────────────────────────────────────────────────────
async function initAudioEngine() {
  if (state.engineReady) return;

  state.audioCtx = new AudioContext();
  const ctx = state.audioCtx;
  if (ctx.state === 'suspended') await ctx.resume();

  // Gain nodes
  state.gainNodes.sys = ctx.createGain();
  state.gainNodes.mic = ctx.createGain();
  state.gainNodes.mix = ctx.createGain();
  state.gainNodes.sys.gain.value = state.gains.sys / 100;
  state.gainNodes.mic.gain.value = state.gains.mic / 100;
  state.gainNodes.mix.gain.value = state.gains.mix / 100;

  // Analysers on the mix bus
  state.analyserL = ctx.createAnalyser(); state.analyserL.fftSize = 1024;
  state.analyserR = ctx.createAnalyser(); state.analyserR.fftSize = 1024;

  // sys gain → mix, mic gain → mix
  state.gainNodes.sys.connect(state.gainNodes.mix);
  state.gainNodes.mic.connect(state.gainNodes.mix);
  // Connect mix directly to both analysers — no splitter.
  // Mic is mono so a ChannelSplitter kills the R channel. Both analysers
  // see the same mixed signal; meters respond symmetrically.
  state.gainNodes.mix.connect(state.analyserL);
  state.gainNodes.mix.connect(state.analyserR);

  // ── Microphone ──
  if (state.sources.mic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      state.streams.mic = micStream;
      ctx.createMediaStreamSource(micStream).connect(state.gainNodes.mic);
      updateDeviceList(await navigator.mediaDevices.enumerateDevices());
    } catch (e) {
      console.warn('Mic access denied:', e.message);
      const row = document.getElementById('src-mic');
      if (row) row.style.opacity = '0.4';
    }
  }

  // ── System Audio: requires BlackHole on macOS ──
  if (state.sources.sys) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const bh = devices.filter(d => d.kind === 'audioinput').find(d =>
        /blackhole|soundflower/i.test(d.label)
      );
      if (bh) {
        const sysStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: bh.deviceId }, echoCancellation: false }
        });
        state.streams.sys = sysStream;
        ctx.createMediaStreamSource(sysStream).connect(state.gainNodes.sys);
      } else {
        // No virtual audio device found — show install prompt
        setSysStatus('NEEDS BLACKHOLE');
      }
    } catch (e) {
      console.warn('System audio unavailable:', e.message);
      setSysStatus('NEEDS BLACKHOLE');
    }
  }

  state.engineReady = true;
}

function updateDeviceList(devices) {
  const list = document.getElementById('deviceList');
  if (!list) return;
  const audioIn = devices.filter(d => d.kind === 'audioinput' && d.label);
  if (!audioIn.length) return;
  list.innerHTML = '';
  audioIn.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'device-item' + (i === 0 ? ' selected' : '');
    el.textContent = d.label;
    el.addEventListener('click', () => {
      list.querySelectorAll('.device-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
    list.appendChild(el);
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────
function showStatus(msg, color = '#ff2244') {
  const el = document.getElementById('standbyLabel');
  if (el) { el.textContent = msg; el.style.color = color; }
}

function setSysStatus(msg) {
  const row = document.getElementById('src-sys');
  if (!row) return;
  row.style.opacity = '0.5';
  // Show inline hint under the source row
  let hint = document.getElementById('sys-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'sys-hint';
    hint.style.cssText = 'font-family:var(--mono);font-size:8px;color:#ffe040;letter-spacing:0.1em;padding:4px 10px 2px;line-height:1.5';
    row.parentNode.insertBefore(hint, row.nextSibling);
  }
  hint.innerHTML = `${msg}<br><a href="https://existential.audio/blackhole/" target="_blank" style="color:#7c4dff;text-decoration:none">↗ install blackhole free</a>`;
}

async function startRecording() {
  state.recordedChunks = [];

  // Build a combined MediaStream from all active raw streams
  const tracks = [];

  if (state.sources.mic && state.streams.mic) {
    state.streams.mic.getAudioTracks().forEach(t => tracks.push(t));
  }
  if (state.sources.sys && state.streams.sys) {
    state.streams.sys.getAudioTracks().forEach(t => tracks.push(t));
  }
  if (state.sources.cam && state.streams.cam) {
    state.streams.cam.getVideoTracks().forEach(t => tracks.push(t));
    state.streams.cam.getAudioTracks().forEach(t => tracks.push(t));
  }

  if (!tracks.length) {
    showStatus('NO SOURCE', '#ff2244');
    document.getElementById('readyLabel').textContent = 'NO SOURCE';
    document.getElementById('readyLabel').style.color = '#ff2244';
    throw new Error('No active audio/video tracks — enable at least one source.');
  }

  const combinedStream = new MediaStream(tracks);

  // Pick best available mime type
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
                 'audio/webm;codecs=opus', 'audio/webm', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  state.mediaRecorder = new MediaRecorder(combinedStream, mime ? { mimeType: mime } : {});
  state.mediaRecorder.addEventListener('dataavailable', e => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  });
  state.mediaRecorder.start(100);

  state.recording = true;
  state.startTime = Date.now();

  state.timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - state.startTime) / 1000);
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopRecording() {
  return new Promise(resolve => {
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') { resolve(); return; }
    state.mediaRecorder.addEventListener('stop', resolve, { once: true });
    state.mediaRecorder.stop();
  }).then(() => {
    state.recording = false;
    clearInterval(state.timerInterval);
  });
}

async function saveRecording() {
  if (!state.recordedChunks.length) {
    alert('No recording to save. Record something first.');
    return;
  }
  const hasVideo = state.sources.cam;
  const type = hasVideo ? 'video/webm' : 'audio/webm';
  const ext  = hasVideo ? 'webm' : 'webm';
  const blob = new Blob(state.recordedChunks, { type });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `yoursound_${stamp}.${ext}`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Camera Toggle ────────────────────────────────────────────────────────────
async function enableCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.streams.cam = stream;
    const vid = document.getElementById('camPreview');
    vid.srcObject = stream;
    vid.classList.add('active');
    document.getElementById('camLabel').classList.add('active');
    document.getElementById('spatialCanvas').style.display = 'none';
  } catch (e) {
    console.warn('Camera access denied:', e.message);
    document.getElementById('toggle-cam').checked = false;
    state.sources.cam = false;
  }
}

function disableCamera() {
  if (state.streams.cam) {
    state.streams.cam.getTracks().forEach(t => t.stop());
    state.streams.cam = null;
  }
  const vid = document.getElementById('camPreview');
  vid.srcObject = null;
  vid.classList.remove('active');
  document.getElementById('camLabel').classList.remove('active');
  document.getElementById('spatialCanvas').style.display = '';
}

// ─── Source Toggles ───────────────────────────────────────────────────────────
function initSourceToggles() {
  ['sys', 'mic', 'cam', 'scr'].forEach(id => {
    const cb = document.getElementById(`toggle-${id}`);
    const row = document.getElementById(`src-${id}`);
    if (!cb || !row) return;

    cb.addEventListener('change', async () => {
      state.sources[id] = cb.checked;
      row.classList.toggle('active', cb.checked);
      row.querySelector('.source-dot').style.opacity = cb.checked ? '1' : '0.3';
      row.style.opacity = '1'; // reset any dimming from failed init
      // Force re-init next record click so new source is picked up
      if (id === 'mic' || id === 'sys') {
        state.engineReady = false;
        if (id === 'sys') {
          const hint = document.getElementById('sys-hint');
          if (hint) hint.remove();
        }
      }

      if (id === 'cam') {
        if (cb.checked) await enableCamera();
        else disableCamera();
      }

      // Mute/unmute gain nodes if engine is running
      if (state.engineReady) {
        if (id === 'sys' && state.gainNodes.sys)
          state.gainNodes.sys.gain.setTargetAtTime(cb.checked ? state.gains.sys/100 : 0, state.audioCtx.currentTime, 0.01);
        if (id === 'mic' && state.gainNodes.mic)
          state.gainNodes.mic.gain.setTargetAtTime(cb.checked ? state.gains.mic/100 : 0, state.audioCtx.currentTime, 0.01);
      }
    });
  });
}

// ─── VU Loop ─────────────────────────────────────────────────────────────────
function startVuLoop() {
  (function tick() {
    requestAnimationFrame(tick);
    if (state.analyserL && state.analyserR && state.engineReady) {
      const bL = new Uint8Array(state.analyserL.fftSize);
      const bR = new Uint8Array(state.analyserR.fftSize);
      state.analyserL.getByteTimeDomainData(bL);
      state.analyserR.getByteTimeDomainData(bR);
      updateVuMeters(Math.min(1, rms(bL)), Math.min(1, rms(bR)));
    } else if (state.recording) {
      const t = Date.now() / 1000;
      updateVuMeters(
        Math.min(1, 0.45 + Math.sin(t * 2.1) * 0.2 + Math.random() * 0.07),
        Math.min(1, 0.42 + Math.sin(t * 1.8 + 0.3) * 0.2 + Math.random() * 0.07)
      );
    } else {
      updateVuMeters(0, 0);
    }
  })();
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function startWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  let phase = 0;

  function resize() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
  resize();
  window.addEventListener('resize', resize);

  (function draw() {
    requestAnimationFrame(draw);
    const { width: W, height: H } = canvas;
    const cy = H / 2;
    ctx.clearRect(0, 0, W, H);

    if (!state.recording) {
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.strokeStyle = 'rgba(68,138,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }

    let samples = null;
    if (state.analyserL) {
      const buf = new Uint8Array(state.analyserL.fftSize);
      state.analyserL.getByteTimeDomainData(buf);
      samples = buf;
    }

    phase += 0.06;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      let y;
      if (samples) {
        const idx = Math.floor((x / W) * samples.length);
        y = cy + ((samples[idx] - 128) / 128) * (H * 0.42);
      } else {
        const env = 0.35 + Math.sin(phase * 0.3) * 0.2;
        y = cy + Math.sin(phase + x * 0.04) * H * env * 0.45
               + Math.sin(phase * 1.7 + x * 0.09) * H * env * 0.15;
      }
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#448aff'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#448aff'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
  })();
}

// ─── Spatial Canvas ───────────────────────────────────────────────────────────
const ORB_DEFS = {
  sys: { color: '#7c4dff', glow: 'rgba(124,77,255,', x: 0.35, y: 0.45, vx: 0.0003, vy: 0.0002 },
  mic: { color: '#448aff', glow: 'rgba(68,138,255,',  x: 0.55, y: 0.38, vx:-0.0002, vy: 0.0003 },
  cam: { color: '#18ffcf', glow: 'rgba(24,255,207,',  x: 0.62, y: 0.60, vx: 0.0002, vy:-0.0003 },
  scr: { color: '#ff6b35', glow: 'rgba(255,107,53,',  x: 0.30, y: 0.60, vx:-0.0003, vy:-0.0002 },
};

function initSpatialCanvas() {
  const canvas = document.getElementById('spatialCanvas');
  const particles = Array.from({ length: 80 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0001, vy: (Math.random() - 0.5) * 0.0001,
    r: Math.random() * 1.5 + 0.5, a: Math.random() * 0.4 + 0.1,
  }));
  const orbs = Object.entries(ORB_DEFS).map(([id, d]) => ({ id, ...d, phase: Math.random() * Math.PI * 2 }));

  function resize() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
  resize();
  window.addEventListener('resize', resize);

  (function frame() {
    requestAnimationFrame(frame);
    const { width: W, height: H } = canvas;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(80,60,160,0.07)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 38) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 38) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Radial center glow
    const g = ctx.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,W*.6);
    g.addColorStop(0,'rgba(60,20,120,0.1)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

    // Particles
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x<0) p.x=1; if (p.x>1) p.x=0; if (p.y<0) p.y=1; if (p.y>1) p.y=0;
      ctx.beginPath(); ctx.arc(p.x*W, p.y*H, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(100,80,200,${p.a})`; ctx.fill();
    });

    // Connection lines between active orbs
    const active = orbs.filter(o => state.sources[o.id]);
    for (let i = 0; i < active.length; i++) for (let j = i+1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const dist = Math.hypot((a.x-b.x)*W, (a.y-b.y)*H);
      if (dist < 260) {
        ctx.beginPath(); ctx.moveTo(a.x*W,a.y*H); ctx.lineTo(b.x*W,b.y*H);
        ctx.strokeStyle = `rgba(124,77,255,${(1-dist/260)*0.22})`; ctx.lineWidth=1; ctx.stroke();
      }
    }

    // Orbs
    orbs.forEach(orb => {
      const isActive = state.sources[orb.id];
      const speed = state.recording ? 1.8 : 0.6;
      orb.x += orb.vx * speed; orb.y += orb.vy * speed;
      if (orb.x<0.08||orb.x>0.92) orb.vx*=-1;
      if (orb.y<0.08||orb.y>0.92) orb.vy*=-1;
      orb.phase += 0.02 * speed;

      const ox = orb.x*W, oy = orb.y*H;
      if (!isActive) {
        ctx.beginPath(); ctx.arc(ox,oy,5,0,Math.PI*2);
        ctx.fillStyle = orb.color+'22'; ctx.fill(); return;
      }

      const pulse = 1 + Math.sin(orb.phase) * 0.15;
      const r = 22 * pulse;
      const gr = ctx.createRadialGradient(ox,oy,0,ox,oy,r*3.5);
      gr.addColorStop(0,orb.glow+'0.28)'); gr.addColorStop(0.5,orb.glow+'0.07)'); gr.addColorStop(1,orb.glow+'0)');
      ctx.beginPath(); ctx.arc(ox,oy,r*3.5,0,Math.PI*2); ctx.fillStyle=gr; ctx.fill();
      const br = ctx.createRadialGradient(ox-r*.3,oy-r*.3,1,ox,oy,r);
      br.addColorStop(0,orb.color+'ff'); br.addColorStop(1,orb.color+'88');
      ctx.beginPath(); ctx.arc(ox,oy,r,0,Math.PI*2); ctx.fillStyle=br;
      ctx.shadowColor=orb.color; ctx.shadowBlur=18; ctx.fill(); ctx.shadowBlur=0;
    });
  })();
}

// ─── Record Button ────────────────────────────────────────────────────────────
function initRecordButton() {
  const btn = document.getElementById('recordBtn');
  const ring = document.getElementById('recordRing');
  const standby = document.getElementById('standbyLabel');
  const badge = document.getElementById('statusBadge');
  const readyLabel = document.getElementById('readyLabel');

  btn.addEventListener('click', async () => {
    if (!state.recording) {
      btn.disabled = true;
      standby.textContent = 'STARTING…';
      standby.style.color = '';

      try {
        await initAudioEngine();
        await startRecording();
        // Only update UI if recording actually started
        btn.classList.add('recording');
        ring.classList.add('pulsing');
        standby.textContent = '● LIVE'; standby.classList.add('live'); standby.style.color = '#ff2244';
        readyLabel.textContent = '● REC'; readyLabel.style.color = '#ff2244';
        badge.textContent = 'LIVE'; badge.style.color = '#ff2244';
      } catch (err) {
        console.error('Record failed:', err.message);
        // Reset to standby — don't show LIVE
        standby.textContent = 'NO SOURCE'; standby.style.color = '#ff2244';
        readyLabel.textContent = 'READY'; readyLabel.style.color = '';
      }
      btn.disabled = false;
    } else {
      await stopRecording();
      btn.classList.remove('recording');
      ring.classList.remove('pulsing');
      standby.textContent = 'CAPTURED'; standby.classList.remove('live'); standby.style.color = '#1aff8a';
      readyLabel.textContent = 'CAPTURED'; readyLabel.style.color = '#1aff8a';
      badge.textContent = 'STANDBY'; badge.style.color = '';
    }
  });
}

// ─── Save Button ──────────────────────────────────────────────────────────────
function initSaveButton() {
  document.getElementById('saveBtn').addEventListener('click', saveRecording);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildVuColumns();
  initKnobs();
  initSourceToggles();
  initRecordButton();
  initSaveButton();
  initSpatialCanvas();
  startWaveform();
  startVuLoop();
});
