/* No Man's Sky Achievement Atlas — account + cloud progress integration.
   This file is loaded after the main inline application script in index.html. */
(() => {
  'use strict';

  const ATLAS_API_BASE = 'https://nms-atlas-sync.kdziatlowicz.workers.dev';
  const ATLAS_AUTH_KEY = 'nms-atlas-auth-v1';
  const atlas$ = (selector, root = document) => root.querySelector(selector);
  const atlasEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  let atlasAuth = atlasLoadAuth();
  let atlasSyncTimer = null;
  let atlasSyncBusy = false;
  let atlasSyncAgain = false;
  let atlasSuspendSync = false;
  let atlasBaseline = null;
  let atlasRecoveryPending = false;
  let atlasCurrentMode = 'login';

  function atlasLoadAuth() {
    try {
      const value = JSON.parse(localStorage.getItem(ATLAS_AUTH_KEY) || 'null');
      if (!value || typeof value.token !== 'string' || typeof value.accountId !== 'string') return null;
      if (Number(value.expiresAt) && Number(value.expiresAt) <= Date.now()) {
        localStorage.removeItem(ATLAS_AUTH_KEY);
        return null;
      }
      return value;
    } catch { return null; }
  }

  function atlasStoreAuth(value) {
    atlasAuth = value;
    try {
      if (value) localStorage.setItem(ATLAS_AUTH_KEY, JSON.stringify(value));
      else localStorage.removeItem(ATLAS_AUTH_KEY);
    } catch { /* The account stays usable until refresh; show the real state in the UI. */ }
    atlasUpdateAccountUI();
  }

  function atlasProgressSnapshot() {
    return {
      completed: Array.isArray(state.completed) ? [...new Set(state.completed.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 27))].sort((a,b)=>a-b) : [],
      notes: state.notes && typeof state.notes === 'object' ? {...state.notes} : {},
      notesVisible: state.notesVisible !== false
    };
  }

  function atlasCleanProgress(input) {
    const source = input && typeof input === 'object' ? input : {};
    const completed = [...new Set((Array.isArray(source.completed) ? source.completed : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 27))].sort((a,b)=>a-b);
    const notes = {};
    if (source.notes && typeof source.notes === 'object' && !Array.isArray(source.notes)) {
      for (const [key, value] of Object.entries(source.notes)) {
        if (/^(?:[1-9]|1\d|2[0-7])$/.test(key) && typeof value === 'string' && value.trim()) notes[key] = value.slice(0,5000);
      }
    }
    return {completed, notes, notesVisible: source.notesVisible !== false};
  }

  function atlasHasLocalData(p) {
    return !!((p.completed || []).length || Object.values(p.notes || {}).some(value => String(value).trim()) || p.notesVisible === false);
  }

  function atlasStable(p) {
    const clean = atlasCleanProgress(p);
    const notes = Object.fromEntries(Object.entries(clean.notes).sort(([a],[b]) => Number(a)-Number(b)));
    return JSON.stringify({completed: clean.completed, notes, notesVisible: clean.notesVisible});
  }

  // First sign-in migration: never discard completed achievements or non-empty notes.
  function atlasInitialMerge(local, remote) {
    const l = atlasCleanProgress(local), r = atlasCleanProgress(remote);
    return atlasCleanProgress({
      completed: [...new Set([...r.completed, ...l.completed])],
      notes: {...r.notes, ...l.notes},
      notesVisible: atlasHasLocalData(l) ? l.notesVisible : r.notesVisible
    });
  }

  // Later syncs use the last shared snapshot as a base to reduce overwriting simultaneous edits.
  // When both devices edit the same note between syncs, the current device wins that conflict.
  function atlasThreeWayMerge(local, remote, base) {
    const l = atlasCleanProgress(local), r = atlasCleanProgress(remote), b = atlasCleanProgress(base || {completed:[],notes:{},notesVisible:true});
    const completed = [];
    for (let n = 1; n <= 27; n++) {
      const lv = l.completed.includes(n), rv = r.completed.includes(n), bv = b.completed.includes(n);
      const localChanged = lv !== bv, remoteChanged = rv !== bv;
      const chosen = localChanged ? lv : (remoteChanged ? rv : bv);
      if (chosen) completed.push(n);
    }
    const notes = {};
    const keys = new Set([...Object.keys(l.notes), ...Object.keys(r.notes), ...Object.keys(b.notes)]);
    for (const key of keys) {
      const lv = l.notes[key], rv = r.notes[key], bv = b.notes[key];
      const localChanged = lv !== bv, remoteChanged = rv !== bv;
      const chosen = localChanged ? lv : (remoteChanged ? rv : (lv !== undefined ? lv : bv));
      if (typeof chosen === 'string' && chosen.trim()) notes[key] = chosen;
    }
    const localVisibilityChanged = l.notesVisible !== b.notesVisible;
    const remoteVisibilityChanged = r.notesVisible !== b.notesVisible;
    return atlasCleanProgress({completed, notes, notesVisible: localVisibilityChanged ? l.notesVisible : (remoteVisibilityChanged ? r.notesVisible : b.notesVisible)});
  }

  async function atlasRequest(path, {method='GET', body, token} = {}) {
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${ATLAS_API_BASE}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit'
      });
    } catch {
      throw new Error('Nie można połączyć się z API. Sprawdź internet i spróbuj ponownie.');
    }
    let data = {};
    try { data = await response.json(); } catch { /* handled by HTTP status below */ }
    if (!response.ok) {
      const err = new Error(data.error || `Błąd serwera (${response.status}).`);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function atlasSetStatus(text, mode='local') {
    const label = atlas$('#atlasCloudStatus');
    if (!label) return;
    label.textContent = text;
    label.dataset.mode = mode;
    label.title = text;
  }

  function atlasUpdateAccountUI() {
    const button = atlas$('#atlasAccountButton');
    const label = atlas$('#atlasAccountButtonLabel');
    const summary = atlas$('#atlasLoggedAccount');
    if (button && label) {
      label.textContent = atlasAuth ? 'Konto' : 'Zaloguj';
      button.title = atlasAuth ? `Konto ${atlasAuth.accountId} — otwórz ustawienia konta` : 'Zaloguj się lub utwórz konto';
      button.classList.toggle('is-signed-in', !!atlasAuth);
      button.setAttribute('aria-label', button.title);
    }
    if (summary) summary.textContent = atlasAuth ? atlasAuth.accountId : '';
    const logged = !!atlasAuth;
    if (atlas$('#atlasAccountForms')) atlas$('#atlasAccountForms').hidden = logged;
    if (atlas$('#atlasLoggedView')) atlas$('#atlasLoggedView').hidden = !logged;
    if (logged && !atlasRecoveryPending) atlasSetStatus('Konto: ' + atlasAuth.accountId, 'cloud');
    if (!logged) atlasSetStatus('Tylko ta przeglądarka', 'local');
  }

  function atlasBuildUI() {
    if (atlas$('#atlasAccountOverlay')) return;
    const topRight = document.querySelector('.topbar .top-right');
    if (topRight) {
      topRight.insertAdjacentHTML('afterbegin', `<button class="pill-btn atlas-account-trigger" id="atlasAccountButton" type="button" title="Zaloguj się lub utwórz konto" aria-label="Zaloguj się lub utwórz konto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="btn-label" id="atlasAccountButtonLabel">Zaloguj</span></button>`);
    }
    document.body.insertAdjacentHTML('beforeend', `
      <div class="atlas-account-overlay" id="atlasAccountOverlay" aria-hidden="true">
        <button class="atlas-account-backdrop" id="atlasAccountBackdrop" type="button" aria-label="Zamknij okno konta"></button>
        <section class="atlas-account-dialog" role="dialog" aria-modal="true" aria-labelledby="atlasAccountTitle">
          <header class="atlas-account-head">
            <div><div class="atlas-account-eyebrow">ACHIEVEMENT ATLAS / CLOUD SYNC</div><h2 id="atlasAccountTitle">Twoje konto</h2><p>Ten sam postęp na komputerze i iPhonie.</p></div>
            <button class="icon-btn" id="atlasAccountClose" type="button" aria-label="Zamknij"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="atlas-account-content">
            <div class="atlas-account-forms" id="atlasAccountForms">
              <div class="atlas-account-tabs" role="tablist" aria-label="Opcje konta">
                <button type="button" data-atlas-mode="login" class="active">Logowanie</button>
                <button type="button" data-atlas-mode="register">Rejestracja</button>
                <button type="button" data-atlas-mode="recover">Odzyskaj</button>
              </div>
              <form id="atlasLoginForm" class="atlas-account-form">
                <label>Identyfikator konta<input id="atlasLoginId" name="accountId" autocomplete="username" placeholder="NMS-ABCD-EFGH-JKLM" required spellcheck="false"></label>
                <label>Hasło<input id="atlasLoginPassword" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label>
                <button class="atlas-primary-button" type="submit">Zaloguj się <span aria-hidden="true">↗</span></button>
                <p class="atlas-account-footnote">Nie masz konta? Utwórz je w zakładce Rejestracja.</p>
              </form>
              <form id="atlasRegisterForm" class="atlas-account-form" hidden>
                <div class="atlas-account-callout">Podczas rejestracji obecne osiągnięcia i notatki z tej przeglądarki zostaną przeniesione na konto.</div>
                <label>Nowe hasło<input id="atlasRegisterPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><small>Minimum 10 znaków.</small></label>
                <label>Powtórz hasło<input id="atlasRegisterPassword2" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
                <button class="atlas-primary-button" type="submit">Utwórz konto <span aria-hidden="true">✦</span></button>
              </form>
              <form id="atlasRecoverForm" class="atlas-account-form" hidden>
                <div class="atlas-account-callout">Użyj identyfikatora i kodu odzyskiwania otrzymanego podczas rejestracji. Po zmianie hasła otrzymasz nowy kod odzyskiwania.</div>
                <label>Identyfikator konta<input id="atlasRecoverId" autocomplete="username" placeholder="NMS-ABCD-EFGH-JKLM" required spellcheck="false"></label>
                <label>Kod odzyskiwania<input id="atlasRecoverCode" autocomplete="off" placeholder="NMS-REC-…" required spellcheck="false"></label>
                <label>Nowe hasło<input id="atlasRecoverPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
                <label>Powtórz nowe hasło<input id="atlasRecoverPassword2" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
                <button class="atlas-primary-button" type="submit">Zmień hasło i zaloguj</button>
              </form>
            </div>
            <div class="atlas-logged-view" id="atlasLoggedView" hidden>
              <div class="atlas-account-callout success"><span class="atlas-online-dot"></span> Zalogowano. Zmiany są synchronizowane z chmurą.</div>
              <div class="atlas-account-idbox"><span>IDENTYFIKATOR KONTA</span><strong id="atlasLoggedAccount">NMS-…</strong><button type="button" class="atlas-secondary-button" data-atlas-copy-account>Kopiuj ID</button></div>
              <div class="atlas-cloud-state"><span class="atlas-cloud-pulse"></span><span id="atlasCloudStatus" data-mode="cloud">Sprawdzanie synchronizacji…</span></div>
              <button class="atlas-primary-button" type="button" id="atlasSyncNow">Synchronizuj teraz <span aria-hidden="true">↻</span></button>
              <button class="atlas-secondary-button atlas-logout-button" type="button" id="atlasLogout">Wyloguj się</button>
              <p class="atlas-account-footnote">Wylogowanie nie usuwa lokalnego zapisu z tego urządzenia. Zachowaj kod odzyskiwania poza przeglądarką.</p>
            </div>
            <div class="atlas-recovery-panel" id="atlasRecoveryPanel" hidden>
              <div class="atlas-recovery-icon">✦</div><h3>Zapisz kod odzyskiwania</h3>
              <p>Kod jest wyświetlany tylko teraz. Zachowaj go w menedżerze haseł lub innym bezpiecznym miejscu. Utrata hasła i kodu oznacza brak możliwości odzyskania konta.</p>
              <label>Twój identyfikator<div class="atlas-code-row"><code id="atlasNewAccountCode"></code><button type="button" class="atlas-secondary-button" data-copy-element="atlasNewAccountCode">Kopiuj</button></div></label>
              <label>Kod odzyskiwania<div class="atlas-code-row"><code id="atlasNewRecoveryCode"></code><button type="button" class="atlas-secondary-button" data-copy-element="atlasNewRecoveryCode">Kopiuj</button></div></label>
              <button class="atlas-primary-button" type="button" id="atlasRecoveryAcknowledged">Zapisałem kod — kontynuuj</button>
            </div>
            <div class="atlas-account-message" id="atlasAccountMessage" role="status" aria-live="polite" hidden></div>
            <div class="atlas-account-local-note">Bez logowania postęp nadal działa lokalnie. Konto włącza synchronizację między urządzeniami.</div>
          </div>
        </section>
      </div>`);

    atlas$('#atlasAccountButton')?.addEventListener('click', atlasOpenAccount);
    atlas$('#atlasAccountClose')?.addEventListener('click', atlasCloseAccount);
    atlas$('#atlasAccountBackdrop')?.addEventListener('click', atlasCloseAccount);
    atlas$$('[data-atlas-mode]').forEach(button => button.addEventListener('click', () => atlasSetMode(button.dataset.atlasMode)));
    atlas$('#atlasLoginForm')?.addEventListener('submit', atlasLoginSubmit);
    atlas$('#atlasRegisterForm')?.addEventListener('submit', atlasRegisterSubmit);
    atlas$('#atlasRecoverForm')?.addEventListener('submit', atlasRecoverSubmit);
    atlas$('#atlasLogout')?.addEventListener('click', atlasLogout);
    atlas$('#atlasSyncNow')?.addEventListener('click', () => atlasSyncNow(true));
    atlas$('#atlasRecoveryAcknowledged')?.addEventListener('click', () => {
      atlasRecoveryPending = false;
      atlas$('#atlasRecoveryPanel').hidden = true;
      atlasUpdateAccountUI();
      atlasSetStatus('Kod zapisany · synchronizacja aktywna', 'cloud');
      atlasShowMessage('Konto gotowe. Możesz zalogować się na nim na innym urządzeniu.', 'success');
    });
    atlas$$('[data-atlas-copy-account]').forEach(button => button.addEventListener('click', () => atlasCopyText(atlasAuth?.accountId || '')));
    atlas$$('[data-copy-element]').forEach(button => button.addEventListener('click', () => atlasCopyText(atlas$('#'+button.dataset.copyElement)?.textContent || '')));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && atlas$('#atlasAccountOverlay')?.classList.contains('open')) atlasCloseAccount();
    });
    window.addEventListener('online', () => { if (atlasAuth) atlasSyncNow(false); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && atlasAuth) atlasSyncNow(false);
    });

    // Hook the original local save; keep local-first behavior and queue a cloud sync when signed in.
    const atlasOriginalSaveState = saveState;
    saveState = function(...args) {
      atlasOriginalSaveState.apply(this, args);
      atlasQueueCloudSave();
    };
    atlasUpdateAccountUI();
    if (atlasAuth) atlasRestoreSession();
  }

  function atlas$$(selector, root = document) { return [...root.querySelectorAll(selector)]; }

  function atlasOpenAccount() {
    const layer = atlas$('#atlasAccountOverlay');
    if (!layer) return;
    layer.classList.add('open'); layer.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden';
    atlasClearMessage();
    if (atlasAuth) atlasUpdateAccountUI();
    else atlasSetMode('login');
  }

  function atlasCloseAccount() {
    if (atlasRecoveryPending) {
      atlasShowMessage('Najpierw skopiuj identyfikator i kod odzyskiwania. Ten kod nie będzie ponownie wyświetlony.', 'error');
      return;
    }
    const layer = atlas$('#atlasAccountOverlay');
    if (!layer) return;
    layer.classList.remove('open'); layer.setAttribute('aria-hidden','true');
    const otherOpen = ['drawer','achievementModal','modal'].some(id => atlas$('#'+id)?.classList.contains('open'));
    document.body.style.overflow = otherOpen ? 'hidden' : '';
  }

  function atlasSetMode(mode) {
    if (atlasAuth) return;
    atlasCurrentMode = mode;
    atlasRecoveryPending = false;
    atlas$('#atlasRecoveryPanel').hidden = true;
    atlas$('#atlasAccountForms').hidden = false;
    atlas$('#atlasLoggedView').hidden = true;
    const forms = {login: 'atlasLoginForm', register: 'atlasRegisterForm', recover: 'atlasRecoverForm'};
    for (const [key,id] of Object.entries(forms)) atlas$('#'+id).hidden = key !== mode;
    atlas$$('[data-atlas-mode]').forEach(button => button.classList.toggle('active', button.dataset.atlasMode === mode));
    atlasClearMessage();
  }

  function atlasShowMessage(message, type='info') {
    const node = atlas$('#atlasAccountMessage');
    if (!node) return;
    node.hidden = false; node.className = `atlas-account-message ${type}`; node.textContent = message;
  }
  function atlasClearMessage() { const node = atlas$('#atlasAccountMessage'); if (node) { node.hidden = true; node.textContent = ''; node.className = 'atlas-account-message'; } }

  function atlasBusy(form, busy, buttonText) {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) { button.dataset.originalHtml = button.innerHTML; button.disabled = true; button.textContent = buttonText || 'Chwila…'; }
    else { button.disabled = false; if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml; }
  }

  async function atlasLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget; atlasBusy(form,true,'Logowanie…'); atlasClearMessage();
    try {
      const accountId = atlas$('#atlasLoginId').value.trim().toUpperCase();
      const password = atlas$('#atlasLoginPassword').value;
      const data = await atlasRequest('/api/login',{method:'POST',body:{accountId,password}});
      atlasStoreAuth({accountId:data.accountId,token:data.token,expiresAt:data.expiresAt});
      const local = atlasProgressSnapshot(), remote = atlasCleanProgress(data.progress || {});
      const merged = atlasInitialMerge(local, remote);
      atlasSuspendSync = true;
      atlasApplyProgress(merged);
      atlasSuspendSync = false;
      if (atlasStable(merged) !== atlasStable(remote)) {
        const written = await atlasRequest('/api/progress',{method:'PUT',token:atlasAuth.token,body:{progress:merged}});
        atlasBaseline = atlasCleanProgress(written.progress || merged);
      } else atlasBaseline = remote;
      atlas$('#atlasLoginPassword').value = '';
      atlasUpdateAccountUI(); atlasSetStatus('Zsynchronizowano', 'cloud');
      atlasShowMessage('Zalogowano. Postęp z tego urządzenia połączono z postępem konta.', 'success');
    } catch (err) {
      atlasSuspendSync = false;
      atlasShowMessage(err.message || 'Nie udało się zalogować.', 'error');
    } finally { atlasBusy(form,false); }
  }

  async function atlasRegisterSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget; atlasBusy(form,true,'Tworzenie konta…'); atlasClearMessage();
    const password = atlas$('#atlasRegisterPassword').value;
    if (password !== atlas$('#atlasRegisterPassword2').value) {
      atlasBusy(form,false); atlasShowMessage('Hasła nie są identyczne.', 'error'); return;
    }
    if (password.length < 10 || password.length > 128) {
      atlasBusy(form,false); atlasShowMessage('Hasło musi mieć od 10 do 128 znaków.', 'error'); return;
    }
    try {
      const local = atlasProgressSnapshot();
      const data = await atlasRequest('/api/register',{method:'POST',body:{password,progress:local}});
      atlasStoreAuth({accountId:data.accountId,token:data.token,expiresAt:data.expiresAt});
      atlasBaseline = atlasCleanProgress(data.progress || local);
      atlas$('#atlasRegisterPassword').value = ''; atlas$('#atlasRegisterPassword2').value = '';
      atlasShowRecovery(data.accountId,data.recoveryCode,'Konto utworzone. Zapisz poniższy identyfikator i kod odzyskiwania.');
    } catch (err) { atlasShowMessage(err.message || 'Nie udało się utworzyć konta.', 'error'); }
    finally { atlasBusy(form,false); }
  }

  async function atlasRecoverSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget; atlasBusy(form,true,'Odzyskiwanie…'); atlasClearMessage();
    const newPassword = atlas$('#atlasRecoverPassword').value;
    if (newPassword !== atlas$('#atlasRecoverPassword2').value) {
      atlasBusy(form,false); atlasShowMessage('Nowe hasła nie są identyczne.', 'error'); return;
    }
    try {
      const data = await atlasRequest('/api/recover',{method:'POST',body:{
        accountId:atlas$('#atlasRecoverId').value.trim().toUpperCase(),
        recoveryCode:atlas$('#atlasRecoverCode').value.trim().toUpperCase(),
        newPassword
      }});
      atlasStoreAuth({accountId:data.accountId,token:data.token,expiresAt:data.expiresAt});
      const local = atlasProgressSnapshot(), remote = atlasCleanProgress(data.progress || {});
      const merged = atlasInitialMerge(local,remote);
      atlasSuspendSync = true; atlasApplyProgress(merged); atlasSuspendSync = false;
      if (atlasStable(merged) !== atlasStable(remote)) {
        const written = await atlasRequest('/api/progress',{method:'PUT',token:atlasAuth.token,body:{progress:merged}});
        atlasBaseline = atlasCleanProgress(written.progress || merged);
      } else atlasBaseline = remote;
      atlas$('#atlasRecoverPassword').value = ''; atlas$('#atlasRecoverPassword2').value = ''; atlas$('#atlasRecoverCode').value = '';
      atlasShowRecovery(data.accountId,data.recoveryCode,'Dostęp odzyskany. Poprzedni kod odzyskiwania jest już nieważny — zapisz nowy.');
    } catch (err) { atlasShowMessage(err.message || 'Nie udało się odzyskać konta.', 'error'); }
    finally { atlasBusy(form,false); }
  }

  function atlasShowRecovery(accountId,recoveryCode,intro) {
    atlasRecoveryPending = true;
    atlas$('#atlasAccountForms').hidden = true;
    atlas$('#atlasLoggedView').hidden = true;
    atlas$('#atlasRecoveryPanel').hidden = false;
    atlas$('#atlasNewAccountCode').textContent = accountId || '';
    atlas$('#atlasNewRecoveryCode').textContent = recoveryCode || '';
    atlasShowMessage(intro,'success');
    atlasSetStatus('Zapisz kod odzyskiwania', 'pending');
  }

  async function atlasCopyText(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (typeof showToast === 'function') showToast('Skopiowano do schowka ✦');
      else atlasShowMessage('Skopiowano do schowka.','success');
    } catch {
      window.prompt('Skopiuj poniższy tekst:',value);
    }
  }

  function atlasApplyProgress(progress) {
    state = {...DEFAULT_STATE,...atlasCleanProgress(progress)};
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* local save warning remains handled by saveState */ }
    renderList(true); updateStats(); setNotesVisible(state.notesVisible,false);
  }

  async function atlasRestoreSession() {
    if (!atlasAuth) return;
    try {
      await atlasRequest('/api/me',{token:atlasAuth.token});
      const local = atlasProgressSnapshot();
      const payload = await atlasRequest('/api/progress',{token:atlasAuth.token});
      const remote = atlasCleanProgress(payload.progress || {});
      const merged = atlasBaseline ? atlasThreeWayMerge(local,remote,atlasBaseline) : atlasInitialMerge(local,remote);
      atlasSuspendSync = true; atlasApplyProgress(merged); atlasSuspendSync = false;
      if (atlasStable(merged) !== atlasStable(remote)) {
        const written = await atlasRequest('/api/progress',{method:'PUT',token:atlasAuth.token,body:{progress:merged}});
        atlasBaseline = atlasCleanProgress(written.progress || merged);
      } else atlasBaseline = remote;
      atlasSetStatus('Zsynchronizowano', 'cloud'); atlasUpdateAccountUI();
    } catch (err) {
      atlasSuspendSync = false;
      if (err.status === 401) {
        atlasStoreAuth(null); atlasBaseline = null;
        atlasSetStatus('Sesja wygasła — zaloguj ponownie', 'error');
      } else {
        atlasSetStatus('Offline — zapis lokalny', 'offline');
      }
    }
  }

  function atlasQueueCloudSave() {
    if (!atlasAuth || atlasSuspendSync) return;
    if (atlasSyncBusy) { atlasSyncAgain = true; return; }
    atlasSetStatus(navigator.onLine ? 'Oczekuje na synchronizację…' : 'Offline — zapis lokalny', navigator.onLine ? 'pending' : 'offline');
    clearTimeout(atlasSyncTimer);
    atlasSyncTimer = setTimeout(() => atlasSyncNow(false), 850);
  }

  async function atlasSyncNow(manual=false) {
    if (!atlasAuth || atlasSuspendSync) {
      if (manual) atlasShowMessage('Najpierw zaloguj się na konto.','error');
      return;
    }
    if (atlasSyncBusy) { atlasSyncAgain = true; return; }
    if (!navigator.onLine) {
      atlasSetStatus('Offline — zapis lokalny', 'offline');
      if (manual) atlasShowMessage('Brak połączenia. Zmiany pozostają na tym urządzeniu i spróbują zsynchronizować się po powrocie internetu.','error');
      return;
    }
    atlasSyncBusy = true;
    if (manual) atlasSetStatus('Synchronizowanie…','pending');
    try {
      const local = atlasProgressSnapshot();
      const payload = await atlasRequest('/api/progress',{token:atlasAuth.token});
      const remote = atlasCleanProgress(payload.progress || {});
      const merged = atlasBaseline ? atlasThreeWayMerge(local,remote,atlasBaseline) : atlasInitialMerge(local,remote);
      atlasSuspendSync = true;
      if (atlasStable(merged) !== atlasStable(local)) atlasApplyProgress(merged);
      atlasSuspendSync = false;
      if (atlasStable(merged) !== atlasStable(remote)) {
        const written = await atlasRequest('/api/progress',{method:'PUT',token:atlasAuth.token,body:{progress:merged}});
        atlasBaseline = atlasCleanProgress(written.progress || merged);
      } else atlasBaseline = remote;
      atlasSetStatus('Zsynchronizowano', 'cloud');
      if (manual) atlasShowMessage('Postęp i notatki są zsynchronizowane.','success');
    } catch (err) {
      atlasSuspendSync = false;
      if (err.status === 401) {
        atlasStoreAuth(null); atlasBaseline = null;
        atlasSetStatus('Sesja wygasła — zaloguj ponownie', 'error');
        if (manual) atlasShowMessage('Sesja wygasła. Zaloguj się ponownie; lokalne dane są zachowane.','error');
      } else {
        atlasSetStatus('Błąd synchronizacji — zapis lokalny', 'error');
        if (manual) atlasShowMessage(err.message || 'Nie udało się zsynchronizować postępu. Dane lokalne pozostały zachowane.','error');
      }
    } finally {
      atlasSyncBusy = false;
      if (atlasSyncAgain) { atlasSyncAgain = false; atlasQueueCloudSave(); }
    }
  }

  async function atlasLogout() {
    const previous = atlasAuth;
    atlasStoreAuth(null); atlasBaseline = null; atlasSuspendSync = true;
    atlasSetStatus('Tylko ta przeglądarka','local');
    try { if (previous) await atlasRequest('/api/logout',{method:'POST',token:previous.token}); } catch { /* local logout still clears the token */ }
    atlasSuspendSync = false;
    atlasSetMode('login'); atlasUpdateAccountUI();
    atlasShowMessage('Wylogowano. Ten zapis pozostaje na tym urządzeniu.','success');
  }

  atlasBuildUI();
})();
