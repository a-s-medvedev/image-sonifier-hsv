const state = {
  audioContext: null,
  source: null,
  audioElementSource: null,
  graphInputNode: null,
  rawPixels: null,
  processedPixels: null,
  hsvHistograms: null,
  width: 0,
  height: 0,
  imageLoaded: false,
  isLoadingImage: false,
  imageRevision: 0,
  isGenerating: false,
  generationId: 0,
  cachedAudioBuffer: null,
  cachedAudioKey: "",
  playerUrl: null,
  playerAudioKey: "",
  outputGain: null,
  timbreFilter: null,
  timbreShaper: null,
  stereoSplitter: null,
  stereoMerger: null,
  leftDelayNode: null,
  rightDelayNode: null,
  leftFeedbackGain: null,
  rightFeedbackGain: null,
  wetGain: null,
  playheadFrame: null,
  sourceImage: null,
  sourceIsDefaultImage: false
};

const elements = {
  imageInput: document.getElementById("imageInput"),
  fileName: document.getElementById("fileName"),
  originalCanvas: document.getElementById("originalCanvas"),
  previewCanvas: document.getElementById("previewCanvas"),
  hsvHistogramCanvas: document.getElementById("hsvHistogramCanvas"),
  audioPlayer: document.getElementById("audioPlayer"),
  playButton: document.getElementById("playButton"),
  stopButton: document.getElementById("stopButton"),
  exportButton: document.getElementById("exportButton"),
  modeSelect: document.getElementById("modeSelect"),
  frequencyDetailSelect: document.getElementById("frequencyDetailSelect"),
  imageSizeLimitSelect: document.getElementById("imageSizeLimitSelect"),
  durationSlider: document.getElementById("durationSlider"),
  minFreqSlider: document.getElementById("minFreqSlider"),
  maxFreqSlider: document.getElementById("maxFreqSlider"),
  contrastSlider: document.getElementById("contrastSlider"),
  volumeSlider: document.getElementById("volumeSlider"),
  redEffectSlider: document.getElementById("redEffectSlider"),
  greenEffectSlider: document.getElementById("greenEffectSlider"),
  blueEffectSlider: document.getElementById("blueEffectSlider"),
  readinessProgress: document.getElementById("readinessProgress"),
  statusText: document.getElementById("statusText"),
  invertCheckbox: document.getElementById("invertCheckbox"),
  reverseCheckbox: document.getElementById("reverseCheckbox"),
  loopCheckbox: document.getElementById("loopCheckbox"),
  durationValue: document.getElementById("durationValue"),
  minFreqValue: document.getElementById("minFreqValue"),
  maxFreqValue: document.getElementById("maxFreqValue"),
  contrastValue: document.getElementById("contrastValue"),
  volumeValue: document.getElementById("volumeValue"),
  redEffectValue: document.getElementById("redEffectValue"),
  greenEffectValue: document.getElementById("greenEffectValue"),
  blueEffectValue: document.getElementById("blueEffectValue"),
  readinessValue: document.getElementById("readinessValue"),
  playbackElapsed: document.getElementById("playbackElapsed"),
  playbackDuration: document.getElementById("playbackDuration"),
  playbackFill: document.getElementById("playbackFill"),
  freqAxis: document.getElementById("freqAxis"),
  timeAxis: document.getElementById("timeAxis"),
  playhead: document.getElementById("playhead")
};

const hiddenCanvas = document.createElement("canvas");
const DEFAULT_TEST_IMAGE = "generated-test-pattern";
const TWO_PI = Math.PI * 2;
const SPECTROGRAM_COLOR_LUT = makeSpectrogramColorLut();

elements.imageInput.addEventListener("change", loadImage);
elements.playButton.addEventListener("click", playAudio);
elements.stopButton.addEventListener("click", stopAudio);
elements.exportButton.addEventListener("click", exportWav);
elements.loopCheckbox.addEventListener("change", () => {
  elements.audioPlayer.loop = elements.loopCheckbox.checked;
  if (state.source) state.source.loop = elements.loopCheckbox.checked;
});

elements.audioPlayer.addEventListener("play", () => {
  stopBufferSource(false);
  safeResumeAudioContext();
  connectAudioElementGraph();
  startAudioElementPlayheadAnimation();
});

elements.audioPlayer.addEventListener("pause", () => {
  if (elements.audioPlayer.ended) return;
  stopPlayheadAnimation(false);
});

elements.audioPlayer.addEventListener("ended", () => {
  stopPlayheadAnimation();
  setStatus("Воспроизведение завершено.");
});

elements.volumeSlider.addEventListener("input", () => {
  updateLabels();
  updateRealtimeAudioControls();
});

[
  elements.redEffectSlider,
  elements.greenEffectSlider,
  elements.blueEffectSlider
].forEach((control) => {
  control.addEventListener("input", () => {
    updateLabels();
    invalidateAudioCache(false);
    updateRealtimeAudioControls();
  });
});

elements.imageSizeLimitSelect.addEventListener("input", () => {
  if (!state.imageLoaded) return;

  if (state.sourceImage) {
    setStatus("Преобразование изображения...");
    convertSourceImageToWorkingCanvas(state.sourceIsDefaultImage);
    setStatus("Готово.");
    return;
  }

  processImage();
  drawPreview();
  clearAudioCache();
});

[
  elements.modeSelect,
  elements.frequencyDetailSelect,
  elements.durationSlider,
  elements.minFreqSlider,
  elements.maxFreqSlider,
  elements.reverseCheckbox
].forEach((control) => {
  control.addEventListener("input", () => {
    updateLabels();
    if (state.imageLoaded) {
      clearAudioCache();
      updateRealtimeAudioControls();
    }
  });
});

[
  elements.contrastSlider,
  elements.invertCheckbox
].forEach((control) => {
  control.addEventListener("input", () => {
    updateLabels();
    if (!state.imageLoaded) return;
    processImage();
    drawPreview();
    clearAudioCache();
  });
});

updateLabels();
setReadyState(false);
setGenerationProgress(0);
loadImage(DEFAULT_TEST_IMAGE);

function loadImage(event) {
  const source = typeof event === "string" ? event : event.target.files[0];
  if (!source) return;

  const isDefaultTestImage = typeof source === "string" && source === DEFAULT_TEST_IMAGE;
  elements.fileName.textContent = typeof source === "string" ? "Тестовое изображение" : source.name;

  if (isDefaultTestImage) {
    setImageLoading(true, "Создание тестового изображения...");
    loadGeneratedTestPattern();
    return;
  }

  setImageLoading(true, "Загрузка изображения...");

  if (typeof source === "string") {
    loadImageElement(source, false);
    return;
  }

  let objectUrl = "";
  try {
    objectUrl = URL.createObjectURL(source);
  } catch (error) {
    loadFileWithReader(source, isDefaultTestImage);
    return;
  }

  loadImageElement(objectUrl, isDefaultTestImage, () => loadFileWithReader(source, isDefaultTestImage));
}

function loadFileWithReader(file, isDefaultTestImage) {
  const reader = new FileReader();
  reader.onload = () => loadImageElement(reader.result, isDefaultTestImage);
  reader.onerror = () => finishImageLoadError("Изображение не удалось прочитать.", isDefaultTestImage);
  reader.readAsDataURL(file);
}

function loadImageElement(src, isDefaultTestImage, fallback = null) {
  const image = new Image();
  const releaseObjectUrl = () => {
    if (typeof src === "string" && src.startsWith("blob:")) {
      URL.revokeObjectURL(src);
    }
  };

  image.onload = () => {
    handleLoadedImage(image, isDefaultTestImage);
    releaseObjectUrl();
  };

  image.onerror = () => {
    releaseObjectUrl();
    if (fallback) {
      fallback();
      return;
    }
    finishImageLoadError("Изображение не удалось загрузить.", isDefaultTestImage);
  };

  image.src = src;
}

function handleLoadedImage(image, isDefaultTestImage) {
  try {
    setStatus("Обработка изображения...");

    state.sourceImage = image;
    state.sourceIsDefaultImage = isDefaultTestImage;
    if (!convertSourceImageToWorkingCanvas(isDefaultTestImage)) return;
    setImageLoading(false, "Готово.");
  } catch (error) {
    finishImageLoadError("Изображение не удалось подготовить.", isDefaultTestImage);
  }
}

function convertSourceImageToWorkingCanvas(isDefaultTestImage) {
  const dimensions = fitImageToSelectedLimit(state.sourceImage.naturalWidth, state.sourceImage.naturalHeight);

  state.width = dimensions.width;
  state.height = dimensions.height;
  hiddenCanvas.width = state.width;
  hiddenCanvas.height = state.height;
  elements.previewCanvas.width = state.width;
  elements.previewCanvas.height = state.height;

  const ctx = hiddenCanvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.drawImage(state.sourceImage, 0, 0, state.width, state.height);

  let data;
  try {
    data = ctx.getImageData(0, 0, state.width, state.height).data;
  } catch (error) {
    if (isDefaultTestImage) {
      loadGeneratedTestPattern();
      return false;
    }
    finishImageLoadError("Изображение не удалось обработать через canvas.", false);
    return false;
  }

  storeRawPixels(data);
  drawOriginalPreview();
  state.imageLoaded = true;
  processImage();
  drawPreview();
  clearAudioCache();
  return true;
}

function fitImageToSelectedLimit(width, height) {
  const limitValue = elements.imageSizeLimitSelect.value;
  if (limitValue === "none") {
    return { width, height };
  }

  const maxSize = Number(limitValue);
  const largestSide = Math.max(width, height);
  if (!maxSize || largestSide <= maxSize) {
    return { width, height };
  }

  const scale = maxSize / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function finishImageLoadError(message, isDefaultTestImage) {
  if (isDefaultTestImage) {
    loadGeneratedTestPattern();
    return;
  }

  state.imageLoaded = false;
  clearAudioCache();
  setImageLoading(false, message);
}

function setImageLoading(isLoading, message = "") {
  state.isLoadingImage = isLoading;
  setReadyState(state.imageLoaded);
  if (message) setStatus(message);
}

function storeRawPixels(data) {
  // Native bytes use one quarter of the memory required by normalized floats.
  state.rawPixels = new Uint8ClampedArray(data);
}

function loadGeneratedTestPattern() {
  state.sourceImage = null;
  state.sourceIsDefaultImage = true;
  state.width = 1024;
  state.height = 512;
  hiddenCanvas.width = state.width;
  hiddenCanvas.height = state.height;
  elements.previewCanvas.width = state.width;
  elements.previewCanvas.height = state.height;
  const ctx = hiddenCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.createImageData(state.width, state.height);

  for (let y = 0; y < state.height; y += 1) {
    const yNorm = y / (state.height - 1);
    for (let x = 0; x < state.width; x += 1) {
      const xNorm = x / (state.width - 1);
      const diagonal = Math.exp(-Math.pow(yNorm - (0.82 - xNorm * 0.62), 2) / 0.0008);
      const arc = Math.exp(-Math.pow(yNorm - (0.22 + 0.16 * Math.sin(xNorm * Math.PI * 4)), 2) / 0.0012);
      const pulses = Math.pow(Math.max(0, Math.sin(xNorm * Math.PI * 14)), 10) * Math.exp(-Math.pow(yNorm - 0.52, 2) / 0.035);
      const bass = Math.exp(-Math.pow(yNorm - 0.9, 2) / 0.004) * (0.45 + 0.55 * Math.sin(xNorm * Math.PI * 8) ** 2);
      const brightness = clamp(diagonal * 0.9 + arc * 0.72 + pulses * 0.75 + bass * 0.55, 0, 1);
      const hueShift = xNorm * 6 + yNorm * 3;
      const index = (y * state.width + x) * 4;

      imageData.data[index] = Math.round(255 * clamp(brightness * (0.45 + 0.55 * Math.sin(hueShift) ** 2), 0, 1));
      imageData.data[index + 1] = Math.round(255 * clamp(brightness * (0.35 + 0.65 * Math.sin(hueShift + 2.1) ** 2), 0, 1));
      imageData.data[index + 2] = Math.round(255 * clamp(brightness * (0.35 + 0.65 * Math.sin(hueShift + 4.2) ** 2), 0, 1));
      imageData.data[index + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  storeRawPixels(imageData.data);
  drawOriginalPreview();
  state.imageLoaded = true;
  processImage();
  drawPreview();
  clearAudioCache();
  setImageLoading(false, "Готово.");
  preloadDefaultAudio();
}

function processImage() {
  const contrast = Number(elements.contrastSlider.value);
  const invert = elements.invertCheckbox.checked;
  const histogramBins = 48;
  const hueHistogram = new Float32Array(histogramBins);
  const saturationHistogram = new Uint32Array(histogramBins);
  const valueHistogram = new Uint32Array(histogramBins);
  // Store only amplitude, hue and saturation; the original value would be a
  // duplicate of data that is never consumed by the synthesizer.
  state.processedPixels = new Float32Array(state.width * state.height * 3);

  for (let i = 0; i < state.width * state.height; i += 1) {
    const sourceIndex = i * 4;
    const targetIndex = i * 3;
    const r = state.rawPixels[sourceIndex] / 255;
    const g = state.rawPixels[sourceIndex + 1] / 255;
    const b = state.rawPixels[sourceIndex + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta > 0) {
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = (b - r) / delta + 2;
      } else {
        hue = (r - g) / delta + 4;
      }
      hue /= 6;
      if (hue < 0) hue += 1;
    }

    const saturation = max === 0 ? 0 : delta / max;
    if (saturation > 0.015) {
      const hueBin = Math.min(histogramBins - 1, Math.floor(hue * histogramBins));
      hueHistogram[hueBin] += 0.2 + saturation * 0.8;
    }
    saturationHistogram[Math.min(histogramBins - 1, Math.floor(saturation * histogramBins))] += 1;
    valueHistogram[Math.min(histogramBins - 1, Math.floor(max * histogramBins))] += 1;

    // HSV value controls amplitude. Contrast and inversion are applied only to
    // the loudness channel so geometry stays separate from hue and saturation.
    let value = clamp((max - 0.5) * contrast + 0.5, 0, 1);
    if (invert) value = 1 - value;

    state.processedPixels[targetIndex] = value;
    state.processedPixels[targetIndex + 1] = hue;
    state.processedPixels[targetIndex + 2] = saturation;
  }

  state.hsvHistograms = {
    hue: hueHistogram,
    saturation: saturationHistogram,
    value: valueHistogram
  };
  drawHsvHistogram();
  state.imageRevision += 1;
}

function drawOriginalPreview() {
  elements.originalCanvas.width = state.width;
  elements.originalCanvas.height = state.height;
  const ctx = elements.originalCanvas.getContext("2d");
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.drawImage(hiddenCanvas, 0, 0, state.width, state.height);
}

async function generateAudioBuffer(audioContext, generationId) {
  if (!state.processedPixels) return null;

  const duration = Number(elements.durationSlider.value);
  const sampleRate = audioContext.sampleRate;
  const frameCount = Math.floor(duration * sampleRate);
  const buffer = audioContext.createBuffer(2, frameCount, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mode = elements.modeSelect.value;
  const minFrequency = Number(elements.minFreqSlider.value);
  const maxFrequency = Math.max(Number(elements.maxFreqSlider.value), minFrequency + 20);
  const reverseTime = elements.reverseCheckbox.checked;
  const frequencyDetail = Number(elements.frequencyDetailSelect.value);
  const modulation = getTimbreModulation(mode);
  const virtualRowCount = Math.max(1, (state.height - 1) * frequencyDetail + 1);
  const rowFrequencies = makeRowFrequencies(minFrequency, maxFrequency, virtualRowCount);
  const phaseIncrements = makePhaseIncrements(rowFrequencies, sampleRate);
  const rowGain = 1 / Math.sqrt(virtualRowCount);
  const progressStep = Math.max(512, Math.floor(sampleRate / 60));
  const spectralColumns = await buildSpectralColumns(frequencyDetail, virtualRowCount, generationId);
  if (!spectralColumns) return null;
  const mix = new Float64Array(7);

  // Main sonification loop:
  // X chooses time, Y chooses frequency, HSV value sets amplitude, and hue /
  // saturation shape timbre without changing the underlying pitch structure.
  for (let sample = 0; sample < frameCount; sample += 1) {
    if (generationId !== state.generationId) return null;

    const time = sample / sampleRate;
    const normalizedTime = sample / Math.max(1, frameCount - 1);
    const xFloat = reverseTime
      ? (1 - normalizedTime) * (state.width - 1)
      : normalizedTime * (state.width - 1);
    const x0 = Math.floor(xFloat);
    const x1 = Math.min(state.width - 1, x0 + 1);
    const xMix = xFloat - x0;
    const leftColumnWeight = 1 - xMix;
    const rightColumnWeight = xMix;

    mix.fill(0);
    addColumnToSample(
      spectralColumns[x0],
      leftColumnWeight,
      mode,
      modulation,
      sample,
      phaseIncrements,
      rowGain,
      mix
    );

    if (x1 !== x0 && rightColumnWeight > 0) {
      addColumnToSample(
        spectralColumns[x1],
        rightColumnWeight,
        mode,
        modulation,
        sample,
        phaseIncrements,
        rowGain,
        mix
      );
    }

    let leftSample = mix[1];
    let rightSample = mix[2];
    const hsvWeight = mix[3];
    const saturationTotal = mix[6];

    if (mode === "scientific") {
      leftSample = mix[0];
      rightSample = mix[0];
    } else if (mode === "art" && hsvWeight > 0) {
      const saturationAverage = saturationTotal / hsvWeight;
      const drive = 1 + saturationAverage * 1.8 * modulation.saturation;
      const mod = 1 - saturationAverage * 0.08 * modulation.saturation * (0.5 + 0.5 * Math.sin(TWO_PI * 4.5 * time));
      leftSample = Math.tanh(leftSample * drive) * mod;
      rightSample = Math.tanh(rightSample * drive) * mod;
    }

    const fade = getFadeGain(sample, frameCount, sampleRate);
    left[sample] = leftSample * fade;
    right[sample] = rightSample * fade;

    if (mode === "art" && sample > 900 && hsvWeight > 0) {
      const saturationAverage = saturationTotal / hsvWeight;
      const hueAverage = circularHueAverage(mix[4], mix[5]);
      const hueSpace = 0.65 + 0.35 * Math.sin(TWO_PI * hueAverage);
      const feedback = saturationAverage * hueSpace * 0.12 * modulation.space;
      left[sample] += right[sample - 900] * feedback;
      right[sample] += left[sample - 650] * feedback;
    }

    if (sample % progressStep === 0) {
      setGenerationProgress(20 + (sample / frameCount) * 72);
      await waitForUi();
    }
  }

  normalizeAudio(left, right);
  setGenerationProgress(100);
  return buffer;
}

async function playAudio() {
  if (state.isLoadingImage || state.isGenerating) return;

  if (!state.imageLoaded) {
    setStatus("Сначала загрузите изображение.");
    return;
  }

  if (!ensureAudioContext()) return;
  safeResumeAudioContext();

  const buffer = await prepareAudioPlayer("Подготовка звука...", "Подготовка звука остановлена.");
  if (!buffer) return;

  elements.audioPlayer.currentTime = 0;
  startBufferPlayback(buffer);
  setStatus("");
}

async function preloadDefaultAudio() {
  if (!state.imageLoaded || !state.sourceIsDefaultImage || state.isGenerating) return;

  const audioContext = ensureAudioContext();
  if (!audioContext) return;

  const imageRevision = state.imageRevision;
  const buffer = await prepareAudioPlayer("Подготовка звука...", "Подготовка звука остановлена.");
  if (!buffer || !state.sourceIsDefaultImage || imageRevision !== state.imageRevision) return;

  setStatus("");
}

function stopAudio() {
  if (state.isGenerating) {
    state.generationId += 1;
    setGenerating(false, "Подготовка звука остановлена.");
  }

  if (stopBufferSource()) {
    elements.audioPlayer.currentTime = 0;
    setStatus("Воспроизведение остановлено.");
    return;
  }

  if (!elements.audioPlayer.paused || elements.audioPlayer.currentTime > 0) {
    elements.audioPlayer.pause();
    elements.audioPlayer.currentTime = 0;
    stopPlayheadAnimation();
    setStatus("Воспроизведение остановлено.");
  }
}

async function exportWav() {
  if (state.isLoadingImage || state.isGenerating) return;

  if (!state.imageLoaded) {
    setStatus("Сначала загрузите изображение.");
    return;
  }

  stopAudio();
  if (!ensureAudioContext()) return;
  const buffer = await getAudioBufferForCurrentSettings(state.audioContext, "Подготовка WAV...", "Экспорт WAV остановлен.");
  if (!buffer) {
    return;
  }

  const wavBlob = audioBufferToWav(buffer);
  const url = URL.createObjectURL(wavBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "image-sonification.wav";
  link.click();
  URL.revokeObjectURL(url);
  setGenerating(false);
  setStatus("WAV экспортирован.");
}

async function prepareAudioPlayer(startMessage, stoppedMessage) {
  if (!ensureAudioContext()) return false;

  const audioKey = getAudioCacheKey(state.audioContext);
  if (state.playerUrl && state.playerAudioKey === audioKey) {
    setGenerationProgress(100);
    return state.cachedAudioBuffer;
  }

  const buffer = await getAudioBufferForCurrentSettings(state.audioContext, startMessage, stoppedMessage);
  if (!buffer) {
    return false;
  }

  const wavBlob = audioBufferToWav(buffer);
  const wavUrl = URL.createObjectURL(wavBlob);
  releaseObjectUrlLater(state.playerUrl);

  state.playerUrl = wavUrl;
  state.playerAudioKey = audioKey;
  elements.audioPlayer.src = wavUrl;
  elements.audioPlayer.loop = elements.loopCheckbox.checked;
  elements.audioPlayer.load();
  return buffer;
}

function ensureAudioContext() {
  if (state.audioContext) return state.audioContext;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    setStatus("Этот браузер не поддерживает Web Audio API.");
    return null;
  }

  try {
    state.audioContext = new AudioContextClass();
  } catch (error) {
    setStatus("Коснитесь экрана, чтобы подготовить звук.");
    return null;
  }
  return state.audioContext;
}

function connectAudioElementGraph() {
  if (!state.audioContext) return;

  try {
    if (!state.audioElementSource) {
      state.audioElementSource = state.audioContext.createMediaElementSource(elements.audioPlayer);
    }
    connectRealtimeAudioGraph(state.audioContext, state.audioElementSource);
  } catch (error) {
    updateRealtimeAudioControls();
  }
}

function safeResumeAudioContext() {
  if (!state.audioContext || state.audioContext.state !== "suspended") {
    return;
  }

  const resumePromise = state.audioContext.resume();
  if (resumePromise && typeof resumePromise.catch === "function") {
    resumePromise.catch(() => {
      setStatus("Если звук не запускается, нажмите Play еще раз.");
    });
  }
}

function startBufferPlayback(buffer) {
  stopBufferSource(false);
  elements.audioPlayer.pause();

  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = elements.loopCheckbox.checked;
  source.onended = () => {
    if (state.source !== source) return;
    state.source = null;
    disconnectRealtimeAudioGraph();
    stopPlayheadAnimation();
    setStatus("Воспроизведение завершено.");
  };

  state.source = source;
  connectRealtimeAudioGraph(state.audioContext, source);
  const startedAt = state.audioContext.currentTime;
  source.start();
  startBufferPlayheadAnimation(startedAt, buffer.duration);
}

function stopBufferSource(resetPlayhead = true) {
  if (!state.source) return false;

  const source = state.source;
  state.source = null;
  source.onended = null;
  try {
    source.stop();
  } catch (error) {
    // The source may already have reached its natural end.
  }
  try {
    source.disconnect();
  } catch (error) {
    // Some browsers throw when disconnecting an already disconnected source.
  }
  disconnectRealtimeAudioGraph();
  stopPlayheadAnimation(resetPlayhead);
  return true;
}

function releaseObjectUrlLater(url) {
  if (!url) return;
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function connectRealtimeAudioGraph(audioContext, source) {
  if (state.graphInputNode === source && state.outputGain) {
    updateRealtimeAudioControls();
    return;
  }

  disconnectRealtimeAudioGraph();
  state.graphInputNode = source;

  state.timbreFilter = audioContext.createBiquadFilter();
  state.timbreFilter.type = "peaking";

  state.timbreShaper = audioContext.createWaveShaper();
  state.timbreShaper.oversample = "2x";

  state.outputGain = audioContext.createGain();
  state.stereoSplitter = audioContext.createChannelSplitter(2);
  state.stereoMerger = audioContext.createChannelMerger(2);
  state.leftDelayNode = audioContext.createDelay(0.45);
  state.rightDelayNode = audioContext.createDelay(0.45);
  state.leftFeedbackGain = audioContext.createGain();
  state.rightFeedbackGain = audioContext.createGain();
  state.wetGain = audioContext.createGain();

  source.connect(state.timbreFilter);
  state.timbreFilter.connect(state.timbreShaper);
  state.timbreShaper.connect(state.outputGain);
  state.outputGain.connect(audioContext.destination);

  state.timbreShaper.connect(state.stereoSplitter);
  state.stereoSplitter.connect(state.leftDelayNode, 0);
  state.stereoSplitter.connect(state.rightDelayNode, 1);
  state.leftDelayNode.connect(state.rightFeedbackGain);
  state.rightFeedbackGain.connect(state.rightDelayNode);
  state.rightDelayNode.connect(state.leftFeedbackGain);
  state.leftFeedbackGain.connect(state.leftDelayNode);
  state.leftDelayNode.connect(state.stereoMerger, 0, 0);
  state.rightDelayNode.connect(state.stereoMerger, 0, 1);
  state.stereoMerger.connect(state.wetGain);
  state.wetGain.connect(state.outputGain);

  updateRealtimeAudioControls();
}

function disconnectRealtimeAudioGraph() {
  if (state.graphInputNode) {
    try {
      state.graphInputNode.disconnect();
    } catch (error) {
      // The input can already be disconnected after media-element playback ends.
    }
  }

  [
    state.outputGain,
    state.timbreFilter,
    state.timbreShaper,
    state.stereoSplitter,
    state.stereoMerger,
    state.leftDelayNode,
    state.rightDelayNode,
    state.leftFeedbackGain,
    state.rightFeedbackGain,
    state.wetGain
  ].forEach((node) => {
    if (node) {
      try {
        node.disconnect();
      } catch (error) {
        // Some browsers throw when disconnecting an already disconnected node.
      }
    }
  });

  state.graphInputNode = null;
  state.outputGain = null;
  state.timbreFilter = null;
  state.timbreShaper = null;
  state.stereoSplitter = null;
  state.stereoMerger = null;
  state.leftDelayNode = null;
  state.rightDelayNode = null;
  state.leftFeedbackGain = null;
  state.rightFeedbackGain = null;
  state.wetGain = null;
}

function updateRealtimeAudioControls() {
  const volume = Number(elements.volumeSlider.value);
  // Web Audio owns the output level after the graph is connected.
  elements.audioPlayer.volume = state.outputGain ? 1 : volume;

  if (!state.audioContext) return;

  const now = state.audioContext.currentTime;
  const timbreEnabled = elements.modeSelect.value !== "scientific";
  const hueAmount = timbreEnabled ? Number(elements.redEffectSlider.value) : 0;
  const saturationAmount = timbreEnabled ? Number(elements.greenEffectSlider.value) : 0;
  const spaceAmount = timbreEnabled ? Number(elements.blueEffectSlider.value) : 0;

  if (state.outputGain) {
    state.outputGain.gain.setTargetAtTime(volume, now, 0.018);
  }

  if (state.timbreFilter) {
    const hueSweep = hueAmount / 2;
    const filterFrequency = 180 + Math.pow(hueSweep, 1.32) * 6200;
    const filterGain = (hueAmount - 0.55) * 10 + saturationAmount * 2.4;
    state.timbreFilter.frequency.setTargetAtTime(filterFrequency, now, 0.025);
    state.timbreFilter.Q.setTargetAtTime(0.85 + hueAmount * 1.05 + saturationAmount * 1.35, now, 0.025);
    state.timbreFilter.gain.setTargetAtTime(timbreEnabled ? filterGain : 0, now, 0.025);
  }

  if (state.timbreShaper) {
    state.timbreShaper.curve = timbreEnabled
      ? makeSaturationCurve(1 + saturationAmount * 2.4)
      : null;
  }

  if (state.leftDelayNode) {
    state.leftDelayNode.delayTime.setTargetAtTime(0.045 + spaceAmount * 0.065, now, 0.03);
  }

  if (state.rightDelayNode) {
    state.rightDelayNode.delayTime.setTargetAtTime(0.072 + spaceAmount * 0.12, now, 0.03);
  }

  if (state.leftFeedbackGain) {
    state.leftFeedbackGain.gain.setTargetAtTime(Math.min(0.31, spaceAmount * 0.12), now, 0.03);
  }

  if (state.rightFeedbackGain) {
    state.rightFeedbackGain.gain.setTargetAtTime(Math.min(0.34, spaceAmount * 0.145), now, 0.03);
  }

  if (state.wetGain) {
    state.wetGain.gain.setTargetAtTime(timbreEnabled ? Math.min(0.32, spaceAmount * 0.14) : 0, now, 0.03);
  }
}

function makeSaturationCurve(amount) {
  const length = 1024;
  const curve = new Float32Array(length);
  const drive = Math.max(1, amount);

  for (let i = 0; i < length; i += 1) {
    const x = (i / (length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }

  return curve;
}

function getTimbreModulation(mode) {
  if (mode === "scientific") {
    return {
      hue: 0,
      saturation: 0,
      space: 0
    };
  }

  return {
    hue: Number(elements.redEffectSlider.value),
    saturation: Number(elements.greenEffectSlider.value),
    space: Number(elements.blueEffectSlider.value)
  };
}

async function getAudioBufferForCurrentSettings(audioContext, startMessage, stoppedMessage) {
  const audioKey = getAudioCacheKey(audioContext);

  if (state.cachedAudioBuffer && state.cachedAudioKey === audioKey) {
    setGenerationProgress(100);
    setStatus("Готово.");
    return state.cachedAudioBuffer;
  }

  setGenerating(true, startMessage);
  const generationId = state.generationId;
  const buffer = await generateAudioBuffer(audioContext, generationId);
  if (!buffer || generationId !== state.generationId) {
    if (generationId === state.generationId) {
      setGenerating(false, stoppedMessage);
    }
    return null;
  }

  state.cachedAudioBuffer = buffer;
  state.cachedAudioKey = audioKey;
  setGenerating(false);
  return buffer;
}

function getAudioCacheKey(audioContext) {
  return JSON.stringify({
    imageRevision: state.imageRevision,
    width: state.width,
    height: state.height,
    sampleRate: audioContext.sampleRate,
    mode: elements.modeSelect.value,
    frequencyDetail: elements.frequencyDetailSelect.value,
    duration: elements.durationSlider.value,
    minFrequency: elements.minFreqSlider.value,
    maxFrequency: elements.maxFreqSlider.value,
    contrast: elements.contrastSlider.value,
    hueEffect: elements.redEffectSlider.value,
    saturationEffect: elements.greenEffectSlider.value,
    spaceEffect: elements.blueEffectSlider.value,
    invert: elements.invertCheckbox.checked,
    reverse: elements.reverseCheckbox.checked
  });
}

function clearAudioCache() {
  invalidateAudioCache(true);
}

function invalidateAudioCache(clearPlayer = true) {
  if (state.isGenerating) {
    state.generationId += 1;
    state.isGenerating = false;
    setReadyState(state.imageLoaded);
  }
  state.cachedAudioBuffer = null;
  state.cachedAudioKey = "";
  if (clearPlayer) {
    clearPlayerCache();
    setGenerationProgress(0);
  } else {
    state.playerAudioKey = "";
  }
}

function clearPlayerCache() {
  if (state.playerUrl) {
    releaseObjectUrlLater(state.playerUrl);
  }
  state.playerUrl = null;
  state.playerAudioKey = "";
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.load();
}

function drawPreview() {
  const ctx = elements.previewCanvas.getContext("2d");
  const imageData = ctx.createImageData(state.width, state.height);

  for (let i = 0; i < state.width * state.height; i += 1) {
    const sourceIndex = i * 3;
    const targetIndex = i * 4;
    const colorIndex = Math.round(clamp(state.processedPixels[sourceIndex], 0, 1) * 255) * 3;
    imageData.data[targetIndex] = SPECTROGRAM_COLOR_LUT[colorIndex];
    imageData.data[targetIndex + 1] = SPECTROGRAM_COLOR_LUT[colorIndex + 1];
    imageData.data[targetIndex + 2] = SPECTROGRAM_COLOR_LUT[colorIndex + 2];
    imageData.data[targetIndex + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

function drawHsvHistogram() {
  const canvas = elements.hsvHistogramCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const gap = 12;
  const panelHeight = (height - gap * 4) / 3;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111723";
  ctx.fillRect(0, 0, width, height);
  if (!state.hsvHistograms) return;

  const histograms = [
    state.hsvHistograms.hue,
    state.hsvHistograms.saturation,
    state.hsvHistograms.value
  ];
  const labels = ["H", "S", "V"];
  const labelColors = ["#f080b7", "#56d4ca", "#efb85a"];

  histograms.forEach((histogram, panelIndex) => {
    let peak = 0;
    for (const count of histogram) peak = Math.max(peak, count);
    const xStart = gap;
    const yStart = gap + panelIndex * (panelHeight + gap);
    const panelWidth = width - gap * 2;
    const barWidth = panelWidth / histogram.length;
    const labelHeight = 28;
    const plotTop = yStart + labelHeight;
    const plotHeight = panelHeight - labelHeight - 7;

    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    ctx.fillRect(xStart, yStart, panelWidth, panelHeight);
    ctx.fillStyle = labelColors[panelIndex];
    ctx.font = "800 20px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(labels[panelIndex], xStart + 8, yStart + labelHeight / 2 + 1);

    for (let bin = 0; bin < histogram.length; bin += 1) {
      const normalized = peak > 0 ? Math.sqrt(histogram[bin] / peak) : 0;
      const barHeight = normalized * plotHeight;
      if (panelIndex === 0) {
        ctx.fillStyle = `hsl(${Math.round((bin / histogram.length) * 360)} 78% 62%)`;
      } else if (panelIndex === 1) {
        const lightness = 74 - (bin / histogram.length) * 34;
        ctx.fillStyle = `hsl(181 62% ${lightness}%)`;
      } else {
        const lightness = 24 + (bin / histogram.length) * 54;
        ctx.fillStyle = `hsl(39 84% ${lightness}%)`;
      }
      ctx.fillRect(
        xStart + bin * barWidth,
        plotTop + plotHeight - barHeight,
        Math.max(1, barWidth - 0.7),
        barHeight
      );
    }
  });
}

function makeRowFrequencies(minFrequency, maxFrequency, rowCount) {
  const frequencies = new Float32Array(rowCount);

  for (let y = 0; y < rowCount; y += 1) {
    // The top row maps to the highest frequency; the bottom row maps to the
    // lowest. A logarithmic ratio matches musical and perceptual pitch spacing.
    const normalizedFromBottom = rowCount === 1 ? 0 : (rowCount - 1 - y) / (rowCount - 1);
    frequencies[y] = minFrequency * Math.pow(maxFrequency / minFrequency, normalizedFromBottom);
  }

  return frequencies;
}

function makePhaseIncrements(rowFrequencies, sampleRate) {
  const increments = new Float32Array(rowFrequencies.length);

  for (let i = 0; i < rowFrequencies.length; i += 1) {
    increments[i] = TWO_PI * rowFrequencies[i] / sampleRate;
  }

  return increments;
}

async function buildSpectralColumns(frequencyDetail, virtualRowCount, generationId) {
  const columns = new Array(state.width);
  const noiseGate = 0.06;
  const maxActiveBins = frequencyDetail === 2 ? 64 : 96;

  for (let x = 0; x < state.width; x += 1) {
    if (generationId !== state.generationId) return null;

    const bins = [];

    for (let y = 0; y < virtualRowCount; y += 1) {
      const sourceY = y / frequencyDetail;
      const y0 = Math.floor(sourceY);
      const y1 = Math.min(state.height - 1, y0 + 1);
      const yMix = sourceY - y0;
      const top = (y0 * state.width + x) * 3;
      const bottom = (y1 * state.width + x) * 3;
      const brightness = lerp(state.processedPixels[top], state.processedPixels[bottom], yMix);

      if (brightness <= noiseGate) continue;

      bins.push([
        y,
        brightness,
        lerpHue(state.processedPixels[top + 1], state.processedPixels[bottom + 1], yMix),
        lerp(state.processedPixels[top + 2], state.processedPixels[bottom + 2], yMix)
      ]);
    }

    // Keep the strongest partials in each time slice. This avoids harsh noise
    // and keeps high-resolution images fast enough for a classroom browser.
    if (bins.length > maxActiveBins) {
      bins.sort((a, b) => b[1] - a[1]);
      bins.length = maxActiveBins;
      bins.sort((a, b) => a[0] - b[0]);
    }

    const values = [];
    for (const bin of bins) {
      values.push(...bin);
    }
    columns[x] = new Float32Array(values);

    if (x % 16 === 0) {
      setGenerationProgress((x / state.width) * 20);
      await waitForUi();
    }
  }

  setGenerationProgress(20);
  return columns;
}

function addColumnToSample(
  column,
  columnWeight,
  mode,
  modulation,
  sample,
  phaseIncrements,
  rowGain,
  mix
) {
  for (let i = 0; i < column.length; i += 4) {
    const row = column[i] | 0;
    const value = column[i + 1] * columnWeight;
    const hue = column[i + 2];
    const saturation = column[i + 3];
    const amplitude = value * rowGain;

    if (mode === "scientific") {
      mix[0] += Math.sin(sample * phaseIncrements[row]) * amplitude;
    } else {
      const timbreStrength = mode === "art" ? 1.25 : 0.85;
      const richness = clamp(saturation * modulation.saturation * timbreStrength, 0, 1.8);
      const hueInfluence = clamp(modulation.hue, 0, 2) * (0.25 + saturation * 0.75);
      const colorExcitation = hueInfluence * (0.48 + saturation * 0.52);
      const harmonicCount = mode === "art"
        ? 1 + Math.min(9, Math.floor(Math.max(richness * 4.2, colorExcitation * 5.2)))
        : 1 + Math.min(6, Math.floor(Math.max(richness * 3.2, colorExcitation * 3.8)));
      const spatialAmount = modulation.space * (0.2 + saturation * 0.8);
      const pan = Math.sin(TWO_PI * hue) * 0.62 * spatialAmount;
      const leftGain = Math.cos((pan + 1) * Math.PI / 4);
      const rightGain = Math.sin((pan + 1) * Math.PI / 4);
      const stereoPhase = spatialAmount * (mode === "art" ? 0.42 : 0.26) * Math.sin(TWO_PI * hue + row * 0.17);
      const hueShape = 0.5 + 0.5 * Math.sin(TWO_PI * hue - Math.PI / 2);
      const formantCenter = 1 + hueShape * (mode === "art" ? 7.2 : 5.8) * hueInfluence;
      const formantWidth = Math.max(0.42, (mode === "art" ? 0.95 : 1.18) - hueInfluence * 0.28);
      const evenBias = 0.34 + (0.5 + hueInfluence * 0.38) * (0.5 + 0.5 * Math.sin(TWO_PI * hue));
      const oddBias = 0.36 + (0.48 + hueInfluence * 0.35) * (0.5 + 0.5 * Math.cos(TWO_PI * hue + Math.PI / 3));

      for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
        const increment = phaseIncrements[row] * harmonic;
        if (increment >= Math.PI) continue;
        const phase = sample * increment;

        const partialGain = getHsvHarmonicGain(
          harmonic,
          richness,
          formantCenter,
          formantWidth,
          evenBias,
          oddBias,
          hue,
          hueInfluence,
          colorExcitation,
          mode
        );
        mix[1] += Math.sin(phase - stereoPhase * harmonic) * amplitude * partialGain * leftGain;
        mix[2] += Math.sin(phase + stereoPhase * harmonic) * amplitude * partialGain * rightGain;
      }
    }

    if (mode === "art") {
      mix[3] += value;
      mix[4] += Math.sin(TWO_PI * hue) * value;
      mix[5] += Math.cos(TWO_PI * hue) * value;
      mix[6] += saturation * value;
    }
  }
}

function getHsvHarmonicGain(
  harmonic,
  richness,
  formantCenter,
  formantWidth,
  evenBias,
  oddBias,
  hue,
  hueInfluence,
  colorExcitation,
  mode
) {
  const saturationGain = clamp(richness, 0, 1.8);
  const rolloff = mode === "art" ? 1.12 : 1.35;
  const baseGain = harmonic === 1 ? 1 : saturationGain / Math.pow(harmonic, rolloff);
  const distance = harmonic - formantCenter;
  const formant = 0.22 + 1.25 * Math.exp(-(distance * distance) / (2 * formantWidth * formantWidth));
  const harmonicColor = harmonic % 2 === 0 ? evenBias : oddBias;
  const hueTimbre = getHueTimbreGain(harmonic, hue, mode);
  const hueDepth = clamp(colorExcitation, 0, 2);

  if (harmonic === 1) {
    const fundamentalColor = 1 - Math.min(0.32, hueDepth * 0.16);
    return baseGain * fundamentalColor * (0.72 + 0.28 * formant) * (0.84 + 0.16 * harmonicColor);
  }

  const excitationGain = hueDepth * hueTimbre / Math.pow(harmonic, mode === "art" ? 0.72 : 0.9);
  return baseGain * formant * harmonicColor + excitationGain * (0.55 + hueInfluence * 0.28);
}

function getHueTimbreGain(harmonic, hue, mode) {
  const profileCount = 5;
  const position = ((hue % 1) + 1) % 1 * profileCount;
  const profileA = Math.floor(position) % profileCount;
  const profileB = (profileA + 1) % profileCount;
  const mix = position - Math.floor(position);
  const gainA = getHueProfileGain(profileA, harmonic, mode);
  const gainB = getHueProfileGain(profileB, harmonic, mode);

  return gainA * (1 - mix) + gainB * mix;
}

function getHueProfileGain(profile, harmonic, mode) {
  if (harmonic === 1) return 1;

  const artBoost = mode === "art" ? 1.18 : 1;

  switch (profile) {
    case 0:
      // Warm: mostly low harmonics.
      return artBoost * (harmonic <= 3 ? 1 / Math.pow(harmonic, 1.7) : 0.08 / harmonic);
    case 1:
      // Hollow: odd harmonics dominate, triangle-like.
      return harmonic % 2 === 1 ? artBoost / Math.pow(harmonic, 1.35) : 0.035;
    case 2:
      // Bright: saw-like, many harmonics.
      return artBoost / Math.pow(harmonic, 0.88);
    case 3:
      // Nasal: emphasizes middle formant-like partials.
      return artBoost * Math.exp(-Math.pow(harmonic - 4.2, 2) / 3.2) + 0.04 / harmonic;
    case 4:
      // Glassy: sparse upper partials, still tied to the same base pitch.
      return artBoost * (
        0.18 / harmonic +
        0.52 * Math.exp(-Math.pow(harmonic - 2.6, 2) / 0.9) +
        0.42 * Math.exp(-Math.pow(harmonic - 7.2, 2) / 2.4)
      );
    default:
      return 0;
  }
}

function waitForUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getFadeGain(sample, frameCount, sampleRate) {
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.04), Math.floor(frameCount / 2));
  if (fadeSamples <= 1) return 1;
  if (sample < fadeSamples) return sample / fadeSamples;
  if (sample > frameCount - fadeSamples) return (frameCount - sample) / fadeSamples;
  return 1;
}

function normalizeAudio(left, right) {
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }

  if (peak > 0.98) {
    const scale = 0.98 / peak;
    for (let i = 0; i < left.length; i += 1) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }
}

function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + frameCount * blockAlign);
  const view = new DataView(wavBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + frameCount * blockAlign, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, frameCount * blockAlign, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(buffer.getChannelData(channel)[i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function updateLabels() {
  let minFrequency = Number(elements.minFreqSlider.value);
  let maxFrequency = Number(elements.maxFreqSlider.value);

  if (maxFrequency <= minFrequency) {
    maxFrequency = minFrequency + 100;
    elements.maxFreqSlider.value = maxFrequency;
  }

  elements.durationValue.textContent = `${Number(elements.durationSlider.value).toFixed(1)} с`;
  elements.minFreqValue.textContent = `${minFrequency} Гц`;
  elements.maxFreqValue.textContent = `${maxFrequency} Гц`;
  elements.contrastValue.textContent = Number(elements.contrastSlider.value).toFixed(1);
  elements.volumeValue.textContent = `${Math.round(Number(elements.volumeSlider.value) * 100)}%`;
  elements.redEffectValue.textContent = `${Math.round(Number(elements.redEffectSlider.value) * 100)}%`;
  elements.greenEffectValue.textContent = `${Math.round(Number(elements.greenEffectSlider.value) * 100)}%`;
  elements.blueEffectValue.textContent = `${Math.round(Number(elements.blueEffectSlider.value) * 100)}%`;
  elements.playbackDuration.textContent = formatTime(Number(elements.durationSlider.value));
  drawAxes(minFrequency, maxFrequency, Number(elements.durationSlider.value));
}

function setReadyState(isReady) {
  const isBusy = state.isGenerating || state.isLoadingImage;
  elements.playButton.disabled = !isReady || isBusy;
  elements.stopButton.disabled = !isReady;
  elements.exportButton.disabled = !isReady || isBusy;
}

function setGenerating(isGenerating, message = "") {
  state.isGenerating = isGenerating;

  if (isGenerating) {
    state.generationId += 1;
    setGenerationProgress(0);
  }

  setReadyState(state.imageLoaded);
  if (message) setStatus(message);
}

function setGenerationProgress(value) {
  const progress = Math.round(clamp(value, 0, 100));
  elements.readinessProgress.value = progress;
  elements.readinessValue.textContent = `${progress}%`;
  const readinessControl = elements.readinessProgress.closest(".readiness-control");
  readinessControl?.classList.toggle("is-idle", progress === 0);
  readinessControl?.classList.toggle("is-complete", progress >= 100);
}

function drawAxes(minFrequency, maxFrequency, duration) {
  const cTicks = makeNoteCTicks(minFrequency, maxFrequency);
  elements.freqAxis.innerHTML = "";
  elements.timeAxis.innerHTML = "";

  for (const note of cTicks) {
    const tick = document.createElement("span");
    tick.className = "freq-mark note-c";
    tick.style.top = `${frequencyToAxisTop(note.frequency, minFrequency, maxFrequency)}%`;
    tick.textContent = note.name;
    elements.freqAxis.appendChild(tick);
  }

  const timeTicks = 6;
  for (let i = 0; i < timeTicks; i += 1) {
    const ratio = i / (timeTicks - 1);
    const tick = document.createElement("span");
    tick.className = "time-mark";
    tick.style.left = `${ratio * 100}%`;
    tick.textContent = `${(duration * ratio).toFixed(1)} с`;
    elements.timeAxis.appendChild(tick);
  }
}

function makeNoteCTicks(minFrequency, maxFrequency) {
  const ticks = [];

  for (let octave = 0; octave <= 9; octave += 1) {
    const midi = 12 * (octave + 1);
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    if (frequency >= minFrequency && frequency <= maxFrequency) {
      ticks.push({ name: `C${octave}`, frequency });
    }
  }

  return ticks;
}

function frequencyToAxisTop(frequency, minFrequency, maxFrequency) {
  const normalized = Math.log(frequency / minFrequency) / Math.log(maxFrequency / minFrequency);
  return (1 - normalized) * 100;
}

function spectrogramColorMap(value) {
  const stops = [
    [0.0, 8, 5, 28],
    [0.18, 45, 22, 94],
    [0.35, 39, 97, 156],
    [0.52, 28, 145, 140],
    [0.70, 102, 190, 95],
    [0.86, 235, 198, 50],
    [1.0, 252, 250, 190]
  ];
  const v = clamp(value, 0, 1);

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (v >= a[0] && v <= b[0]) {
      const mix = (v - a[0]) / (b[0] - a[0]);
      return [
        Math.round(lerp(a[1], b[1], mix)),
        Math.round(lerp(a[2], b[2], mix)),
        Math.round(lerp(a[3], b[3], mix))
      ];
    }
  }

  return [252, 250, 190];
}

function makeSpectrogramColorLut() {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const color = spectrogramColorMap(i / 255);
    lut[i * 3] = color[0];
    lut[i * 3 + 1] = color[1];
    lut[i * 3 + 2] = color[2];
  }
  return lut;
}

function lerpHue(a, b, mix) {
  let delta = b - a;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return (a + delta * mix + 1) % 1;
}

function circularHueAverage(sinTotal, cosTotal) {
  if (sinTotal === 0 && cosTotal === 0) return 0;
  return (Math.atan2(sinTotal, cosTotal) / TWO_PI + 1) % 1;
}

function startAudioElementPlayheadAnimation() {
  stopPlayheadAnimation(false);
  elements.playhead.classList.add("active");

  const step = () => {
    if (elements.audioPlayer.paused || !Number.isFinite(elements.audioPlayer.duration) || elements.audioPlayer.duration <= 0) {
      state.playheadFrame = requestAnimationFrame(step);
      return;
    }

    const audioProgress = clamp(elements.audioPlayer.currentTime / elements.audioPlayer.duration, 0, 1);
    const visualProgress = elements.reverseCheckbox.checked ? 1 - audioProgress : audioProgress;
    updatePlaybackPosition(audioProgress, elements.audioPlayer.duration);
    updatePlayheadVisual(visualProgress);

    if (!elements.audioPlayer.ended) {
      state.playheadFrame = requestAnimationFrame(step);
    }
  };

  state.playheadFrame = requestAnimationFrame(step);
}

function startBufferPlayheadAnimation(startedAt, duration) {
  stopPlayheadAnimation(false);
  elements.playhead.classList.add("active");

  const step = () => {
    if (!state.source || !state.audioContext) {
      stopPlayheadAnimation();
      return;
    }

    const elapsed = state.audioContext.currentTime - startedAt;
    const isLooping = state.source.loop;
    const audioProgress = isLooping
      ? (elapsed % duration) / duration
      : clamp(elapsed / duration, 0, 1);
    elements.audioPlayer.currentTime = audioProgress * duration;
    updatePlaybackPosition(audioProgress, duration);
    const visualProgress = elements.reverseCheckbox.checked ? 1 - audioProgress : audioProgress;
    updatePlayheadVisual(visualProgress);

    if (isLooping || audioProgress < 1) {
      state.playheadFrame = requestAnimationFrame(step);
    }
  };

  state.playheadFrame = requestAnimationFrame(step);
}

function updatePlayheadVisual(visualProgress) {
  const profile = getColumnGlowProfile(visualProgress);
  elements.playhead.style.left = `${visualProgress * 100}%`;
  elements.playhead.style.setProperty("--playhead-gradient", profile.gradient);
  elements.playhead.style.setProperty("--playhead-glow", `${Math.round(16 + profile.intensity * 70)}px`);
  elements.playhead.style.setProperty("--playhead-alpha", (0.52 + profile.intensity * 0.46).toFixed(2));
  elements.playhead.style.setProperty("--playhead-alpha-soft", (0.38 + profile.intensity * 0.52).toFixed(2));
  elements.playhead.style.setProperty("--playhead-width-boost", `${(profile.intensity * 10).toFixed(1)}px`);
}

function stopPlayheadAnimation(resetPosition = true) {
  if (state.playheadFrame) {
    cancelAnimationFrame(state.playheadFrame);
    state.playheadFrame = null;
  }

  elements.playhead.classList.remove("active");
  if (resetPosition) {
    updatePlaybackPosition(0, Number(elements.durationSlider.value));
    elements.playhead.style.left = "0";
    elements.playhead.style.setProperty("--playhead-glow", "0px");
    elements.playhead.style.setProperty("--playhead-alpha", "0.48");
    elements.playhead.style.setProperty("--playhead-alpha-soft", "0.34");
    elements.playhead.style.setProperty("--playhead-width-boost", "0px");
    elements.playhead.style.removeProperty("--playhead-gradient");
  }
}

function updatePlaybackPosition(progress, duration) {
  const normalized = clamp(progress, 0, 1);
  const safeDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : Number(elements.durationSlider.value);
  elements.playbackFill.style.width = `${normalized * 100}%`;
  elements.playbackFill.parentElement.setAttribute("aria-valuenow", String(Math.round(normalized * 100)));
  elements.playbackElapsed.textContent = formatTime(normalized * safeDuration);
  elements.playbackDuration.textContent = formatTime(safeDuration);
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getColumnGlowProfile(progress) {
  const fallback = {
    gradient: "linear-gradient(to bottom, rgba(255, 60, 20, 0.9), rgba(255, 60, 20, 0.9))",
    intensity: 0
  };
  if (!state.processedPixels || state.width === 0 || state.height === 0) return fallback;

  const x = Math.round(clamp(progress, 0, 1) * (state.width - 1));
  let sum = 0;
  let peak = 0;
  const stops = [];
  const sampleCount = 24;

  for (let y = 0; y < state.height; y += 1) {
    const brightness = state.processedPixels[(y * state.width + x) * 3];
    sum += brightness;
    if (brightness > peak) peak = brightness;
  }

  for (let i = 0; i < sampleCount; i += 1) {
    const y = Math.round((i / (sampleCount - 1)) * (state.height - 1));
    const brightness = state.processedPixels[(y * state.width + x) * 3];
    const powered = Math.pow(brightness, 0.55);
    const alpha = 0.04 + powered * 0.96;
    const widthHot = Math.min(255, Math.round(150 + powered * 105));
    const greenHot = Math.round(45 + powered * 205);
    const position = Math.round((i / (sampleCount - 1)) * 100);
    stops.push(`rgba(255, ${greenHot}, ${Math.round(20 + powered * 90)}, ${alpha.toFixed(2)}) ${position}%`);
    if (powered > 0.62) {
      stops.push(`rgba(${widthHot}, 255, 210, ${Math.min(1, alpha + 0.18).toFixed(2)}) ${position}%`);
    }
  }

  const average = sum / state.height;
  return {
    gradient: `linear-gradient(to bottom, ${stops.join(", ")})`,
    intensity: clamp(average * 0.45 + peak * 0.75, 0, 1)
  };
}

function setStatus(message = "") {
  if (!elements.statusText) return;
  elements.statusText.textContent = message === "Готово." ? "" : message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, mix) {
  return a + (b - a) * mix;
}
