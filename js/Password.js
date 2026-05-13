let passwords = [];
let links = [];
let pendingTasks = [];
let sections = [];
let selectedSectionId = "";
let selectedSectionActionId = null;
let pendingSectionName = "";
let pendingInactiveSectionId = null;
let selectedPasswordId = null;
let selectedLinkId = null;
let selectedPendingId = null;
let selectedView = "passwords";
let historyLoaded = false;
let shouldAnimateCards = false;
let animatedViews = new Set();

let directoryHandle = null;
let passwordFileHandle = null;
let sectionFileHandle = null;
let linkFileHandle = null;
let pendingFileHandle = null;

const JSON_FILE_NAME = "passwords-history.json";
const SECTIONS_JSON_FILE_NAME = "sections-history.json";
const LINKS_JSON_FILE_NAME = "links-history.json";
const PENDING_JSON_FILE_NAME = "pending-history.json";
const SECTIONS_STORAGE_KEY = "password-manager-sections";

/* =========================
   IndexedDB
========================= */
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PasswordManagerDB", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("handles");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(handle) {
  const db = await openHandleDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "directory");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSavedDirectoryHandle() {
  const db = await openHandleDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const request = tx.objectStore("handles").get("directory");

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function verifyPermission(handle, autoMode = false) {
  const options = { mode: "readwrite" };

  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  if (autoMode) {
    return false;
  }

  if ((await handle.requestPermission(options)) === "granted") {
    return true;
  }

  return false;
}

/* =========================
   Helpers
========================= */
function nowText() {
  return new Date().toLocaleString();
}

function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSection(section) {
  return {
    id: section.id || generateId(),
    name: section.name || "",
    createdAt: section.createdAt || nowText(),
    updatedAt: section.updatedAt || section.createdAt || nowText(),
    active: section.active ?? !section.deletedAt,
    deletedAt: section.deletedAt || ""
  };
}

function getActiveSections() {
  return sections.filter(section => section.active !== false);
}

function loadSectionsFromLocalStorage() {
  const savedSections = localStorage.getItem(SECTIONS_STORAGE_KEY);

  if (!savedSections) {
    sections = [];
    return;
  }

  try {
    const parsedSections = JSON.parse(savedSections);

    sections = Array.isArray(parsedSections)
      ? parsedSections
          .filter(section => section && section.name)
          .map(normalizeSection)
      : [];
  } catch (error) {
    console.warn("No se pudieron cargar las secciones:", error);
    sections = [];
  }
}

function saveSectionsToLocalStorage() {
  localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sections));
}

function getSectionName(sectionId) {
  const section = sections.find(item => item.id === sectionId);
  if (!section) return "Sin seccion";
  return section.active === false ? `${section.name} (inactiva)` : section.name;
}

function getVisiblePasswords() {
  const activePasswords = passwords.filter(item => item.active !== false);

  return selectedSectionId
    ? activePasswords.filter(item => item.sectionId === selectedSectionId)
    : activePasswords;
}

function getVisibleLinks() {
  const activeLinks = links.filter(item => item.active !== false);

  return selectedSectionId
    ? activeLinks.filter(item => item.sectionId === selectedSectionId)
    : activeLinks;
}

function getVisiblePendingTasks() {
  return pendingTasks;
}

function keepValidSelectedSection() {
  if (selectedSectionId && !getActiveSections().some(section => section.id === selectedSectionId)) {
    selectedSectionId = "";
  }
}

function normalizeSectionName(name) {
  return name.trim().toLowerCase();
}

function findInactiveSectionByName(name) {
  const normalizedName = normalizeSectionName(name);

  return sections.find(section =>
    section.active === false &&
    normalizeSectionName(section.name) === normalizedName
  );
}

function getSectionHistory(sectionId) {
  return passwords
    .filter(item => item.sectionId === sectionId)
    .map((item, index) => `Plataforma ${index + 1}: ${item.platform || "Sin plataforma"}`);
}

/* =========================
   File / JSON
========================= */
async function ensureJsonFile(autoMode = false) {
  if (!window.showDirectoryPicker) {
    if (!autoMode) {
      alert("Tu navegador no soporta selección de carpetas. Usa Chrome o Edge.");
    }
    return false;
  }

  try {
    directoryHandle = await getSavedDirectoryHandle();

    if (!directoryHandle) {
      if (autoMode) {
        console.warn("No hay carpeta guardada todavía.");
        return false;
      }

      directoryHandle = await window.showDirectoryPicker();
      await saveDirectoryHandle(directoryHandle);
    }

    const hasPermission = await verifyPermission(directoryHandle, autoMode);

    if (!hasPermission) {
      if (!autoMode) {
        alert("Permiso denegado para leer/escribir en la carpeta.");
      }
      return false;
    }

    passwordFileHandle = await directoryHandle.getFileHandle(JSON_FILE_NAME, {
      create: true
    });

    sectionFileHandle = await directoryHandle.getFileHandle(SECTIONS_JSON_FILE_NAME, {
      create: true
    });

    linkFileHandle = await directoryHandle.getFileHandle(LINKS_JSON_FILE_NAME, {
      create: true
    });

    pendingFileHandle = await directoryHandle.getFileHandle(PENDING_JSON_FILE_NAME, {
      create: true
    });

    return true;
  } catch (error) {
    console.warn("No se pudo acceder a la carpeta:", error);

    if (!autoMode) {
      alert("No se seleccionó ninguna carpeta.");
    }

    return false;
  }
}

async function writeJsonArray(fileHandle, data = []) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function loadSectionsFromJsonFile(autoMode = false) {
  const hasFile = await ensureJsonFile(autoMode);
  if (!hasFile) return false;

  const file = await sectionFileHandle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    sections = [];
    keepValidSelectedSection();
    saveSectionsToLocalStorage();
    await writeJsonArray(sectionFileHandle, []);
    return true;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error("JSON de secciones invalido:", error);

    if (!autoMode) {
      alert("El archivo sections-history.json tiene formato invalido.");
    }

    return false;
  }

  if (!Array.isArray(data)) {
    if (!autoMode) {
      alert("El historial de secciones debe ser un arreglo JSON.");
    }

    return false;
  }

  sections = data
    .filter(section => section && section.name)
    .map(normalizeSection);

  keepValidSelectedSection();
  saveSectionsToLocalStorage();
  return true;
}

async function saveSectionsToJsonFile() {
  saveSectionsToLocalStorage();

  const hasFile = await ensureJsonFile(false);
  if (!hasFile) return;

  const data = sections.map(section => ({
    id: section.id,
    name: section.name,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    active: section.active ?? true,
    deletedAt: section.deletedAt || ""
  }));

  const writable = await sectionFileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function loadPasswordsFromJsonFile(autoMode = false) {
  const hasFile = await ensureJsonFile(autoMode);
  if (!hasFile) return false;

  const file = await passwordFileHandle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    passwords = [];
    await writeJsonArray(passwordFileHandle, []);

    const loadedSections = await loadSectionsFromJsonFile(autoMode);
    if (!loadedSections) return false;

    const loadedLinks = await loadLinksFromJsonFile(autoMode);
    if (!loadedLinks) return false;

    const loadedPendingTasks = await loadPendingTasksFromJsonFile(autoMode);
    if (!loadedPendingTasks) return false;

    historyLoaded = true;
    return true;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error("JSON inválido:", error);

    if (!autoMode) {
      alert("El archivo passwords-history.json tiene formato inválido.");
    }

    return false;
  }

  if (!Array.isArray(data)) {
    if (!autoMode) {
      alert("El historial debe ser un arreglo JSON.");
    }
    return false;
  }

  passwords = data.map(item => ({
    id: item.id || generateId(),
    platform: item.platform || "",
    platformUrl: item.platformUrl || item.pageLink || "",
    username: item.username || item.usuario || "",
    email: item.email || item.correo || "",
    password: item.password || item.contraseña || "",
    sectionId: item.sectionId || "",
    note: item.note || item.notes || "",
    active: item.active ?? !item.deletedAt,
    deletedAt: item.deletedAt || "",
    createdAt: item.createdAt || nowText(),
    updatedAt: item.updatedAt || nowText()
  }));

  const loadedSections = await loadSectionsFromJsonFile(autoMode);
  if (!loadedSections) return false;

  const loadedLinks = await loadLinksFromJsonFile(autoMode);
  if (!loadedLinks) return false;

  const loadedPendingTasks = await loadPendingTasksFromJsonFile(autoMode);
  if (!loadedPendingTasks) return false;

  historyLoaded = true;
  return true;
}

function refreshHistoryUi(loadButton = null) {
  renderCurrentView();
  renderSections();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();
  updatePendingCounter();

  if (loadButton && loadButton.parentNode) {
    loadButton.remove();
  }
}

function applyCardCascade(article, index) {
  if (!shouldAnimateCards) return;

  article.classList.add("card-cascade-in");
  article.style.setProperty("--card-delay", `${Math.min(index * 70, 560)}ms`);
}

async function initializeHistoryIfNeeded(autoMode = false, loadButton = null) {
  if (historyLoaded) {
    refreshHistoryUi(loadButton);
    return true;
  }

  const loadedFromJson = await loadPasswordsFromJsonFile(autoMode);

  if (!loadedFromJson) {
    if (!autoMode) {
      alert("No se pudo inicializar el historial. Selecciona la carpeta del repo para crear o cargar los JSON.");
    }

    return false;
  }

  refreshHistoryUi(loadButton);
  return true;
}

async function initializeHistoryWithTimeout(loadButton = null, timeoutMs = 3000) {
  let finished = false;

  const timeoutId = setTimeout(() => {
    if (finished || historyLoaded) return;

    alert("No se pudieron cargar los datos en 3 segundos. Usa el boton de cargar historial o intenta de nuevo.");
  }, timeoutMs);

  const loaded = await initializeHistoryIfNeeded(true, loadButton);
  finished = true;
  clearTimeout(timeoutId);

  if (!loaded) {
    console.warn("No se pudo cargar automáticamente. Usa el botón Cargar historial.");
  }

  return loaded;
}

async function savePasswordsToJsonFile() {
  if (!historyLoaded) {
    alert("Primero carga el historial antes de guardar cambios.");
    return;
  }

  const hasFile = await ensureJsonFile(false);
  if (!hasFile) return;

  const data = passwords.map(item => ({
    id: item.id,
    platform: item.platform,
    platformUrl: item.platformUrl || "",
    username: item.username,
    email: item.email,
    password: item.password,
    sectionId: item.sectionId || "",
    note: item.note || "",
    active: item.active ?? true,
    deletedAt: item.deletedAt || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));

  const writable = await passwordFileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function loadLinksFromJsonFile(autoMode = false) {
  const hasFile = await ensureJsonFile(autoMode);
  if (!hasFile) return false;

  const file = await linkFileHandle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    links = [];
    await writeJsonArray(linkFileHandle, []);
    return true;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error("JSON de links invalido:", error);

    if (!autoMode) {
      alert("El archivo links-history.json tiene formato invalido.");
    }

    return false;
  }

  if (!Array.isArray(data)) {
    if (!autoMode) {
      alert("El historial de links debe ser un arreglo JSON.");
    }

    return false;
  }

  links = data.map(item => ({
    id: item.id || generateId(),
    name: item.name || item.title || "",
    url: item.url || item.link || "",
    sectionId: item.sectionId || "",
    note: item.note || item.notes || "",
    active: item.active ?? !item.deletedAt,
    deletedAt: item.deletedAt || "",
    createdAt: item.createdAt || nowText(),
    updatedAt: item.updatedAt || nowText()
  }));

  return true;
}

async function saveLinksToJsonFile() {
  if (!historyLoaded) {
    alert("Primero carga el historial antes de guardar cambios.");
    return;
  }

  const hasFile = await ensureJsonFile(false);
  if (!hasFile) return;

  const data = links.map(item => ({
    id: item.id,
    name: item.name,
    url: item.url,
    sectionId: item.sectionId || "",
    note: item.note || "",
    active: item.active ?? true,
    deletedAt: item.deletedAt || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));

  const writable = await linkFileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function loadPendingTasksFromJsonFile(autoMode = false) {
  const hasFile = await ensureJsonFile(autoMode);
  if (!hasFile) return false;

  const file = await pendingFileHandle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    pendingTasks = [];
    await writeJsonArray(pendingFileHandle, []);
    return true;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error("JSON de pendientes invalido:", error);

    if (!autoMode) {
      alert("El archivo pending-history.json tiene formato invalido.");
    }

    return false;
  }

  if (!Array.isArray(data)) {
    if (!autoMode) {
      alert("El historial de pendientes debe ser un arreglo JSON.");
    }

    return false;
  }

  pendingTasks = data.map(item => ({
    id: item.id || generateId(),
    title: item.title || "",
    company: item.company || item.compania || "",
    description: item.description || item.descripcion || "",
    dueDate: item.dueDate || item.fechaLimite || "",
    color: ["green", "yellow", "red"].includes(item.color) ? item.color : "green",
    createdAt: item.createdAt || nowText(),
    updatedAt: item.updatedAt || nowText()
  }));

  return true;
}

async function savePendingTasksToJsonFile() {
  if (!historyLoaded) {
    alert("Primero carga el historial antes de guardar cambios.");
    return;
  }

  const hasFile = await ensureJsonFile(false);
  if (!hasFile) return;

  const data = pendingTasks.map(item => ({
    id: item.id,
    title: item.title,
    company: item.company,
    description: item.description,
    dueDate: item.dueDate,
    color: item.color,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));

  const writable = await pendingFileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/* =========================
   Render
========================= */
function renderPasswords(list = getVisiblePasswords()) {
  const passwordList = document.querySelector(".password-list");
  if (!passwordList) return;

  passwordList.innerHTML = "";

  if (list.length === 0) {
    passwordList.innerHTML = `
      <article class="password-card">
        <div class="password-info">
          <div class="platform-icon">?</div>
          <div>
            <h4>No passwords</h4>
            <p>${selectedSectionId ? `No records found in ${escapeHtml(getSectionName(selectedSectionId))}` : "No records found"}</p>
            <span>Add your first password</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  list.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "password-card";
    applyCardCascade(article, index);

    article.innerHTML = `
      <div class="password-info">
        <div class="platform-icon">
          ${escapeHtml((item.platform || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <div class="card-title-row">
            <h4>${escapeHtml(item.platform)}</h4>
            <button
              class="inline-copy-btn share-password-btn"
              type="button"
              title="Compartir credenciales"
              aria-label="Compartir credenciales"
            >
              <i class="bi bi-share"></i>
            </button>
          </div>
          <p>${escapeHtml(item.username)}</p>
          <p class="card-copy-row">
            <span>
              Link:
              ${
                item.platformUrl
                  ? `<a class="card-link-anchor" href="${escapeHtml(normalizeUrl(item.platformUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.platformUrl)}</a>`
                  : "Sin link"
              }
            </span>
            ${
              item.platformUrl
                ? `<button
                    class="inline-copy-btn"
                    type="button"
                    data-copy-value="${escapeHtml(item.platformUrl)}"
                    data-copy-message="Link copiado."
                    title="Copiar link"
                    aria-label="Copiar link"
                  >
                    <i class="bi bi-clipboard"></i>
                  </button>`
                : ""
            }
          </p>
          <p class="card-copy-row">
            <span>Email: ${escapeHtml(item.email)}</span>
            <button
              class="inline-copy-btn"
              type="button"
              data-copy-value="${escapeHtml(item.email)}"
              data-copy-message="Email copiado."
              title="Copiar email"
              aria-label="Copiar email"
            >
              <i class="bi bi-clipboard"></i>
            </button>
          </p>
          <p class="card-copy-row">
            <span>Contraseña: ${escapeHtml(item.password)}</span>
            <button
              class="inline-copy-btn"
              type="button"
              data-copy-value="${escapeHtml(item.password)}"
              data-copy-message="Contraseña copiada."
              title="Copiar contraseña"
              aria-label="Copiar contraseña"
            >
              <i class="bi bi-clipboard"></i>
            </button>

          </p>
          <span>Seccion: ${escapeHtml(getSectionName(item.sectionId))}</span>
        </div>
      </div>

      <div class="card-notes">
        <button class="note-dropdown-btn" type="button" aria-expanded="false" title="Ver nota" aria-label="Ver nota">
          <span>Nota</span>
          <i class="bi bi-chevron-down note-arrow"></i>
        </button>

        <div class="card-note-panel">
          <div class="card-note-preview">
            ${escapeHtml(item.note || "Sin notas guardadas")}
          </div>

          <div class="card-note-read-actions">
            <button class="btn edit-note-btn" type="button" title="Editar nota" aria-label="Editar nota">
              <i class="bi bi-pencil"></i>
            </button>
          </div>

          <textarea
            class="card-note-input"
            placeholder="Escribe una nota para esta contraseña"
          >${escapeHtml(item.note || "")}</textarea>

          <div class="card-note-actions">
            <button class="btn cancel-note-btn" type="button" title="Cancelar edicion" aria-label="Cancelar edicion">
              <i class="bi bi-x-circle"></i>
            </button>

            <button class="btn save-note-btn" type="button" title="Guardar nota" aria-label="Guardar nota">
              <i class="bi bi-save"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn details-btn" type="button" data-id="${escapeHtml(item.id)}" title="Detalles" aria-label="Detalles">
          <i class="bi bi-info-circle"></i>
        </button>

        <button class="btn update-btn" type="button" data-id="${escapeHtml(item.id)}" title="Actualizar" aria-label="Actualizar">
          <i class="bi bi-pencil-square"></i>
        </button>

        <button class="btn delete-btn" type="button" data-id="${escapeHtml(item.id)}" title="Eliminar" aria-label="Eliminar">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;

    article.querySelector(".details-btn").addEventListener("click", () => {
      openDetails(item.id);
    });

    article.querySelector(".update-btn").addEventListener("click", () => {
      openUpdate(item.id);
    });

    article.querySelectorAll(".inline-copy-btn").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.copyValue) {
          copyText(button.dataset.copyValue, button.dataset.copyMessage);
        }
      });
    });

    article.querySelector(".share-password-btn").addEventListener("click", () => {
      copyText(
        `Plataforma: ${item.platform}\nUsuario: ${item.username}\nCorreo: ${item.email}\nContraseña: ${item.password}`,
        "Credenciales copiadas."
      );
    });

    const notesContainer = article.querySelector(".card-notes");
    const noteDropdownButton = article.querySelector(".note-dropdown-btn");
    const editNoteButton = article.querySelector(".edit-note-btn");

    noteDropdownButton.addEventListener("click", () => {
      const isOpen = notesContainer.classList.toggle("is-open");
      notesContainer.classList.remove("is-editing");
      noteDropdownButton.setAttribute("aria-expanded", String(isOpen));
    });

    editNoteButton.addEventListener("click", () => {
      notesContainer.classList.add("is-editing");
      article.querySelector(".card-note-input").focus();
    });

    article.querySelector(".cancel-note-btn").addEventListener("click", () => {
      const noteInput = article.querySelector(".card-note-input");

      noteInput.value = item.note || "";
      notesContainer.classList.remove("is-editing");
    });

    article.querySelector(".save-note-btn").addEventListener("click", async () => {
      const noteInput = article.querySelector(".card-note-input");
      const notePreview = article.querySelector(".card-note-preview");

      const saved = await savePasswordNote(item.id, noteInput.value);
      if (!saved) return;

      item.note = noteInput.value.trim();
      notePreview.textContent = noteInput.value.trim() || "Sin notas guardadas";
      notesContainer.classList.remove("is-open");
      notesContainer.classList.remove("is-editing");
      noteDropdownButton.setAttribute("aria-expanded", "false");
    });

    article.querySelector(".delete-btn").addEventListener("click", () => {
      openDelete(item.id);
    });

    passwordList.appendChild(article);
  });
}

function normalizeUrl(url) {
  const value = url.trim();
  if (!value) return "";

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function renderLinks(list = getVisibleLinks()) {
  const passwordList = document.querySelector(".password-list");
  if (!passwordList) return;

  passwordList.innerHTML = "";

  if (list.length === 0) {
    passwordList.innerHTML = `
      <article class="password-card">
        <div class="password-info">
          <div class="platform-icon">?</div>
          <div>
            <h4>No links</h4>
            <p>No records found</p>
            <span>Add your first link</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  list.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "password-card";
    applyCardCascade(article, index);

    article.innerHTML = `
      <div class="password-info">
        <div class="platform-icon">
          ${escapeHtml((item.name || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <h4>${escapeHtml(item.name)}</h4>
          <p class="card-copy-row">
            <span>
              Link:
              <a class="card-link-anchor" href="${escapeHtml(normalizeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>
            </span>
            <button
              class="inline-copy-btn"
              type="button"
              data-copy-value="${escapeHtml(item.url)}"
              title="Copiar link"
              aria-label="Copiar link"
            >
              <i class="bi bi-clipboard"></i>
            </button>
          </p>
          <span>Seccion: ${escapeHtml(getSectionName(item.sectionId))}</span>
        </div>
      </div>

      <div class="card-notes">
        <button class="note-dropdown-btn" type="button" aria-expanded="false" title="Ver nota" aria-label="Ver nota">
          <span>Nota</span>
          <i class="bi bi-chevron-down note-arrow"></i>
        </button>

        <div class="card-note-panel">
          <div class="card-note-preview">
            ${escapeHtml(item.note || "Sin notas guardadas")}
          </div>

          <div class="card-note-read-actions">
            <button class="btn edit-note-btn" type="button" title="Editar nota" aria-label="Editar nota">
              <i class="bi bi-pencil"></i>
            </button>
          </div>

          <textarea
            class="card-note-input"
            placeholder="Escribe una nota para este link"
          >${escapeHtml(item.note || "")}</textarea>

          <div class="card-note-actions">
            <button class="btn cancel-note-btn" type="button" title="Cancelar edicion" aria-label="Cancelar edicion">
              <i class="bi bi-x-circle"></i>
            </button>

            <button class="btn save-note-btn" type="button" title="Guardar nota" aria-label="Guardar nota">
              <i class="bi bi-save"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="card-actions">
        <a class="btn details-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="Abrir link" aria-label="Abrir link">
          <i class="bi bi-box-arrow-up-right"></i>
        </a>

        <button class="btn update-btn" type="button" title="Actualizar link" aria-label="Actualizar link">
          <i class="bi bi-pencil-square"></i>
        </button>

        <button class="btn delete-btn" type="button" title="Eliminar link" aria-label="Eliminar link">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;

    article.querySelectorAll(".inline-copy-btn").forEach(button => {
      button.addEventListener("click", () => {
        copyText(button.dataset.copyValue, "Link copiado.");
      });
    });

    const notesContainer = article.querySelector(".card-notes");
    const noteDropdownButton = article.querySelector(".note-dropdown-btn");
    const editNoteButton = article.querySelector(".edit-note-btn");

    noteDropdownButton.addEventListener("click", () => {
      const isOpen = notesContainer.classList.toggle("is-open");
      notesContainer.classList.remove("is-editing");
      noteDropdownButton.setAttribute("aria-expanded", String(isOpen));
    });

    editNoteButton.addEventListener("click", () => {
      notesContainer.classList.add("is-editing");
      article.querySelector(".card-note-input").focus();
    });

    article.querySelector(".cancel-note-btn").addEventListener("click", () => {
      const noteInput = article.querySelector(".card-note-input");

      noteInput.value = item.note || "";
      notesContainer.classList.remove("is-editing");
    });

    article.querySelector(".save-note-btn").addEventListener("click", async () => {
      const noteInput = article.querySelector(".card-note-input");
      const notePreview = article.querySelector(".card-note-preview");

      const saved = await saveLinkNote(item.id, noteInput.value);
      if (!saved) return;

      item.note = noteInput.value.trim();
      notePreview.textContent = noteInput.value.trim() || "Sin notas guardadas";
      notesContainer.classList.remove("is-open");
      notesContainer.classList.remove("is-editing");
      noteDropdownButton.setAttribute("aria-expanded", "false");
    });

    article.querySelector(".update-btn").addEventListener("click", () => {
      openUpdateLink(item.id);
    });

    article.querySelector(".delete-btn").addEventListener("click", () => {
      openDeleteLink(item.id);
    });

    passwordList.appendChild(article);
  });
}

function getPendingColorLabel(color) {
  const labels = {
    green: "Verde",
    yellow: "Amarillo",
    red: "Rojo"
  };

  return labels[color] || "Verde";
}

function updatePendingCounter() {
  const pendingCounter = document.getElementById("pendingCounter");
  if (!pendingCounter) return;

  pendingCounter.textContent = String(pendingTasks.length);
}

function renderPendingTasks(list = getVisiblePendingTasks()) {
  const passwordList = document.querySelector(".password-list");
  if (!passwordList) return;

  updatePendingCounter();
  passwordList.innerHTML = "";

  if (list.length === 0) {
    passwordList.innerHTML = `
      <article class="password-card pending-card pending-card-green">
        <div class="password-info">
          <div class="platform-icon"><i class="bi bi-list-check"></i></div>
          <div>
            <h4>No hay pendientes</h4>
            <p>Agrega tu primer pendiente</p>
            <span>Usa el boton superior para registrarlo</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  list.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = `password-card pending-card pending-card-${item.color}`;
    applyCardCascade(article, index);

    article.innerHTML = `
      <div class="password-info">
        <div class="platform-icon">
          ${escapeHtml((item.title || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>Compañia: ${escapeHtml(item.company)}</p>
          <p>Fecha limite: ${escapeHtml(item.dueDate || "Sin fecha")}</p>
          <span class="pending-color-label">Semaforo: ${escapeHtml(getPendingColorLabel(item.color))}</span>
        </div>
      </div>

      <div class="pending-card-description">
        <h5>Descripcion</h5>
        <p>${escapeHtml(item.description || "Sin descripcion")}</p>
      </div>

      <div class="card-actions">
        <button class="btn details-btn" type="button" title="Detalles" aria-label="Detalles">
          <i class="bi bi-eye"></i>
        </button>

        <button class="btn update-btn" type="button" title="Actualizar" aria-label="Actualizar">
          <i class="bi bi-pencil-square"></i>
        </button>

        <button class="btn delete-btn" type="button" title="Eliminar" aria-label="Eliminar">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;

    article.querySelector(".details-btn").addEventListener("click", () => {
      openPendingModal("view", item.id);
    });

    article.querySelector(".update-btn").addEventListener("click", () => {
      openPendingModal("edit", item.id);
    });

    article.querySelector(".delete-btn").addEventListener("click", () => {
      deletePendingTask(item.id);
    });

    passwordList.appendChild(article);
  });
}

function renderCurrentView() {
  updatePendingCounter();

  shouldAnimateCards = historyLoaded && !animatedViews.has(selectedView);

  if (selectedView === "pending") {
    renderPendingTasks();
    if (shouldAnimateCards) animatedViews.add(selectedView);
    shouldAnimateCards = false;
    return;
  }

  if (selectedView === "links") {
    renderLinks();
    if (shouldAnimateCards) animatedViews.add(selectedView);
    shouldAnimateCards = false;
    return;
  }

  renderPasswords();
  if (shouldAnimateCards) animatedViews.add(selectedView);
  shouldAnimateCards = false;
}

function renderSections() {
  const sectionList = document.getElementById("sectionList");
  if (!sectionList) return;

  sectionList.innerHTML = "";

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `sidebar-section-item${!selectedSectionId && selectedView !== "pending" ? " active" : ""}`;
  allButton.innerHTML = `
    <span class="sidebar-section-icon">#</span>
    <span>Todas</span>
  `;

  allButton.addEventListener("click", () => {
    selectedSectionId = "";
    renderSections();
    if (selectedView === "pending") {
      setActiveView("passwords");
    } else {
      renderCurrentView();
    }
    populateAddPasswordSectionSelect();
    populateAddLinkSectionSelect();
  });

  sectionList.appendChild(allButton);

  const activeSections = getActiveSections();

  if (activeSections.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "sidebar-empty-sections";
    emptyMessage.textContent = "Sin secciones";
    sectionList.appendChild(emptyMessage);
    return;
  }

  activeSections.forEach(section => {
    const sectionRow = document.createElement("div");
    sectionRow.className = "sidebar-section-row";
    sectionRow.dataset.id = section.id;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `sidebar-section-item${section.id === selectedSectionId && selectedView !== "pending" ? " active" : ""}`;

    button.innerHTML = `
      <span class="sidebar-section-icon">
        ${escapeHtml(section.name.charAt(0).toUpperCase())}
      </span>
      <span>${escapeHtml(section.name)}</span>
    `;

    button.addEventListener("click", () => {
      selectedSectionId = section.id;
      renderSections();
      if (selectedView === "pending") {
        setActiveView("passwords");
      } else {
        renderCurrentView();
      }
      populateAddPasswordSectionSelect();
      populateAddLinkSectionSelect();
    });

    const actionGroup = document.createElement("div");
    actionGroup.className = "sidebar-section-actions";
    actionGroup.innerHTML = `
      <button class="sidebar-section-action edit-section-btn" type="button" title="Editar seccion" aria-label="Editar seccion">
        <i class="bi bi-pencil"></i>
      </button>

      <button class="sidebar-section-action delete-section-btn" type="button" title="Eliminar seccion" aria-label="Eliminar seccion">
        <i class="bi bi-trash"></i>
      </button>
    `;

    actionGroup.querySelector(".edit-section-btn").addEventListener("click", () => {
      openEditSection(section.id);
    });

    actionGroup.querySelector(".delete-section-btn").addEventListener("click", () => {
      openDeleteSection(section.id);
    });

    sectionRow.appendChild(button);
    sectionRow.appendChild(actionGroup);
    sectionList.appendChild(sectionRow);
  });
}

function populateSectionSelect(selectElement, selectedId = "") {
  if (!selectElement) return;

  selectElement.innerHTML = '<option value="">Selecciona una seccion</option>';

  getActiveSections().forEach(section => {
    const option = document.createElement("option");
    option.value = section.id;
    option.textContent = section.name;
    option.selected = section.id === selectedId;
    selectElement.appendChild(option);
  });
}

function populateAddPasswordSectionSelect() {
  populateSectionSelect(
    document.getElementById("addPasswordSection"),
    selectedSectionId
  );
}

function populateAddLinkSectionSelect() {
  populateSectionSelect(
    document.getElementById("addLinkSection"),
    selectedSectionId
  );
}

function setActiveView(view) {
  selectedView = view;
  document.body.dataset.activeView = selectedView;

  const isLinksView = selectedView === "links";
  const isPendingView = selectedView === "pending";
  const heroTitle = document.querySelector(".hero-section h1");
  const heroDescription = document.getElementById("heroDescription");
  const addButton = document.getElementById("openAddPasswordModal");
  const pendingAccessButton = document.getElementById("pendingAccessBtn");

  document.querySelectorAll(".vault-tab").forEach(button => {
    const isActive = button.dataset.view === selectedView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (pendingAccessButton) {
    pendingAccessButton.classList.toggle("active", isPendingView);
  }

  if (heroTitle) {
    heroTitle.textContent = isPendingView
      ? "Administrador de Pendientes"
      : isLinksView
        ? "Administrador de Links"
        : "Administrador de Contraseñas";
  }

  if (heroDescription) {
    heroDescription.textContent = isPendingView
      ? "Organiza tareas por prioridad de semaforo"
      : isLinksView
        ? "Guarda accesos rapidos a paginas y empresas"
        : "Administra tus contraseñas de forma rápida";
  }

  if (addButton) {
    addButton.title = isPendingView
      ? "Agregar pendiente"
      : isLinksView
        ? "Agregar link"
        : "Agregar contraseña";
    addButton.setAttribute(
      "aria-label",
      isPendingView
        ? "Agregar pendiente"
        : isLinksView
          ? "Agregar link"
          : "Agregar contraseña"
    );
    addButton.innerHTML = isPendingView
      ? '<i class="bi bi-list-check"></i>'
      : isLinksView
        ? '<i class="bi bi-link-45deg"></i>'
        : '<i class="bi bi-key-fill"></i>';
  }

  renderSections();
  renderCurrentView();
}

/* =========================
   CRUD
========================= */
async function createSection(sectionName) {
  const name = sectionName.trim();

  if (!name) {
    alert("Ingresa el nombre de la seccion.");
    return false;
  }

  const inactiveSection = findInactiveSectionByName(name);

  if (inactiveSection) {
    openRestoreSectionPrompt(inactiveSection.id, name);
    return false;
  }

  return createNewSection(name);
}

async function createNewSection(name) {
  const normalizedName = name.trim();

  const newSection = {
    id: generateId(),
    name: normalizedName,
    createdAt: nowText(),
    updatedAt: nowText(),
    active: true,
    deletedAt: ""
  };

  sections.push(newSection);
  selectedSectionId = newSection.id;

  await saveSectionsToJsonFile();
  renderSections();
  renderCurrentView();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();
  return true;
}

function openRestoreSectionPrompt(sectionId, sectionName) {
  pendingSectionName = sectionName;
  pendingInactiveSectionId = sectionId;

  const modal = document.getElementById("restoreSectionModal");
  const message = document.getElementById("restoreSectionMessage");
  const historyList = document.getElementById("restoreSectionHistoryList");
  const history = getSectionHistory(sectionId);

  message.textContent = `Ya existe una seccion inactiva llamada "${sectionName}". ¿Deseas restaurarla o sobrescribirla con una seccion nueva?`;
  historyList.innerHTML = "";

  if (history.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No hay plataformas registradas.";
    historyList.appendChild(item);
  } else {
    history.forEach(historyItem => {
      const item = document.createElement("li");
      item.textContent = historyItem;
      historyList.appendChild(item);
    });
  }

  modal.classList.add("show");
}

async function restoreInactiveSection(id) {
  const restoredAt = nowText();
  const section = sections.find(item => item.id === id && item.active === false);
  if (!section) return false;

  section.active = true;
  section.deletedAt = "";
  section.updatedAt = restoredAt;

  passwords = passwords.map(item =>
    item.sectionId === id
      ? {
          ...item,
          active: true,
          deletedAt: "",
          updatedAt: restoredAt
        }
      : item
  );

  links = links.map(item =>
    item.sectionId === id
      ? {
          ...item,
          active: true,
          deletedAt: "",
          updatedAt: restoredAt
        }
      : item
  );

  selectedSectionId = id;

  await saveSectionsToJsonFile();
  await savePasswordsToJsonFile();
  await saveLinksToJsonFile();
  renderSections();
  renderCurrentView();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();
  return true;
}

async function updateSection(id, sectionName) {
  const name = sectionName.trim();

  if (!name) {
    alert("Ingresa el nombre de la seccion.");
    return false;
  }

  const section = sections.find(item => item.id === id && item.active !== false);
  if (!section) return false;

  section.name = name;
  section.updatedAt = nowText();

  await saveSectionsToJsonFile();
  renderSections();
  renderCurrentView();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();
  return true;
}

async function softDeleteSection(id) {
  const section = sections.find(item => item.id === id && item.active !== false);
  if (!section) return false;

  const deletedAt = nowText();

  section.active = false;
  section.deletedAt = deletedAt;
  section.updatedAt = deletedAt;

  passwords = passwords.map(item =>
    item.sectionId === id
      ? {
          ...item,
          active: false,
          deletedAt,
          updatedAt: deletedAt
        }
      : item
  );

  links = links.map(item =>
    item.sectionId === id
      ? {
          ...item,
          active: false,
          deletedAt,
          updatedAt: deletedAt
        }
      : item
  );

  if (selectedSectionId === id) {
    selectedSectionId = "";
  }

  await saveSectionsToJsonFile();
  await savePasswordsToJsonFile();
  await saveLinksToJsonFile();
  renderSections();
  renderCurrentView();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();
  return true;
}

function getPasswordSectionId(sectionId) {
  return getActiveSections().some(section => section.id === sectionId) ? sectionId : "";
}

async function createPassword(passwordData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const sectionId = getPasswordSectionId(passwordData.sectionId);

  if (!sectionId) {
    alert("Selecciona una seccion para guardar la contraseña.");
    return false;
  }

  const newPassword = {
    id: generateId(),
    platform: passwordData.platform,
    platformUrl: normalizeUrl(passwordData.platformUrl || ""),
    username: passwordData.username,
    email: passwordData.email,
    password: passwordData.password,
    sectionId,
    note: "",
    active: true,
    deletedAt: "",
    createdAt: nowText(),
    updatedAt: nowText()
  };

  passwords.push(newPassword);
  renderPasswords();
  await savePasswordsToJsonFile();
  return true;
}

async function createLink(linkData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const sectionId = getPasswordSectionId(linkData.sectionId);

  if (!sectionId) {
    alert("Selecciona una seccion para guardar el link.");
    return false;
  }

  const url = normalizeUrl(linkData.url);

  if (!url) {
    alert("Ingresa un link valido.");
    return false;
  }

  const newLink = {
    id: generateId(),
    name: linkData.name,
    url,
    sectionId,
    note: "",
    active: true,
    deletedAt: "",
    createdAt: nowText(),
    updatedAt: nowText()
  };

  links.push(newLink);
  renderCurrentView();
  await saveLinksToJsonFile();
  return true;
}

async function updateLink(id, updatedData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const sectionId = getPasswordSectionId(updatedData.sectionId);

  if (!sectionId) {
    alert("Selecciona una seccion para guardar el link.");
    return false;
  }

  const url = normalizeUrl(updatedData.url);

  if (!url) {
    alert("Ingresa un link valido.");
    return false;
  }

  links = links.map(item =>
    item.id === id
      ? {
          ...item,
          name: updatedData.name,
          url,
          sectionId,
          updatedAt: nowText()
        }
      : item
  );

  renderLinks();
  await saveLinksToJsonFile();
  return true;
}

async function createPendingTask(pendingData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const newPendingTask = {
    id: generateId(),
    title: pendingData.title,
    company: pendingData.company,
    description: pendingData.description,
    dueDate: pendingData.dueDate,
    color: pendingData.color,
    createdAt: nowText(),
    updatedAt: nowText()
  };

  pendingTasks.push(newPendingTask);
  renderPendingTasks();
  await savePendingTasksToJsonFile();
  return true;
}

async function updatePendingTask(id, updatedData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  pendingTasks = pendingTasks.map(item =>
    item.id === id
      ? {
          ...item,
          ...updatedData,
          updatedAt: nowText()
        }
      : item
  );

  renderPendingTasks();
  await savePendingTasksToJsonFile();
  return true;
}

async function updatePassword(id, updatedData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const sectionId = getPasswordSectionId(updatedData.sectionId);

  if (!sectionId) {
    alert("Selecciona una seccion para guardar la contraseña.");
    return false;
  }

  passwords = passwords.map(item =>
    item.id === id
      ? {
          ...item,
          ...updatedData,
          platformUrl: normalizeUrl(updatedData.platformUrl || ""),
          sectionId,
          updatedAt: nowText()
        }
      : item
  );

  renderPasswords();
  await savePasswordsToJsonFile();
  return true;
}

async function savePasswordNote(id, note) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const item = passwords.find(password => password.id === id);
  if (!item) return false;

  item.note = note.trim();
  item.updatedAt = nowText();

  await savePasswordsToJsonFile();
  alert("Nota guardada.");
  return true;
}

async function saveLinkNote(id, note) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return false;
  }

  const item = links.find(link => link.id === id);
  if (!item) return false;

  item.note = note.trim();
  item.updatedAt = nowText();

  await saveLinksToJsonFile();
  alert("Nota guardada.");
  return true;
}

async function deletePassword(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  passwords = passwords.filter(item => item.id !== id);
  renderPasswords();
  await savePasswordsToJsonFile();
}

async function deleteLink(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  links = links.filter(item => item.id !== id);
  renderLinks();
  await saveLinksToJsonFile();
}

async function deletePendingTask(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  pendingTasks = pendingTasks.filter(item => item.id !== id);
  renderPendingTasks();
  await savePendingTasksToJsonFile();
}

/* =========================
   Modales
========================= */
function setDetailsModalMode(mode) {
  const detailsModal = document.getElementById("detailsModal");
  const title = document.getElementById("detailsModalTitle");
  const subtitle = document.getElementById("detailsModalSubtitle");
  const submitButton = document.getElementById("updateDetailsSubmit");
  const sectionSelect = document.getElementById("detailsPasswordSection");
  const passwordField = document.getElementById("detailsPasswordField");
  const togglePasswordButton = document.getElementById("toggleDetailsPassword");
  const copyPasswordButton = document.getElementById("copyDetailsPassword");
  const dateGroups = detailsModal.querySelectorAll(".details-date-group");
  const inputs = detailsModal.querySelectorAll("input");
  const isViewMode = mode === "view";

  title.textContent = isViewMode
    ? "Detalles de la contraseña"
    : "Actualizar contraseña";
  subtitle.textContent = isViewMode
    ? "Consulta la informacion guardada."
    : "Edita y guarda los cambios de esta contraseña.";

  if (sectionSelect) {
    sectionSelect.disabled = isViewMode;
  }

  inputs.forEach(input => {
    input.readOnly = isViewMode;
  });

  detailsModal.querySelectorAll(".details-date-group input").forEach(input => {
    input.readOnly = true;
  });

  dateGroups.forEach(group => {
    group.hidden = !isViewMode;
  });

  if (submitButton) {
    submitButton.hidden = isViewMode;
  }

  if (passwordField) {
    passwordField.type = "text";
  }

  if (togglePasswordButton) {
    togglePasswordButton.hidden = true;
  }

  if (copyPasswordButton) {
    copyPasswordButton.hidden = true;
  }
}

function openPasswordModal(id, mode) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPasswordId = id;

  const item = passwords.find(password => password.id === id);
  if (!item) return;

  const detailsModal = document.getElementById("detailsModal");
  const sectionSelect = document.getElementById("detailsPasswordSection");
  const inputs = detailsModal.querySelectorAll("input");

  populateSectionSelect(sectionSelect, item.sectionId);
  setDetailsModalMode(mode);

  inputs[0].value = item.platform;
  inputs[1].value = item.platformUrl || "";
  inputs[2].value = item.username;
  inputs[3].value = item.email;
  inputs[4].value = item.createdAt;
  inputs[5].value = item.updatedAt;
  inputs[6].value = item.password;

  detailsModal.classList.add("show");
}

function openDetails(id) {
  openPasswordModal(id, "view");
}

function openUpdate(id) {
  openPasswordModal(id, "edit");
}

function openEditSection(id) {
  const section = sections.find(item => item.id === id && item.active !== false);
  if (!section) return;

  selectedSectionActionId = id;

  const editSectionModal = document.getElementById("editSectionModal");
  const editSectionNameInput = document.getElementById("editSectionNameInput");

  editSectionNameInput.value = section.name;
  editSectionModal.classList.add("show");
  editSectionNameInput.focus();
}

function openDeleteSection(id) {
  const section = sections.find(item => item.id === id && item.active !== false);
  if (!section) return;

  selectedSectionActionId = id;
  document.getElementById("deleteSectionModal").classList.add("show");
}

function openUpdateLink(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedLinkId = id;

  const item = links.find(link => link.id === id);
  if (!item) return;

  const updateLinkModal = document.getElementById("updateLinkModal");
  const updateLinkSection = document.getElementById("updateLinkSection");
  const inputs = updateLinkModal.querySelectorAll("input");

  populateSectionSelect(updateLinkSection, item.sectionId);
  inputs[0].value = item.name;
  inputs[1].value = item.url;

  updateLinkModal.classList.add("show");
}

function setPendingModalMode(mode) {
  const pendingModal = document.getElementById("pendingModal");
  const title = document.getElementById("pendingModalTitle");
  const subtitle = document.getElementById("pendingModalSubtitle");
  const submitButton = document.getElementById("savePendingBtn");
  const inputs = pendingModal.querySelectorAll("input, textarea, select");
  const isViewMode = mode === "view";

  title.textContent = isViewMode
    ? "Detalles del pendiente"
    : mode === "edit"
      ? "Actualizar pendiente"
      : "Agregar Pendiente";

  subtitle.textContent = isViewMode
    ? "Consulta la informacion guardada."
    : mode === "edit"
      ? "Edita y guarda los cambios de este pendiente."
      : "Registra una tarea pendiente.";

  inputs.forEach(input => {
    input.disabled = isViewMode;
  });

  if (submitButton) {
    submitButton.hidden = isViewMode;
  }
}

function openPendingModal(mode = "create", id = null) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPendingId = id;

  const pendingModal = document.getElementById("pendingModal");
  const form = pendingModal.querySelector("form");
  const inputs = pendingModal.querySelectorAll("input, textarea, select");
  form.reset();
  inputs.forEach(input => {
    input.disabled = false;
  });

  if (mode !== "create") {
    const item = pendingTasks.find(pendingTask => pendingTask.id === id);
    if (!item) return;

    inputs[0].value = item.title;
    inputs[1].value = item.company;
    inputs[2].value = item.description;
    inputs[3].value = item.dueDate;
    inputs[4].value = item.color;
  }

  setPendingModalMode(mode);
  pendingModal.dataset.mode = mode;
  pendingModal.classList.add("show");
}

function openDelete(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPasswordId = id;
  document.getElementById("deleteModal").classList.add("show");
}

function openDeleteLink(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPasswordId = id;
  document.getElementById("deleteModal").classList.add("show");
}

function copyText(text, message) {
  navigator.clipboard.writeText(text);
  alert(message);
}

function copyPassword(password) {
  copyText(password, "Contraseña copiada.");
}

function searchPasswords(query) {
  if (!historyLoaded) return;

  const text = query.toLowerCase();

  const filtered = getVisiblePasswords().filter(item =>
    item.platform.toLowerCase().includes(text) ||
    (item.platformUrl || "").toLowerCase().includes(text) ||
    item.username.toLowerCase().includes(text) ||
    item.email.toLowerCase().includes(text)
  );

  renderPasswords(filtered);
}

function searchLinks(query) {
  if (!historyLoaded) return;

  const text = query.toLowerCase();

  const filtered = getVisibleLinks().filter(item =>
    item.name.toLowerCase().includes(text) ||
    item.url.toLowerCase().includes(text)
  );

  renderLinks(filtered);
}

function searchPendingTasks(query) {
  if (!historyLoaded) return;

  const text = query.toLowerCase();

  const filtered = getVisiblePendingTasks().filter(item =>
    item.title.toLowerCase().includes(text) ||
    item.company.toLowerCase().includes(text) ||
    item.description.toLowerCase().includes(text) ||
    item.dueDate.toLowerCase().includes(text) ||
    getPendingColorLabel(item.color).toLowerCase().includes(text)
  );

  renderPendingTasks(filtered);
}

function searchCurrentView(query) {
  if (selectedView === "pending") {
    searchPendingTasks(query);
    return;
  }

  if (selectedView === "links") {
    searchLinks(query);
    return;
  }

  searchPasswords(query);
}

function closeInlineSectionForm() {
  const toggleSectionForm = document.getElementById("toggleInlineAddSectionForm");

  if (toggleSectionForm) {
    toggleSectionForm.checked = false;
  }
}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.activeView = selectedView;
  updatePendingCounter();
  loadSectionsFromLocalStorage();
  renderSections();
  populateAddPasswordSectionSelect();
  populateAddLinkSectionSelect();

  const toolbar = document.querySelector(".toolbar");

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "btn btn-primary mt-3";
  loadButton.title = "Cargar historial";
  loadButton.setAttribute("aria-label", "Cargar historial");
  loadButton.innerHTML = '<i class="bi bi-folder2-open"></i>';

  toolbar.appendChild(loadButton);

  loadButton.addEventListener("click", async () => {
    await initializeHistoryIfNeeded(false, loadButton);
  });

  initializeHistoryWithTimeout(loadButton).then(loadedFromJson => {
    if (loadedFromJson) {
      console.log("Historial cargado automáticamente.");
    }
  });

  const searchInput = document.querySelector(".search-input");

  if (searchInput) {
    searchInput.addEventListener("input", event => {
      searchCurrentView(event.target.value);
    });
  }

  document.querySelectorAll(".vault-tab").forEach(button => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);

      if (searchInput) {
        searchInput.value = "";
      }
    });
  });

  const pendingAccessButton = document.getElementById("pendingAccessBtn");

  if (pendingAccessButton) {
    pendingAccessButton.addEventListener("click", () => {
      setActiveView("pending");

      if (searchInput) {
        searchInput.value = "";
      }
    });
  }

  const addSectionForm = document.getElementById("addSectionForm");
  const openAddSectionForm = document.getElementById("openAddSectionForm");
  const toggleSectionForm = document.getElementById("toggleInlineAddSectionForm");
  const sectionNameInput = document.getElementById("sectionNameInput");
  const cancelAddSection = document.getElementById("cancelAddSection");
  const restoreSectionModal = document.getElementById("restoreSectionModal");
  const restoreSectionBtn = document.getElementById("restoreSectionBtn");
  const overwriteSectionBtn = document.getElementById("overwriteSectionBtn");
  const cancelRestoreSectionBtn = document.getElementById("cancelRestoreSectionBtn");
  const editSectionModal = document.getElementById("editSectionModal");
  const editSectionForm = document.getElementById("editSectionForm");
  const editSectionNameInput = document.getElementById("editSectionNameInput");
  const closeEditSectionModal = document.getElementById("closeEditSectionModal");
  const cancelEditSection = document.getElementById("cancelEditSection");
  const deleteSectionModal = document.getElementById("deleteSectionModal");
  const cancelDeleteSectionBtn = document.getElementById("cancelDeleteSectionBtn");
  const confirmDeleteSectionBtn = document.getElementById("confirmDeleteSectionBtn");

  if (openAddSectionForm && toggleSectionForm) {
    openAddSectionForm.addEventListener("click", async event => {
      event.preventDefault();

      const initialized = await initializeHistoryIfNeeded(false, loadButton);
      if (!initialized) return;

      toggleSectionForm.checked = true;
    });
  }

  if (addSectionForm && sectionNameInput) {
    addSectionForm.addEventListener("submit", async event => {
      event.preventDefault();

      const initialized = await initializeHistoryIfNeeded(false, loadButton);
      if (!initialized) return;

      const created = await createSection(sectionNameInput.value);
      if (!created) return;

      addSectionForm.reset();
      closeInlineSectionForm();
    });
  }

  if (cancelAddSection && addSectionForm) {
    cancelAddSection.addEventListener("click", () => {
      addSectionForm.reset();
      closeInlineSectionForm();
    });
  }

  if (restoreSectionModal) {
    restoreSectionModal.addEventListener("click", event => {
      if (event.target === restoreSectionModal) {
        restoreSectionModal.classList.remove("show");
      }
    });
  }

  if (restoreSectionBtn) {
    restoreSectionBtn.addEventListener("click", async () => {
      const restored = await restoreInactiveSection(pendingInactiveSectionId);
      if (!restored) return;

      addSectionForm.reset();
      closeInlineSectionForm();
      restoreSectionModal.classList.remove("show");
    });
  }

  if (overwriteSectionBtn) {
    overwriteSectionBtn.addEventListener("click", async () => {
      const created = await createNewSection(pendingSectionName);
      if (!created) return;

      addSectionForm.reset();
      closeInlineSectionForm();
      restoreSectionModal.classList.remove("show");
    });
  }

  if (cancelRestoreSectionBtn) {
    cancelRestoreSectionBtn.addEventListener("click", () => {
      restoreSectionModal.classList.remove("show");
    });
  }

  if (closeEditSectionModal) {
    closeEditSectionModal.addEventListener("click", () => {
      editSectionModal.classList.remove("show");
    });
  }

  if (cancelEditSection) {
    cancelEditSection.addEventListener("click", () => {
      editSectionModal.classList.remove("show");
    });
  }

  if (editSectionModal) {
    editSectionModal.addEventListener("click", event => {
      if (event.target === editSectionModal) {
        editSectionModal.classList.remove("show");
      }
    });
  }

  if (editSectionForm && editSectionNameInput) {
    editSectionForm.addEventListener("submit", async event => {
      event.preventDefault();

      const saved = await updateSection(
        selectedSectionActionId,
        editSectionNameInput.value
      );

      if (!saved) return;

      editSectionModal.classList.remove("show");
    });
  }

  if (cancelDeleteSectionBtn) {
    cancelDeleteSectionBtn.addEventListener("click", () => {
      deleteSectionModal.classList.remove("show");
    });
  }

  if (deleteSectionModal) {
    deleteSectionModal.addEventListener("click", event => {
      if (event.target === deleteSectionModal) {
        deleteSectionModal.classList.remove("show");
      }
    });
  }

  if (confirmDeleteSectionBtn) {
    confirmDeleteSectionBtn.addEventListener("click", async () => {
      const deleted = await softDeleteSection(selectedSectionActionId);
      if (!deleted) return;

      deleteSectionModal.classList.remove("show");
    });
  }

  const addForm = document.querySelector("#addPasswordModal .modal-form");
  const addPasswordSection = document.getElementById("addPasswordSection");
  const openAddPasswordButton = document.getElementById("openAddPasswordModal");

  if (openAddPasswordButton) {
    openAddPasswordButton.addEventListener("click", async () => {
      const initialized = await initializeHistoryIfNeeded(false, loadButton);
      if (!initialized) return;

      if (selectedView === "pending") {
        openPendingModal("create");
        return;
      }

      if (selectedView === "links") {
        populateAddLinkSectionSelect();
        document.getElementById("addLinkModal").classList.add("show");
        return;
      }

      populateAddPasswordSectionSelect();
      document.getElementById("addPasswordModal").classList.add("show");
    });
  }

  const addLinkModal = document.getElementById("addLinkModal");
  const closeAddLinkModal = document.getElementById("closeAddLinkModal");
  const cancelAddLink = document.getElementById("cancelAddLink");
  const addLinkForm = document.querySelector("#addLinkModal .modal-form");
  const addLinkSection = document.getElementById("addLinkSection");
  const updateLinkModal = document.getElementById("updateLinkModal");
  const closeUpdateLinkModal = document.getElementById("closeUpdateLinkModal");
  const cancelUpdateLink = document.getElementById("cancelUpdateLink");
  const updateLinkForm = document.querySelector("#updateLinkModal .modal-form");
  const updateLinkSection = document.getElementById("updateLinkSection");

  if (closeAddLinkModal) {
    closeAddLinkModal.addEventListener("click", () => {
      addLinkModal.classList.remove("show");
    });
  }

  if (cancelAddLink) {
    cancelAddLink.addEventListener("click", () => {
      addLinkModal.classList.remove("show");
    });
  }

  if (addLinkModal) {
    addLinkModal.addEventListener("click", event => {
      if (event.target === addLinkModal) {
        addLinkModal.classList.remove("show");
      }
    });
  }

  if (addLinkForm) {
    addLinkForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = addLinkForm.querySelectorAll("input");

      const saved = await createLink({
        sectionId: addLinkSection ? addLinkSection.value : "",
        name: inputs[0].value.trim(),
        url: inputs[1].value.trim()
      });

      if (!saved) return;

      addLinkForm.reset();
      addLinkModal.classList.remove("show");
    });
  }

  if (closeUpdateLinkModal) {
    closeUpdateLinkModal.addEventListener("click", () => {
      updateLinkModal.classList.remove("show");
    });
  }

  if (cancelUpdateLink) {
    cancelUpdateLink.addEventListener("click", () => {
      updateLinkModal.classList.remove("show");
    });
  }

  if (updateLinkModal) {
    updateLinkModal.addEventListener("click", event => {
      if (event.target === updateLinkModal) {
        updateLinkModal.classList.remove("show");
      }
    });
  }

  if (updateLinkForm) {
    updateLinkForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = updateLinkForm.querySelectorAll("input");

      const saved = await updateLink(selectedLinkId, {
        sectionId: updateLinkSection ? updateLinkSection.value : "",
        name: inputs[0].value.trim(),
        url: inputs[1].value.trim()
      });

      if (!saved) return;

      updateLinkModal.classList.remove("show");
    });
  }

  const pendingModal = document.getElementById("pendingModal");
  const closePendingModal = document.getElementById("closePendingModal");
  const cancelPendingModal = document.getElementById("cancelPendingModal");
  const pendingForm = document.querySelector("#pendingModal .modal-form");

  function closePendingFormModal() {
    pendingModal.classList.remove("show");
    pendingForm.reset();
  }

  if (closePendingModal) {
    closePendingModal.addEventListener("click", closePendingFormModal);
  }

  if (cancelPendingModal) {
    cancelPendingModal.addEventListener("click", closePendingFormModal);
  }

  if (pendingModal) {
    pendingModal.addEventListener("click", event => {
      if (event.target === pendingModal) {
        closePendingFormModal();
      }
    });
  }

  if (pendingForm) {
    pendingForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = pendingForm.querySelectorAll("input, textarea, select");
      const pendingData = {
        title: inputs[0].value.trim(),
        company: inputs[1].value.trim(),
        description: inputs[2].value.trim(),
        dueDate: inputs[3].value,
        color: inputs[4].value
      };

      const saved = pendingModal.dataset.mode === "edit"
        ? await updatePendingTask(selectedPendingId, pendingData)
        : await createPendingTask(pendingData);

      if (!saved) return;

      closePendingFormModal();
    });
  }

  if (addForm) {
    addForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = addForm.querySelectorAll("input");

      const saved = await createPassword({
        sectionId: addPasswordSection ? addPasswordSection.value : "",
        platform: inputs[0].value.trim(),
        platformUrl: inputs[1].value.trim(),
        username: inputs[2].value.trim(),
        email: inputs[3].value.trim(),
        password: inputs[4].value
      });

      if (!saved) return;

      addForm.reset();
      document.getElementById("addPasswordModal").classList.remove("show");
    });
  }

  const detailsForm = document.querySelector("#detailsModal .modal-form");
  const detailsPasswordSection = document.getElementById("detailsPasswordSection");

  if (detailsForm) {
    detailsForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = detailsForm.querySelectorAll("input");

      const saved = await updatePassword(selectedPasswordId, {
        sectionId: detailsPasswordSection ? detailsPasswordSection.value : "",
        platform: inputs[0].value.trim(),
        platformUrl: inputs[1].value.trim(),
        username: inputs[2].value.trim(),
        email: inputs[3].value.trim(),
        password: inputs[6].value
      });

      if (!saved) return;

      document.getElementById("detailsModal").classList.remove("show");
    });
  }

  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (selectedView === "links") {
        await deleteLink(selectedPasswordId);
      } else {
        await deletePassword(selectedPasswordId);
      }

      document.getElementById("deleteModal").classList.remove("show");
    });
  }

  const detailsCopyButton = document.querySelector(
    "#detailsModal .password-detail-row button:last-child"
  );

  if (detailsCopyButton) {
    detailsCopyButton.addEventListener("click", () => {
      const passwordField = document.getElementById("detailsPasswordField");
      copyPassword(passwordField.value);
    });
  }
});

/* =========================
   Lógica de Temas (Palanca de Cambios)
========================= */
let contadorTemas = 0; // 0 = Predeterminado (Luis), 1 = Apple (Claro), 2 = Gótico (Oscuro)

function palancaDeCambios() {
  // Rotamos entre 0, 1 y 2
  contadorTemas = (contadorTemas + 1) % 3;

  // Obtenemos las referencias de los links en el HTML
  const linkLight = document.getElementById('theme-light');
  const linkDark = document.getElementById('theme-dark');

  if (contadorTemas === 1) {
    // MODO APPLE: Activamos el CSS claro y apagamos el oscuro
    if (linkLight) linkLight.disabled = false;
    if (linkDark) linkDark.disabled = true;
    console.log("Tema activado: Apple (Claro)");
  } 
  else if (contadorTemas === 2) {
    // MODO GÓTICO: Activamos el CSS oscuro y apagamos el claro
    if (linkLight) linkLight.disabled = true;
    if (linkDark) linkDark.disabled = false;
    console.log("Tema activado: Gótico (Oscuro)");
  } 
  else {
    // MODO PREDETERMINADO: Apagamos ambos archivos nuevos
    if (linkLight) linkLight.disabled = true;
    if (linkDark) linkDark.disabled = true;
    console.log("Tema activado: Predeterminado (Luis)");
  }
}
