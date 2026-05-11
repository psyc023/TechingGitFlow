let passwords = [];
let sections = [];
let selectedSectionId = "";
let selectedPasswordId = null;
let historyLoaded = false;

let directoryHandle = null;
let passwordFileHandle = null;
let sectionFileHandle = null;

const JSON_FILE_NAME = "passwords-history.json";
const SECTIONS_JSON_FILE_NAME = "sections-history.json";
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
            <button class="inline-copy-btn" type="button" data-copy-value="${escapeHtml(item.email)}">copiar</button>
          </p>
          <p class="card-copy-row">
            <span>Contraseña: ${escapeHtml(item.password)}</span>
            <button class="inline-copy-btn" type="button" data-copy-value="${escapeHtml(item.password)}">copiar</button>
          </p>
          <span>Seccion: ${escapeHtml(getSectionName(item.sectionId))}</span>
        </div>
      </div>

      <div class="card-notes">
        <label>Notas</label>
        <textarea
          class="card-note-input"
          placeholder="Escribe una nota para esta contraseña"
        >${escapeHtml(item.note || "")}</textarea>

        <div class="card-note-actions">
          <button class="btn save-note-btn" type="button">
            Guardar
          </button>
        </div>

        <div class="card-note-preview">
          ${escapeHtml(item.note || "Sin notas guardadas")}
        </div>
      </div>

      <div class="card-actions">
        <button class="btn details-btn" type="button" data-id="${escapeHtml(item.id)}">
          Detalles
        </button>

        <button class="btn update-btn" type="button" data-id="${escapeHtml(item.id)}">
          Actualizar
        </button>

        <button class="btn delete-btn" type="button" data-id="${escapeHtml(item.id)}">
          Eliminar
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
        copyPassword(button.dataset.copyValue);
      });
    });

    article.querySelector(".save-note-btn").addEventListener("click", async () => {
      const noteInput = article.querySelector(".card-note-input");
      const notePreview = article.querySelector(".card-note-preview");

      const saved = await savePasswordNote(item.id, noteInput.value);
      if (!saved) return;

      notePreview.textContent = noteInput.value.trim() || "Sin notas guardadas";
      article.classList.add("show-note");
    });

    article.querySelector(".delete-btn").addEventListener("click", () => {
      openDelete(item.id);
    });

    article.addEventListener("click", event => {
      if (event.target.closest("button, input, textarea, select, label, a")) {
        return;
      }

      article.classList.toggle("show-note");
    });

    passwordList.appendChild(article);
  });
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
    renderPasswords();
    populateAddPasswordSectionSelect();
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
      renderPasswords();
      populateAddPasswordSectionSelect();
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
  renderPasswords();
  populateAddPasswordSectionSelect();
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

async function deletePassword(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  passwords = passwords.filter(item => item.id !== id);
  renderPasswords();
  await savePasswordsToJsonFile();
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

function openDelete(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPasswordId = id;
  document.getElementById("deleteModal").classList.add("show");
}

function copyPassword(password) {
  navigator.clipboard.writeText(password);
  alert("Contraseña copiada.");
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

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", () => {
  loadSectionsFromLocalStorage();
  renderSections();
  populateAddPasswordSectionSelect();

  const toolbar = document.querySelector(".toolbar");

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "btn btn-primary mt-3";
  loadButton.textContent = "📂 Cargar historial";

  toolbar.appendChild(loadButton);

  loadButton.addEventListener("click", async () => {
    const loadedFromJson = await loadPasswordsFromJsonFile(false);

    if (!loadedFromJson) {
      alert("No se cargó historial válido. No se guardará nada para evitar sobrescribir tu archivo.");
      return;
    }

    renderPasswords();
    renderSections();
    populateAddPasswordSectionSelect();

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

    renderPasswords();
    renderSections();
    populateAddPasswordSectionSelect();

    if (loadButton && loadButton.parentNode) {
      loadButton.remove();
    }

    console.log("Historial cargado automáticamente.");
  }, 3000);

  const searchInput = document.querySelector(".search-input");

  if (searchInput) {
    searchInput.addEventListener("input", event => {
      searchPasswords(event.target.value);
    });
  }

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
    openAddPasswordButton.addEventListener("click", populateAddPasswordSectionSelect);
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
      await deletePassword(selectedPasswordId);
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