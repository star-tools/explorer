


import JSZip from '../lib/jszip.js';

async function downloadModelWithTextures(modelUrl, texturesMap) {
  const zip = new JSZip();

  // 1. Fetch model as binary
  const modelResp = await fetch(modelUrl);
  if (!modelResp.ok) throw new Error("Failed to fetch model");
  const modelBuffer = await modelResp.arrayBuffer();

  // 2. Search for .dds strings in binary
  const modelText = bufferToAscii(modelBuffer);
  const ddsRegex = /([\w\-\/\\]+\.(?:dds))/gi;
  const foundTextures = [...modelText.matchAll(ddsRegex)]
    .map(m => m[1].replace(/\\/g, '/').split('/').pop().toLowerCase());

  // Remove duplicates
  const uniqueTextures = [...new Set(foundTextures)];

  // 3. Add model to zip
  const modelName = modelUrl.split('/').pop();
  zip.file(modelName, modelBuffer);

  // 4. Download each matching texture
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

  // 5. Zip and download
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, modelName.replace(/\.m3$/, '') + '_with_textures.zip');
}

// Helper: Convert ArrayBuffer to ASCII string (partial decoding)
function bufferToAscii(buffer) {
  const view = new Uint8Array(buffer);
  let ascii = '';
  for (let i = 0; i < view.length; i++) {
    const char = view[i];
    if (char >= 32 && char <= 126) {
      ascii += String.fromCharCode(char);
    } else {
      ascii += ' ';
    }
  }
  return ascii;
}

// Helper: Fetch a binary file as Blob
async function fetchAsBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.blob();
}

// Helper: Download a Blob as file
function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  document.body.removeChild(a);
}




function parseIniString(iniText) {
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

function flattenRepoFiles(repoMap) {
    const result = [];

    for (const [repo, files] of Object.entries(repoMap)) {
        for (const file of files) {
        result.push({ file, repo });
        }
    }

    return result;
}

async function loadIniFile(list){
      const response = await fetch(`./list/${list}.ini`);
      if (!response.ok) throw new Error(`Failed to load ${list}`);
      const text = await response.text();
      return parseIniString(text);
}

function watchImages({ selector = 'img', onLoad = null, onError = null, fadeInClass = 'loaded' } = {}) {
  const images = document.querySelectorAll(selector);

  images.forEach(img => {
    if (img.complete && img.naturalWidth !== 0) {
      // Already loaded
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


document.getElementById('fullscreen-toggle').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    // Enter fullscreen
    document.documentElement.requestFullscreen().catch(err => {
      alert(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    // Exit fullscreen
    document.exitFullscreen();
  }
});


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
let  totalPages
  const renderedItems = []; // Store DOM + source item
    let allItems = [];
    let currentPage = 1;
    let filteredItems = [];

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

      // Create index objects (key = lowercase file name)
      const ddsIndex = Object.create(null);
      for (const { file, repo } of ddsList) {
        ddsIndex[file.toLowerCase()] = { file, repo };
      }

      const pngIndex = Object.create(null);
      for (const { file, repo } of pngList) {
        pngIndex[file.toLowerCase()] = { file, repo };
      }

      // Merge matched files from pngIndex and ddsIndex
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
    totalPages = Math.ceil(filteredItems.length / itemsPerPage);
      renderPage(currentPage,totalPages);
      attachSearch();
    } catch (e) {
      console.error('Error loading items:', e);
    } finally {
      if (preloader) preloader.style.display = 'none';
    }
  }



  function renderPage(page) {
    container.innerHTML = '';
    renderedItems.length = 0;

    const start = (page - 1) * itemsPerPage;
    const end = page * itemsPerPage;
    const pageItems = filteredItems.slice(start, end);

    const fragment = document.createDocumentFragment();
    for (const item of pageItems) {
      const el = renderItemFn(item);
      renderedItems.push({ el, item });
      fragment.appendChild(el);
    }

    container.appendChild(fragment);
    renderPaginationControls(currentPage, totalPages, newPage => {
      currentPage = newPage;
      renderPage(currentPage);
    });



    watchImages({
      selector: '.icons-grid img',
      onError: img => console.warn('Failed to load:', img.src)
    });

    if (typeof onRendered === 'function') {
      onRendered(pageItems,filteredItems,allItems);

      document.getElementById("icons-count").textContent = filteredItems.length + " / " + allItems.length + " icons" 
    }
  }

  // function renderPaginationControls() {
  //   paginationEl.innerHTML = '';

  //   if (totalPages <= 1) return;

  //   const prev = document.createElement('button');
  //   prev.textContent = 'Previous';
  //   prev.disabled = currentPage === 1;
  //   prev.addEventListener('click', () => {
  //     if (currentPage > 1) {
  //       currentPage--;
  //       renderPage(currentPage);
  //     }
  //   });

  //   const next = document.createElement('button');
  //   next.textContent = 'Next';
  //   next.disabled = currentPage === totalPages;
  //   next.addEventListener('click', () => {
  //     if (currentPage < totalPages) {
  //       currentPage++;
  //       renderPage(currentPage);
  //     }
  //   });

  //   const info = document.createElement('span');
  //   info.textContent = `Page ${currentPage} of ${totalPages}`;

  //   paginationEl.append(prev, info, next);
  // }

  function renderPaginationControls(currentPage, totalPages, onPageChange) {
    
  paginationEl.innerHTML = '';

  function createPageButton(label, page, disabled = false, isActive = false) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = disabled;
    btn.className = isActive ? 'active' : '';
    if (!disabled && !isActive) {
      btn.addEventListener('click', () => onPageChange(page));
    }
    return btn;
  }

  // "<" Prev button
  paginationEl.appendChild(createPageButton('<', currentPage - 1, currentPage === 1));

  const pageRange = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageRange.push(i);
  } else {
    if (currentPage <= 4) {
      pageRange.push(...[1, 2, 3, 4, 5, '...', totalPages]);
    } else if (currentPage >= totalPages - 3) {
      pageRange.push(1, '...', ...[totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]);
    } else {
      pageRange.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
    }
  }

  for (const p of pageRange) {
    if (p === '...') {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.className = 'ellipsis';
      paginationEl.appendChild(ellipsis);
    } else {
      paginationEl.appendChild(createPageButton(p, p, false, p === currentPage));
    }
  }

  // ">" Next button
  paginationEl.appendChild(createPageButton('>', currentPage + 1, currentPage === totalPages));
}




  function attachSearch() {
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();

        filteredItems = allItems.filter(item =>
          item.name.toLowerCase().includes(query)
        );

        currentPage = 1;
        renderPage(currentPage);
      }, debounceDelay);
    });
  }



document.addEventListener('click', function(event) {
    const codeEl = event.target.closest('[data-copy]');
    if (codeEl) {
    const text = codeEl.getAttribute("data-copy");
    navigator.clipboard.writeText(text)
        .then(() => {
        // Show copied notification
        codeEl.classList.add('copied');

        // Remove 'copied' status after 1 second
        setTimeout(() => codeEl.classList.remove('copied'), 1000);
        })
        .catch(err => {
        console.error('Failed to copy:', err);
        });
    }
});


  return { load };
}

