/**
 * ============================================================================
 * MANGA AI VOICE ASSISTANT WIDGET (SATORU GOJO / JUJUTSU CHAT CHRONICLE)
 * Continuous Speech-to-Speech RAG Voice Assistant for Paulo Fesalbon's Portfolio
 * ============================================================================
 * 
 * Features:
 * - Authentic Japanese Shonen Manga panel aesthetic matching reference image
 * - Continuous always-on microphone streaming (16kHz PCM Int16 frames)
 * - Real-time Kokoro TTS audio playback queue with zero gap
 * - Instant Barge-In / Interruption support
 * - Live bidirectional manga ink equalizer visualizer
 * - Real-time token streaming with manga quotation marks & typing cursor
 * - Collapsible text input drawer & conversation history log
 * - WebSocket bridge configuration drawer (supports ngrok and local dev)
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Default Configuration
  // --------------------------------------------------------------------------
  const STORAGE_KEY = 'LEO_VOICE_WS_URL';
  const LOCAL_WS_URL = 'ws://127.0.0.1:8765/ws/voice';
  const NGROK_WS_URL = 'wss://alia-pseudocotyledonal-alison.ngrok-free.app/ws/voice';
  const DEFAULT_WS_URL = LOCAL_WS_URL; // Using local link for testing

  // Target audio constraints for Silero VAD & Faster-Whisper
  const TARGET_SAMPLE_RATE = 16000;
  const FRAME_SAMPLES = 512; // 32ms at 16kHz, matches STT model

  function normalizeWsUrl(rawUrl) {
    if (!rawUrl) return DEFAULT_WS_URL;
    let url = rawUrl.trim();

    // Map 0.0.0.0 to 127.0.0.1 (browser cannot open WebSocket to 0.0.0.0)
    url = url.replace('0.0.0.0', '127.0.0.1');

    // Convert HTTP(S) to WS(S)
    if (url.startsWith('https://')) {
      url = 'wss://' + url.slice(8);
    } else if (url.startsWith('http://')) {
      url = 'ws://' + url.slice(7);
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = (url.includes('ngrok') ? 'wss://' : 'ws://') + url;
    }

    // Ensure path defaults to /ws/voice if omitted
    try {
      const parsed = new URL(url.replace('wss://', 'https://').replace('ws://', 'http://'));
      let pathname = parsed.pathname;
      if (!pathname || pathname === '/' || pathname === '') {
        pathname = '/ws/voice';
      }
      const proto = url.startsWith('wss://') ? 'wss://' : 'ws://';
      return proto + parsed.host + pathname;
    } catch (e) {
      if (!url.includes('/')) {
        url = url + '/ws/voice';
      }
      return url;
    }
  }

  // State Variables
  let ws = null;
  localStorage.setItem(STORAGE_KEY, DEFAULT_WS_URL);
  let wsUrl = DEFAULT_WS_URL;
  let isOpen = false;
  let isMuted = false;
  let isSpeakerMuted = false;
  let currentState = 'disconnected'; // disconnected, connected, listening, thinking, speaking
  let isUserSpeaking = false;

  // Web Audio Variables
  let audioCtx = null;
  let micStream = null;
  let micSourceNode = null;
  let micProcessorNode = null;
  let micAnalyser = null;
  let speakerAnalyser = null;

  // Audio Playback Queue
  let activeAudioSources = [];
  let nextPlayTime = 0;
  let currentAiMsgEl = null;
  let currentAiQuote = '';

  // Animation Frame
  let visualizerAnimId = null;

  // --------------------------------------------------------------------------
  // UI Template Injection (Manga Comic Layout)
  // --------------------------------------------------------------------------
  function injectWidgetDOM() {
    if (document.getElementById('leo-widget-container')) return;

    // 1. Floating Launcher Button (Manga Badge)
    const launcher = document.createElement('button');
    launcher.id = 'leo-launcher';
    launcher.setAttribute('aria-label', 'Open Manga Voice Assistant');
    launcher.title = 'Talk with Gojo (AI Voice)';
    launcher.innerHTML = `
      <img src="picture/gojo_avatar.jpg" alt="Gojo" class="leo-launcher-avatar" onerror="this.src='picture/leo_avatar.jpg'">
      <svg id="leo-fallback-icon" class="leo-launcher-icon" viewBox="0 0 24 24">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5"/>
      </svg>
      <div class="leo-launcher-zap-badge">CHAT!</div>
      <div class="leo-status-badge" id="leo-status-badge"></div>
      <div class="leo-launcher-tooltip">Ask Gojo AI (Voice) ✦</div>
    `;

    // 2. Main Widget Container (Manga Panel Layout)
    const container = document.createElement('div');
    container.id = 'leo-widget-container';
    container.innerHTML = `
      <!-- Top Header Bar with Caption Banner & Controls -->
      <div class="manga-header-bar">
        <div class="manga-title-banner">
          <h2>JUJUTSU CHAT CHRONICLE!</h2>
        </div>
        <div class="manga-header-controls">
          <button class="manga-icon-btn" id="leo-history-btn" title="Conversation Transcript">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
          <button class="manga-icon-btn" id="leo-text-toggle-btn" title="Toggle Text Input">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"></polyline>
              <line x1="9" y1="20" x2="15" y2="20"></line>
              <line x1="12" y1="4" x2="12" y2="20"></line>
            </svg>
          </button>
          <button class="manga-icon-btn" id="leo-settings-btn" title="Bridge Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button class="manga-icon-btn" id="leo-close-btn" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Settings Panel Drawer -->
      <div class="manga-settings-drawer" id="leo-settings-panel">
        <label class="manga-settings-label" for="leo-ws-input">WebSocket Bridge URL</label>
        <div class="manga-settings-row">
          <input type="text" id="leo-ws-input" class="manga-settings-input" placeholder="ws://127.0.0.1:8765/ws/voice" value="${wsUrl}">
          <button class="manga-save-btn" id="leo-ws-save-btn">CONNECT</button>
        </div>
        <p class="manga-settings-hint">
          Bridge server: <code>python ws_bridge.py</code> | Tunnel: <code>ngrok http 8765</code>
        </p>
      </div>

      <!-- Upper Storyboard 3-Panel Grid -->
      <div class="manga-storyboard-grid">
        <!-- Panel 1 (Left): FWUUSH! burst -->
        <div class="manga-subpanel manga-subpanel-left">
          <div class="manga-burst-star">
            <span class="manga-burst-text">FWUUSH!</span>
          </div>
        </div>
        <!-- Panel 2 (Center): Halftone dots + Jagged speech bubble -->
        <div class="manga-subpanel manga-subpanel-center">
          <div class="manga-jagged-bubble">
            <p class="manga-bubble-text">Hey<br>strongesty<br>there...</p>
          </div>
        </div>
        <!-- Panel 3 (Right): Speed lines + thought bubble + ZAP! -->
        <div class="manga-subpanel manga-subpanel-right">
          <div class="manga-ellipsis-bubble">...</div>
          <div class="manga-mini-zap">ZAP!</div>
        </div>
      </div>

      <!-- Collapsible Conversation History Drawer -->
      <div class="manga-history-drawer" id="leo-history-drawer">
        <div id="leo-chat-body"></div>
      </div>

      <!-- Main Lower Dialogue Section -->
      <div class="manga-dialogue-section">
        <div class="manga-char-header">
          <h3 class="manga-char-name">Satoru Gojo</h3>
          <div class="manga-char-flourish">
            <span class="manga-flourish-symbol">~*~</span>
            <span class="manga-char-subtitle">The Strongest Jujutsu Sorcerer</span>
            <span class="manga-flourish-symbol">~*~</span>
          </div>
        </div>

        <div class="manga-dialogue-body">
          <div class="manga-dialogue-box">
            <p class="manga-quote-text" id="manga-quote-text">&ldquo;Hey there, Traveler! And small floating creature! Welcome to... well, this place! Perfect timing, as always! We are on cue!&rdquo;</p>
          </div>
          <div class="manga-portrait-wrap">
            <img src="picture/gojo_avatar.jpg" alt="Satoru Gojo" class="manga-portrait-img" onerror="this.src='picture/leo_avatar.jpg'">
          </div>
        </div>
      </div>

      <!-- Collapsible Text Input Drawer -->
      <div class="manga-text-input-drawer" id="leo-text-input-row">
        <div class="manga-text-input-group">
          <input type="text" class="manga-text-field" id="leo-text-field" placeholder="Ask Gojo anything about Paulo..." autocomplete="off">
          <button class="manga-send-btn" id="leo-send-btn" title="Send text">
            <svg viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Bottom Audio Equalizer & Controls Strip -->
      <div class="manga-bottom-bar">
        <!-- Overlapping ZAP! Sticker -->
        <div class="manga-zap-sticker">ZAP!</div>

        <!-- Traveler Avatar Badge -->
        <div class="manga-user-badge">
          <img src="picture/traveler_avatar.jpg" alt="Traveler" class="manga-user-avatar" onerror="this.src='picture/Paulo.jpg'">
        </div>

        <!-- Equalizer Waveform Canvas -->
        <div class="manga-waveform-container">
          <canvas id="leo-visualizer"></canvas>
          <div class="manga-status-overlay" id="leo-status-overlay">Tap mic to start voice chat</div>
        </div>

        <!-- Circular Action Buttons -->
        <div class="manga-action-group">
          <button class="leo-interrupt-btn" id="leo-interrupt-btn" title="Interrupt Gojo (Barge-in)">
            <span>Interrupt</span> ✕
          </button>
          <button class="manga-circle-btn manga-mic-btn" id="leo-mic-btn" title="Toggle Microphone">
            <svg id="leo-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          <button class="manga-circle-btn manga-speaker-btn" id="leo-speaker-btn" title="Mute/Unmute Audio">
            <svg id="leo-speaker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(container);
  }

  // --------------------------------------------------------------------------
  // Web Audio Setup & Continuous 16kHz PCM Stream
  // --------------------------------------------------------------------------
  async function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      return true;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      alert('Your browser does not support Web Audio API.');
      return false;
    }

    // Initialize AudioContext
    audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Analysers for Visualizer
    micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 128;
    micAnalyser.smoothingTimeConstant = 0.8;

    speakerAnalyser = audioCtx.createAnalyser();
    speakerAnalyser.fftSize = 128;
    speakerAnalyser.smoothingTimeConstant = 0.8;

    startVisualizerLoop();
    return true;
  }

  async function startMicCapture() {
    const ok = await initAudio();
    if (!ok) return false;

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

      // Downsample/buffer to 16kHz PCM Int16
      setupPCMStream(micSourceNode);
      isMuted = false;
      updateMicButtonUI();
      return true;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      updateStatusText('Microphone permission denied', 'neutral');
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

      let resampled = [];
      if (inputSampleRate === TARGET_SAMPLE_RATE) {
        for (let i = 0; i < inputData.length; i++) {
          resampled.push(inputData[i]);
        }
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
  }

  // --------------------------------------------------------------------------
  // Audio Playback Pipeline (Kokoro TTS WAV streaming chunks)
  // --------------------------------------------------------------------------
  async function enqueueAudioChunk(arrayBuffer) {
    if (!audioCtx) {
      await initAudio();
    }
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

    source.onended = () => {
      const index = activeAudioSources.indexOf(source);
      if (index > -1) {
        activeAudioSources.splice(index, 1);
      }
    };
  }

  function interruptPlayback() {
    activeAudioSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch (e) {}
    });
    activeAudioSources = [];
    nextPlayTime = 0;

    const interruptBtn = document.getElementById('leo-interrupt-btn');
    if (interruptBtn) interruptBtn.style.display = 'none';

    finalizeAiMessage();
  }

  // --------------------------------------------------------------------------
  // WebSocket Client & Event Dispatcher
  // --------------------------------------------------------------------------
  function connectWebSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
    }

    updateState('connecting');
    updateStatusText('Connecting to RAG Bridge...', 'neutral');

    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      console.error('WebSocket connection error:', err);
      updateState('disconnected');
      updateStatusText('Invalid WebSocket URL', 'neutral');
      return;
    }

    ws.onopen = function () {
      console.log('Connected to Manga AI Bridge:', wsUrl);
      updateState('connected');
      updateStatusText('Connected! Speak into your microphone', 'active');
      const badge = document.getElementById('leo-status-badge');
      if (badge) badge.className = 'leo-status-badge connected';
    };

    ws.onmessage = async function (event) {
      // 1. Binary Frame: Kokoro TTS audio WAV chunk
      if (event.data instanceof ArrayBuffer) {
        enqueueAudioChunk(event.data);
        return;
      }

      // 2. Text Frame: JSON message
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('Non-JSON WebSocket message:', event.data);
      }
    };

    ws.onerror = function (err) {
      console.warn('WebSocket error:', err);
      updateState('disconnected');
      updateStatusText('Connection error • Check ws_bridge', 'neutral');
    };

    ws.onclose = function () {
      console.log('WebSocket disconnected');
      updateState('disconnected');
      updateStatusText('Offline • Tap mic or settings', 'neutral');
      interruptPlayback();
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'state':
        updateState(msg.state);
        break;

      case 'vad':
        isUserSpeaking = !!msg.speaking;
        const overlay = document.getElementById('leo-status-overlay');
        if (overlay) {
          if (isUserSpeaking) {
            overlay.textContent = 'Voice detected... listening';
            overlay.classList.add('active');
          } else if (currentState === 'listening') {
            overlay.textContent = 'Listening continuously...';
            overlay.classList.remove('active');
          }
        }
        break;

      case 'transcript':
        appendMessage('user', msg.text);
        break;

      case 'token':
        appendAiToken(msg.token);
        break;

      case 'done':
        finalizeAiMessage();
        break;

      case 'interrupted':
        interruptPlayback();
        updateStatusText('Interrupted • Listening...', 'active');
        break;

      case 'pong':
        break;

      default:
        console.log('Unknown message type:', msg);
    }
  }

  function sendJson(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // --------------------------------------------------------------------------
  // UI State Management & Conversation Log
  // --------------------------------------------------------------------------
  function updateState(newState) {
    currentState = newState;
    const badge = document.getElementById('leo-status-badge');
    const interruptBtn = document.getElementById('leo-interrupt-btn');
    const overlay = document.getElementById('leo-status-overlay');

    if (badge) badge.className = 'leo-status-badge ' + newState;
    if (!overlay) return;

    switch (newState) {
      case 'connected':
        overlay.textContent = 'Ready • Speak or type';
        overlay.classList.add('active');
        if (interruptBtn) interruptBtn.style.display = 'none';
        break;

      case 'listening':
        overlay.textContent = 'Listening continuously...';
        overlay.classList.add('active');
        if (interruptBtn) interruptBtn.style.display = 'none';
        break;

      case 'thinking':
        overlay.textContent = 'Gojo is thinking...';
        overlay.classList.add('active');
        if (interruptBtn) interruptBtn.style.display = 'none';
        break;

      case 'speaking':
        overlay.textContent = 'Gojo is speaking...';
        overlay.classList.add('active');
        if (interruptBtn) interruptBtn.style.display = 'inline-flex';
        break;

      case 'connecting':
        overlay.textContent = 'Connecting...';
        overlay.classList.remove('active');
        if (interruptBtn) interruptBtn.style.display = 'none';
        break;

      case 'disconnected':
      default:
        overlay.textContent = 'Tap mic to start voice chat';
        overlay.classList.remove('active');
        if (interruptBtn) interruptBtn.style.display = 'none';
        break;
    }
  }

  function updateStatusText(text, type) {
    const overlay = document.getElementById('leo-status-overlay');
    if (!overlay) return;
    overlay.textContent = text;
    if (type === 'active') {
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  }

  function appendMessage(role, text) {
    const quoteEl = document.getElementById('manga-quote-text');
    if (role === 'ai' && quoteEl) {
      quoteEl.textContent = `\u201C${text}\u201D`;
    } else if (role === 'user') {
      updateStatusText(`You: "${text.length > 25 ? text.slice(0, 25) + '...' : text}"`, 'active');
    }

    const chatBody = document.getElementById('leo-chat-body');
    if (chatBody) {
      const entry = document.createElement('div');
      entry.className = `manga-history-entry ${role}`;
      entry.innerHTML = `
        <span class="manga-history-speaker">${role === 'ai' ? 'Satoru Gojo' : 'Traveler'}</span>
        <span>${text}</span>
      `;
      chatBody.appendChild(entry);
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  }

  function appendAiToken(token) {
    const quoteEl = document.getElementById('manga-quote-text');
    if (!quoteEl) return;

    if (!currentAiMsgEl) {
      currentAiQuote = token;
      quoteEl.innerHTML = `\u201C${escapeHtml(currentAiQuote)}<span class="leo-typing-cursor"></span>\u201D`;
      currentAiMsgEl = quoteEl;
    } else {
      currentAiQuote += token;
      quoteEl.innerHTML = `\u201C${escapeHtml(currentAiQuote)}<span class="leo-typing-cursor"></span>\u201D`;
    }
    quoteEl.scrollTop = quoteEl.scrollHeight;
  }

  function finalizeAiMessage() {
    const quoteEl = document.getElementById('manga-quote-text');
    if (quoteEl && currentAiQuote) {
      quoteEl.textContent = `\u201C${currentAiQuote}\u201D`;

      const chatBody = document.getElementById('leo-chat-body');
      if (chatBody) {
        const entry = document.createElement('div');
        entry.className = 'manga-history-entry ai';
        entry.innerHTML = `
          <span class="manga-history-speaker">Satoru Gojo</span>
          <span>${escapeHtml(currentAiQuote)}</span>
        `;
        chatBody.appendChild(entry);
        chatBody.scrollTop = chatBody.scrollHeight;
      }
    }
    currentAiMsgEl = null;
    currentAiQuote = '';
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --------------------------------------------------------------------------
  // Manga Ink Equalizer Waveform Canvas Animation
  // --------------------------------------------------------------------------
  function startVisualizerLoop() {
    const canvas = document.getElementById('leo-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
    }

    const micData = new Uint8Array(64);
    const speakerData = new Uint8Array(64);
    let phase = 0;

    function render() {
      resize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let isSpeakerActive = false;
      let isMicActive = false;

      let speakerEnergy = 0;
      if (speakerAnalyser && activeAudioSources.length > 0) {
        speakerAnalyser.getByteFrequencyData(speakerData);
        for (let i = 0; i < speakerData.length; i++) {
          speakerEnergy += speakerData[i];
        }
        speakerEnergy = speakerEnergy / (speakerData.length * 255);
        if (speakerEnergy > 0.04) isSpeakerActive = true;
      }

      let micEnergy = 0;
      if (micAnalyser && !isMuted) {
        micAnalyser.getByteFrequencyData(micData);
        for (let i = 0; i < micData.length; i++) {
          micEnergy += micData[i];
        }
        micEnergy = micEnergy / (micData.length * 255);
        if (micEnergy > 0.03) isMicActive = true;
      }

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      phase += 0.12;

      // Draw vertical soundwave bars (Manga Equalizer Bars)
      const numBars = 34;
      const barSpacing = 3.5;
      const barWidth = 2.2;
      const totalWidth = numBars * barWidth + (numBars - 1) * barSpacing;
      const startX = Math.max(4, Math.floor((width - totalWidth) / 2));

      ctx.fillStyle = '#111111';

      for (let i = 0; i < numBars; i++) {
        const normIndex = i / (numBars - 1);
        // Envelope curve: bars are naturally taller near the center
        const envelope = Math.sin(normIndex * Math.PI);

        let barHeight = 4;

        if (isSpeakerActive) {
          const freqVal = speakerData[i % speakerData.length] / 255;
          barHeight = 4 + (freqVal * 28 + speakerEnergy * 20) * envelope;
        } else if (isUserSpeaking || isMicActive) {
          const freqVal = micData[i % micData.length] / 255;
          barHeight = 4 + (freqVal * 26 + micEnergy * 22) * envelope;
        } else {
          // Idle rhythm
          const wave = Math.sin(phase + i * 0.4) * 0.5 + 0.5;
          barHeight = 3 + wave * 7 * envelope;
        }

        barHeight = Math.min(height - 8, Math.max(3, barHeight));
        const x = startX + i * (barWidth + barSpacing);
        const y = centerY - barHeight / 2;

        ctx.fillRect(x, y, barWidth, barHeight);
      }

      visualizerAnimId = requestAnimationFrame(render);
    }

    render();
  }

  // --------------------------------------------------------------------------
  // Event Listeners & Widget Controls
  // --------------------------------------------------------------------------
  function updateMicButtonUI() {
    const micBtn = document.getElementById('leo-mic-btn');
    if (!micBtn) return;

    if (isMuted) {
      micBtn.classList.remove('active');
      micBtn.classList.add('muted');
      updateStatusText('Microphone muted', 'neutral');
    } else {
      micBtn.classList.remove('muted');
      micBtn.classList.add('active');
      updateStatusText('Microphone live • Listening', 'active');
    }
  }

  function setupEventListeners() {
    const launcher = document.getElementById('leo-launcher');
    const container = document.getElementById('leo-widget-container');
    const closeBtn = document.getElementById('leo-close-btn');
    const historyBtn = document.getElementById('leo-history-btn');
    const historyDrawer = document.getElementById('leo-history-drawer');
    const settingsBtn = document.getElementById('leo-settings-btn');
    const settingsPanel = document.getElementById('leo-settings-panel');
    const wsInput = document.getElementById('leo-ws-input');
    const wsSaveBtn = document.getElementById('leo-ws-save-btn');
    const micBtn = document.getElementById('leo-mic-btn');
    const speakerBtn = document.getElementById('leo-speaker-btn');
    const interruptBtn = document.getElementById('leo-interrupt-btn');
    const textToggleBtn = document.getElementById('leo-text-toggle-btn');
    const textInputRow = document.getElementById('leo-text-input-row');
    const textField = document.getElementById('leo-text-field');
    const sendBtn = document.getElementById('leo-send-btn');

    // Toggle widget panel
    function toggleWidget() {
      isOpen = !isOpen;
      if (isOpen) {
        container.classList.add('open');
        initAudio();
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
        if (!micStream) {
          startMicCapture();
        }
      } else {
        container.classList.remove('open');
      }
    }

    if (launcher) launcher.addEventListener('click', toggleWidget);
    if (closeBtn) closeBtn.addEventListener('click', () => {
      isOpen = false;
      container.classList.remove('open');
    });

    // Toggle conversation history drawer
    if (historyBtn && historyDrawer) {
      historyBtn.addEventListener('click', () => {
        historyDrawer.classList.toggle('open');
        historyBtn.classList.toggle('active');
      });
    }

    // Toggle settings panel
    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', () => {
        settingsPanel.classList.toggle('open');
        settingsBtn.classList.toggle('active');
      });
    }

    // Save WebSocket URL & reconnect
    if (wsSaveBtn && wsInput) {
      wsSaveBtn.addEventListener('click', () => {
        const inputVal = wsInput.value.trim();
        if (inputVal) {
          wsUrl = normalizeWsUrl(inputVal);
          wsInput.value = wsUrl;
          localStorage.setItem(STORAGE_KEY, wsUrl);
          settingsPanel.classList.remove('open');
          settingsBtn.classList.remove('active');
          connectWebSocket();
        }
      });
    }

    // Mic button (Mute / Unmute / Activate)
    if (micBtn) {
      micBtn.addEventListener('click', async () => {
        if (!micStream) {
          const ok = await startMicCapture();
          if (ok) {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              connectWebSocket();
            }
          }
        } else {
          isMuted = !isMuted;
          updateMicButtonUI();
          if (isMuted) {
            updateStatusText('Microphone muted', 'neutral');
          } else {
            updateStatusText('Microphone live • Listening', 'active');
          }
        }
      });
    }

    // Speaker toggle button (Mute/Unmute TTS Audio)
    if (speakerBtn) {
      speakerBtn.addEventListener('click', () => {
        isSpeakerMuted = !isSpeakerMuted;
        speakerBtn.classList.toggle('muted', isSpeakerMuted);
        if (isSpeakerMuted) {
          interruptPlayback();
          updateStatusText('Speaker audio muted', 'neutral');
        } else {
          updateStatusText('Speaker audio unmuted', 'active');
        }
      });
    }

    // Interrupt / Barge-in button
    if (interruptBtn) {
      interruptBtn.addEventListener('click', () => {
        interruptPlayback();
        sendJson({ type: 'interrupt' });
      });
    }

    // Toggle text input drawer
    if (textToggleBtn && textInputRow) {
      textToggleBtn.addEventListener('click', () => {
        textInputRow.classList.toggle('visible');
        textToggleBtn.classList.toggle('active');
        if (textInputRow.classList.contains('visible') && textField) {
          textField.focus();
        }
      });
    }

    // Send text query
    function submitText() {
      if (!textField) return;
      const val = textField.value.trim();
      if (!val) return;
      textField.value = '';
      appendMessage('user', val);
      sendJson({ type: 'text_input', text: val });
    }

    if (sendBtn) sendBtn.addEventListener('click', submitText);
    if (textField) {
      textField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          submitText();
        }
      });
    }

    // Escape key closes widget
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        isOpen = false;
        container.classList.remove('open');
      }
    });
  }

  // --------------------------------------------------------------------------
  // Auto-Initialization on Page Load
  // --------------------------------------------------------------------------
  function init() {
    injectWidgetDOM();
    setupEventListeners();
    console.log('Manga AI Voice Widget (Gojo) initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
