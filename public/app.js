const tokenInput = document.getElementById('tokenInput');
const refreshButton = document.getElementById('refreshButton');
const statusText = document.getElementById('statusText');
const sessionsRoot = document.getElementById('sessionsRoot');
const createSessionForm = document.getElementById('createSessionForm');
const createWindowForm = document.getElementById('createWindowForm');
const paneTemplate = document.getElementById('paneTemplate');

const STORAGE_KEY = 'tmux-web-console-api-token';
tokenInput.value = localStorage.getItem(STORAGE_KEY) || '';

tokenInput.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY, tokenInput.value.trim());
});

function authHeaders() {
  const token = tokenInput.value.trim();
  return token ? { 'x-api-token': token } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

function renderSessions(sessions) {
  sessionsRoot.innerHTML = '';

  if (!sessions.length) {
    sessionsRoot.innerHTML = '<p class="empty">No tmux sessions found.</p>';
    return;
  }

  for (const session of sessions) {
    const section = document.createElement('section');
    section.className = 'session';
    section.innerHTML = `
      <div class="session-header">
        <div>
          <h3>${session.name}</h3>
          <p>${session.windows.length} window(s) · ${session.attached} attached</p>
        </div>
        <button data-kill-session="${session.name}">Kill session</button>
      </div>
    `;

    const windowsWrap = document.createElement('div');
    windowsWrap.className = 'windows';

    for (const window of session.windows) {
      const windowEl = document.createElement('article');
      windowEl.className = 'window';
      windowEl.innerHTML = `
        <div class="window-header">
          <h4>${window.index}: ${window.name}</h4>
          <span>${window.panes.length} pane(s)</span>
        </div>
      `;

      const panesWrap = document.createElement('div');
      panesWrap.className = 'panes';

      for (const pane of window.panes) {
        const fragment = paneTemplate.content.cloneNode(true);
        const paneRoot = fragment.querySelector('.pane');
        const meta = fragment.querySelector('.pane-meta');
        const form = fragment.querySelector('.command-form');
        const input = fragment.querySelector('.command-input');

        meta.innerHTML = `
          <strong>${pane.id}</strong>
          <span>${pane.currentCommand || 'shell'} · ${pane.currentPath || '-'}</span>
        `;

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            statusText.textContent = `Sending command to ${pane.id}…`;
            await api('/api/commands', {
              method: 'POST',
              body: JSON.stringify({
                targetPane: pane.id,
                command: input.value,
                enter: true,
              }),
            });
            input.value = '';
            statusText.textContent = `Command sent to ${pane.id}`;
          } catch (error) {
            statusText.textContent = error.message;
          }
        });

        paneRoot.dataset.paneId = pane.id;
        panesWrap.appendChild(fragment);
      }

      windowEl.appendChild(panesWrap);
      windowsWrap.appendChild(windowEl);
    }

    section.appendChild(windowsWrap);
    sessionsRoot.appendChild(section);
  }

  sessionsRoot.querySelectorAll('[data-kill-session]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sessionName = button.dataset.killSession;
      if (!confirm(`Kill session ${sessionName}?`)) {
        return;
      }

      try {
        await api(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
        await refresh();
      } catch (error) {
        statusText.textContent = error.message;
      }
    });
  });
}

async function refresh() {
  try {
    statusText.textContent = 'Refreshing…';
    const payload = await api('/api/tree');
    renderSessions(payload.sessions);
    statusText.textContent = `Loaded ${payload.sessions.length} session(s)`;
  } catch (error) {
    sessionsRoot.innerHTML = '<p class="empty">Unable to load tmux data.</p>';
    statusText.textContent = error.message;
  }
}

createSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('sessionNameInput').value.trim();
  if (!name) {
    return;
  }

  try {
    await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    createSessionForm.reset();
    await refresh();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

createWindowForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sessionName = document.getElementById('windowSessionInput').value.trim();
  const name = document.getElementById('windowNameInput').value.trim();
  if (!sessionName || !name) {
    return;
  }

  try {
    await api('/api/windows', {
      method: 'POST',
      body: JSON.stringify({ sessionName, name }),
    });
    createWindowForm.reset();
    await refresh();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

refreshButton.addEventListener('click', refresh);
refresh();
