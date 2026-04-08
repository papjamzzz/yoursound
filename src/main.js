// ─── YourSound CK-1 ─ Main Audio Engine ─────────────────────────────────────

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  recording: false,
  startTime: null,
  timerInterval: null,
  recordedChunks: [],
  mediaRecorder: null,
  audioCtx: null,
  analyserL: null,
  analyserR: null,
  splitter: null,
  merger: null,
  gainNodes: { sys: null, mic: null, mix: null },
  streams: { sys: null, mic: null, cam: null, scr: null },
  sourceNodes: { sys: null, mic: null },
  sources: { sys: true, mic: true, cam: false, scr: false },
  clipTimeout: null,
  gains: { sys: 75, mic: 82, mix: 60 },
};

// ─── Knob Renderer ────────────────────────────────────────────────────────────
function drawKnob(canvas, value) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = (w / 2) - 4;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const pct = value / 100;
  const angle = startAngle + pct * (endAngle - startAngle);

  ctx.clearRect(0, 0, w, h);

  // Track bg
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, startAngle, endAngle);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Active arc
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, startAngle, angle);
  const grad = ctx.createLinearGradient(0, h, w, 0);
  grad.addColorStop(0, '#5030cc');
  grad.addColorStop(1, '#9c6fff');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Body
  const bodyGrad = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, 2, cx, cy, r - 6);
  bodyGrad.addColorStop(0, '#1e2238');
  bodyGrad.addColorStop(1, '#0d1020');
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tick
  const tickLen = 9;
  const tx = cx + (r - 12) * Math.cos(angle);
  const ty = cy + (r - 12) * Math.sin(angle);
  const tx2 = cx + (r - 12 - tickLen) * Math.cos(angle);
  const ty2 = cy + (r - 12 - tickLen) * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx2, ty2);
  ctx.strokeStyle = '#9c6fff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.shadowColor = '#7c4dff';
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ─── Knob Drag Interaction ────────────────────────────────────────────────────
function initKnobs() {
  const knobs = document.querySelectorAll('.knob');
  knobs.forEach(canvas => {
    const id = canvas.id.replace('knob-', '');
    let dragging = false, startY = 0, startVal = 0;

    drawKnob(canvas, parseInt(canvas.dataset.value));

    canvas.addEventListener('mousedown', e => {
      dragging = true;
      startY = e.clientY;
      startVal = state.gains[id] ?? 75;
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = -(e.clientY - startY);
      const newVal = Math.min(100, Math.max(0, startVal + Math.round(delta * 0.7)));
      state.gains[id] = newVal;
      drawKnob(canvas, newVal);
      const valEl = document.getElementById(`val-${id}`);
      if (valEl) valEl.textContent = newVal;
      applyGain(id, newVal);
    });

    window.addEventListener('mouseup', () => { dragging = false; });
  });
}

function applyGain(id, value) {
  const linear = value / 100;
  if (id === 'sys' && state.gainNodes.sys) state.gainNodes.sys.gain.value = linear;
  if (id === 'mic' && state.gainNodes.mic) state.gainNodes.mic.gain.value = linear;
  if (id === 'mix' && state.gainNodes.mix) state.gainNodes.mix.gain.value = linear;
}

// ─── VU Meters ────────────────────────────────────────────────────────────────
const SEGMENTS = 16;
const GREEN_THRESH = 10;
const YELLOW_THRESH = 13;

function buildVuColumns() {
  ['vuLeft', 'vuRight'].forEach(id => {
    const col = document.getElementById(id);
    col.innerHTML = '';
    for (let i = 0; i < SEGMENTS; i++) {
      const seg = document.createElement('div');
      seg.className = 'vu-seg';
      col.appendChild(seg);
    }
  });
}

function updateVuMeters(levelL, levelR) {
  setVuLevel('vuLeft', levelL);
  setVuLevel('vuRight', levelR);
  // CLIP detection
  if (levelL > 0.95 || levelR > 0.95) triggerClip();
}

function setVuLevel(colId, level) {
  const col = document.getElementById(colId);
  const segs = col.querySelectorAll('.vu-seg');
  const litCount = Math.round(level * SEGMENTS);
  segs.forEach((seg, i) => {
    seg.className = 'vu-seg';
    if (i < litCount) {
      if (i < GREEN_THRESH) seg.classList.add('lit-green');
      else if (i < YELLOW_THRESH) seg.classList.add('lit-yellow');
      else seg.classList.add('lit-red');
    }
  });
}

function triggerClip() {
  const bar = document.getElementById('clipBar');
  bar.classList.add('clipping');
  clearTimeout(state.clipTimeout);
  state.clipTimeout = setTimeout(() => bar.classList.remove('clipping'), 400);
}

// ─── Spatial Canvas Visualizer ────────────────────────────────────────────────
let orbs, particles, spatialAnim;

const ORB_DEFS = {
  sys: { color: '#7c4dff', glowColor: 'rgba(124,77,255,', x: 0.35, y: 0.45, vx: 0.0003, vy: 0.0002 },
  mic: { color: '#448aff', glowColor: 'rgba(68,138,255,', x: 0.55, y: 0.38, vx: -0.0002, vy: 0.0003 },
  cam: { color: '#18ffcf', glowColor: 'rgba(24,255,207,', x: 0.62, y: 0.6,  vx: 0.0002, vy: -0.0003 },
  scr: { color: '#ff6b35', glowColor: 'rgba(255,107,53,', x: 0.3,  y: 0.6,  vx: -0.0003, vy: -0.0002 },
};

function initSpatialCanvas() {
  const canvas = document.getElementById('spatialCanvas');

  particles = Array.from({ length: 80 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0001,
    vy: (Math.random() - 0.5) * 0.0001,
    size: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.4 + 0.1,
  }));

  orbs = Object.entries(ORB_DEFS).map(([id, def]) => ({
    id, ...def,
    phase: Math.random() * Math.PI * 2,
    speed: 1,
  }));

  function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let t = 0;
  function drawFrame() {
    spatialAnim = requestAnimationFrame(drawFrame);
    t += 0.016;
    const { width: W, height: H } = canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Deep bg fill
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(80,60,160,0.08)';
    ctx.lineWidth = 1;
    const gridSpacing = 38;
    for (let x = 0; x < W; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Radial glow center
    const glow = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.6);
    glow.addColorStop(0, 'rgba(60,20,120,0.12)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Particles
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
      if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,80,200,${p.alpha})`;
      ctx.fill();
    });

    // Active orbs
    const activeOrbs = orbs.filter(o => state.sources[o.id]);

    // Connection lines between nearby active orbs
    for (let i = 0; i < activeOrbs.length; i++) {
      for (let j = i + 1; j < activeOrbs.length; j++) {
        const a = activeOrbs[i], b = activeOrbs[j];
        const ax = a.x * W, ay = a.y * H;
        const bx = b.x * W, by = b.y * H;
        const dist = Math.hypot(ax - bx, ay - by);
        if (dist < 260) {
          const alpha = (1 - dist / 260) * 0.25;
          ctx.beginPath();
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          ctx.strokeStyle = `rgba(124,77,255,${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Orbs
    orbs.forEach(orb => {
      const active = state.sources[orb.id];
      const speed = state.recording ? 1.8 : 0.6;

      // Drift
      orb.x += orb.vx * speed;
      orb.y += orb.vy * speed;
      if (orb.x < 0.08 || orb.x > 0.92) orb.vx *= -1;
      if (orb.y < 0.08 || orb.y > 0.92) orb.vy *= -1;

      orb.phase += 0.02 * speed;
      const pulse = active ? 1 + Math.sin(orb.phase) * 0.15 : 0.5;
      const baseR = active ? 22 : 8;
      const r = baseR * pulse;
      const ox = orb.x * W, oy = orb.y * H;

      if (!active) {
        ctx.beginPath();
        ctx.arc(ox, oy, 5, 0, Math.PI * 2);
        ctx.fillStyle = orb.color + '22';
        ctx.fill();
        return;
      }

      // Glow
      const glowR = r * 3.5;
      const glowGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, glowR);
      glowGrad.addColorStop(0, orb.glowColor + '0.3)');
      glowGrad.addColorStop(0.5, orb.glowColor + '0.08)');
      glowGrad.addColorStop(1, orb.glowColor + '0)');
      ctx.beginPath();
      ctx.arc(ox, oy, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // Orb body
      const orbGrad = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.3, 1, ox, oy, r);
      orbGrad.addColorStop(0, orb.color + 'ff');
      orbGrad.addColorStop(1, orb.color + '88');
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.shadowColor = orb.color;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  drawFrame();
}

// ─── Waveform Canvas ──────────────────────────────────────────────────────────
let waveAnim;

function startWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  let phase = 0;

  function resizeWave() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resizeWave();
  window.addEventListener('resize', resizeWave);

  function drawWave() {
    waveAnim = requestAnimationFrame(drawWave);
    const { width: W, height: H } = canvas;
    const cy = H / 2;
    ctx.clearRect(0, 0, W, H);

    if (!state.recording) {
      // Flat line
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(W, cy);
      ctx.strokeStyle = 'rgba(68,138,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }

    // If we have an analyser, use real data
    let samples;
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
        y = cy + Math.sin(phase + x * 0.04) * H * env * 0.5
              + Math.sin(phase * 1.7 + x * 0.09) * H * env * 0.15;
      }
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#448aff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#448aff';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill below
    ctx.lineTo(W, cy);
    ctx.lineTo(0, cy);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, cy - H * 0.3, 0, cy + 10);
    fillGrad.addColorStop(0, 'rgba(68,138,255,0.15)');
    fillGrad.addColorStop(1, 'rgba(68,138,255,0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
  }

  drawWave();
}

// ─── VU Animation Loop ────────────────────────────────────────────────────────
let vuAnim;

function startVuLoop() {
  function tick() {
    vuAnim = requestAnimationFrame(tick);
    let levelL = 0, levelR = 0;

    if (state.analyserL && state.analyserR) {
      const bufL = new Uint8Array(state.analyserL.fftSize);
      const bufR = new Uint8Array(state.analyserR.fftSize);
      state.analyserL.getByteTimeDomainData(bufL);
      state.analyserR.getByteTimeDomainData(bufR);
      levelL = computeRMS(bufL);
      levelR = computeRMS(bufR);
    } else if (state.recording) {
      // Simulated meter when no analyser
      const t = Date.now() / 1000;
      levelL = 0.45 + Math.sin(t * 2.1) * 0.2 + Math.random() * 0.08;
      levelR = 0.42 + Math.sin(t * 1.8 + 0.3) * 0.2 + Math.random() * 0.08;
    }

    updateVuMeters(Math.min(1, levelL), Math.min(1, levelR));
  }
  tick();
}

function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

// ─── Audio Engine Init ────────────────────────────────────────────────────────
async function initAudioEngine() {
  try {
    state.audioCtx = new AudioContext();
    const ctx = state.audioCtx;

    state.gainNodes.sys = ctx.createGain();
    state.gainNodes.mic = ctx.createGain();
    state.gainNodes.mix = ctx.createGain();
    state.gainNodes.sys.gain.value = state.gains.sys / 100;
    state.gainNodes.mic.gain.value = state.gains.mic / 100;
    state.gainNodes.mix.gain.value = state.gains.mix / 100;

    state.analyserL = ctx.createAnalyser();
    state.analyserR = ctx.createAnalyser();
    state.analyserL.fftSize = 512;
    state.analyserR.fftSize = 512;

    state.merger = ctx.createChannelMerger(2);
    state.splitter = ctx.createChannelSplitter(2);

    // Mic input
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    state.streams.mic = micStream;
    state.sourceNodes.mic = ctx.createMediaStreamSource(micStream);
    state.sourceNodes.mic.connect(state.gainNodes.mic);
    state.gainNodes.mic.connect(state.gainNodes.mix);

    // Try to find BlackHole / system audio device
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const blackhole = audioInputs.find(d =>
      d.label.toLowerCase().includes('blackhole') ||
      d.label.toLowerCase().includes('multi-output') ||
      d.label.toLowerCase().includes('soundflower')
    );

    if (blackhole && state.sources.sys) {
      const sysStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: blackhole.deviceId }, echoCancellation: false }
      });
      state.streams.sys = sysStream;
      state.sourceNodes.sys = ctx.createMediaStreamSource(sysStream);
      state.sourceNodes.sys.connect(state.gainNodes.sys);
      state.gainNodes.sys.connect(state.gainNodes.mix);
    }

    // Mix → splitter → analysers
    state.gainNodes.mix.connect(state.splitter);
    state.splitter.connect(state.analyserL, 0);
    state.splitter.connect(state.analyserR, 1);

    // For recording destination
    state.gainNodes.mix.connect(ctx.destination);

    updateDeviceList(audioInputs);
  } catch (err) {
    console.warn('Audio engine init:', err.message);
    // Continue — VU meters will use simulation
  }
}

function updateDeviceList(devices) {
  const list = document.getElementById('deviceList');
  if (!list || !devices.length) return;
  list.innerHTML = '';
  devices.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'device-item' + (i === 0 ? ' selected' : '');
    el.textContent = d.label || `Audio Device ${i + 1}`;
    el.addEventListener('click', () => {
      list.querySelectorAll('.device-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
    list.appendChild(el);
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────
async function startRecording() {
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    await state.audioCtx.resume();
  }

  state.recordedChunks = [];

  // Create a stream destination for recording
  let stream;
  if (state.audioCtx && state.gainNodes.mix) {
    const dest = state.audioCtx.createMediaStreamDestination();
    state.gainNodes.mix.connect(dest);
    stream = dest.stream;
  } else {
    // Fallback: try mic only
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.streams.mic = stream;
    } catch (e) {
      console.warn('Fallback recording failed:', e);
      return;
    }
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  state.mediaRecorder = new MediaRecorder(stream, { mimeType });
  state.mediaRecorder.addEventListener('dataavailable', e => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  });
  state.mediaRecorder.start(100);

  state.recording = true;
  state.startTime = Date.now();

  // Timer
  state.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${h}:${m}:${s}`;
    document.getElementById('readyLabel').textContent = '● REC';
    document.getElementById('readyLabel').style.color = '#ff2244';
  }, 1000);
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.recording = false;
  clearInterval(state.timerInterval);
  document.getElementById('readyLabel').textContent = 'CAPTURED';
  document.getElementById('readyLabel').style.color = '#1aff8a';
}

function saveRecording() {
  if (!state.recordedChunks.length) {
    alert('No recording to save. Record something first.');
    return;
  }
  const blob = new Blob(state.recordedChunks, { type: 'audio/webm' });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `yoursound_${stamp}.webm`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Source Toggles ───────────────────────────────────────────────────────────
function initSourceToggles() {
  const toggleIds = ['sys', 'mic', 'cam', 'scr'];
  toggleIds.forEach(id => {
    const checkbox = document.getElementById(`toggle-${id}`);
    const row = document.getElementById(`src-${id}`);
    if (!checkbox || !row) return;

    checkbox.addEventListener('change', () => {
      state.sources[id] = checkbox.checked;
      row.classList.toggle('active', checkbox.checked);

      // Update dot opacity
      const dot = row.querySelector('.source-dot');
      if (dot) dot.style.opacity = checkbox.checked ? '1' : '0.3';

      // Mute/unmute audio nodes
      if (id === 'sys' && state.gainNodes.sys) {
        state.gainNodes.sys.gain.value = checkbox.checked ? state.gains.sys / 100 : 0;
      }
      if (id === 'mic' && state.gainNodes.mic) {
        state.gainNodes.mic.gain.value = checkbox.checked ? state.gains.mic / 100 : 0;
      }
    });
  });
}

// ─── Record Button ────────────────────────────────────────────────────────────
function initRecordButton() {
  const btn = document.getElementById('recordBtn');
  const ring = document.getElementById('recordRing');
  const standby = document.getElementById('standbyLabel');
  const statusBadge = document.getElementById('statusBadge');

  btn.addEventListener('click', async () => {
    if (!state.recording) {
      // Start
      if (!state.audioCtx) await initAudioEngine();
      await startRecording();
      btn.classList.add('recording');
      ring.classList.add('pulsing');
      standby.textContent = '● LIVE';
      standby.classList.add('live');
      statusBadge.textContent = 'LIVE';
      statusBadge.style.color = '#ff2244';
    } else {
      // Stop
      stopRecording();
      btn.classList.remove('recording');
      ring.classList.remove('pulsing');
      standby.textContent = 'CAPTURED';
      standby.classList.remove('live');
      standby.style.color = '#1aff8a';
      statusBadge.textContent = 'STANDBY';
      statusBadge.style.color = '';
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
