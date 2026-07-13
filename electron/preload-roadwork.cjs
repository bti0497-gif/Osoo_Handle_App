const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roadworkDev', {
  dumpNow() {
    try {
      const html = document.documentElement.outerHTML;
      return ipcRenderer.invoke('roadwork:dumpHtml', html);
    } catch (error) {
      return Promise.reject(error);
    }
  },
});

function findUsernameField(passwordField) {
  const form = passwordField.form;
  if (form) {
    const fromForm = form.querySelector('input[type="text"], input[type="email"], input[type="number"], input[name*="id" i], input[name*="user" i], input[name*="login" i], input[name*="account" i], input[autocomplete*="username" i], input[placeholder*="아이디" i]');
    if (fromForm) return fromForm;
  }

  const direct = document.querySelector('input[id*="id" i], input[name*="id" i], input[id*="user" i], input[name*="user" i], input[name*="login" i], input[name*="account" i], input[autocomplete*="username" i], input[placeholder*="아이디" i]');
  if (direct) return direct;

  const inputs = Array.from(document.querySelectorAll('input'));
  const passwordIndex = inputs.indexOf(passwordField);
  if (passwordIndex <= 0) return null;

  for (let i = passwordIndex - 1; i >= 0; i -= 1) {
    if (['text', 'email', 'number'].includes(inputs[i].type)) {
      return inputs[i];
    }
  }

  return inputs.find((input) => ['text', 'email', 'number'].includes(input.type) && input !== passwordField) || null;
}

function setNativeValue(input, value) {
  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
}

function dispatchFieldEvents(...fields) {
  const events = ['input', 'change', 'blur'];
  for (const field of fields) {
    for (const eventName of events) {
      field.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
  }
}

async function fillLoginFields(usernameField, passwordField) {
  const res = await ipcRenderer.invoke('roadwork:getCredentials');
  if (!res?.success || !res.userId || !res.password) {
    return false;
  }

  const userId = String(res.userId || '').trim();
  const password = String(res.password || '').trim();
  if (!userId || !password) {
    return false;
  }

  setNativeValue(usernameField, userId);
  setNativeValue(passwordField, password);
  dispatchFieldEvents(usernameField, passwordField);

  usernameField.dataset.roadworkAutofilled = 'true';
  passwordField.dataset.roadworkAutofilled = 'true';
  return true;
}

function setupAutofill() {
  let pending = false;

  async function checkAndAutofill() {
    if (pending) return;

    const passwordField = document.querySelector('input[type="password"]');
    if (!passwordField || passwordField.dataset.roadworkAutofilled === 'true') return;

    const usernameField = findUsernameField(passwordField);
    if (!usernameField) return;

    pending = true;
    try {
      await fillLoginFields(usernameField, passwordField);
    } catch (error) {
      console.warn('[Roadwork Autofill] Failed:', error.message);
    } finally {
      pending = false;
    }
  }

  checkAndAutofill();

  const observer = new MutationObserver(() => {
    checkAndAutofill();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
    const html = document.documentElement.outerHTML;
    ipcRenderer.invoke('roadwork:dumpHtml', html)
      .then((res) => {
        if (res?.success) {
          alert(`도로공사 DOM 구조가 저장되었습니다.\n경로: ${res.path}`);
        }
      })
      .catch(() => {});
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAutofill);
} else {
  setupAutofill();
}
