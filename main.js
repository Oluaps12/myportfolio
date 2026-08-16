(function () {
  const TOTAL_FRAMES = 211;
  const FRAME_DIR = 'ezgif-1a8c1350b41bb89c-jpg';

  // Format frame index into 3-digit filename: ezgif-frame-001.jpg
  function getFramePath(index) {
    const paddedIndex = String(index + 1).padStart(3, '0');
    return `${FRAME_DIR}/ezgif-frame-${paddedIndex}.jpg`;
  }

  const canvas = document.getElementById('hero-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-bar');
  const loaderText = document.getElementById('loader-text');

  const images = new Array(TOTAL_FRAMES);
  let loadedCount = 0;

  let targetProgress = 0;
  let currentProgress = 0;
  let lastRenderedFrameIndex = -1;

  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;

    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(canvasHeight * dpr);
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    lastRenderedFrameIndex = -1; // Force redraw on resize
    renderFrame();
  }

  window.addEventListener('resize', resizeCanvas);

  function drawImageCover(img) {
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const canvasW = canvas.width;
    const canvasH = canvas.height;

    const imgRatio = imgW / imgH;
    const canvasRatio = canvasW / canvasH;

    let drawW, drawH, offsetX, offsetY;

    if (canvasRatio > imgRatio) {
      drawW = canvasW;
      drawH = canvasW / imgRatio;
      offsetX = 0;
      offsetY = (canvasH - drawH) / 2;
    } else {
      drawW = canvasH * imgRatio;
      drawH = canvasH;
      offsetX = (canvasW - drawW) / 2;
      offsetY = 0;
    }

    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  }

  // Cross-browser scroll progress calculator
  function getScrollProgress() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const scrollableHeight = (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight;
    if (scrollableHeight <= 0) return 0;
    return Math.min(1, Math.max(0, scrollTop / scrollableHeight));
  }

  function updateProgress() {
    targetProgress = getScrollProgress();
  }

  window.addEventListener('scroll', updateProgress, { passive: true });

  // Fallback to nearest loaded image if current frame hasn't loaded yet
  function getBestImageForIndex(targetIdx) {
    if (images[targetIdx] && images[targetIdx].complete && images[targetIdx].naturalWidth > 0) {
      return { img: images[targetIdx], idx: targetIdx };
    }
    // Search backwards
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (images[i] && images[i].complete && images[i].naturalWidth > 0) {
        return { img: images[i], idx: i };
      }
    }
    // Search forwards
    for (let i = targetIdx + 1; i < TOTAL_FRAMES; i++) {
      if (images[i] && images[i].complete && images[i].naturalWidth > 0) {
        return { img: images[i], idx: i };
      }
    }
    return null;
  }

  function renderFrame() {
    const frameIndex = Math.min(
      TOTAL_FRAMES - 1,
      Math.max(0, Math.floor(currentProgress * (TOTAL_FRAMES - 1)))
    );

    const match = getBestImageForIndex(frameIndex);
    if (match && match.idx !== lastRenderedFrameIndex) {
      drawImageCover(match.img);
      lastRenderedFrameIndex = match.idx;
    }
  }

  // Animation Loop - starts running IMMEDIATELY
  function loop() {
    const diff = targetProgress - currentProgress;
    
    // Smooth lerp factor 0.15 for immediate response with silky deceleration
    currentProgress += diff * 0.15;

    if (Math.abs(diff) < 0.00005) {
      currentProgress = targetProgress;
    }

    renderFrame();
    updateGismoLoop();
    requestAnimationFrame(loop);
  }

  // ==========================================
  // GISMO AI ASSISTANT POPUP & ANIMATION LOGIC
  // ==========================================
  const GISMO_TOTAL_FRAMES = 300;
  const GISMO_FRAME_DIR = 'Gismo';

  function getGismoFramePath(index) {
    const paddedIndex = String(index + 1).padStart(3, '0');
    return `${GISMO_FRAME_DIR}/ezgif-frame-${paddedIndex}.jpg`;
  }

  const gismoImages = new Array(GISMO_TOTAL_FRAMES);
  let gismoLoadedCount = 0;

  const gismoModal = document.getElementById('gismo-modal');
  const gismoCloseBtn = document.getElementById('gismo-close-btn');
  const gismoBackdrop = document.getElementById('gismo-backdrop');
  const gismoCanvas = document.getElementById('gismo-canvas');
  const gismoScrollArea = document.getElementById('gismo-scroll-area');
  const gismoCtx = gismoCanvas ? gismoCanvas.getContext('2d') : null;

  let gismoTargetProgress = 0;
  let gismoCurrentProgress = 0;
  let gismoLastRenderedFrame = -1;
  let isGismoActive = false;

  function resizeGismoCanvas() {
    if (!gismoCanvas) return;
    const dprVal = Math.min(window.devicePixelRatio || 1, 2);
    gismoCanvas.width = Math.floor(window.innerWidth * dprVal);
    gismoCanvas.height = Math.floor(window.innerHeight * dprVal);
    if (gismoCtx) {
      gismoCtx.imageSmoothingEnabled = true;
      gismoCtx.imageSmoothingQuality = 'high';
    }
    gismoLastRenderedFrame = -1;
    renderGismoFrame();
  }

  function drawGismoImageCover(img) {
    if (!img || !img.complete || img.naturalWidth === 0 || !gismoCtx) return;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const canvasW = gismoCanvas.width;
    const canvasH = gismoCanvas.height;

    const imgRatio = imgW / imgH;
    const canvasRatio = canvasW / canvasH;

    let drawW, drawH, offsetX, offsetY;

    if (canvasRatio > imgRatio) {
      drawW = canvasW;
      drawH = canvasW / imgRatio;
      offsetX = 0;
      offsetY = (canvasH - drawH) / 2;
    } else {
      drawW = canvasH * imgRatio;
      drawH = canvasH;
      offsetX = (canvasW - drawW) / 2;
      offsetY = 0;
    }

    gismoCtx.clearRect(0, 0, canvasW, canvasH);
    gismoCtx.drawImage(img, offsetX, offsetY, drawW, drawH);
  }

  function getBestGismoImage(idx) {
    if (gismoImages[idx] && gismoImages[idx].complete && gismoImages[idx].naturalWidth > 0) {
      return { img: gismoImages[idx], idx };
    }
    for (let i = idx - 1; i >= 0; i--) {
      if (gismoImages[i] && gismoImages[i].complete && gismoImages[i].naturalWidth > 0) {
        return { img: gismoImages[i], idx: i };
      }
    }
    for (let i = idx + 1; i < GISMO_TOTAL_FRAMES; i++) {
      if (gismoImages[i] && gismoImages[i].complete && gismoImages[i].naturalWidth > 0) {
        return { img: gismoImages[i], idx: i };
      }
    }
    return null;
  }

  function updateGismoCards(progress) {
    const card1 = document.getElementById('gismo-card-1');
    const card2 = document.getElementById('gismo-card-2');
    const card3 = document.getElementById('gismo-card-3');
    const dots = document.querySelectorAll('.gismo-stage-dot');
    const overlay = document.querySelector('.gismo-canvas-overlay');

    // Stage visibility ranges in scrub progress [0, 1]
    const s1Start = 0.00, s1PeakEnd = 0.12, s1End = 0.18;
    const s2Start = 0.40, s2PeakEnd = 0.52, s2End = 0.58;
    const s3Start = 0.80, s3PeakEnd = 0.92, s3End = 0.96;

    const isStage1 = progress >= s1Start && progress <= s1End;
    const isStage2 = progress >= s2Start && progress <= s2End;
    const isStage3 = progress >= s3Start && progress <= s3End;

    let op1 = 0, op2 = 0, op3 = 0;

    // Stage 1 Card
    if (card1) {
      card1.classList.toggle('active', isStage1);
      if (isStage1) {
        const norm = (progress - s1Start) / (s1End - s1Start);
        const offsetY = (norm - 0.5) * 40;
        card1.style.setProperty('--scroll-offset-y', `${offsetY}px`);

        op1 = 1;
        if (progress > s1PeakEnd) {
          op1 = Math.max(0, 1 - (progress - s1PeakEnd) / (s1End - s1PeakEnd));
        }
        card1.style.opacity = op1;
      } else {
        card1.style.opacity = '';
      }
    }

    // Stage 2 Card
    if (card2) {
      card2.classList.toggle('active', isStage2);
      if (isStage2) {
        const norm = (progress - s2Start) / (s2End - s2Start);
        const offsetY = (norm - 0.5) * 40;
        card2.style.setProperty('--scroll-offset-y', `${offsetY}px`);

        op2 = 1;
        if (progress > s2PeakEnd) {
          op2 = Math.max(0, 1 - (progress - s2PeakEnd) / (s2End - s2PeakEnd));
        }
        card2.style.opacity = op2;
      } else {
        card2.style.opacity = '';
      }
    }

    // Stage 3 Card
    if (card3) {
      card3.classList.toggle('active', isStage3);
      if (isStage3) {
        const norm = (progress - s3Start) / (s3End - s3Start);
        const offsetY = (norm - 0.5) * 40;
        card3.style.setProperty('--scroll-offset-y', `${offsetY}px`);

        op3 = 1;
        if (progress > s3PeakEnd) {
          op3 = Math.max(0, 1 - (progress - s3PeakEnd) / (s3End - s3PeakEnd));
        }
        card3.style.opacity = op3;
      } else {
        card3.style.opacity = '';
      }
    }

    // Dynamic full-screen background overlay darkening & lightening:
    // When popping text is active/visible, background darkens (overlay opacity ~0.72)
    // When popping text disappears, background lightens up (overlay opacity ~0.12) to showcase 3D animation
    if (overlay) {
      const activeTextOpacity = Math.max(op1, op2, op3);
      const targetOverlayOpacity = 0.12 + activeTextOpacity * 0.60;
      overlay.style.opacity = targetOverlayOpacity.toFixed(2);
    }

    // Active dots indicator based on overall progress sections
    const isDot1 = progress >= 0.00 && progress < 0.33;
    const isDot2 = progress >= 0.33 && progress < 0.67;
    const isDot3 = progress >= 0.67;

    dots.forEach((dot, index) => {
      const active = (index === 0 && isDot1) || (index === 1 && isDot2) || (index === 2 && isDot3);
      dot.classList.toggle('active', active);
    });
  }

  function renderGismoFrame() {
    if (!isGismoActive) return;
    const frameIndex = Math.min(
      GISMO_TOTAL_FRAMES - 1,
      Math.max(0, Math.floor(gismoCurrentProgress * (GISMO_TOTAL_FRAMES - 1)))
    );

    const match = getBestGismoImage(frameIndex);
    if (match && match.idx !== gismoLastRenderedFrame) {
      drawGismoImageCover(match.img);
      gismoLastRenderedFrame = match.idx;

      // Update frame counter and progress fill
      const counterEl = document.getElementById('gismo-frame-counter');
      const progressFillEl = document.getElementById('gismo-progress-fill');
      if (counterEl) {
        counterEl.textContent = `FRAME ${String(match.idx + 1).padStart(3, '0')} / 300`;
      }
      if (progressFillEl) {
        progressFillEl.style.width = `${((match.idx + 1) / GISMO_TOTAL_FRAMES) * 100}%`;
      }
    }
  }

  function updateGismoLoop() {
    if (isGismoActive) {
      const diff = gismoTargetProgress - gismoCurrentProgress;
      // Silky smooth low-sensitivity lerp
      gismoCurrentProgress += diff * 0.045;
      if (Math.abs(diff) < 0.00005) {
        gismoCurrentProgress = gismoTargetProgress;
      }
      renderGismoFrame();
      updateGismoCards(gismoCurrentProgress);
    }
  }

  function openGismoModal() {
    if (!gismoModal) return;
    isGismoActive = true;
    gismoModal.classList.add('active');
    gismoModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    gismoTargetProgress = 0;
    gismoCurrentProgress = 0;
    gismoLastRenderedFrame = -1;
    updateGismoCards(0);
    setTimeout(() => {
      resizeGismoCanvas();
    }, 50);
  }

  function closeGismoModal() {
    if (!gismoModal) return;
    isGismoActive = false;
    gismoModal.classList.remove('active');
    gismoModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function initGismo() {
    for (let i = 0; i < GISMO_TOTAL_FRAMES; i++) {
      const img = new Image();
      img.onload = () => { gismoLoadedCount++; };
      img.onerror = () => { gismoLoadedCount++; };
      img.src = getGismoFramePath(i);
      gismoImages[i] = img;
    }

    const gismoTriggers = document.querySelectorAll('img[src*="epik_high_coachella.png"]');
    gismoTriggers.forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        if (el.closest('a')) return;
        e.preventDefault();
        e.stopPropagation();
        openGismoModal();
      });
      // Also enable click on parent card wrapper if not linked
      const container = el.closest('.card-image-wrap, .collage-card');
      if (container && !container.closest('a')) {
        container.style.cursor = 'pointer';
        container.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          e.preventDefault();
          openGismoModal();
        });
      }
    });

    // Stage button clicks in HUD bar
    const stageDots = document.querySelectorAll('.gismo-stage-dot');
    stageDots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const stageIndex = parseInt(dot.getAttribute('data-stage') || '0', 10);
        if (stageIndex === 0) gismoTargetProgress = 0.05;
        else if (stageIndex === 1) gismoTargetProgress = 0.45;
        else if (stageIndex === 2) gismoTargetProgress = 0.85;
      });
    });

    if (gismoCloseBtn) gismoCloseBtn.addEventListener('click', closeGismoModal);
    if (gismoBackdrop) gismoBackdrop.addEventListener('click', closeGismoModal);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isGismoActive) {
        closeGismoModal();
      }
    });

    if (gismoModal) {
      // Low sensitivity wheel listener for slow, precise cinematic scrubbing
      gismoModal.addEventListener('wheel', (e) => {
        if (!isGismoActive) return;
        e.preventDefault();
        const delta = e.deltaY * 0.00007;
        gismoTargetProgress = Math.min(1, Math.max(0, gismoTargetProgress + delta));
      }, { passive: false });

      // Low sensitivity touch drag
      let touchYStart = 0;
      gismoModal.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
          touchYStart = e.touches[0].clientY;
        }
      }, { passive: true });

      gismoModal.addEventListener('touchmove', (e) => {
        if (!isGismoActive || !e.touches || !e.touches[0]) return;
        e.preventDefault();
        const touchY = e.touches[0].clientY;
        const deltaY = (touchYStart - touchY) * 0.00015;
        touchYStart = touchY;
        gismoTargetProgress = Math.min(1, Math.max(0, gismoTargetProgress + deltaY));
      }, { passive: false });

      // Low sensitivity mouse drag
      let isDragging = false;
      let mouseYStart = 0;
      if (gismoScrollArea) {
        gismoScrollArea.addEventListener('mousedown', (e) => {
          isDragging = true;
          mouseYStart = e.clientY;
        });
        window.addEventListener('mousemove', (e) => {
          if (!isDragging || !isGismoActive) return;
          const deltaY = (mouseYStart - e.clientY) * 0.00015;
          mouseYStart = e.clientY;
          gismoTargetProgress = Math.min(1, Math.max(0, gismoTargetProgress + deltaY));
        });
        window.addEventListener('mouseup', () => { isDragging = false; });
      }
    }

    window.addEventListener('resize', () => {
      if (isGismoActive) resizeGismoCanvas();
    });
  }

  // Fallback direct mouse wheel scrubbing (critical for iframe embeds / locked viewport layouts)
  window.addEventListener('wheel', (e) => {
    if (isGismoActive) return;
    const scrollableHeight = (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight;
    if (scrollableHeight <= 0) {
      // Manual virtual progress stepping when native page scroll is disabled
      targetProgress = Math.min(1, Math.max(0, targetProgress + e.deltaY * 0.001));
    }
  }, { passive: true });

  // Fallback direct touch swipe scrubbing
  let touchStartY = 0;
  window.addEventListener('touchstart', (e) => {
    if (isGismoActive) return;
    if (e.touches && e.touches[0]) {
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isGismoActive) return;
    const scrollableHeight = (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight;
    if (scrollableHeight <= 0 && e.touches && e.touches[0]) {
      const touchY = e.touches[0].clientY;
      const deltaY = touchStartY - touchY;
      touchStartY = touchY;
      targetProgress = Math.min(1, Math.max(0, targetProgress + deltaY * 0.005));
    }
  }, { passive: true });

  // Preload Images asynchronously (assign handlers BEFORE setting src to prevent cached load issues)
  function init() {
    resizeCanvas();
    updateProgress();
    initGismo();

    // Start render loop immediately
    requestAnimationFrame(loop);

    let loaderHidden = false;
    function hideLoader() {
      if (loaderHidden || !loader) return;
      loaderHidden = true;
      loader.classList.add('hidden');
    }

    // Safety fallback: ensure loader is hidden after 3 seconds max
    setTimeout(hideLoader, 3000);

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const img = new Image();
      
      const onFrameLoad = () => {
        loadedCount++;
        const percent = Math.floor((loadedCount / TOTAL_FRAMES) * 100);
        
        if (loaderBar) loaderBar.style.width = percent + '%';
        if (loaderText) loaderText.textContent = `Loading ${percent}%`;

        // Draw initial frame as soon as frame 0 loads
        if (i === 0 && lastRenderedFrameIndex === -1) {
          renderFrame();
        }

        if (loadedCount >= TOTAL_FRAMES) {
          setTimeout(hideLoader, 200);
        }
      };

      img.onload = onFrameLoad;
      img.onerror = onFrameLoad;
      img.src = getFramePath(i); // src set AFTER load event triggers are wired up
      images[i] = img;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
