(function () {
  'use strict';

  const pdfjs = window.pdfjsLib;
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const elements = {};
  const state = {
    pdf: null,
    image: null,
    fileName: '',
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    renderSequence: 0,
    drawing: false,
    selectionStart: null,
    selection: null,
    cropCanvas: null,
    selectedRow: null,
    ocrWorker: null,
    ocrBusy: false
  };

  function cacheElements() {
    [
      'planFile', 'fileStatus', 'previousPageBtn', 'nextPageBtn', 'pageSelect',
      'zoomOutBtn', 'zoomInBtn', 'zoomLabel', 'thumbnailStrip', 'planViewport',
      'canvasStack', 'planCanvas', 'selectionCanvas', 'emptyPlanMessage',
      'selectedLegLabel', 'captureTargets', 'captureInstruction', 'cropPreview',
      'rotationInput', 'readSelectionBtn', 'ocrStatus', 'recognizedValue',
      'rawOcrText', 'applyValueBtn', 'confirmLegBtn', 'unconfirmLegBtn',
      'addLegBtn', 'bearingAdjustmentLabel', 'customAngle', 'addCustomAngleBtn',
      'subtractCustomAngleBtn', 'legsTable', 'calculateBtn', 'printBtn',
      'clearBtn', 'reportOutput', 'plotCanvas'
    ].forEach(id => { elements[id] = document.getElementById(id); });
  }

  function setStatus(element, message, type = '') {
    element.textContent = message;
    element.classList.remove('error', 'working');
    if (type) element.classList.add(type);
  }

  function activeTarget() {
    return document.querySelector('input[name="captureTarget"]:checked').value;
  }

  function updateCaptureInstruction() {
    const labels = {
      bearing: 'bearing',
      distance: 'distance or arc length',
      radius: 'curve radius',
      direction: 'L or R curve direction'
    };
    elements.captureInstruction.textContent = `Draw a tight box around the ${labels[activeTarget()]}.`;
  }

  function rowNumber(row) {
    return Array.from(elements.legsTable.tBodies[0].rows).indexOf(row) + 1;
  }

  function refreshRowNumbers() {
    Array.from(elements.legsTable.tBodies[0].rows).forEach((row, index) => {
      row.querySelector('[data-role="number"]').textContent = String(index + 1);
    });
    updateSelectedRowDisplay();
  }

  function updateSelectedRowDisplay() {
    if (!state.selectedRow || !state.selectedRow.isConnected) {
      state.selectedRow = elements.legsTable.tBodies[0].rows[0] || null;
    }
    Array.from(elements.legsTable.tBodies[0].rows).forEach(row => {
      row.classList.toggle('selected-row', row === state.selectedRow);
    });
    const number = state.selectedRow ? rowNumber(state.selectedRow) : 0;
    elements.selectedLegLabel.textContent = number ? `Leg ${number} selected` : 'No leg selected';
    elements.bearingAdjustmentLabel.textContent = number ? `Leg ${number}` : 'No leg selected';
  }

  function selectRow(row) {
    state.selectedRow = row;
    updateSelectedRowDisplay();
  }

  function markRowUnconfirmed(row) {
    row.dataset.confirmed = 'false';
    const pill = row.querySelector('[data-role="status"]');
    pill.textContent = 'Unconfirmed';
    pill.className = 'status-pill unconfirmed';
  }

  function markRowConfirmed(row) {
    row.dataset.confirmed = 'true';
    const pill = row.querySelector('[data-role="status"]');
    pill.textContent = 'Confirmed';
    pill.className = 'status-pill confirmed';
  }

  function syncCurveFields(row) {
    const isCurve = row.querySelector('[data-field="type"]').value === 'Curve';
    row.querySelector('[data-field="radius"]').disabled = !isCurve;
    row.querySelector('[data-field="direction"]').disabled = !isCurve;
  }

  function addLeg(insertAfter = null, values = {}) {
    const body = elements.legsTable.tBodies[0];
    const row = document.createElement('tr');
    row.dataset.confirmed = values.confirmed ? 'true' : 'false';
    row.innerHTML = `
      <td data-role="number"></td>
      <td><select data-field="type"><option>Straight</option><option>Curve</option></select></td>
      <td><input data-field="bearing" type="text" inputmode="decimal" placeholder="D.MMSS"></td>
      <td><input data-field="distance" type="number" inputmode="decimal" step="any" min="0"></td>
      <td><input data-field="radius" type="number" inputmode="decimal" step="any" min="0"></td>
      <td><select data-field="direction"><option value=""></option><option value="L">L</option><option value="R">R</option></select></td>
      <td><input data-field="page" type="text" readonly></td>
      <td><span data-role="status" class="status-pill unconfirmed">Unconfirmed</span></td>
      <td><div class="row-actions"><button data-action="add-below" type="button">Add Leg Below</button><button data-action="delete" type="button">Delete</button></div></td>`;

    if (insertAfter && insertAfter.nextSibling) body.insertBefore(row, insertAfter.nextSibling);
    else body.appendChild(row);

    row.querySelector('[data-field="type"]').value = values.type || 'Straight';
    row.querySelector('[data-field="bearing"]').value = values.bearing || '';
    row.querySelector('[data-field="distance"]').value = values.distance || '';
    row.querySelector('[data-field="radius"]').value = values.radius || '';
    row.querySelector('[data-field="direction"]').value = values.direction || '';
    row.querySelector('[data-field="page"]').value = values.page || '';
    if (values.confirmed) markRowConfirmed(row);

    row.addEventListener('click', () => selectRow(row));
    row.querySelectorAll('input, select').forEach(control => {
      control.addEventListener('focus', () => selectRow(row));
      if (control.dataset.field !== 'page') control.addEventListener('input', () => markRowUnconfirmed(row));
    });
    row.querySelector('[data-field="type"]').addEventListener('change', () => syncCurveFields(row));
    row.querySelector('[data-action="add-below"]').addEventListener('click', event => {
      event.stopPropagation();
      const newRow = addLeg(row);
      selectRow(newRow);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', event => {
      event.stopPropagation();
      if (body.rows.length === 1) {
        row.querySelectorAll('input').forEach(input => { input.value = ''; });
        row.querySelector('[data-field="type"]').value = 'Straight';
        row.querySelector('[data-field="direction"]').value = '';
        markRowUnconfirmed(row);
        syncCurveFields(row);
        selectRow(row);
        return;
      }
      const fallback = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      selectRow(fallback);
      refreshRowNumbers();
    });

    syncCurveFields(row);
    refreshRowNumbers();
    return row;
  }

  function resetPlanState() {
    state.pdf = null;
    state.image = null;
    state.pageCount = 0;
    state.currentPage = 1;
    state.zoom = 1;
    state.selection = null;
    state.cropCanvas = null;
    elements.thumbnailStrip.innerHTML = '';
    elements.pageSelect.innerHTML = '';
    clearSelectionOverlay();
    clearCropPreview();
    updatePlanControls();
  }

  function updatePlanControls() {
    const loaded = state.pageCount > 0;
    elements.previousPageBtn.disabled = !loaded || state.currentPage <= 1;
    elements.nextPageBtn.disabled = !loaded || state.currentPage >= state.pageCount;
    elements.pageSelect.disabled = !loaded;
    elements.zoomOutBtn.disabled = !loaded || state.zoom <= 0.5;
    elements.zoomInBtn.disabled = !loaded || state.zoom >= 2.5;
    elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  async function loadPlan(file) {
    resetPlanState();
    state.fileName = file.name;
    setStatus(elements.fileStatus, `Loading ${file.name}…`, 'working');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        if (!pdfjs) throw new Error('The PDF viewer library could not be loaded. Check the internet connection and reload.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        state.pdf = await pdfjs.getDocument({ data: bytes }).promise;
        state.pageCount = state.pdf.numPages;
      } else if (file.type.startsWith('image/')) {
        state.image = await loadImageFile(file);
        state.pageCount = 1;
      } else {
        throw new Error('Choose a PDF, PNG, JPEG or WebP file.');
      }
      populatePageSelector();
      await createThumbnails();
      await renderCurrentPage();
      setStatus(elements.fileStatus, `${file.name} loaded — ${state.pageCount} page${state.pageCount === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error(error);
      setStatus(elements.fileStatus, error.message || 'The plan could not be loaded.', 'error');
    }
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be loaded.')); };
      image.src = url;
    });
  }

  function populatePageSelector() {
    elements.pageSelect.innerHTML = '';
    for (let page = 1; page <= state.pageCount; page += 1) {
      const option = document.createElement('option');
      option.value = String(page);
      option.textContent = String(page);
      elements.pageSelect.appendChild(option);
    }
    elements.pageSelect.value = String(state.currentPage);
    updatePlanControls();
  }

  async function createThumbnails() {
    elements.thumbnailStrip.innerHTML = '';
    for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
      const button = document.createElement('button');
      button.className = 'thumbnail-button';
      button.type = 'button';
      button.dataset.page = String(pageNumber);
      const canvas = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = `Page ${pageNumber}`;
      button.append(canvas, label);
      button.addEventListener('click', () => changePage(pageNumber));
      elements.thumbnailStrip.appendChild(button);
      if (state.pdf) {
        const page = await state.pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = 95 / base.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } else {
        const scale = Math.min(95 / state.image.naturalWidth, 115 / state.image.naturalHeight);
        canvas.width = Math.ceil(state.image.naturalWidth * scale);
        canvas.height = Math.ceil(state.image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(state.image, 0, 0, canvas.width, canvas.height);
      }
    }
    updateThumbnailSelection();
  }

  function updateThumbnailSelection() {
    elements.thumbnailStrip.querySelectorAll('.thumbnail-button').forEach(button => {
      button.classList.toggle('active', Number(button.dataset.page) === state.currentPage);
    });
  }

  async function changePage(pageNumber) {
    if (pageNumber < 1 || pageNumber > state.pageCount || pageNumber === state.currentPage) return;
    state.currentPage = pageNumber;
    elements.pageSelect.value = String(pageNumber);
    updateThumbnailSelection();
    updatePlanControls();
    await renderCurrentPage();
  }

  function targetRenderWidth(baseWidth) {
    const preferred = Math.max(1600, Math.min(2600, elements.planViewport.clientWidth * 2.1));
    return preferred * state.zoom / baseWidth;
  }

  async function renderCurrentPage() {
    const sequence = ++state.renderSequence;
    state.selection = null;
    state.cropCanvas = null;
    clearCropPreview();
    elements.readSelectionBtn.disabled = true;
    setStatus(elements.ocrStatus, 'Draw a selection on the plan.');
    const canvas = elements.planCanvas;
    const context = canvas.getContext('2d');

    if (state.pdf) {
      const page = await state.pdf.getPage(state.currentPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = targetRenderWidth(baseViewport.width);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
    } else if (state.image) {
      const baseScale = Math.min(1, 2400 / state.image.naturalWidth);
      canvas.width = Math.max(1, Math.round(state.image.naturalWidth * baseScale * state.zoom));
      canvas.height = Math.max(1, Math.round(state.image.naturalHeight * baseScale * state.zoom));
      context.drawImage(state.image, 0, 0, canvas.width, canvas.height);
    }
    if (sequence !== state.renderSequence) return;

    elements.selectionCanvas.width = canvas.width;
    elements.selectionCanvas.height = canvas.height;
    elements.canvasStack.style.display = 'block';
    elements.emptyPlanMessage.style.display = 'none';
    updatePlanControls();
  }

  function selectionPoint(event) {
    const rectangle = elements.selectionCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(elements.selectionCanvas.width, (event.clientX - rectangle.left) * elements.selectionCanvas.width / rectangle.width)),
      y: Math.max(0, Math.min(elements.selectionCanvas.height, (event.clientY - rectangle.top) * elements.selectionCanvas.height / rectangle.height))
    };
  }

  function startSelection(event) {
    if (!state.pageCount || state.ocrBusy) return;
    state.drawing = true;
    state.selectionStart = selectionPoint(event);
    state.selection = { x: state.selectionStart.x, y: state.selectionStart.y, width: 0, height: 0 };
    elements.selectionCanvas.setPointerCapture(event.pointerId);
  }

  function moveSelection(event) {
    if (!state.drawing) return;
    const point = selectionPoint(event);
    const start = state.selectionStart;
    state.selection = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y)
    };
    drawSelectionOverlay();
  }

  function finishSelection(event) {
    if (!state.drawing) return;
    moveSelection(event);
    state.drawing = false;
    if (!state.selection || state.selection.width < 8 || state.selection.height < 8) {
      state.selection = null;
      clearSelectionOverlay();
      setStatus(elements.ocrStatus, 'Selection is too small. Draw a box around the complete value.', 'error');
      return;
    }
    createCropFromSelection();
    elements.readSelectionBtn.disabled = false;
    setStatus(elements.ocrStatus, 'Selection ready. Adjust text rotation if needed, then read the text.');
  }

  function drawSelectionOverlay() {
    const canvas = elements.selectionCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.selection) return;
    context.fillStyle = 'rgba(35, 106, 161, 0.13)';
    context.strokeStyle = '#df861c';
    context.lineWidth = 3;
    context.setLineDash([10, 6]);
    context.fillRect(state.selection.x, state.selection.y, state.selection.width, state.selection.height);
    context.strokeRect(state.selection.x, state.selection.y, state.selection.width, state.selection.height);
    context.setLineDash([]);
  }

  function clearSelectionOverlay() {
    const canvas = elements.selectionCanvas;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  function createCropFromSelection() {
    const selection = state.selection;
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(selection.width));
    crop.height = Math.max(1, Math.round(selection.height));
    crop.getContext('2d').drawImage(
      elements.planCanvas,
      Math.round(selection.x), Math.round(selection.y), crop.width, crop.height,
      0, 0, crop.width, crop.height
    );
    state.cropCanvas = crop;
    drawCropPreview();
  }

  function rotateCanvas(source, degrees) {
    const radians = degrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(source.width * cos + source.height * sin));
    canvas.height = Math.max(1, Math.ceil(source.width * sin + source.height * cos));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(radians);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  function prepareOcrCanvas(source, rotation) {
    const rotated = rotateCanvas(source, rotation);
    const scale = Math.max(2, Math.min(4, 900 / Math.max(rotated.width, rotated.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rotated.width * scale));
    canvas.height = Math.max(1, Math.round(rotated.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(rotated, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const gray = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
      const value = gray > 225 ? 255 : Math.max(0, Math.min(255, (gray - 55) * 1.35));
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  function drawCropPreview() {
    const preview = elements.cropPreview;
    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
    context.fillStyle = 'white';
    context.fillRect(0, 0, preview.width, preview.height);
    if (!state.cropCanvas) return;
    const rotated = rotateCanvas(state.cropCanvas, Number(elements.rotationInput.value) || 0);
    const scale = Math.min((preview.width - 12) / rotated.width, (preview.height - 12) / rotated.height);
    const width = rotated.width * scale;
    const height = rotated.height * scale;
    context.drawImage(rotated, (preview.width - width) / 2, (preview.height - height) / 2, width, height);
  }

  function clearCropPreview() {
    const context = elements.cropPreview.getContext('2d');
    context.clearRect(0, 0, elements.cropPreview.width, elements.cropPreview.height);
    context.fillStyle = 'white';
    context.fillRect(0, 0, elements.cropPreview.width, elements.cropPreview.height);
    elements.recognizedValue.value = '';
    elements.rawOcrText.textContent = '';
    elements.applyValueBtn.disabled = true;
  }

  async function ensureOcrWorker() {
    if (state.ocrWorker) return state.ocrWorker;
    if (!window.Tesseract) throw new Error('The OCR library could not be loaded. Check the internet connection and reload.');
    state.ocrWorker = await window.Tesseract.createWorker('eng', 1, {
      logger(message) {
        if (message.status === 'recognizing text') {
          setStatus(elements.ocrStatus, `Reading selected text… ${Math.round((message.progress || 0) * 100)}%`, 'working');
        }
      }
    });
    await state.ocrWorker.setParameters({
      tessedit_char_whitelist: '0123456789.,°\'"LRlr- ',
      preserve_interword_spaces: '1'
    });
    return state.ocrWorker;
  }

  function normalizeBearing(raw) {
    let text = raw
      .replace(/[Oo]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[º˚]/g, '°')
      .replace(/[’′`]/g, "'")
      .replace(/[“”″]/g, '"')
      .trim();
    const marked = text.match(/(\d{1,3})\s*°\s*(\d{1,2})\s*[' ]\s*(\d{1,2})/);
    if (marked) return `${Number(marked[1])}.${marked[2].padStart(2, '0')}${marked[3].padStart(2, '0')}`;
    const separated = text.match(/(?:^|\D)(\d{1,3})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/);
    if (separated) return `${Number(separated[1])}.${separated[2].padStart(2, '0')}${separated[3].padStart(2, '0')}`;
    const compact = text.replace(/\s+/g, '').match(/(\d{1,3})[.,](\d{2})(\d{2})/);
    if (compact) return `${Number(compact[1])}.${compact[2]}${compact[3]}`;
    return text.replace(/\s+/g, '');
  }

  function normalizeNumber(raw) {
    const cleaned = raw.replace(/[Oo]/g, '0').replace(/,/g, '.').replace(/\s+/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : cleaned;
  }

  function normalizeOcr(raw, target) {
    if (target === 'bearing') return normalizeBearing(raw);
    if (target === 'direction') {
      const match = raw.toUpperCase().match(/[LR]/);
      return match ? match[0] : raw.trim().toUpperCase();
    }
    return normalizeNumber(raw);
  }

  async function readSelection() {
    if (!state.cropCanvas || state.ocrBusy) return;
    state.ocrBusy = true;
    elements.readSelectionBtn.disabled = true;
    elements.applyValueBtn.disabled = true;
    setStatus(elements.ocrStatus, 'Preparing OCR…', 'working');
    try {
      const worker = await ensureOcrWorker();
      const prepared = prepareOcrCanvas(state.cropCanvas, Number(elements.rotationInput.value) || 0);
      const result = await worker.recognize(prepared, { rotateAuto: true });
      const raw = result.data.text.trim();
      elements.rawOcrText.textContent = raw ? `OCR read: ${raw}` : 'OCR did not detect text in the selection.';
      elements.recognizedValue.value = normalizeOcr(raw, activeTarget());
      elements.applyValueBtn.disabled = !elements.recognizedValue.value;
      setStatus(elements.ocrStatus, raw ? 'Review the value, then apply it to the selected leg.' : 'Try a tighter selection or another rotation.', raw ? '' : 'error');
    } catch (error) {
      console.error(error);
      setStatus(elements.ocrStatus, error.message || 'The selected text could not be read.', 'error');
    } finally {
      state.ocrBusy = false;
      elements.readSelectionBtn.disabled = !state.cropCanvas;
    }
  }

  function applyRecognizedValue() {
    if (!state.selectedRow) return;
    const target = activeTarget();
    const fieldName = target === 'distance' ? 'distance' : target;
    const field = state.selectedRow.querySelector(`[data-field="${fieldName}"]`);
    if (!field) return;
    field.value = elements.recognizedValue.value.trim();
    state.selectedRow.querySelector('[data-field="page"]').value = state.pageCount ? String(state.currentPage) : '';
    markRowUnconfirmed(state.selectedRow);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    setStatus(elements.ocrStatus, `Applied to leg ${rowNumber(state.selectedRow)}. Confirm the leg after reviewing all fields.`);
  }

  function rowHasContent(row) {
    return ['bearing', 'distance', 'radius', 'direction'].some(field => row.querySelector(`[data-field="${field}"]`).value.trim());
  }

  function validateRowForConfirmation(row) {
    const type = row.querySelector('[data-field="type"]').value;
    const bearing = row.querySelector('[data-field="bearing"]').value.trim();
    const distance = row.querySelector('[data-field="distance"]').value.trim();
    if (!bearing || !distance) throw new Error('Enter the bearing and distance/arc before confirming this leg.');
    window.TraverseEngine.dmsToDecimal(bearing);
    if (!(Number(distance) > 0)) throw new Error('Distance or arc must be greater than zero.');
    if (type === 'Curve') {
      const radius = row.querySelector('[data-field="radius"]').value;
      const direction = row.querySelector('[data-field="direction"]').value;
      if (!(Number(radius) > 0) || !['L', 'R'].includes(direction)) {
        throw new Error('A curve requires a positive radius and an L or R direction.');
      }
    }
  }

  function confirmSelectedLeg(addNext) {
    if (!state.selectedRow) return;
    try {
      validateRowForConfirmation(state.selectedRow);
      markRowConfirmed(state.selectedRow);
      if (addNext) {
        const next = state.selectedRow.nextElementSibling || addLeg(state.selectedRow);
        selectRow(next);
        next.querySelector('[data-field="bearing"]').focus();
      }
    } catch (error) {
      setStatus(elements.ocrStatus, error.message, 'error');
    }
  }

  function adjustSelectedBearing(adjustment) {
    if (!state.selectedRow) return;
    const input = state.selectedRow.querySelector('[data-field="bearing"]');
    try {
      input.value = window.TraverseEngine.adjustBearing(input.value, adjustment);
      markRowUnconfirmed(state.selectedRow);
      input.focus();
    } catch (error) {
      setStatus(elements.ocrStatus, error.message, 'error');
    }
  }

  function gatherLegs() {
    const rows = Array.from(elements.legsTable.tBodies[0].rows).filter(rowHasContent);
    if (!rows.length) throw new Error('Enter at least one traverse leg.');
    const unconfirmed = rows.find(row => row.dataset.confirmed !== 'true');
    if (unconfirmed) throw new Error(`Leg ${rowNumber(unconfirmed)} has not been confirmed.`);
    return rows.map(row => ({
      type: row.querySelector('[data-field="type"]').value,
      bearing: row.querySelector('[data-field="bearing"]').value.trim(),
      distance: row.querySelector('[data-field="distance"]').value,
      radius: row.querySelector('[data-field="radius"]').value,
      direction: row.querySelector('[data-field="direction"]').value,
      page: row.querySelector('[data-field="page"]').value
    }));
  }

  function calculate() {
    try {
      const result = window.TraverseEngine.calculateTraverse(gatherLegs());
      elements.reportOutput.textContent = window.TraverseEngine.buildReport(result);
      window.TraverseEngine.drawTraverse(elements.plotCanvas, result);
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      elements.reportOutput.textContent = `Unable to calculate:\n${error.message}`;
    }
  }

  function clearTraverse() {
    if (!window.confirm('Clear every traverse leg? The uploaded plan will remain open.')) return;
    const body = elements.legsTable.tBodies[0];
    body.innerHTML = '';
    state.selectedRow = null;
    addLeg();
    selectRow(body.rows[0]);
    elements.reportOutput.textContent = 'Enter and confirm the traverse legs, then calculate.';
    elements.plotCanvas.getContext('2d').clearRect(0, 0, elements.plotCanvas.width, elements.plotCanvas.height);
  }

  function bindEvents() {
    elements.planFile.addEventListener('change', event => {
      const file = event.target.files[0];
      if (file) loadPlan(file);
    });
    elements.previousPageBtn.addEventListener('click', () => changePage(state.currentPage - 1));
    elements.nextPageBtn.addEventListener('click', () => changePage(state.currentPage + 1));
    elements.pageSelect.addEventListener('change', () => changePage(Number(elements.pageSelect.value)));
    elements.zoomOutBtn.addEventListener('click', async () => { state.zoom = Math.max(0.5, state.zoom - 0.25); await renderCurrentPage(); });
    elements.zoomInBtn.addEventListener('click', async () => { state.zoom = Math.min(2.5, state.zoom + 0.25); await renderCurrentPage(); });

    elements.selectionCanvas.addEventListener('pointerdown', startSelection);
    elements.selectionCanvas.addEventListener('pointermove', moveSelection);
    elements.selectionCanvas.addEventListener('pointerup', finishSelection);
    elements.selectionCanvas.addEventListener('pointercancel', () => { state.drawing = false; });

    elements.captureTargets.addEventListener('change', () => {
      updateCaptureInstruction();
      if (elements.rawOcrText.textContent) {
        elements.recognizedValue.value = normalizeOcr(elements.rawOcrText.textContent.replace(/^OCR read:\s*/, ''), activeTarget());
      }
    });
    elements.rotationInput.addEventListener('input', drawCropPreview);
    document.querySelectorAll('[data-rotation]').forEach(button => {
      button.addEventListener('click', () => {
        elements.rotationInput.value = button.dataset.rotation;
        drawCropPreview();
      });
    });
    elements.readSelectionBtn.addEventListener('click', readSelection);
    elements.applyValueBtn.addEventListener('click', applyRecognizedValue);
    elements.recognizedValue.addEventListener('input', () => {
      elements.applyValueBtn.disabled = !elements.recognizedValue.value.trim();
    });
    elements.confirmLegBtn.addEventListener('click', () => confirmSelectedLeg(true));
    elements.unconfirmLegBtn.addEventListener('click', () => { if (state.selectedRow) markRowUnconfirmed(state.selectedRow); });
    elements.addLegBtn.addEventListener('click', () => selectRow(addLeg()));

    document.querySelectorAll('[data-bearing-adjust]').forEach(button => {
      button.addEventListener('click', () => adjustSelectedBearing(Number(button.dataset.bearingAdjust)));
    });
    elements.addCustomAngleBtn.addEventListener('click', () => {
      try { adjustSelectedBearing(window.TraverseEngine.dmsToDecimal(elements.customAngle.value)); }
      catch (error) { setStatus(elements.ocrStatus, error.message, 'error'); }
    });
    elements.subtractCustomAngleBtn.addEventListener('click', () => {
      try { adjustSelectedBearing(-window.TraverseEngine.dmsToDecimal(elements.customAngle.value)); }
      catch (error) { setStatus(elements.ocrStatus, error.message, 'error'); }
    });
    elements.calculateBtn.addEventListener('click', calculate);
    elements.printBtn.addEventListener('click', () => window.print());
    elements.clearBtn.addEventListener('click', clearTraverse);
  }

  function initialize() {
    cacheElements();
    bindEvents();
    addLeg();
    selectRow(elements.legsTable.tBodies[0].rows[0]);
    updateCaptureInstruction();
    updatePlanControls();
    clearCropPreview();
  }

  window.SurveyPlanAssistant = {
    normalizeBearing,
    normalizeNumber,
    normalizeOcr
  };

  window.addEventListener('DOMContentLoaded', initialize);
}());
