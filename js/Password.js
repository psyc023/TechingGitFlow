let passwords = [];
let selectedPasswordId = null;
let historyLoaded = false;

let directoryHandle = null;
let passwordFileHandle = null;

const JSON_FILE_NAME = "passwords-history.json";

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

    return true;
  } catch (error) {
    console.warn("No se pudo acceder a la carpeta:", error);

    if (!autoMode) {
      alert("No se seleccionó ninguna carpeta.");
    }

    return false;
  }
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
    createdAt: item.createdAt || nowText(),
    updatedAt: item.updatedAt || nowText()
  }));

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
function renderPasswords(list = passwords) {
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
            <p>No records found</p>
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
          <span>${escapeHtml(item.email)}</span>
        </div>
      </div>

      <div class="password-meta">
        <span>${escapeHtml(item.updatedAt)}</span>
      </div>

      <div class="card-actions">
        <button class="btn details-btn" type="button" data-id="${escapeHtml(item.id)}">
          Details
        </button>

        <button class="btn delete-btn" type="button" data-id="${escapeHtml(item.id)}">
          Delete
        </button>
      </div>
    `;

    article.querySelector(".details-btn").addEventListener("click", () => {
      openDetails(item.id);
    });

    article.querySelector(".delete-btn").addEventListener("click", () => {
      openDelete(item.id);
    });

    passwordList.appendChild(article);
  });
}

/* =========================
   CRUD
========================= */
async function createPassword(passwordData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  const newPassword = {
    id: generateId(),
    platform: passwordData.platform,
    username: passwordData.username,
    email: passwordData.email,
    password: passwordData.password,
    createdAt: nowText(),
    updatedAt: nowText()
  };

  passwords.push(newPassword);
  renderPasswords();
  await savePasswordsToJsonFile();
}

async function updatePassword(id, updatedData) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  passwords = passwords.map(item =>
    item.id === id
      ? {
          ...item,
          ...updatedData,
          updatedAt: nowText()
        }
      : item
  );

  renderPasswords();
  await savePasswordsToJsonFile();
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
function openDetails(id) {
  if (!historyLoaded) {
    alert("Primero carga el historial.");
    return;
  }

  selectedPasswordId = id;

  const item = passwords.find(password => password.id === id);
  if (!item) return;

  const detailsModal = document.getElementById("detailsModal");
  const inputs = detailsModal.querySelectorAll("input");

  inputs[0].value = item.platform;
  inputs[1].value = item.username;
  inputs[2].value = item.email;
  inputs[3].value = item.password;

  detailsModal.classList.add("show");
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
  alert("Password copied.");
}

function searchPasswords(query) {
  if (!historyLoaded) return;

  const text = query.toLowerCase();

  const filtered = passwords.filter(item =>
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

  const addForm = document.querySelector("#addPasswordModal .modal-form");

  if (addForm) {
    addForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = addForm.querySelectorAll("input");

      await createPassword({
        platform: inputs[0].value.trim(),
        username: inputs[1].value.trim(),
        email: inputs[2].value.trim(),
        password: inputs[3].value
      });

      addForm.reset();
      document.getElementById("addPasswordModal").classList.remove("show");
    });
  }

  const detailsForm = document.querySelector("#detailsModal .modal-form");

  if (detailsForm) {
    detailsForm.addEventListener("submit", async event => {
      event.preventDefault();

      const inputs = detailsForm.querySelectorAll("input");

      await updatePassword(selectedPasswordId, {
        platform: inputs[0].value.trim(),
        username: inputs[1].value.trim(),
        email: inputs[2].value.trim(),
        password: inputs[3].value
      });

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