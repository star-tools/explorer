// Import JSZip for ZIP operations
import JSZip from '../lib/jszip.js';

/**
 * Downloads a StarCraft 2 model along with its textures into a ZIP file.
 * - Extracts .dds texture names from the model binary.
 * - Matches them with provided texture repositories.
 * - Downloads textures and packs them with the model.
 */
export async function downloadModelWithTextures(modelUrl, texturesMap) {
  const zip = new JSZip();

  // 1. Fetch model as binary
  const modelResp = await fetch(modelUrl);
  if (!modelResp.ok) throw new Error("Failed to fetch model");
  const modelBuffer = await modelResp.arrayBuffer();

  // 2. Extract .dds texture names from model binary
  const modelText = bufferToAscii(modelBuffer);
  const ddsRegex = /([\w\-/\\]+\.(?:dds))/gi;
  const foundTextures = [...modelText.matchAll(ddsRegex)]
    .map(m => m[1].replace(/\\/g, '/').split('/').pop().toLowerCase());

  const uniqueTextures = [...new Set(foundTextures)];

  // 3. Add model to zip
  const modelName = modelUrl.split('/').pop();
  zip.file(modelName, modelBuffer);

  // 4. Download matching textures
  for (const texName of uniqueTextures) {
    const repo = texturesMap[texName];
    if (!repo) {
      console.warn(`Missing repo for texture: ${texName}`);
      continue;
    }

    const texUrl = `${repo}/${texName}`;
    try {
      const texBlob = await fetchAsBlob(texUrl);
      zip.file(texName, texBlob);
    } catch (err) {
      console.warn(`Failed to fetch texture ${texUrl}`, err);
    }
  }

  // 5. Generate ZIP and trigger download
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, modelName.replace(/\.m3$/, '') + '_with_textures.zip');
}

/**
 * Converts an ArrayBuffer to an ASCII string (non-printable bytes replaced with spaces).
 */
function bufferToAscii(buffer) {
  const view = new Uint8Array(buffer);
  return Array.from(view, char => (char >= 32 && char <= 126) ? String.fromCharCode(char) : ' ').join('');
}

/**
 * Fetches a binary file as Blob.
 */
async function fetchAsBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.blob();
}

/**
 * Triggers a browser download of a Blob.
 */
function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  document.body.removeChild(a);
}

/**
 * Parses INI text into an object: { sectionName: [lines...] }
 */
export function parseIniString(iniText) {
  const result = {};
  let currentSection = null;

  const lines = iniText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[(.+?)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = [];
    } else if (currentSection) {
      result[currentSection].push(trimmed);
    }
  }

  return result;
}

/**
 * Flattens repo structure {repo: [files]} into array of {file, repo}
 */
export function flattenRepoFiles(repoMap) {
  return Object.entries(repoMap).flatMap(([repo, files]) =>
    files.map(file => ({ file, repo }))
  );
}

/**
 * Loads an INI file from ./list/{list}.ini and parses it.
 */
export async function loadIniFile(list) {
  const response = await fetch(`./list/${list}.ini`);
  if (!response.ok) throw new Error(`Failed to load ${list}`);
  const text = await response.text();
  return parseIniString(text);
}

/**
 * Watches images in the DOM and applies fade-in class when loaded.
 */
export function watchImages({ selector = 'img', onLoad = null, onError = null, fadeInClass = 'loaded' } = {}) {
  const images = document.querySelectorAll(selector);

  images.forEach(img => {
    if (img.complete && img.naturalWidth !== 0) {
      img.classList.add(fadeInClass);
      onLoad?.(img);
    } else {
      img.addEventListener('load', () => {
        img.classList.add(fadeInClass);
        onLoad?.(img);
      });
      img.addEventListener('error', () => {
        img.classList.remove(fadeInClass);
        onError?.(img);
      });
    }
  });
}

/**
 * Creates an interactive item list with search, pagination, and lazy image handling.
 * Fixes: Pagination now updates properly after search.
 */
export function createItemList({
  list,
  containerSelector,
  searchInputSelector,
  renderItemFn,
  onRendered,
  debounceDelay = 300,
  itemsPerPage = 200
}) {
  const container = document.querySelector(containerSelector);
  const searchInput = document.querySelector(searchInputSelector);
  const paginationEl = document.createElement('div');
  paginationEl.className = 'pagination';
  container.after(paginationEl);

  let allItems = [];
  let filteredItems = [];
  let currentPage = 1;

  let debounceTimer = null;

  async function load() {
    const preloader = document.getElementById('preloader');
    if (preloader) preloader.style.display = 'flex';

    try {
      const [ddsFiles, pngFiles] = await Promise.all([
        loadIniFile(list),
        loadIniFile(`${list}-png`)
      ]);

      const ddsList = flattenRepoFiles(ddsFiles);
      const pngList = flattenRepoFiles(pngFiles);

      // Index for quick lookup
      const ddsIndex = Object.fromEntries(ddsList.map(({ file, repo }) => [file.toLowerCase(), { file, repo }]));
      const pngIndex = Object.fromEntries(pngList.map(({ file, repo }) => [file.toLowerCase(), { file, repo }]));

      // Merge lists by filename
      allItems = Object.keys(ddsIndex).map(key => {
        const dds = ddsIndex[key];
        const png = pngIndex[key];
        if (!png) return null;

        return {
          file: `${dds.repo}/${dds.file}.dds`,
          icon: `${png.repo}/${png.file}.png`,
          name: png.file
        };
      }).filter(Boolean);

      filteredItems = allItems;

      renderPage(1);
      attachSearch();
    } catch (e) {
      console.error('Error loading items:', e);
    } finally {
      if (preloader) preloader.style.display = 'none';
    }
  }

  function renderPage(page) {
    container.innerHTML = '';
    currentPage = page;

    const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
    const start = (page - 1) * itemsPerPage;
    const end = page * itemsPerPage;
    const pageItems = filteredItems.slice(start, end);

    const fragment = document.createDocumentFragment();
    for (const item of pageItems) {
      fragment.appendChild(renderItemFn(item));
    }

    container.appendChild(fragment);
    renderPaginationControls(currentPage, totalPages);

    watchImages({
      selector: '.icons-grid img',
      onError: img => console.warn('Failed to load:', img.src)
    });

    if (onRendered) {
      onRendered(pageItems, filteredItems, allItems);
      document.getElementById("icons-count").textContent = `${filteredItems.length} / ${allItems.length} icons`;
    }
  }

  function renderPaginationControls(current, total) {
    paginationEl.innerHTML = '';

    const createBtn = (label, page, disabled = false, active = false) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.disabled = disabled;
      if (active) btn.className = 'active';
      btn.onclick = () => renderPage(page);
      return btn;
    };

    paginationEl.appendChild(createBtn('<', current - 1, current === 1));

    const pages = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      if (current <= 4) {
        pages.push(...[1,2,3,4,5,'...',total]);
      } else if (current >= total - 3) {
        pages.push(1,'...', total-4, total-3, total-2, total-1, total);
      } else {
        pages.push(1,'...', current-1, current, current+1, '...', total);
      }
    }

    pages.forEach(p => {
      if (p === '...') {
        const span = document.createElement('span');
        span.textContent = '...';
        span.className = 'ellipsis';
        paginationEl.appendChild(span);
      } else {
        paginationEl.appendChild(createBtn(p, p, false, p === current));
      }
    });

    paginationEl.appendChild(createBtn('>', current + 1, current === total));
  }

  function attachSearch() {
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();
        filteredItems = allItems.filter(item => item.name.toLowerCase().includes(query));
        renderPage(1); // Always reset to page 1 on search
      }, debounceDelay);
    });
  }

  // Clipboard copy handler for [data-copy]
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-copy]');
    if (el) {
      navigator.clipboard.writeText(el.getAttribute('data-copy'))
        .then(() => {
          el.classList.add('copied');
          setTimeout(() => el.classList.remove('copied'), 1000);
        })
        .catch(err => console.error('Clipboard error:', err));
    }
  });

  return { load };
}
