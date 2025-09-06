(() => {
  const $ = (sel) => document.querySelector(sel);
  const groupsEl = $('#groups');
  const statsEl = $('#stats');
  const nameInput = $('#name');
  const saveNameBtn = $('#saveNameBtn');
  const nameModal = $('#nameModal');
  const leaveBtn = $('#leaveBtn');
  const myGroup = $('#myGroup');
  const myNameEl = $('#myName');

  // Stable device ID for bind-once
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxx-xxxx-4xxx-yxxx-xxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  const deviceId = localStorage.getItem('gp:device') || (() => {
    const id = uuid();
    localStorage.setItem('gp:device', id);
    return id;
  })();

  // Persisted name: required before joining
  let savedName = localStorage.getItem('gp:name') || '';
  if (savedName) {
    myNameEl.textContent = `本机姓名：${savedName}`;
    nameModal.classList.add('hidden');
  } else {
    nameModal.classList.remove('hidden');
    nameInput && nameInput.focus();
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateMyGroupFromState(state) {
    const name = savedName.trim();
    if (!name) {
      myGroup.classList.add('hidden');
      myGroup.textContent = '';
      return;
    }
    let foundGroup = null;
    for (const g of state.groups) {
      if (g.members.some(n => n.toLowerCase() === name.toLowerCase())) {
        foundGroup = g.id; break;
      }
    }
    if (foundGroup) {
      myGroup.classList.remove('hidden');
      myGroup.innerHTML = `已加入 <strong>第 ${foundGroup} 组</strong>`;
    } else {
      myGroup.classList.add('hidden');
      myGroup.textContent = '';
    }
  }

  function render(state) {
    const { groups, counts } = state;
    statsEl.textContent = `已加入 ${counts.joined} / 44，剩余 ${counts.remaining}`;
    const myName = savedName.trim();
    const lowerMy = myName.toLowerCase();
    groupsEl.innerHTML = groups
      .map(g => {
        const capText = `(${g.members.length}/${g.capacity})`;
        const remaining = g.capacity - g.members.length;
        const isMine = myName && g.members.some(n => n.toLowerCase() === lowerMy);
        const members = g.members.map(n => `<div class="member">${escapeHTML(n)}</div>`).join('');
        const btnLabel = isMine ? '已加入' : (remaining > 0 ? `加入第 ${g.id} 组` : '已满');
        const disabled = (!myName) || isMine || remaining <= 0 ? 'disabled' : '';
        return `
          <div class="group${isMine ? ' current' : ''}">
            <div class="actions-row" style="margin:0 0 8px 0">
              <button class="join-btn" data-join="${g.id}" ${disabled}>${btnLabel}<span class="badge">剩余 ${remaining}</span></button>
            </div>
            <h3>第 ${g.id} 组 <span class="cap">${capText}</span></h3>
            ${members}
          </div>`;
      })
      .join('');
    updateMyGroupFromState(state);
  }

  // Load initial state
  fetch('/state').then(r => r.json()).then(render).catch(() => {});

  // Subscribe to live updates
  try {
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      try { render(JSON.parse(ev.data)); } catch {}
    };
  } catch {}

  // Save name once via modal
  saveNameBtn.addEventListener('click', () => {
    const name = (nameInput && nameInput.value || '').trim();
    if (!name) {
      nameInput && nameInput.focus();
      return;
    }
    savedName = name;
    localStorage.setItem('gp:name', name);
    myNameEl.textContent = `本机姓名：${name}`;
    nameModal.classList.add('hidden');
    // Rerender to enable buttons
    fetch('/state').then(r => r.json()).then(render).catch(() => {});
  });

  // Join a specific group via inline buttons
  groupsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    const groupId = Number(btn.getAttribute('data-join'));
    const name = (localStorage.getItem('gp:name') || '').trim();
    if (!name) {
      nameModal.classList.remove('hidden');
      nameInput && nameInput.focus();
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupId, deviceId }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem('gp:name', name);
        myGroup.classList.remove('hidden');
        myGroup.innerHTML = `已加入 <strong>第 ${data.groupId} 组</strong>`;
      } else {
        alert(data.error || '加入失败');
      }
    } catch (err) {
      alert('网络错误');
    } finally {
      btn.disabled = false;
    }
  });

  leaveBtn.addEventListener('click', async () => {
    const name = (localStorage.getItem('gp:name') || '').trim();
    if (!name) return alert('请先填写姓名');
    leaveBtn.disabled = true;
    try {
      const res = await fetch('/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, deviceId }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || '撤销失败');
      } else {
        myGroup.classList.add('hidden');
        myGroup.textContent = '';
      }
    } catch (e) {
      alert('网络错误');
    } finally {
      leaveBtn.disabled = false;
    }
  });
})();
