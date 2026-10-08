/**
 * ============================================================================
 * MINIMAL SPEECH-TO-SPEECH AI COMPANION
 * Anime-Cute Floating Voice Assistant with Audio-Reactive Eyes & Spectrum Mouth
 * ============================================================================
 * 
 * Architecture:
 * - Section 1: Customization Variables (Iris color, glow, mouth bar count)
 * - Section 2: Face Visuals (Canvas 60fps rendering, eye tracking, blinks, expressions)
 * - Section 3: Web Audio Hookup (AudioContext, AnalyserNodes, spectrum extraction)
 * - Section 4: STT Pipeline (Microphone capture & 16kHz PCM streaming)
 * - Section 5: LLM & WebSocket Protocol (JSON events, token streaming, state machine)
 * - Section 6: TTS Pipeline (AudioBuffer decoding, queueing, barge-in interruption)
 * - Section 7: UI Controls, Accessibility & Lifecycle
 */

(function () {
  'use strict';

  // ==========================================================================
  // 1. LAUNCHER & COMPANION CUSTOMIZATION VARIABLES
  // ==========================================================================
  const CAPTION_LINES = [
    "Heyy there! Want some help?",
    "Got questions? Just ask me!",
    "Psst... talk to me"
  ];
  const CAPTION_DELAY = 3000;                      // 1. Caption delay after page load (ms)
  const CAPTION_VISIBLE_DURATION = 6000;           // 2. Caption visible duration (ms)
  const CAPTION_REPEAT_INTERVAL = 10000;           // 3. Caption repeat interval (ms)
  const EYE_COLOR = '#70F3FF';                     // 4. Eye glow color (cyan)
  const GLOW_COLOR = 'rgba(0, 240, 255, 0.4)';     // 5. Ambient glow color
  const ORB_SIZE = 72;                             // Orb size (px on desktop, 64px mobile)
  const MOUTH_BAR_COUNT = 11;                      // Mouth audio spectrum bars (9-15)

  // ==========================================================================
  // Default Bridge & Audio Configuration
  // ==========================================================================
  const STORAGE_KEY = 'LEO_VOICE_WS_URL';
  const LOCAL_WS_URL = 'ws://127.0.0.1:8765/ws/voice';
  const NGROK_WS_URL = 'wss://alia-pseudocotyledonal-alison.ngrok-free.app/ws/voice';
  const DEFAULT_WS_URL = LOCAL_WS_URL;

  const TARGET_SAMPLE_RATE = 16000;
  const FRAME_SAMPLES = 512; // 32ms at 16kHz

  function normalizeWsUrl(rawUrl) {
    if (!rawUrl) return DEFAULT_WS_URL;
    let url = rawUrl.trim();
    url = url.replace('0.0.0.0', '127.0.0.1');
    if (url.startsWith('https://')) url = 'wss://' + url.slice(8);
    else if (url.startsWith('http://')) url = 'ws://' + url.slice(7);
    else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = (url.includes('ngrok') ? 'wss://' : 'ws://') + url;
    }
    try {
      const parsed = new URL(url.replace('wss://', 'https://').replace('ws://', 'http://'));
      let pathname = parsed.pathname;
      if (!pathname || pathname === '/' || pathname === '') pathname = '/ws/voice';
      const proto = url.startsWith('wss://') ? 'wss://' : 'ws://';
      return proto + parsed.host + pathname;
    } catch (e) {
      if (!url.includes('/')) url = url + '/ws/voice';
      return url;
    }
  }

  // State Management: 'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected'
  let currentState = 'idle';
  let isOpen = false;
  let isMuted = false;
  let isSpeakerMuted = false;
  let showCaptions = true;
  let ws = null;
  let wsUrl = localStorage.getItem(STORAGE_KEY) || DEFAULT_WS_URL;

  // Web Audio Nodes
  let audioCtx = null;
  let micStream = null;
  let micSourceNode = null;
  let micProcessorNode = null;
  let micAnalyser = null;
  let speakerAnalyser = null;

  // TTS Queue & Barge-in
  let activeAudioSources = [];
  let nextPlayTime = 0;
  let currentAiQuote = '';

  // Animation & Rendering Loop
  let animFrameId = null;
  let launcherAnimFrameId = null;
  let isTabVisible = true;
  let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Launcher & Companion Interactive State
  let isLauncherHovered = false;
  let isWidgetFaceHovered = false;
  let isAttentionMoving = false;
  let attentionTimer = null;
  let captionIndex = 0;
  let captionInitialTimeout = null;
  let captionNextTimeout = null;
  let captionHideTimeout = null;
  let captionTypewriterInterval = null;
  let hasOpenedChat = sessionStorage.getItem('LEO_COMPANION_CHAT_OPENED') === 'true';

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    prefersReducedMotion = e.matches;
  });

  // ==========================================================================
  // 2. FACE VISUALS (CANVAS RENDERING, EYE TRACKING & EXPRESSIONS)
  // ==========================================================================
  const faceState = {
    // Pointer tracking
    targetCursorX: 0,
    targetCursorY: 0,
    hasMovedCursor: false,
    lastCursorMoveTime: Date.now(),

    // Smooth whole-eye offsets (eased a few px toward cursor, not inner pupils)
    leftEyeOffsetX: 0,
    leftEyeOffsetY: 0,
    rightEyeOffsetX: 0,
    rightEyeOffsetY: 0,

    // Idle drift & occasional subtle glance
    idleGlanceX: 0,
    idleGlanceY: 0,
    lastGlanceTime: Date.now(),
    glanceDuration: 700,
    isGlancing: false,

    // Slow blinks (pill squashes vertically)
    blinkProgress: 0, // 0 = open, 1 = fully squashed
    isBlinking: false,
    blinkStartTime: 0,
    blinkDuration: 180, // calm, robotic-smooth blink
    nextBlinkTime: Date.now() + 3000,
    isDoubleBlinkPending: false,

    // Dynamic mouth bars (spectrum; flat neutral dots at rest)
    mouthBars: new Array(MOUTH_BAR_COUNT).fill(3.2),

    // Audio energy smoothing
    smoothedSpeakerVolume: 0,
    smoothedMicVolume: 0,
  };

  // Setup cursor and touch listeners across the entire window
  function initPointerTracking() {
    function onPointerMove(x, y) {
      faceState.targetCursorX = x;
      faceState.targetCursorY = y;
      faceState.hasMovedCursor = true;
      faceState.lastCursorMoveTime = Date.now();
      faceState.isGlancing = false;
    }

    window.addEventListener('mousemove', (e) => {
      onPointerMove(e.clientX, e.clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 0) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
  }

  // Update eye position, idle drift, random blinks, and spectrum bars
  function updateFacePhysics(canvas, rect) {
    const now = Date.now();
    const lerpFactor = prefersReducedMotion ? 0.04 : 0.085;
    // Move whole eye shape slightly toward cursor (a few px, eased)
    const maxEyeOffset = prefersReducedMotion ? 2 : 5.5;

    // 1. Check Idle Drift (> 3s without cursor movement)
    const isIdleCursor = !faceState.hasMovedCursor || (now - faceState.lastCursorMoveTime > 3000);

    if (isIdleCursor) {
      // Occasional random subtle glance
      if (!faceState.isGlancing && now - faceState.lastGlanceTime > 3400 + Math.random() * 2600) {
        faceState.isGlancing = true;
        faceState.lastGlanceTime = now;
        faceState.idleGlanceX = (Math.random() - 0.5) * 5.5;
        faceState.idleGlanceY = (Math.random() - 0.5) * 3.5;
      } else if (faceState.isGlancing && now - faceState.lastGlanceTime > faceState.glanceDuration) {
        faceState.isGlancing = false;
        faceState.idleGlanceX = 0;
        faceState.idleGlanceY = 0;
      }
    }

    // 2. Moderate eye centers (not wide-set)
    const leftEyeCenterX = rect.left + rect.width * 0.38;
    const rightEyeCenterX = rect.left + rect.width * 0.62;
    const eyeCenterY = rect.top + rect.height * 0.44;

    function calcTargetOffset(eyeX, eyeY) {
      if (currentState === 'thinking') {
        // Thinking expression: eyes shift up and to the side
        return { x: -3.5, y: -6.0 };
      }

      if (isIdleCursor) {
        return { x: faceState.idleGlanceX, y: faceState.idleGlanceY };
      }

      const dx = faceState.targetCursorX - eyeX;
      const dy = faceState.targetCursorY - eyeY;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      // Subtle lean towards cursor
      const radiusBoost = currentState === 'listening' ? 1.15 : 1.0;
      const offsetDist = Math.min(maxEyeOffset * radiusBoost, dist * 0.024);

      return {
        x: Math.cos(angle) * offsetDist,
        y: Math.sin(angle) * offsetDist,
      };
    }

    const leftTarget = calcTargetOffset(leftEyeCenterX, eyeCenterY);
    const rightTarget = calcTargetOffset(rightEyeCenterX, eyeCenterY);

    // Smooth whole-eye movement
    faceState.leftEyeOffsetX += (leftTarget.x - faceState.leftEyeOffsetX) * lerpFactor;
    faceState.leftEyeOffsetY += (leftTarget.y - faceState.leftEyeOffsetY) * lerpFactor;
    faceState.rightEyeOffsetX += (rightTarget.x - faceState.rightEyeOffsetX) * lerpFactor;
    faceState.rightEyeOffsetY += (rightTarget.y - faceState.rightEyeOffsetY) * lerpFactor;

    // 3. Slow Blinking (squashes vertically)
    if (!faceState.isBlinking && now >= faceState.nextBlinkTime) {
      faceState.isBlinking = true;
      faceState.blinkStartTime = now;
    }

    if (faceState.isBlinking) {
      const elapsed = now - faceState.blinkStartTime;
      if (elapsed < faceState.blinkDuration) {
        // Easing curve: 0 -> 1 -> 0
        faceState.blinkProgress = Math.sin((elapsed / faceState.blinkDuration) * Math.PI);
      } else {
        faceState.isBlinking = false;
        faceState.blinkProgress = 0;

        // Occasional double blink (20% chance)
        if (!faceState.isDoubleBlinkPending && Math.random() < 0.20) {
          faceState.isDoubleBlinkPending = true;
          faceState.nextBlinkTime = now + 180;
        } else {
          faceState.isDoubleBlinkPending = false;
          faceState.nextBlinkTime = now + 2600 + Math.random() * 4200;
        }
      }
    }

    // 4. Update Live Audio Spectrum for Mouth
    updateAudioMouthBars();
  }

  // Read AnalyserNode frequency data and map into mouth bar heights
  function updateAudioMouthBars() {
    const isSpeaking = currentState === 'speaking' || activeAudioSources.length > 0;
    const isListening = currentState === 'listening' && !isMuted;
    const isThinking = currentState === 'thinking';

    let speakerFreqData = null;
    let micFreqData = null;
    let speakerEnergy = 0;
    let micEnergy = 0;

    if (speakerAnalyser && isSpeaking) {
      const buf = new Uint8Array(speakerAnalyser.frequencyBinCount);
      speakerAnalyser.getByteFrequencyData(buf);
      speakerFreqData = buf;
      let sum = 0;
      const count = Math.min(64, buf.length);
      for (let i = 0; i < count; i++) sum += buf[i];
      speakerEnergy = sum / (count * 255);
    }

    if (micAnalyser && isListening) {
      const buf = new Uint8Array(micAnalyser.frequencyBinCount);
      micAnalyser.getByteFrequencyData(buf);
      micFreqData = buf;
      let sum = 0;
      const count = Math.min(64, buf.length);
      for (let i = 0; i < count; i++) sum += buf[i];
      micEnergy = sum / (count * 255);
    }

    // Volume smoothing for expressions
    faceState.smoothedSpeakerVolume += (speakerEnergy - faceState.smoothedSpeakerVolume) * 0.3;
    faceState.smoothedMicVolume += (micEnergy - faceState.smoothedMicVolume) * 0.3;

    const count = faceState.mouthBars.length;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const norm = count > 1 ? i / (count - 1) : 0.5;
      // Parabolic envelope: center bars are tallest, edge bars shortest
      const envelope = Math.sin(norm * Math.PI);

      let targetH = 3.2; // Idle resting height (dot height = width = 3.2)

      if (isSpeaking && speakerFreqData) {
        // Map bar index to vocal frequencies (bins 2..28)
        const binIndex = Math.floor(2 + norm * 26);
        const freqVal = (speakerFreqData[binIndex] || 0) / 255;
        targetH = 3.2 + (freqVal * 28 + faceState.smoothedSpeakerVolume * 22) * envelope;
      } else if (isListening && micFreqData) {
        // Microphone visual feedback
        const binIndex = Math.floor(2 + norm * 22);
        const freqVal = (micFreqData[binIndex] || 0) / 255;
        targetH = 3.2 + (freqVal * 12 + faceState.smoothedMicVolume * 10) * envelope;
      } else if (isThinking) {
        // Harmonic undulating ripple
        const wave = Math.sin(now / 180 + i * 0.65) * 0.5 + 0.5;
        targetH = 3.2 + wave * 5.0 * envelope;
      } else {
        // At rest: completely flat line of dots (neutral, zero curve)
        targetH = 3.2;
      }

      // Clamp max height
      targetH = Math.min(32, Math.max(3.0, targetH));
      // Smooth lerp (no jitter)
      faceState.mouthBars[i] += (targetH - faceState.mouthBars[i]) * 0.32;
    }
  }

  // Helper to draw a capsule / stadium / vertical rounded pill centered at (x, y)
  function drawRoundedPill(ctx, x, y, width, height) {
    const rx = width / 2;
    const ry = height / 2;
    const r = Math.min(rx, ry);
    ctx.beginPath();
    ctx.moveTo(x - rx + r, y - ry);
    ctx.lineTo(x + rx - r, y - ry);
    ctx.arc(x + rx - r, y - ry + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + rx, y + ry - r);
    ctx.arc(x + rx - r, y + ry - r, r, 0, Math.PI / 2);
    ctx.lineTo(x - rx + r, y + ry);
    ctx.arc(x - rx + r, y + ry - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x - rx, y - ry + r);
    ctx.arc(x - rx + r, y - ry + r, r, Math.PI, -Math.PI / 2);
    ctx.closePath();
  }

  // Render minimalist unisex robotic assistant eye (Chat Widget)
  function drawMinimalistEye(ctx, cx, cy, isLeft, offsetX, offsetY, state, blinkProgress, speechEnergy, isHovered) {
    ctx.save();
    // Whole eye shape moves slightly toward cursor (eased a few px)
    ctx.translate(cx + offsetX, cy + offsetY);

    const isHappy = isHovered || state === 'happy';
    const isListening = state === 'listening';
    const isThinking = state === 'thinking';
    const isSpeaking = state === 'speaking';

    // 1. Hover / Happy Expression: eyes become small upward arcs (^ ^)
    if (isHappy) {
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = EYE_COLOR;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Upward smiling arc ^
      ctx.moveTo(-11.5, 3.5);
      ctx.quadraticCurveTo(0, -9.5, 11.5, 3.5);
      ctx.stroke();

      // Soft cyan glow underlay
      ctx.strokeStyle = EYE_COLOR;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-11.5, 3.5);
      ctx.quadraticCurveTo(0, -9.5, 11.5, 3.5);
      ctx.stroke();

      ctx.restore();
      return;
    }

    // 2. Base Dimensions (vertical rounded pill, moderate proportions)
    const baseRx = 11.5;
    let baseRy = 25.5;

    // Listening: eyes slightly taller and brighter
    if (isListening) {
      baseRy = 29.5;
    }

    // Speaking: eyes stay steady and pulse softly with audio level
    if (isSpeaking) {
      const pulseFactor = 1.0 + Math.min(0.12, speechEnergy * 0.18);
      baseRy *= pulseFactor;
    }

    // Idle slow blinks: the pill squashes vertically
    const squashFactor = Math.max(0.08, 1 - blinkProgress * 0.92);
    const ry = baseRy * squashFactor;
    const rx = baseRx * (1 + (1 - squashFactor) * 0.12);

    // If eye is fully squashed in blink, draw minimal flat slit
    if (squashFactor <= 0.12) {
      ctx.fillStyle = EYE_COLOR;
      ctx.shadowColor = GLOW_COLOR;
      ctx.shadowBlur = 4;
      drawRoundedPill(ctx, 0, 0, rx * 2, 2.8);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 3. Thinking: dims slightly
    if (isThinking) {
      ctx.globalAlpha = 0.72;
    }

    // 4. Solid Pill Fill: flat color with subtle inner glow
    const eyeFill = isListening ? '#dffbff' : (isThinking ? '#42c0d2' : EYE_COLOR);
    ctx.fillStyle = eyeFill;
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = isListening ? 18 : (isThinking ? 4 : (isSpeaking ? 12 + speechEnergy * 10 : 9));

    drawRoundedPill(ctx, 0, 0, rx * 2, ry * 2);
    ctx.fill();

    // Subtle inner glow (soft white-cyan core)
    const innerGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, Math.max(rx, ry));
    innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    innerGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.08)');
    innerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = innerGrad;
    drawRoundedPill(ctx, 0, 0, rx * 2, ry * 2);
    ctx.fill();

    // 5. Specular highlight: at most ONE small highlight dot
    if (squashFactor > 0.45 && !isThinking) {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      const dotX = rx * 0.32;
      const dotY = -ry * 0.44;
      ctx.arc(dotX, dotY, 1.8 * squashFactor, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Draw Live Audio Spectrum Mouth (Chat Widget)
  function drawMouthSpectrum(ctx, cx, cy, bars, state) {
    const count = bars.length;
    const barWidth = 3.2;
    const barSpacing = 2.8;
    const totalWidth = count * barWidth + (count - 1) * barSpacing;
    const startX = cx - totalWidth / 2;

    ctx.save();
    ctx.fillStyle = EYE_COLOR;
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = 7;

    for (let i = 0; i < count; i++) {
      const x = startX + i * (barWidth + barSpacing);
      const h = Math.max(3.2, bars[i]);
      // At rest, this is a completely flat horizontal line of dots (neutral, zero curve)
      const y = cy - h / 2;

      ctx.beginPath();
      const r = barWidth / 2;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, h, r);
      } else {
        ctx.rect(x, y, barWidth, h);
      }
      ctx.fill();
    }

    ctx.restore();
  }

  // Main 60fps Face Canvas Render Loop
  function startFaceRenderLoop() {
    const canvas = document.getElementById('leo-face-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function render() {
      if (!isTabVisible) {
        animFrameId = requestAnimationFrame(render);
        return;
      }

      // Handle High-DPI screens
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;

      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      // Update physics and audio reactive data
      const rect = canvas.getBoundingClientRect();
      updateFacePhysics(canvas, rect);

      // Moderate spacing: 0.38 and 0.62 (not wide-set)
      const leftEyeX = displayWidth * 0.38;
      const rightEyeX = displayWidth * 0.62;
      const eyeY = displayHeight * 0.44;
      const mouthY = displayHeight * 0.74;

      // Draw Left Eye
      drawMinimalistEye(
        ctx,
        leftEyeX,
        eyeY,
        true,
        faceState.leftEyeOffsetX,
        faceState.leftEyeOffsetY,
        currentState,
        faceState.blinkProgress,
        faceState.smoothedSpeakerVolume,
        isWidgetFaceHovered
      );

      // Draw Right Eye
      drawMinimalistEye(
        ctx,
        rightEyeX,
        eyeY,
        false,
        faceState.rightEyeOffsetX,
        faceState.rightEyeOffsetY,
        currentState,
        faceState.blinkProgress,
        faceState.smoothedSpeakerVolume,
        isWidgetFaceHovered
      );

      // Draw Spectrum Mouth
      drawMouthSpectrum(ctx, displayWidth * 0.5, mouthY, faceState.mouthBars, currentState);

      ctx.restore();
      animFrameId = requestAnimationFrame(render);
    }

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(render);
  }

  // ==========================================================================
  // 3. WEB AUDIO HOOKUP (AUDIO CONTEXT & ANALYSER NODES)
  // ==========================================================================
  async function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      return true;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('Web Audio API not supported in this browser.');
      return false;
    }

    audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Analyser for Microphone
    micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.8;

    // Analyser for TTS Speaker Playback
    speakerAnalyser = audioCtx.createAnalyser();
    speakerAnalyser.fftSize = 256;
    speakerAnalyser.smoothingTimeConstant = 0.8;

    return true;
  }

  /**
   * Helper: Connect an <audio> element to speakerAnalyser
   * Use this if your TTS plays through an <audio> tag or object URL!
   */
  window.hookAudioElementToCompanion = function (audioEl) {
    if (!audioCtx) initAudio();
    try {
      const source = audioCtx.createMediaElementSource(audioEl);
      source.connect(speakerAnalyser);
      speakerAnalyser.connect(audioCtx.destination);
    } catch (e) {
      console.warn('Audio element already connected or cross-origin restricted:', e);
    }
  };

  /**
   * Helper: Fallback for window.speechSynthesis
   * Note: Browsers do not allow MediaElementSource routing directly from SpeechSynthesisUtterance.
   * This drives a synthetic amplitude envelope to make the mouth and eyes react naturally!
   */
  window.simulateSpeechSynthesisVisuals = function (utterance) {
    let animInterval = null;

    utterance.onstart = function () {
      updateState('speaking');
      animInterval = setInterval(() => {
        // Generate simulated speech energy
        const simulatedEnergy = 0.25 + Math.random() * 0.6;
        faceState.smoothedSpeakerVolume = simulatedEnergy;
      }, 80);
    };

    utterance.onboundary = function () {
      // Pulse mouth on syllables
      faceState.smoothedSpeakerVolume = Math.min(1.0, faceState.smoothedSpeakerVolume + 0.4);
    };

    utterance.onend = utterance.onerror = function () {
      if (animInterval) clearInterval(animInterval);
      faceState.smoothedSpeakerVolume = 0;
      updateState('idle');
    };
  };

  // ==========================================================================
  // 4. SPEECH-TO-TEXT (STT) PIPELINE (Continuous 16kHz PCM Int16 streaming)
  // ==========================================================================
  async function startMicCapture() {
    const ok = await initAudio();
    if (!ok) return false;

    hideNotice();

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micSourceNode = audioCtx.createMediaStreamSource(micStream);
      micSourceNode.connect(micAnalyser);

      setupPCMStream(micSourceNode);
      isMuted = false;
      updateMicButtonUI();
      updateState('listening');
      return true;
    } catch (err) {
      console.warn('Microphone permission denied or unavailable:', err);
      showNotice('Microphone access blocked. Switched to keyboard mode.');
      openKeyboardDrawer();
      updateState('idle');
      return false;
    }
  }

  function setupPCMStream(sourceNode) {
    const inputSampleRate = audioCtx.sampleRate;
    const bufferSize = 4096;

    micProcessorNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    let sampleAccumulator = [];

    micProcessorNode.onaudioprocess = function (e) {
      if (isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Downsample to 16kHz if needed
      let resampled = [];
      if (inputSampleRate === TARGET_SAMPLE_RATE) {
        for (let i = 0; i < inputData.length; i++) resampled.push(inputData[i]);
      } else {
        const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
        for (let i = 0; i < inputData.length; i += ratio) {
          const index = Math.floor(i);
          resampled.push(inputData[index] || 0);
        }
      }

      for (let i = 0; i < resampled.length; i++) {
        sampleAccumulator.push(resampled[i]);
      }

      // Send 512-sample Int16 PCM frames
      while (sampleAccumulator.length >= FRAME_SAMPLES) {
        const chunk = sampleAccumulator.splice(0, FRAME_SAMPLES);
        const int16Array = new Int16Array(FRAME_SAMPLES);

        for (let i = 0; i < FRAME_SAMPLES; i++) {
          const s = Math.max(-1, Math.min(1, chunk[i]));
          int16Array[i] = s < 0 ? s * 32768 : s * 32767;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(int16Array.buffer);
        }
      }
    };

    sourceNode.connect(micProcessorNode);
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    micProcessorNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  }

  function stopMicCapture() {
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (micSourceNode) {
      micSourceNode.disconnect();
      micSourceNode = null;
    }
    if (micProcessorNode) {
      micProcessorNode.disconnect();
      micProcessorNode = null;
    }
    isMuted = true;
    updateMicButtonUI();
  }

  // ==========================================================================
  // 5. LLM & WEBSOCKET PROTOCOL (JSON Events & Token Streaming)
  // ==========================================================================
  function connectWebSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (e) { }
    }

    updateState('connecting');

    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      console.warn('WebSocket connection error:', err);
      updateState('disconnected');
      return;
    }

    ws.onopen = function () {
      console.log('AI Companion connected to bridge:', wsUrl);
      updateState(isMuted ? 'idle' : 'listening');
    };

    ws.onmessage = async function (event) {
      // 1. Binary Audio Frame: Kokoro TTS audio WAV chunk
      if (event.data instanceof ArrayBuffer) {
        enqueueAudioChunk(event.data);
        return;
      }

      // 2. Text Frame: JSON message
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('Non-JSON message received:', event.data);
      }
    };

    ws.onerror = function (err) {
      console.warn('Companion WebSocket offline:', err);
      updateState('disconnected');
    };

    ws.onclose = function () {
      console.log('Companion WebSocket closed');
      updateState('disconnected');
      interruptPlayback();
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'state':
        updateState(msg.state);
        break;

      case 'vad':
        if (msg.speaking && currentState !== 'speaking') {
          updateState('listening');
        }
        break;

      case 'transcript':
        showSubtitle(`You: "${msg.text}"`);
        if (!isOpen) notifyUnreadReply();
        break;

      case 'token':
        appendAiToken(msg.token);
        if (!isOpen) notifyUnreadReply();
        break;

      case 'done':
        finalizeAiMessage();
        break;

      case 'interrupted':
        interruptPlayback();
        updateState('listening');
        break;

      default:
        break;
    }
  }

  function sendJson(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ==========================================================================
  // 6. TEXT-TO-SPEECH (TTS) PIPELINE (Kokoro WAV Queue & Barge-in)
  // ==========================================================================
  async function enqueueAudioChunk(arrayBuffer) {
    if (!audioCtx) await initAudio();
    if (isSpeakerMuted) return;

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      scheduleAudioBuffer(audioBuffer);
    } catch (err) {
      console.error('Error decoding TTS audio chunk:', err);
    }
  }

  function scheduleAudioBuffer(audioBuffer) {
    if (!audioCtx || isSpeakerMuted) return;

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    source.connect(speakerAnalyser);
    speakerAnalyser.connect(audioCtx.destination);

    const currentTime = audioCtx.currentTime;
    const startTime = Math.max(currentTime, nextPlayTime);
    source.start(startTime);
    nextPlayTime = startTime + audioBuffer.duration;

    activeAudioSources.push(source);
    updateState('speaking');

    source.onended = () => {
      const index = activeAudioSources.indexOf(source);
      if (index > -1) {
        activeAudioSources.splice(index, 1);
      }
      if (activeAudioSources.length === 0) {
        nextPlayTime = 0;
        if (currentState === 'speaking') {
          updateState(isMuted ? 'idle' : 'listening');
        }
      }
    };
  }

  // Barge-In: Stop all audio instantly when interrupted
  function interruptPlayback() {
    activeAudioSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch (e) { }
    });
    activeAudioSources = [];
    nextPlayTime = 0;
    finalizeAiMessage();
  }

  // ==========================================================================
  // 7. UI CONTROLS, STATE MACHINE & LIFECYCLE
  // ==========================================================================
  function updateState(newState) {
    // Map internal states: 'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected'
    if (newState === 'connected') newState = isMuted ? 'idle' : 'listening';
    currentState = newState;

    const container = document.getElementById('leo-widget-container');
    const indicator = document.getElementById('leo-status-indicator');
    const launcherDot = document.getElementById('leo-launcher-status-dot');
    const statusLabel = document.getElementById('leo-status-label');
    const micBtn = document.getElementById('leo-mic-btn');

    if (container) {
      container.classList.remove('idle', 'listening', 'thinking', 'speaking', 'disconnected');
      container.classList.add(newState);
    }

    if (indicator) {
      indicator.className = 'leo-status-indicator ' + newState;
    }

    if (launcherDot) {
      launcherDot.className = 'leo-launcher-status-dot ' + newState;
    }

    if (statusLabel) {
      switch (newState) {
        case 'listening': statusLabel.textContent = 'Listening'; break;
        case 'thinking': statusLabel.textContent = 'Thinking'; break;
        case 'speaking': statusLabel.textContent = 'Speaking'; break;
        case 'disconnected': statusLabel.textContent = 'Offline'; break;
        default: statusLabel.textContent = 'Voice AI'; break;
      }
    }

    if (micBtn) {
      micBtn.classList.remove('listening', 'thinking', 'speaking');
      if (newState === 'listening' || newState === 'thinking' || newState === 'speaking') {
        micBtn.classList.add(newState);
      }
    }
  }

  function updateMicButtonUI() {
    const micBtn = document.getElementById('leo-mic-btn');
    if (!micBtn) return;
    if (isMuted) {
      micBtn.classList.remove('listening');
    } else if (currentState === 'listening') {
      micBtn.classList.add('listening');
    }
  }

  function showSubtitle(text) {
    const subArea = document.getElementById('leo-subtitle-area');
    const subText = document.getElementById('leo-subtitle-text');
    if (!subArea || !subText) return;
    subText.textContent = text;
    if (showCaptions) {
      subArea.classList.add('visible');
    }
  }

  function appendAiToken(token) {
    currentAiQuote += token;
    showSubtitle(currentAiQuote);
  }

  function finalizeAiMessage() {
    currentAiQuote = '';
  }

  function showNotice(msg) {
    const banner = document.getElementById('leo-notice-banner');
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = 'block';
  }

  function hideNotice() {
    const banner = document.getElementById('leo-notice-banner');
    if (!banner) return;
    banner.style.display = 'none';
  }

  function openKeyboardDrawer() {
    const drawer = document.getElementById('leo-text-drawer');
    const kbBtn = document.getElementById('leo-keyboard-btn');
    const input = document.getElementById('leo-text-input');
    if (drawer) drawer.classList.add('visible');
    if (kbBtn) kbBtn.classList.add('active');
    if (input) input.focus();
  }

  // Inject Minimal Companion DOM
  function injectCompanionDOM() {
    if (document.getElementById('leo-widget-container')) return;

    // 1. Futuristic Floating AI Orb Launcher
    const launcher = document.createElement('button');
    launcher.id = 'leo-launcher';
    launcher.setAttribute('aria-label', 'Open AI assistant');
    launcher.title = 'Talk with AI Companion';
    launcher.style.setProperty('--orb-size', ORB_SIZE + 'px');
    launcher.innerHTML = `
      <!-- Sonar Ripple Rings -->
      <div class="leo-orb-sonar-ring" aria-hidden="true"></div>
      <div class="leo-orb-sonar-ring delay" aria-hidden="true"></div>

      <!-- Orbiting 3D Neon Rings -->
      <div class="leo-orb-rings-container" aria-hidden="true">
        <div class="leo-orb-ring ring-1">
          <span class="leo-ring-particle"></span>
        </div>
        <div class="leo-orb-ring ring-2">
          <span class="leo-ring-particle"></span>
        </div>
      </div>

      <!-- Ambient Drifting Sparkles -->
      <div class="leo-orb-particles" aria-hidden="true">
        <span class="leo-particle p1"></span>
        <span class="leo-particle p2"></span>
        <span class="leo-particle p3"></span>
      </div>

      <!-- Glassy Sphere Body -->
      <div class="leo-orb-sphere">
        <div class="leo-orb-hologram-shimmer" aria-hidden="true"></div>
        <div class="leo-orb-gloss" aria-hidden="true"></div>
        <canvas id="leo-launcher-face-canvas" class="leo-launcher-face-canvas"></canvas>
      </div>

      <!-- Status Indicator Dot -->
      <span class="leo-launcher-status-dot" id="leo-launcher-status-dot" aria-label="Status: Online"></span>

      <!-- Caption Box (Speech Bubble) on Launcher -->
      <div class="leo-launcher-tooltip" id="leo-launcher-tooltip" role="tooltip" aria-live="polite">
        <span class="leo-tooltip-text" id="leo-tooltip-text"></span>
        <div class="leo-tooltip-arrow"></div>
      </div>
    `;

    // 2. Main Companion Widget Window
    const container = document.createElement('div');
    container.id = 'leo-widget-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'AI Voice Companion');
    container.setAttribute('tabindex', '0');
    container.innerHTML = `
      <div class="leo-widget-glow-bg"></div>

      <!-- Top Header Bar -->
      <div class="leo-header-bar">
        <div class="leo-header-status">
          <span class="leo-status-indicator" id="leo-status-indicator"></span>
          <span class="leo-status-label" id="leo-status-label">Voice AI</span>
        </div>
        <div class="leo-header-actions">
          <button class="leo-icon-btn active" id="leo-cc-btn" aria-label="Toggle live captions" title="Toggle Captions">
            <span class="leo-cc-label">CC</span>
          </button>
          <button class="leo-icon-btn" id="leo-keyboard-btn" aria-label="Toggle text input" title="Keyboard Mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="5" width="20" height="14" rx="3"></rect>
              <line x1="6" y1="9" x2="6.01" y2="9"></line>
              <line x1="10" y1="9" x2="10.01" y2="9"></line>
              <line x1="14" y1="9" x2="14.01" y2="9"></line>
              <line x1="18" y1="9" x2="18.01" y2="9"></line>
              <line x1="6" y1="13" x2="6.01" y2="13"></line>
              <line x1="18" y1="13" x2="18.01" y2="13"></line>
              <line x1="9" y1="13" x2="15" y2="13"></line>
            </svg>
          </button>
          <button class="leo-icon-btn" id="leo-close-btn" aria-label="Minimize companion" title="Minimize">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Center: The Face Stage -->
      <div class="leo-face-stage">
        <canvas id="leo-face-canvas" class="leo-face-canvas"></canvas>
      </div>

      <!-- Subtitle Area (Live captions - default ON) -->
      <div class="leo-subtitle-area visible" id="leo-subtitle-area" aria-live="polite">
        <p class="leo-subtitle-text" id="leo-subtitle-text"></p>
      </div>

      <!-- Inline Notice (Permissions) -->
      <div class="leo-notice-banner" id="leo-notice-banner" style="display: none;"></div>

      <!-- Sliding Text Input Drawer -->
      <div class="leo-text-drawer" id="leo-text-drawer">
        <form class="leo-text-form" id="leo-text-form">
          <input type="text" id="leo-text-input" class="leo-text-input" placeholder="Type a message..." autocomplete="off">
          <button type="submit" class="leo-send-btn" id="leo-send-btn" aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>

      <!-- Bottom Control Bar: Hero Mic Button -->
      <div class="leo-bottom-bar">
        <div class="leo-mic-wrapper">
          <button class="leo-mic-btn" id="leo-mic-btn" aria-label="Toggle voice input" title="Tap to talk / interrupt">
            <span class="leo-mic-pulse-ring"></span>
            <span class="leo-mic-pulse-ring-2"></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(container);
  }

  // ==========================================================================
  // LAUNCHER MINI FACE CANVAS LOOP & ATTENTION ACTIONS
  // ==========================================================================
  function startLauncherFaceRenderLoop() {
    const canvas = document.getElementById('leo-launcher-face-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function renderLauncher() {
      if (!isTabVisible || isOpen) {
        launcherAnimFrameId = requestAnimationFrame(renderLauncher);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const displayW = canvas.clientWidth || 54;
      const displayH = canvas.clientHeight || 54;

      if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, displayW, displayH);

      // Launcher Eye Tracking (whole eye shape moves slightly toward cursor)
      const rect = canvas.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width / 2;
      const eyeCenterY = rect.top + rect.height / 2;

      let pOffsetX = 0;
      let pOffsetY = 0;
      if (faceState.hasMovedCursor && !prefersReducedMotion) {
        const dx = faceState.targetCursorX - eyeCenterX;
        const dy = faceState.targetCursorY - eyeCenterY;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const maxR = 2.0;
        const r = Math.min(maxR, dist * 0.024);
        pOffsetX = Math.cos(angle) * r;
        pOffsetY = Math.sin(angle) * r;
      } else if (!prefersReducedMotion) {
        // Synchronize idle glance
        pOffsetX = faceState.idleGlanceX * 0.22;
        pOffsetY = faceState.idleGlanceY * 0.22;
      }

      // Moderate spacing: 0.38 and 0.62 (not wide-set)
      const leftEyeX = displayW * 0.38;
      const rightEyeX = displayW * 0.62;
      const eyeY = displayH * 0.44;
      const mouthY = displayH * 0.69;

      // Draw Left Eye
      drawMiniMinimalistEye(ctx, leftEyeX, eyeY, true, pOffsetX, pOffsetY);
      // Draw Right Eye
      drawMiniMinimalistEye(ctx, rightEyeX, eyeY, false, pOffsetX, pOffsetY);

      // Draw Mini Mouth
      drawMiniMouth(ctx, displayW * 0.5, mouthY);

      ctx.restore();
      launcherAnimFrameId = requestAnimationFrame(renderLauncher);
    }

    if (launcherAnimFrameId) cancelAnimationFrame(launcherAnimFrameId);
    launcherAnimFrameId = requestAnimationFrame(renderLauncher);
  }

  // Render minimalist unisex robotic eye for launcher orb
  function drawMiniMinimalistEye(ctx, cx, cy, isLeft, offsetX, offsetY) {
    ctx.save();
    ctx.translate(cx + offsetX, cy + offsetY);

    // Hover / Happy: eyes become small upward arcs (^ ^)
    if (isLauncherHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = EYE_COLOR;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-3.8, 1.2);
      ctx.quadraticCurveTo(0, -2.8, 3.8, 1.2);
      ctx.stroke();

      ctx.restore();
      return;
    }

    // Idle: vertical rounded pill; slow blinks squash vertically
    const squashFactor = Math.max(0.1, 1 - faceState.blinkProgress * 0.9);
    const rx = 3.2;
    const ry = 7.0 * squashFactor;

    if (squashFactor <= 0.15) {
      ctx.fillStyle = EYE_COLOR;
      ctx.shadowColor = GLOW_COLOR;
      ctx.shadowBlur = 3;
      drawRoundedPill(ctx, 0, 0, rx * 2, 1.6);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Pill fill with subtle glow
    ctx.fillStyle = (currentState === 'listening') ? '#dcfbff' : EYE_COLOR;
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = (currentState === 'listening') ? 8 : 5;
    drawRoundedPill(ctx, 0, 0, rx * 2, ry * 2);
    ctx.fill();

    // Subtle inner core
    const innerGrad = ctx.createRadialGradient(0, 0, 0.5, 0, 0, Math.max(rx, ry));
    innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    innerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = innerGrad;
    drawRoundedPill(ctx, 0, 0, rx * 2, ry * 2);
    ctx.fill();

    // At most ONE small highlight dot
    if (squashFactor > 0.45) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(rx * 0.32, -ry * 0.42, 0.85 * squashFactor, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Draw launcher mouth: tiny neutral line at rest, slight subtle curve only on hover
  function drawMiniMouth(ctx, cx, cy) {
    ctx.save();
    ctx.strokeStyle = EYE_COLOR;
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';

    ctx.beginPath();
    if (isLauncherHovered) {
      // Slight, subtle curve only on hover
      ctx.moveTo(cx - 3.2, cy - 0.4);
      ctx.quadraticCurveTo(cx, cy + 1.8, cx + 3.2, cy - 0.4);
    } else {
      // Tiny flat neutral line at rest (no curve)
      ctx.moveTo(cx - 3.2, cy);
      ctx.lineTo(cx + 3.2, cy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Attention Move: Playful Hop & Eye Sparkle
  function initAttentionSchedule() {
    if (attentionTimer) clearInterval(attentionTimer);
    attentionTimer = setInterval(() => {
      if (hasOpenedChat && !isOpen) {
        triggerAttentionMove();
      }
    }, 28000);
  }

  function triggerAttentionMove() {
    if (isOpen || !isTabVisible || prefersReducedMotion) return;
    const launcher = document.getElementById('leo-launcher');
    if (!launcher) return;

    isAttentionMoving = true;
    launcher.classList.add('attention-move');

    setTimeout(() => {
      launcher.classList.remove('attention-move');
      isAttentionMoving = false;
    }, 950);
  }

  // Caption Box: Speech bubble rotation next to launcher orb
  function initCaptionSchedule() {
    if (hasOpenedChat || isOpen) return;
    if (captionInitialTimeout) clearTimeout(captionInitialTimeout);

    captionInitialTimeout = setTimeout(() => {
      if (!hasOpenedChat && !isOpen) {
        showNextCaption();
      }
    }, CAPTION_DELAY);
  }

  function showNextCaption() {
    if (hasOpenedChat || isOpen) return;
    const tooltip = document.getElementById('leo-launcher-tooltip');
    const textEl = document.getElementById('leo-tooltip-text');
    if (!tooltip || !textEl) return;

    // Pick text and advance index
    const text = CAPTION_LINES[captionIndex % CAPTION_LINES.length];
    captionIndex = (captionIndex + 1) % CAPTION_LINES.length;

    // The orb does a small wiggle and the eyes blink or sparkle when the bubble appears
    triggerAttentionMove();
    faceState.isBlinking = true;
    faceState.blinkStartTime = Date.now();

    // Clear previous typewriter / timer
    if (captionTypewriterInterval) clearInterval(captionTypewriterInterval);
    if (captionHideTimeout) clearTimeout(captionHideTimeout);

    if (prefersReducedMotion) {
      textEl.textContent = text;
      tooltip.classList.add('visible');
    } else {
      textEl.textContent = '';
      tooltip.classList.add('visible');

      let charIndex = 0;
      const stepMs = Math.max(18, Math.min(32, Math.floor(400 / text.length)));
      captionTypewriterInterval = setInterval(() => {
        if (charIndex < text.length) {
          textEl.textContent += text.charAt(charIndex);
          charIndex++;
        } else {
          clearInterval(captionTypewriterInterval);
          captionTypewriterInterval = null;
        }
      }, stepMs);
    }

    // Stays visible for CAPTION_VISIBLE_DURATION (6s), then fades out
    captionHideTimeout = setTimeout(() => {
      hideCaptionTooltip();
      scheduleNextCaption();
    }, CAPTION_VISIBLE_DURATION);
  }

  function hideCaptionTooltip() {
    const tooltip = document.getElementById('leo-launcher-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
    if (captionTypewriterInterval) {
      clearInterval(captionTypewriterInterval);
      captionTypewriterInterval = null;
    }
  }

  function scheduleNextCaption() {
    if (hasOpenedChat || isOpen) return;
    if (captionNextTimeout) clearTimeout(captionNextTimeout);

    // Reappears every CAPTION_REPEAT_INTERVAL (~25s) with next line in the array
    captionNextTimeout = setTimeout(() => {
      if (!hasOpenedChat && !isOpen && isTabVisible) {
        showNextCaption();
      } else if (!hasOpenedChat && !isOpen) {
        scheduleNextCaption();
      }
    }, CAPTION_REPEAT_INTERVAL);
  }

  function stopCaptionPermanently() {
    hasOpenedChat = true;
    sessionStorage.setItem('LEO_COMPANION_CHAT_OPENED', 'true');
    hideCaptionTooltip();
    if (captionInitialTimeout) clearTimeout(captionInitialTimeout);
    if (captionNextTimeout) clearTimeout(captionNextTimeout);
    if (captionHideTimeout) clearTimeout(captionHideTimeout);
    if (captionTypewriterInterval) clearInterval(captionTypewriterInterval);
  }

  // Notification Pulse on Launcher if reply arrives while closed
  function notifyUnreadReply() {
    if (isOpen) return;
    const launcher = document.getElementById('leo-launcher');
    if (launcher) launcher.classList.add('has-unread');
  }

  function clearUnreadReply() {
    const launcher = document.getElementById('leo-launcher');
    if (launcher) launcher.classList.remove('has-unread');
  }

  // Setup Event Listeners
  function setupEventListeners() {
    const launcher = document.getElementById('leo-launcher');
    const container = document.getElementById('leo-widget-container');
    const tooltip = document.getElementById('leo-launcher-tooltip');
    const faceCanvas = document.getElementById('leo-face-canvas');
    const closeBtn = document.getElementById('leo-close-btn');
    const ccBtn = document.getElementById('leo-cc-btn');
    const subtitleArea = document.getElementById('leo-subtitle-area');
    const kbBtn = document.getElementById('leo-keyboard-btn');
    const textDrawer = document.getElementById('leo-text-drawer');
    const textForm = document.getElementById('leo-text-form');
    const textInput = document.getElementById('leo-text-input');
    const micBtn = document.getElementById('leo-mic-btn');

    // Toggle Open/Close Widget
    function toggleWidget() {
      isOpen = !isOpen;
      if (isOpen) {
        stopCaptionPermanently();
        clearUnreadReply();
        if (launcher) launcher.classList.add('widget-open');
        container.classList.add('open');
        container.focus();
        initAudio();
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
        if (!micStream) {
          startMicCapture();
        }
      } else {
        container.classList.remove('open');
        if (launcher) launcher.classList.remove('widget-open');
      }
    }

    if (launcher) {
      launcher.addEventListener('click', toggleWidget);
      launcher.addEventListener('mouseenter', () => {
        isLauncherHovered = true;
        hideCaptionTooltip();
      });
      launcher.addEventListener('mouseleave', () => {
        isLauncherHovered = false;
      });
      launcher.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleWidget();
        }
      });
    }

    // Clicking the speech bubble itself also opens the chat
    if (tooltip) {
      tooltip.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWidget();
      });
    }

    // Chat widget face stage hover triggers happy expression (^ ^)
    if (faceCanvas) {
      faceCanvas.addEventListener('mouseenter', () => {
        isWidgetFaceHovered = true;
      });
      faceCanvas.addEventListener('mouseleave', () => {
        isWidgetFaceHovered = false;
      });
    }

    if (closeBtn) closeBtn.addEventListener('click', () => {
      isOpen = false;
      container.classList.remove('open');
      if (launcher) launcher.classList.remove('widget-open');
    });

    // Toggle Captions / Subtitles
    if (ccBtn) {
      ccBtn.addEventListener('click', () => {
        showCaptions = !showCaptions;
        ccBtn.classList.toggle('active', showCaptions);
        if (subtitleArea) {
          subtitleArea.classList.toggle('visible', showCaptions);
        }
      });
    }

    // Toggle Keyboard Drawer
    if (kbBtn && textDrawer) {
      kbBtn.addEventListener('click', () => {
        const isVisible = textDrawer.classList.toggle('visible');
        kbBtn.classList.toggle('active', isVisible);
        if (isVisible && textInput) {
          textInput.focus();
        }
      });
    }

    // Submit Text Input
    if (textForm && textInput) {
      textForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = textInput.value.trim();
        if (!text) return;
        textInput.value = '';
        showSubtitle(`You: "${text}"`);
        sendJson({ type: 'text_input', text: text });
      });
    }

    // Mic Action & Barge-In
    if (micBtn) {
      micBtn.addEventListener('click', async () => {
        // Interruption: tapping while speaking cuts TTS instantly and starts listening
        if (currentState === 'speaking') {
          interruptPlayback();
          sendJson({ type: 'interrupt' });
          if (!micStream) {
            await startMicCapture();
          } else {
            isMuted = false;
            updateMicButtonUI();
            updateState('listening');
          }
          return;
        }

        // Normal toggle listening / mute
        if (!micStream) {
          const ok = await startMicCapture();
          if (ok && (!ws || ws.readyState !== WebSocket.OPEN)) {
            connectWebSocket();
          }
        } else {
          isMuted = !isMuted;
          updateMicButtonUI();
          updateState(isMuted ? 'idle' : 'listening');
        }
      });
    }

    // Keyboard Accessibility: Space toggles mic when widget is focused
    container.addEventListener('keydown', (e) => {
      if (e.key === ' ' && document.activeElement !== textInput) {
        e.preventDefault();
        if (micBtn) micBtn.click();
      } else if (e.key === 'Escape') {
        isOpen = false;
        container.classList.remove('open');
        if (launcher) launcher.classList.remove('widget-open');
      }
    });

    // Pause animation when tab is inactive to save battery/resources
    document.addEventListener('visibilitychange', () => {
      isTabVisible = !document.hidden;
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================
  function init() {
    injectCompanionDOM();
    initPointerTracking();
    setupEventListeners();
    startFaceRenderLoop();
    startLauncherFaceRenderLoop();
    initAttentionSchedule();
    initCaptionSchedule();
    console.log('AI Voice Companion initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
