let passwords = [];
let links = [];
let sections = [];
let selectedSectionId = "";
let selectedPasswordId = null;
let selectedLinkId = null;
let selectedView = "passwords";
let historyLoaded = false;

let directoryHandle = null;
let passwordFileHandle = null;
let sectionFileHandle = null;
let linkFileHandle = null;

const JSON_FILE_NAME = "passwords-history.json";
const SECTIONS_JSON_FILE_NAME = "sections-history.json";
const LINKS_JSON_FILE_NAME = "links-history.json";
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
    createdAt: section.createdAt || nowText()
  };
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
  return section ? section.name : "Sin seccion";
}

function getVisiblePasswords() {
  return selectedSectionId
    ? passwords.filter(item => item.sectionId === selectedSectionId)
    : passwords;
}

function getVisibleLinks() {
  return selectedSectionId
    ? links.filter(item => item.sectionId === selectedSectionId)
    : links;
}

function keepValidSelectedSection() {
  if (selectedSectionId && !sections.some(section => section.id === selectedSectionId)) {
    selectedSectionId = "";
  }
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

    return true;
  } catch (error) {
    console.warn("No se pudo acceder a la carpeta:", error);

    if (!autoMode) {
      alert("No se seleccionó ninguna carpeta.");
    }

    return false;
  }
}

async function loadSectionsFromJsonFile(autoMode = false) {
  const hasFile = await ensureJsonFile(autoMode);
  if (!hasFile) return false;

  const file = await sectionFileHandle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    await saveSectionsToJsonFile();
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
    createdAt: section.createdAt
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
    if (!autoMode) {
      alert("El archivo passwords-history.json está vacío.");
    }
    return false;
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
    username: item.username || item.usuario || "",
    email: item.email || item.correo || "",
    password: item.password || item.contraseña || "",
    sectionId: item.sectionId || "",
    note: item.note || item.notes || "",
    createdAt: item.createdAt || nowText(),
    updatedAt: item.updatedAt || nowText()
  }));

  const loadedSections = await loadSectionsFromJsonFile(autoMode);
  if (!loadedSections) return false;

  const loadedLinks = await loadLinksFromJsonFile(autoMode);
  if (!loadedLinks) return false;

  historyLoaded = true;
  return true;
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
    username: item.username,
    email: item.email,
    password: item.password,
    sectionId: item.sectionId || "",
    note: item.note || "",
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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));

  const writable = await linkFileHandle.createWritable();
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

  list.forEach(item => {
    const article = document.createElement("article");
    article.className = "password-card";

    article.innerHTML = `
      <div class="password-info">
        <div class="platform-icon">
          ${escapeHtml((item.platform || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <h4>${escapeHtml(item.platform)}</h4>
          <p>${escapeHtml(item.username)}</p>
          <p class="card-copy-row">
            <span>Email: ${escapeHtml(item.email)}</span>
            <button
              class="inline-copy-btn"
              type="button"
              data-copy-value="${escapeHtml(item.email)}"
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
              title="Copiar contraseña"
              aria-label="Copiar contraseña"
            >
              <i class="bi bi-clipboard"></i>
            </button>

            <button
              class="inline-copy-btn share-password-btn"
              type="button"
              title="Compartir credenciales"
              aria-label="Compartir credenciales"
            >
              <i class="bi bi-share"></i>
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
          copyPassword(button.dataset.copyValue);
        }
      });
    });

    article.querySelector(".share-password-btn").addEventListener("click", () => {
      copyText(
        `Email: ${item.email}\nContraseña: ${item.password}`,
        "Email y contraseña copiados."
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

  list.forEach(item => {
    const article = document.createElement("article");
    article.className = "password-card";

    article.innerHTML = `
      <div class="password-info">
        <div class="platform-icon">
          ${escapeHtml((item.name || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <h4>${escapeHtml(item.name)}</h4>
          <p class="card-copy-row">
            <span>Link: ${escapeHtml(item.url)}</span>
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

function renderCurrentView() {
  if (selectedView === "links") {
    renderLinks();
    return;
  }

  renderPasswords();
}

function renderSections() {
  const sectionList = document.getElementById("sectionList");
  if (!sectionList) return;

  sectionList.innerHTML = "";

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `sidebar-section-item${selectedSectionId ? "" : " active"}`;
  allButton.innerHTML = `
    <span class="sidebar-section-icon">#</span>
    <span>Todas</span>
  `;

  allButton.addEventListener("click", () => {
    selectedSectionId = "";
    renderSections();
    renderCurrentView();
    populateAddPasswordSectionSelect();
    populateAddLinkSectionSelect();
  });

  sectionList.appendChild(allButton);

  if (sections.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "sidebar-empty-sections";
    emptyMessage.textContent = "Sin secciones";
    sectionList.appendChild(emptyMessage);
    return;
  }

  sections.forEach(section => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sidebar-section-item${section.id === selectedSectionId ? " active" : ""}`;
    button.dataset.id = section.id;

    button.innerHTML = `
      <span class="sidebar-section-icon">
        ${escapeHtml(section.name.charAt(0).toUpperCase())}
      </span>
      <span>${escapeHtml(section.name)}</span>
    `;

    button.addEventListener("click", () => {
      selectedSectionId = section.id;
      renderSections();
      renderCurrentView();
      populateAddPasswordSectionSelect();
      populateAddLinkSectionSelect();
    });

    sectionList.appendChild(button);
  });
}

function populateSectionSelect(selectElement, selectedId = "") {
  if (!selectElement) return;

  selectElement.innerHTML = '<option value="">Selecciona una seccion</option>';

  sections.forEach(section => {
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
  const heroTitle = document.querySelector(".hero-section h1");
  const heroDescription = document.getElementById("heroDescription");
  const addButton = document.getElementById("openAddPasswordModal");

  document.querySelectorAll(".vault-tab").forEach(button => {
    const isActive = button.dataset.view === selectedView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (heroTitle) {
    heroTitle.textContent = isLinksView
      ? "Administrador de Links"
      : "Administrador de Contraseñas";
  }

  if (heroDescription) {
    heroDescription.textContent = isLinksView
      ? "Guarda accesos rapidos a paginas y empresas"
      : "Administra tus contraseñas de forma rápida";
  }

  if (addButton) {
    addButton.title = isLinksView ? "Agregar link" : "Agregar contraseña";
    addButton.setAttribute(
      "aria-label",
      isLinksView ? "Agregar link" : "Agregar contraseña"
    );
    addButton.innerHTML = isLinksView
      ? '<i class="bi bi-link-45deg"></i>'
      : '<i class="bi bi-key-fill"></i>';
  }

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

  const newSection = {
    id: generateId(),
    name,
    createdAt: nowText()
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

function getPasswordSectionId(sectionId) {
  return sections.some(section => section.id === sectionId) ? sectionId : "";
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
    username: passwordData.username,
    email: passwordData.email,
    password: passwordData.password,
    sectionId,
    note: "",
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

  inputs.forEach((input, index) => {
    input.readOnly = isViewMode || index === 3 || index === 4;
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
  inputs[1].value = item.username;
  inputs[2].value = item.email;
  inputs[3].value = item.createdAt;
  inputs[4].value = item.updatedAt;
  inputs[5].value = item.password;

  detailsModal.classList.add("show");
}

function openDetails(id) {
  openPasswordModal(id, "view");
}

function openUpdate(id) {
  openPasswordModal(id, "edit");
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

function searchCurrentView(query) {
  if (selectedView === "links") {
    searchLinks(query);
    return;
  }

  searchPasswords(query);
}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.activeView = selectedView;
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
    const loadedFromJson = await loadPasswordsFromJsonFile(false);

    if (!loadedFromJson) {
      alert("No se cargó historial válido. No se guardará nada para evitar sobrescribir tu archivo.");
      return;
    }

    renderCurrentView();
    renderSections();
    populateAddPasswordSectionSelect();
    populateAddLinkSectionSelect();

    if (loadButton && loadButton.parentNode) {
      loadButton.remove();
    }
  });

  // Timer automático: se ejecuta una sola vez después de 3 segundos
  setTimeout(async () => {
    if (historyLoaded) return;

    const loadedFromJson = await loadPasswordsFromJsonFile(true);

    if (!loadedFromJson) {
      console.warn("No se pudo cargar automáticamente. Usa el botón Cargar historial.");
      return;
    }

    renderCurrentView();
    renderSections();
    populateAddPasswordSectionSelect();
    populateAddLinkSectionSelect();

    if (loadButton && loadButton.parentNode) {
      loadButton.remove();
    }

    console.log("Historial cargado automáticamente.");
  }, 3000);

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

  const addSectionForm = document.getElementById("addSectionForm");
  const sectionNameInput = document.getElementById("sectionNameInput");

  if (addSectionForm && sectionNameInput) {
    addSectionForm.addEventListener("submit", async event => {
      event.preventDefault();

      const created = await createSection(sectionNameInput.value);
      if (!created) return;

      addSectionForm.reset();

      const toggleSectionForm = document.getElementById("toggleInlineAddSectionForm");
      if (toggleSectionForm) {
        toggleSectionForm.checked = false;
      }
    });
  }

  const addForm = document.querySelector("#addPasswordModal .modal-form");
  const addPasswordSection = document.getElementById("addPasswordSection");
  const openAddPasswordButton = document.getElementById("openAddPasswordModal");

  if (openAddPasswordButton) {
    openAddPasswordButton.addEventListener("click", () => {
      if (selectedView === "links") {
        populateAddLinkSectionSelect();
        document.getElementById("addLinkModal").classList.add("show");
        return;
      }

      populateAddPasswordSectionSelect();
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

  if (addForm) {
    addForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = addForm.querySelectorAll("input");

      const saved = await createPassword({
        sectionId: addPasswordSection ? addPasswordSection.value : "",
        platform: inputs[0].value.trim(),
        username: inputs[1].value.trim(),
        email: inputs[2].value.trim(),
        password: inputs[3].value
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
        username: inputs[1].value.trim(),
        email: inputs[2].value.trim(),
        password: inputs[5].value
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