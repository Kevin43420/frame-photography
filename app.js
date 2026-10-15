(() => {
  'use strict';

  const archive = window.FRAME_ARCHIVE || {};
  const collections = (Array.isArray(archive.collections) ? archive.collections : [])
    .filter(item => item && typeof item.id === 'string' && Array.isArray(item.photos))
    .map(collection => ({
      ...collection,
      photos: collection.photos.filter(photo => photo && typeof photo.id === 'string' && typeof photo.src === 'string')
    }));
  const videos = (Array.isArray(archive.videos) ? archive.videos : []).filter(video => video && typeof video.id === 'string' && typeof video.src === 'string');
  const awards = (Array.isArray(archive.awards) ? archive.awards : []).filter(award => award && typeof award.src === 'string');
  const collectionMap = new Map(collections.map(collection => [collection.id, collection]));
  const videoMap = new Map(videos.map(video => [video.id, video]));
  const photoMap = new Map();
  collections.forEach(collection => collection.photos.forEach(photo => photoMap.set(photo.id, { photo, collection })));
  const $ = id => document.getElementById(id);
  const dom = Object.fromEntries([
    'cameraStage', 'stagePhoto', 'stageVideo', 'stageTitle', 'stageCategory',
    'stageIndex', 'stageBadge', 'stageCaption', 'stageProgress', 'modeDial',
    'dialModeValue', 'modePhoto', 'modeMotion', 'stageModeLabel', 'cameraStatus',
    'prevWork', 'nextWork', 'openWork', 'shutterButton', 'shutterStatus',
    'exposureSlider', 'exposureValue', 'gridToggle', 'motionToggle',
    'photoAutoplay', 'collectionSelect', 'seriesTitle', 'seriesTone',
    'seriesDescription', 'seriesTabs', 'photoRail', 'photoWall', 'photoPosition',
    'programList', 'filmstrip', 'filmCount', 'clearFilm', 'awardList',
    'awardImage', 'awardName', 'awardStatus', 'awardYear', 'awardPosition',
    'awardPrev', 'awardNext', 'posterOpen', 'lightbox', 'modalImage',
    'modalTitle', 'mediaDialog', 'dialogVideo', 'dialogTitle', 'dialogSubtitle',
    'closeImage', 'closeVideo', 'liveStatus', 'soundToggle', 'helpToggle', 'cameraHelp'
  ].map(id => [id, $(id)]));
  if (!dom.cameraStage) return;

  const initialCollection = collectionMap.get('human-quiet-landscapes') || collections[0] || null;
  let view = videos.length ? 'motion' : 'photo';
  let collectionId = initialCollection?.id || null;
  let category = initialCollection?.category || 'all';
  let photoId = initialCollection?.photos[0]?.id || null;
  let videoId = videoMap.has('shots-trailer') ? 'shots-trailer' : videos[0]?.id || null;
  let exposure = 0;
  let gridEnabled = true;
  let motionEnabled = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let photoAutoplayEnabled = false;
  let photoTimer;
  let toastTimer;
  let toastHideTimer;
  let focusTimer;
  let captureTimer;
  let captureResetTimer;
  let focusStarted = null;
  let focusToken = 0;
  let capturePending = false;
  let pointerId = null;
  let spaceDown = false;
  let lastCaptureAt = -Infinity;
  let ignoreClickUntil = 0;
  let touchStart = null;
  let stageGeneration = 0;
  let stageChangeTimer;
  let stageInView = true;
  let dialogVideoId = null;
  let dialogMuted = false;
  let awardIndex = 0;
  let awardTimer;
  let shortlist = [];
  let storageAvailable = true;
  const storageKey = 'frame-archive-shortlist-v2';
  const now = () => performance.now();
  const pad = number => String(number).padStart(2, '0');
  const text = (element, value) => { if (element) element.textContent = value == null ? '' : String(value); };
  const on = (element, event, callback, options) => { if (element) element.addEventListener(event, callback, options); };
  const setPressed = (element, pressed) => {
    if (!element) return;
    element.setAttribute('aria-pressed', String(pressed));
    element.classList.toggle('is-active', pressed);
  };
  const announce = message => {
    if (!dom.liveStatus) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    dom.liveStatus.classList.remove('is-visible');
    dom.liveStatus.textContent = '';
    toastTimer = setTimeout(() => {
      dom.liveStatus.textContent = message;
      dom.liveStatus.classList.add('is-visible');
      toastHideTimer = setTimeout(() => dom.liveStatus.classList.remove('is-visible'), 2700);
    }, 20);
  };
  const currentCollection = () => collectionMap.get(collectionId) || null;
  const currentPhoto = () => currentCollection()?.photos.find(photo => photo.id === photoId) || null;
  const currentVideo = () => videoMap.get(videoId) || null;
  const categoryCollections = () => category === 'all' ? collections : collections.filter(collection => collection.category === category);
  const durationLabel = seconds => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${pad(value % 60)}`;
  };
  const versionLabel = video => video.presentation === 'montage' ? 'Montage' : video.presentation === 'trailer' ? 'Original trailer' : video.excerpt ? `${Math.round(Number(video.duration) || 0)}s excerpt` : String(video.id || '').includes('trailer') ? 'Trailer' : `${Math.round(Number(video.duration) || 0)}s film`;
  const imageButton = (className, imageSrc, title, ariaLabel) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', ariaLabel || title);
    const image = document.createElement('img');
    image.src = imageSrc;
    image.alt = title;
    image.loading = 'lazy';
    image.decoding = 'async';
    button.append(image);
    return button;
  };

  function cancelFocus() {
    focusToken += 1;
    clearTimeout(focusTimer);
    clearTimeout(captureTimer);
    clearTimeout(captureResetTimer);
    focusStarted = null;
    capturePending = false;
    dom.cameraStage.classList.remove('is-focusing', 'is-focused', 'is-capturing');
    dom.shutterButton?.classList.remove('is-pressed');
    text(dom.shutterStatus, 'Hold to focus · Release to save');
  }

  function pause(video) {
    if (!video) return;
    try { video.pause(); } catch (_) { /* Media may be unavailable in a document preview. */ }
  }

  function configurePreview(video, source, poster) {
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'metadata';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('loop', '');
    if (poster) video.poster = poster;
    if (source && video.getAttribute('src') !== source) video.src = source;
  }

  function tryPlay(video, onFailure) {
    if (!video || !motionEnabled || document.hidden) return;
    video.muted = true;
    video.defaultMuted = true;
    try {
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') promise.catch(error => { if (error?.name === 'AbortError') return; if (onFailure) onFailure(); });
    } catch (_) {
      if (onFailure) onFailure();
    }
  }

  function posterFallback(generation) {
    if (generation !== stageGeneration || view !== 'motion') return;
    const video = currentVideo();
    pause(dom.stageVideo);
    if (dom.stageVideo) dom.stageVideo.hidden = true;
    if (dom.stagePhoto && video?.poster) {
      dom.stagePhoto.src = video.poster;
      dom.stagePhoto.alt = `${video.title}, preview poster`;
      dom.stagePhoto.hidden = false;
    }
    text(dom.cameraStatus, 'STILL PREVIEW / PLAY FILM');
  }

  function attemptStagePlayback() {
    if (view !== 'motion' || !stageInView || !motionEnabled || document.hidden || dom.mediaDialog?.open || dom.lightbox?.open) {
      pause(dom.stageVideo);
      return;
    }
    const generation = stageGeneration;
    tryPlay(dom.stageVideo, () => posterFallback(generation));
  }

  function updateExposure() {
    const brightness = view === 'photo' ? Math.pow(2, exposure * 0.4).toFixed(3) : '1';
    dom.cameraStage.style.setProperty('--exposure-brightness', brightness);
    dom.stagePhoto?.style.setProperty('--exposure-brightness', brightness);
    text(dom.exposureValue, `${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)}`);
    if (dom.exposureSlider) {
      dom.exposureSlider.disabled = view !== 'photo';
      dom.exposureSlider.value = String(exposure);
      dom.exposureSlider.setAttribute('aria-label', view === 'photo' ? 'Photo exposure, minus two to plus two EV' : 'Exposure is available in PHOTO mode');
    }
  }

  function updateStage() {
    cancelFocus();
    stageGeneration += 1;
    clearTimeout(stageChangeTimer);
    dom.cameraStage.classList.remove('changing');
    if (motionEnabled && stageGeneration > 1) {
      dom.cameraStage.classList.add('changing');
      stageChangeTimer = setTimeout(() => dom.cameraStage.classList.remove('changing'), 240);
    }
    const item = view === 'photo' ? currentPhoto() : currentVideo();
    document.body.dataset.view = view;
    const collection = currentCollection();
    const list = view === 'photo' ? (collection?.photos || []) : videos;
    const index = list.findIndex(entry => entry.id === (view === 'photo' ? photoId : videoId));
    text(dom.dialModeValue, view === 'photo' ? 'PHOTO' : 'MOTION');
    text(dom.stageModeLabel, view === 'photo' ? 'PHOTOGRAPHY / PHOTO' : 'MOVING IMAGE / MOTION');
    text(dom.stageTitle, item?.title || 'No works yet');
    text(dom.stageCategory, view === 'photo' ? `${collection?.category || ''} / ${collection?.title || ''}` : item?.kind || 'Moving image');
    text(dom.stageIndex, `${pad(index + 1)} / ${pad(list.length)}`);
    text(dom.stageBadge, view === 'photo' ? (collection?.tone || 'PHOTO') : `${versionLabel(item || {})} · ${durationLabel(item?.duration)}`);
    text(dom.stageCaption, view === 'photo' ? 'Swipe or use arrows to follow this series' : 'Silent preview · Open to play');
    text(dom.cameraStatus, view === 'photo' ? 'PHOTO / READY' : motionEnabled ? 'MOTION / MUTED PREVIEW' : 'MOTION / PAUSED');
    dom.stageProgress?.style.setProperty('--progress', list.length ? `${((index + 1) / list.length) * 100}%` : '0%');
    dom.modeDial?.setAttribute('aria-label', `${view === 'photo' ? 'PHOTO' : 'MOTION'} mode. Press to switch`);
    document.querySelectorAll('button[data-view]').forEach(button => setPressed(button, button.dataset.view === view));
    document.querySelectorAll('[data-open-view]').forEach(link => {
      if (link.dataset.openView === view) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    setPressed(dom.modePhoto, view === 'photo');
    setPressed(dom.modeMotion, view === 'motion');
    if (dom.openWork) {
      dom.openWork.disabled = !item;
      dom.openWork.setAttribute('aria-label', view === 'photo' ? 'Enlarge the selected photograph' : `Play ${item?.title || 'film'}, ${item ? versionLabel(item) : ''}`);
      const label = dom.openWork.querySelector('[data-open-label]');
      text(label || dom.openWork, view === 'photo' ? 'Enlarge' : 'Play sequence');
    }
    for (const button of [dom.prevWork, dom.nextWork]) if (button) button.disabled = list.length < 2;
    if (dom.shutterButton) dom.shutterButton.disabled = !item;
    if (dom.photoAutoplay) dom.photoAutoplay.disabled = !currentCollection()?.photos.length;
    pause(dom.stageVideo);
    if (dom.stageVideo) dom.stageVideo.hidden = view !== 'motion' || !item;
    if (dom.stagePhoto) {
      dom.stagePhoto.hidden = view !== 'photo' || !item;
      if (view === 'photo' && item) {
        dom.stagePhoto.src = item.src;
        dom.stagePhoto.alt = `${item.title}, ${collection.category}, ${collection.title}`;
        dom.stagePhoto.dataset.orientation = item.orientation || 'landscape';
      }
    }
    if (view === 'motion' && item) {
      configurePreview(dom.stageVideo, item.preview || item.src, item.poster);
      if (dom.stageVideo) dom.stageVideo.dataset.orientation = item.aspect || 'landscape';
      attemptStagePlayback();
    }
    updateExposure();
    updatePhotoSelection();
    updateProgramSelection();
    schedulePhotoAutoplay();
  }

  function setView(next, { notify = true } = {}) {
    if (!['photo', 'motion'].includes(next)) return;
    view = next;
    updateStage();
    if (notify) announce(`${view === 'photo' ? 'PHOTO' : 'MOTION'} mode`);
  }

  function renderCollectionOptions() {
    const available = categoryCollections();
    if (dom.collectionSelect) {
      const fragment = document.createDocumentFragment();
      available.forEach(collection => {
        const option = document.createElement('option');
        option.value = collection.id;
        option.textContent = `${collection.title} · ${collection.photos.length} frames`;
        fragment.append(option);
      });
      dom.collectionSelect.replaceChildren(fragment);
      dom.collectionSelect.value = collectionId || '';
      dom.collectionSelect.disabled = available.length === 0;
    }
    if (dom.seriesTabs) {
      const fragment = document.createDocumentFragment();
      available.forEach(collection => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'series-tab';
        button.setAttribute('data-collection-id', collection.id);
        const name = document.createElement('span');
        name.textContent = collection.title;
        const count = document.createElement('span');
        count.className = 'series-count';
        count.textContent = pad(collection.photos.length);
        button.append(name, count);
        button.setAttribute('aria-label', `${collection.title}, ${collection.tone}, ${collection.photos.length} frames`);
        setPressed(button, collection.id === collectionId);
        on(button, 'click', () => chooseCollection(collection.id));
        fragment.append(button);
      });
      dom.seriesTabs.replaceChildren(fragment);
    }
    document.querySelectorAll('[data-category]').forEach(button => setPressed(button, button.dataset.category === category));
  }

  function updatePhotoSelection() {
    const collection = currentCollection();
    const index = collection?.photos.findIndex(photo => photo.id === photoId) ?? -1;
    text(dom.photoPosition, `${pad(index + 1)} / ${pad(collection?.photos.length || 0)}`);
    [dom.photoRail, dom.photoWall].forEach(container => container?.querySelectorAll('[data-photo-id]').forEach(button => setPressed(button, button.dataset.photoId === photoId)));
    if (dom.seriesTabs) dom.seriesTabs.querySelectorAll('[data-collection-id]').forEach(button => setPressed(button, button.dataset.collectionId === collectionId));
    if (dom.collectionSelect) dom.collectionSelect.value = collectionId || '';
  }

  function renderPhotos() {
    const collection = currentCollection();
    text(dom.seriesTitle, collection?.title || 'No series yet');
    text(dom.seriesTone, collection?.tone || '');
    text(dom.seriesDescription, collection?.description || 'Choose a photography category.');
    if (collection?.accent) document.body.style.setProperty('--collection-accent', collection.accent);
    [dom.photoRail, dom.photoWall].forEach(container => {
      if (!container) return;
      const fragment = document.createDocumentFragment();
      const wall = container === dom.photoWall;
      (collection?.photos || []).forEach((photo, index) => {
        const button = imageButton(wall ? 'photo-print' : 'film-frame', photo.thumb || photo.src, photo.title, `View ${photo.title}, frame ${index + 1} of ${collection.title}`);
        button.setAttribute('data-photo-id', photo.id);
        button.dataset.orientation = photo.orientation || 'landscape';
        const caption = document.createElement('span');
        caption.className = wall ? 'photo-print-caption' : 'film-frame-caption';
        const number = document.createElement('span');
        number.className = 'photo-index';
        number.textContent = pad(index + 1);
        const title = document.createElement('span');
        title.textContent = photo.title;
        if (wall) caption.append(title, number);
        else caption.textContent = `${pad(index + 1)} · ${photo.title}`;
        button.append(caption);
        on(button, 'click', () => choosePhoto(photo.id));
        fragment.append(button);
      });
      if (!collection?.photos.length) {
        const empty = document.createElement('p');
        empty.className = 'archive-empty';
        empty.textContent = 'No photographs in this category yet.';
        fragment.append(empty);
      }
      container.replaceChildren(fragment);
    });
    renderCollectionOptions();
    updatePhotoSelection();
  }

  function chooseCollection(id, { notify = true, nextPhotoId = null } = {}) {
    const collection = collectionMap.get(id);
    if (!collection) return;
    collectionId = id;
    category = collection.category;
    photoId = collection.photos.some(photo => photo.id === nextPhotoId) ? nextPhotoId : collection.photos[0]?.id || null;
    view = 'photo';
    renderPhotos();
    updateStage();
    if (notify) announce(`${collection.title} · ${collection.photos.length} frames`);
  }

  function chooseCategory(nextCategory) {
    category = nextCategory;
    const first = categoryCollections()[0] || null;
    collectionId = first?.id || null;
    photoId = first?.photos[0]?.id || null;
    view = 'photo';
    renderPhotos();
    updateStage();
    announce(`${nextCategory === 'all' ? 'All photography' : nextCategory} · ${categoryCollections().length} series`);
  }

  function choosePhoto(id, { notify = true } = {}) {
    if (!currentCollection()?.photos.some(photo => photo.id === id)) return;
    photoId = id;
    view = 'photo';
    updateStage();
    if (notify) announce(currentPhoto().title);
  }

  function chooseVideo(id, { notify = true } = {}) {
    if (!videoMap.has(id)) return;
    videoId = id;
    view = 'motion';
    updateStage();
    if (notify) announce(`${currentVideo().title} · ${versionLabel(currentVideo())}`);
  }

  function moveWork(direction, { notify = true } = {}) {
    const list = view === 'photo' ? currentCollection()?.photos || [] : videos;
    if (list.length < 2) return;
    const id = view === 'photo' ? photoId : videoId;
    const index = list.findIndex(item => item.id === id);
    const next = list[(index + direction + list.length) % list.length];
    if (view === 'photo') choosePhoto(next.id, { notify });
    else chooseVideo(next.id, { notify });
    if (dom.lightbox?.open && view === 'photo') openPhoto(currentPhoto());
  }

  function schedulePhotoAutoplay() {
    clearTimeout(photoTimer);
    setPressed(dom.photoAutoplay, photoAutoplayEnabled);
    text(dom.photoAutoplay, photoAutoplayEnabled ? 'Pause series' : 'Play series');
    if (dom.photoAutoplay) dom.photoAutoplay.setAttribute('aria-label', photoAutoplayEnabled ? `Stop this series slideshow${!motionEnabled ? ', motion is paused' : ''}` : 'Browse this series automatically, one frame every 3.5 seconds');
    if (!photoAutoplayEnabled || !motionEnabled || view !== 'photo' || document.hidden || dom.lightbox?.open || dom.mediaDialog?.open || (currentCollection()?.photos.length || 0) < 2) return;
    photoTimer = setTimeout(() => {
      if (focusStarted !== null || capturePending || pointerId !== null || spaceDown) schedulePhotoAutoplay();
      else moveWork(1, { notify: false });
    }, 3500);
  }

  const previewEntries = [];
  let previewObserver;
  function canPreview(entry) {
    return motionEnabled && !document.hidden && (entry.inView || entry.hovered || entry.focused) && !dom.mediaDialog?.open && !dom.lightbox?.open;
  }
  function updateProgramPreview(entry) {
    if (canPreview(entry)) tryPlay(entry.video, () => {
      entry.video.hidden = true;
      entry.button.classList.remove('is-previewing');
      entry.button.classList.add('preview-fallback');
    });
    else {
      pause(entry.video);
      entry.button.classList.remove('is-previewing');
    }
  }

  function updateProgramSelection() {
    dom.programList?.querySelectorAll('[data-video-id]').forEach(button => setPressed(button, button.dataset.videoId === videoId));
    dom.programList?.querySelectorAll('[data-work-id]').forEach(row => row.classList.toggle('is-active', row.dataset.workId === currentVideo()?.workId));
  }

  function renderProgram() {
    if (!dom.programList) return;
    const groups = new Map();
    videos.forEach(video => {
      const groupId = video.workId || video.id;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(video);
    });
    const fragment = document.createDocumentFragment();
    let workNumber = 0;
    groups.forEach((versions, workId) => {
      workNumber += 1;
      const video = versions.find(item => item.id.includes('trailer')) || versions[0];
      const row = document.createElement('article');
      row.className = 'program-row';
      row.setAttribute('data-work-id', workId);
      const number = document.createElement('span');
      number.className = 'program-index';
      number.textContent = pad(workNumber);
      const previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'media-preview';
      previewButton.setAttribute('aria-label', `Preview ${video.title} in the viewfinder`);
      previewButton.dataset.aspect = video.aspect || 'landscape';
      const poster = document.createElement('img');
      poster.src = video.poster;
      poster.alt = `${video.title}, poster`;
      poster.loading = 'lazy';
      const preview = document.createElement('video');
      preview.className = 'preview-video';
      preview.setAttribute('aria-hidden', 'true');
      preview.setAttribute('tabindex', '-1');
      configurePreview(preview, video.preview || video.src, video.poster);
      previewButton.append(poster, preview);
      const info = document.createElement('div');
      info.className = 'program-info';
      const heading = document.createElement('h3');
      heading.textContent = video.title;
      const metadata = document.createElement('span');
      metadata.className = 'program-meta';
      metadata.textContent = versions.length > 1 ? `Documentary feature · ${versions.map(versionLabel).join(' / ')}` : `${video.kind} / ${durationLabel(video.duration)}`;
      const description = document.createElement('p');
      description.className = 'program-description';
      description.textContent = video.description;
      const versionList = document.createElement('div');
      versionList.className = 'program-versions';
      versions.forEach(version => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'program-version';
        button.setAttribute('data-video-id', version.id);
        button.textContent = versionLabel(version);
        button.setAttribute('aria-label', `Preview ${version.title}, ${versionLabel(version)}`);
        on(button, 'click', () => chooseVideo(version.id));
        versionList.append(button);
      });
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'program-version program-play';
      playButton.textContent = 'Play sequence';
      playButton.setAttribute('aria-label', `Play ${video.title}, ${versionLabel(video)}`);
      on(playButton, 'click', () => {
        const selected = versions.find(version => version.id === videoId) || video;
        chooseVideo(selected.id, { notify: false });
        openVideo(selected);
      });
      versionList.append(playButton);
      info.append(heading, description, metadata);
      row.append(number, previewButton, info, versionList);
      fragment.append(row);
      const entry = { button: previewButton, video: preview, inView: false, hovered: false, focused: false };
      previewEntries.push(entry);
      on(previewButton, 'click', () => chooseVideo(video.id));
      on(previewButton, 'pointerenter', () => {
        if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches !== false) { entry.hovered = true; updateProgramPreview(entry); }
      });
      on(previewButton, 'pointerleave', () => { entry.hovered = false; updateProgramPreview(entry); });
      on(previewButton, 'focus', () => { entry.focused = true; updateProgramPreview(entry); });
      on(previewButton, 'blur', () => { entry.focused = false; updateProgramPreview(entry); });
      on(preview, 'error', () => { pause(preview); preview.hidden = true; previewButton.classList.remove('is-previewing'); previewButton.classList.add('preview-fallback'); });
      on(preview, 'playing', () => { preview.hidden = false; previewButton.classList.add('is-previewing'); previewButton.classList.remove('preview-fallback'); });
    });
    dom.programList.replaceChildren(fragment);
    if (typeof IntersectionObserver === 'function') {
      previewObserver = new IntersectionObserver(entries => entries.forEach(observed => {
        const entry = previewEntries.find(item => item.button === observed.target);
        if (!entry) return;
        entry.inView = observed.isIntersecting && observed.intersectionRatio >= 0.25;
        updateProgramPreview(entry);
      }), { threshold: [0, 0.25, 0.6] });
      previewEntries.forEach(entry => previewObserver.observe(entry.button));
    }
    updateProgramSelection();
  }

  function setMotionEnabled(enabled, { notify = true } = {}) {
    motionEnabled = Boolean(enabled);
    document.body.dataset.motion = motionEnabled ? 'on' : 'off';
    setPressed(dom.motionToggle, motionEnabled);
    text(dom.motionToggle, motionEnabled ? 'Motion on' : 'Motion off');
    dom.motionToggle?.setAttribute('aria-label', `${motionEnabled ? 'Pause' : 'Enable'} motion previews and slideshows`);
    if (view === 'motion') text(dom.cameraStatus, motionEnabled ? 'MOTION / MUTED PREVIEW' : 'MOTION / PAUSED');
    attemptStagePlayback();
    previewEntries.forEach(updateProgramPreview);
    schedulePhotoAutoplay();
    if (notify) announce(motionEnabled ? 'Motion previews on · Always muted' : 'Motion previews and slideshows paused');
  }

  function openImage(source, title, photo = null) {
    if (!source || !dom.lightbox || !dom.modalImage) return;
    cancelFocus();
    pause(dom.stageVideo);
    previewEntries.forEach(entry => pause(entry.video));
    dom.modalImage.src = source;
    dom.modalImage.alt = title;
    dom.modalImage.style.setProperty('--exposure-brightness', photo ? Math.pow(2, exposure * 0.4).toFixed(3) : '1');
    dom.lightbox.dataset.photoId = photo?.id || '';
    text(dom.modalTitle, title);
    if (typeof dom.lightbox.showModal === 'function') {
      if (!dom.lightbox.open) dom.lightbox.showModal();
    } else dom.lightbox.setAttribute('open', '');
    schedulePhotoAutoplay();
  }

  function openPhoto(photo) {
    if (!photo) return;
    openImage(photo.src, `${photo.title} / ${currentCollection()?.title || 'Photography'}`, photo);
  }

  function updateSoundControl() {
    setPressed(dom.soundToggle, !dialogMuted);
    text(dom.soundToggle, dialogMuted ? 'Sound off' : 'Sound on');
    dom.soundToggle?.setAttribute('aria-label', dialogMuted ? 'Unmute the film player' : 'Mute the film player');
    if (dom.soundToggle) dom.soundToggle.disabled = !dom.mediaDialog?.open;
  }

  function openVideo(video) {
    if (!video || !dom.mediaDialog || !dom.dialogVideo) return;
    cancelFocus();
    pause(dom.stageVideo);
    previewEntries.forEach(entry => pause(entry.video));
    dialogVideoId = video.id;
    const player = dom.dialogVideo;
    player.src = video.src;
    player.poster = video.poster;
    player.controls = true;
    player.loop = false;
    player.playsInline = true;
    player.preload = 'metadata';
    player.muted = dialogMuted;
    player.defaultMuted = false;
    player.removeAttribute('muted');
    player.removeAttribute('autoplay');
    player.setAttribute('controls', '');
    player.setAttribute('playsinline', '');
    text(dom.dialogTitle, video.title);
    text(dom.dialogSubtitle, `${versionLabel(video)} / ${durationLabel(video.duration)}${video.presentation === 'montage' ? ' · Selected moments, rearranged' : video.excerpt ? ' · Selected passage from the film' : ''}`);
    if (typeof dom.mediaDialog.showModal === 'function') {
      if (!dom.mediaDialog.open) dom.mediaDialog.showModal();
    } else dom.mediaDialog.setAttribute('open', '');
    updateSoundControl();
    schedulePhotoAutoplay();
    try {
      const promise = player.play();
      if (promise?.catch) promise.catch(() => announce('Press play in the player to begin.'));
    } catch (_) { announce('Press play in the player to begin.'); }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog === dom.mediaDialog) pause(dom.dialogVideo);
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    if (dialog === dom.mediaDialog) afterVideoClose();
    else afterImageClose();
  }

  function afterImageClose() {
    attemptStagePlayback();
    previewEntries.forEach(updateProgramPreview);
    schedulePhotoAutoplay();
  }

  function afterVideoClose() {
    pause(dom.dialogVideo);
    dialogVideoId = null;
    updateSoundControl();
    attemptStagePlayback();
    previewEntries.forEach(updateProgramPreview);
    schedulePhotoAutoplay();
  }

  function validSavedItem(item) {
    if (!item || !['photo', 'motion'].includes(item.type) || typeof item.id !== 'string') return null;
    if (item.type === 'photo') {
      const entry = photoMap.get(item.id);
      if (!entry) return null;
      return { type: 'photo', id: item.id, collectionId: entry.collection.id, exposure: Number.isFinite(item.exposure) ? Math.max(-2, Math.min(2, item.exposure)) : 0 };
    }
    return videoMap.has(item.id) ? { type: 'motion', id: item.id } : null;
  }

  function restoreShortlist() {
    try {
      const restored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(restored)) shortlist = restored.map(validSavedItem).filter(Boolean).slice(-12);
    } catch (_) { storageAvailable = false; shortlist = []; }
  }

  function saveShortlist() {
    try { localStorage.setItem(storageKey, JSON.stringify(shortlist)); storageAvailable = true; }
    catch (_) { storageAvailable = false; }
  }

  function replaySaved(item) {
    if (item.type === 'photo') {
      const entry = photoMap.get(item.id);
      if (!entry) return;
      exposure = item.exposure;
      chooseCollection(entry.collection.id, { notify: false, nextPhotoId: item.id });
      announce(`${entry.photo.title} · ${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)} EV`);
    } else chooseVideo(item.id);
  }

  function renderShortlist() {
    text(dom.filmCount, `${pad(shortlist.length)} / 12`);
    if (dom.clearFilm) { dom.clearFilm.hidden = !shortlist.length; dom.clearFilm.disabled = !shortlist.length; }
    if (!dom.filmstrip) return;
    const fragment = document.createDocumentFragment();
    shortlist.forEach((item, index) => {
      const entry = item.type === 'photo' ? photoMap.get(item.id) : null;
      const video = item.type === 'motion' ? videoMap.get(item.id) : null;
      const title = entry?.photo.title || video?.title || 'Untitled';
      const button = imageButton('saved-frame', entry ? entry.photo.thumb || entry.photo.src : video.poster, title, `Recall selection ${index + 1}: ${title}, ${item.type === 'photo' ? 'photograph' : 'film'}`);
      button.style.setProperty('--shot-brightness', entry ? Math.pow(2, item.exposure * 0.4).toFixed(3) : '1');
      button.querySelector('img')?.style.setProperty('filter', `brightness(${entry ? Math.pow(2, item.exposure * 0.4).toFixed(3) : '1'})`);
      const caption = document.createElement('span');
      caption.className = 'saved-frame-caption';
      caption.textContent = `${pad(index + 1)} · ${item.type === 'photo' ? 'PHOTO' : 'MOTION'}`;
      button.append(caption);
      on(button, 'click', () => replaySaved(item));
      fragment.append(button);
    });
    if (!shortlist.length) {
      const empty = document.createElement('p');
      empty.className = 'film-empty';
      empty.textContent = 'Press the shutter to keep a frame or a film.';
      fragment.append(empty);
    }
    dom.filmstrip.replaceChildren(fragment);
  }

  function beginFocus() {
    if (!(view === 'photo' ? currentPhoto() : currentVideo()) || capturePending) return false;
    cancelFocus();
    focusStarted = now();
    const token = focusToken;
    dom.cameraStage.classList.add('is-focusing');
    dom.shutterButton?.classList.add('is-pressed');
    text(dom.shutterStatus, 'Focusing…');
    focusTimer = setTimeout(() => {
      if (token !== focusToken) return;
      dom.cameraStage.classList.remove('is-focusing');
      dom.cameraStage.classList.add('is-focused');
      text(dom.shutterStatus, 'In focus · Release to save');
    }, 240);
    return true;
  }

  function requestCapture() {
    const item = view === 'photo' ? currentPhoto() : currentVideo();
    if (!item || capturePending || now() - lastCaptureAt < 350) return;
    if (focusStarted === null) beginFocus();
    const token = focusToken;
    const saved = view === 'photo' ? { type: 'photo', id: item.id, collectionId, exposure } : { type: 'motion', id: item.id };
    capturePending = true;
    dom.shutterButton?.classList.remove('is-pressed');
    captureTimer = setTimeout(() => {
      if (token !== focusToken) return;
      clearTimeout(focusTimer);
      capturePending = false;
      focusStarted = null;
      lastCaptureAt = now();
      dom.cameraStage.classList.remove('is-focusing');
      dom.cameraStage.classList.add('is-focused', 'is-capturing');
      shortlist.push(saved);
      if (shortlist.length > 12) shortlist.shift();
      saveShortlist();
      renderShortlist();
      text(dom.shutterStatus, 'Saved to your roll');
      announce(`${item.title} · Saved${storageAvailable ? '' : ' for this session'} · ${shortlist.length} / 12`);
      captureResetTimer = setTimeout(() => {
        if (token !== focusToken) return;
        dom.cameraStage.classList.remove('is-focused', 'is-capturing');
        text(dom.shutterStatus, 'Hold to focus · Release to save');
      }, 550);
    }, Math.max(0, 240 - (now() - focusStarted)));
  }

  function renderAwardOptions() {
    if (!dom.awardList) return;
    const fragment = document.createDocumentFragment();
    awards.forEach((award, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'award-choice';
      button.setAttribute('data-award-index', String(index));
      button.setAttribute('aria-label', `${award.name}, ${award.statusLabel}, ${award.year || 'Year unlisted'}`);
      const name = document.createElement('span');
      name.className = 'award-choice-name';
      name.textContent = award.name;
      const status = document.createElement('span');
      status.className = 'award-choice-status';
      status.textContent = `${award.statusLabel}${award.year ? ` / ${award.year}` : ''}`;
      const number = document.createElement('span');
      number.className = 'award-number';
      number.textContent = pad(index + 1);
      button.append(number, name, status);
      on(button, 'click', () => chooseAward(index));
      fragment.append(button);
    });
    dom.awardList.replaceChildren(fragment);
  }

  function chooseAward(index, { notify = true } = {}) {
    if (!awards.length) return;
    awardIndex = (index + awards.length) % awards.length;
    const award = awards[awardIndex];
    if (dom.awardImage) {
      clearTimeout(awardTimer);
      dom.awardImage.classList.remove('changing');
      dom.awardImage.src = award.src;
      dom.awardImage.alt = `${award.name}, ${award.statusLabel}, ${award.year || 'Year unlisted'}, ${award.film}`;
      if (motionEnabled) {
        dom.awardImage.classList.add('changing');
        awardTimer = setTimeout(() => dom.awardImage.classList.remove('changing'), 220);
      }
    }
    text(dom.awardName, award.name);
    text(dom.awardStatus, award.label);
    text(dom.awardYear, award.year || 'Year unlisted');
    text(dom.awardPosition, `${pad(awardIndex + 1)} / ${pad(awards.length)}`);
    dom.awardList?.querySelectorAll('[data-award-index]').forEach(button => setPressed(button, Number(button.dataset.awardIndex) === awardIndex));
    for (const button of [dom.awardPrev, dom.awardNext]) if (button) button.disabled = awards.length < 2;
    if (notify) announce(`${award.name} · ${award.statusLabel}`);
  }

  const modeButtons = new Set([...document.querySelectorAll('button[data-view]'), dom.modePhoto, dom.modeMotion].filter(Boolean));
  modeButtons.forEach(button => on(button, 'click', () => setView(button.dataset.view || (button === dom.modePhoto ? 'photo' : 'motion'))));
  on(dom.modeDial, 'click', () => setView(view === 'photo' ? 'motion' : 'photo'));
  document.querySelectorAll('[data-open-view]').forEach(link => on(link, 'click', event => {
    event.preventDefault();
    const next = link.dataset.openView;
    setView(next);
    const destination = next === 'photo' ? dom.photoWall : dom.programList;
    destination?.scrollIntoView({ behavior: motionEnabled ? 'smooth' : 'auto', block: 'start' });
  }));
  document.querySelectorAll('[data-category]').forEach(button => on(button, 'click', () => chooseCategory(button.dataset.category)));
  on(dom.collectionSelect, 'change', event => chooseCollection(event.target.value));
  on(dom.prevWork, 'click', () => moveWork(-1));
  on(dom.nextWork, 'click', () => moveWork(1));
  on(dom.openWork, 'click', () => view === 'photo' ? openPhoto(currentPhoto()) : openVideo(currentVideo()));
  on(dom.exposureSlider, 'input', event => {
    if (view !== 'photo') return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    exposure = Math.round(Math.max(-2, Math.min(2, value)) * 10) / 10;
    updateExposure();
    announce(`Exposure ${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)} EV`);
  });
  on(dom.gridToggle, 'click', () => {
    gridEnabled = !gridEnabled;
    dom.cameraStage.classList.toggle('grid-hidden', !gridEnabled);
    setPressed(dom.gridToggle, gridEnabled);
    text(dom.gridToggle, gridEnabled ? 'Grid on' : 'Grid off');
    announce(`Composition grid ${gridEnabled ? 'on' : 'off'}`);
  });
  on(dom.motionToggle, 'click', () => setMotionEnabled(!motionEnabled));
  on(dom.photoAutoplay, 'click', () => {
    photoAutoplayEnabled = !photoAutoplayEnabled;
    schedulePhotoAutoplay();
    announce(photoAutoplayEnabled ? motionEnabled ? 'Series slideshow on · 3.5 seconds per frame' : 'Slideshow ready · Enable motion to begin' : 'Series slideshow off');
  });
  on(dom.clearFilm, 'click', () => {
    shortlist = [];
    try { localStorage.removeItem(storageKey); } catch (_) { storageAvailable = false; }
    renderShortlist();
    announce('Your roll is clear');
  });
  on(dom.awardPrev, 'click', () => chooseAward(awardIndex - 1));
  on(dom.awardNext, 'click', () => chooseAward(awardIndex + 1));
  on(dom.posterOpen, 'click', () => openImage(archive.film?.poster, `${archive.film?.title || 'Film'} / Official poster`));
  document.querySelectorAll('[data-open-image]').forEach(button => on(button, 'click', () => openImage(button.dataset.openImage, button.dataset.imageTitle || 'Film still')));
  on(dom.closeImage, 'click', () => closeDialog(dom.lightbox));
  on(dom.closeVideo, 'click', () => closeDialog(dom.mediaDialog));
  on(dom.lightbox, 'close', afterImageClose);
  on(dom.mediaDialog, 'close', afterVideoClose);
  [dom.lightbox, dom.mediaDialog].forEach(dialog => on(dialog, 'click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
  }));
  on(dom.soundToggle, 'click', () => {
    if (!dom.mediaDialog?.open || !dom.dialogVideo) return;
    dialogMuted = !dom.dialogVideo.muted;
    dom.dialogVideo.muted = dialogMuted;
    updateSoundControl();
    announce(dialogMuted ? 'Film sound off' : 'Film sound on');
  });
  on(dom.dialogVideo, 'volumechange', () => {
    if (!dom.mediaDialog?.open) return;
    dialogMuted = dom.dialogVideo.muted;
    updateSoundControl();
  });
  on(dom.dialogVideo, 'error', () => {
    if (!dom.mediaDialog?.open) return;
    pause(dom.dialogVideo);
    text(dom.dialogSubtitle, 'Playback unavailable. The poster remains in view.');
    announce('Playback unavailable. Please try again.');
  });
  on(dom.stageVideo, 'error', () => posterFallback(stageGeneration));
  on(dom.stageVideo, 'playing', () => {
    if (view !== 'motion' || !motionEnabled || !stageInView || document.hidden) { pause(dom.stageVideo); return; }
    dom.stageVideo.hidden = false;
    if (dom.stagePhoto) dom.stagePhoto.hidden = true;
    text(dom.cameraStatus, 'MOTION / MUTED PREVIEW');
  });
  on(dom.helpToggle, 'click', () => {
    if (!dom.cameraHelp) return;
    dom.cameraHelp.hidden = !dom.cameraHelp.hidden;
    dom.helpToggle.setAttribute('aria-expanded', String(!dom.cameraHelp.hidden));
  });

  on(dom.shutterButton, 'pointerdown', event => {
    if (event.button !== 0 || pointerId !== null || capturePending || now() - lastCaptureAt < 350) return;
    pointerId = event.pointerId;
    beginFocus();
    try { dom.shutterButton.setPointerCapture(event.pointerId); } catch (_) { /* Click fallback remains available. */ }
  });
  on(dom.shutterButton, 'pointerup', event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    ignoreClickUntil = now() + 450;
    const rect = dom.shutterButton.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside) requestCapture();
    else cancelFocus();
  });
  on(dom.shutterButton, 'pointercancel', () => { pointerId = null; cancelFocus(); });
  on(dom.shutterButton, 'click', event => {
    if (event.detail > 0 && now() < ignoreClickUntil) return;
    requestCapture();
  });
  on(dom.cameraStage, 'pointerdown', event => {
    if (event.pointerType !== 'touch' || event.target.closest('button, a, input, select, textarea')) return;
    touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  on(dom.cameraStage, 'pointerup', event => {
    if (!touchStart || touchStart.id !== event.pointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4) moveWork(dx < 0 ? 1 : -1);
  });
  on(dom.cameraStage, 'pointercancel', () => { touchStart = null; });

  const editable = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  const interactive = target => target instanceof Element && Boolean(target.closest('button, a, input, textarea, select, video, [role="button"], [contenteditable="true"], [role="textbox"]'));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return;
    if (event.key === 'Escape') {
      if (dom.mediaDialog?.open) closeDialog(dom.mediaDialog);
      else if (dom.lightbox?.open) closeDialog(dom.lightbox);
      else if (dom.cameraHelp && !dom.cameraHelp.hidden) { dom.cameraHelp.hidden = true; dom.helpToggle?.setAttribute('aria-expanded', 'false'); }
      cancelFocus();
      return;
    }
    if (dom.mediaDialog?.open) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (dom.lightbox?.open && !dom.lightbox.dataset.photoId) return;
      if (interactive(event.target) && !dom.lightbox?.open) return;
      event.preventDefault();
      moveWork(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.code !== 'Space' || interactive(event.target) || dom.lightbox?.open) return;
    event.preventDefault();
    if (event.repeat || spaceDown) return;
    spaceDown = beginFocus();
  });
  document.addEventListener('keyup', event => {
    if (event.code !== 'Space' || !spaceDown) return;
    event.preventDefault();
    spaceDown = false;
    requestCapture();
  });
  window.addEventListener('blur', () => { spaceDown = false; pointerId = null; touchStart = null; cancelFocus(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      spaceDown = false;
      cancelFocus();
      pause(dom.stageVideo);
      previewEntries.forEach(entry => pause(entry.video));
      clearTimeout(photoTimer);
      pause(dom.dialogVideo);
    } else {
      attemptStagePlayback();
      previewEntries.forEach(updateProgramPreview);
      schedulePhotoAutoplay();
    }
  });
  if (typeof IntersectionObserver === 'function') {
    const stageObserver = new IntersectionObserver(entries => {
      stageInView = entries.some(entry => entry.isIntersecting);
      attemptStagePlayback();
    }, { threshold: 0.15 });
    stageObserver.observe(dom.cameraStage);
  }
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (motionPreference?.addEventListener) motionPreference.addEventListener('change', event => { if (event.matches) setMotionEnabled(false); });

  restoreShortlist();
  renderPhotos();
  renderProgram();
  renderShortlist();
  renderAwardOptions();
  chooseAward(0, { notify: false });
  setPressed(dom.gridToggle, true);
  text(dom.gridToggle, 'Grid on');
  setMotionEnabled(motionEnabled, { notify: false });
  updateSoundControl();
  updateStage();
})();
