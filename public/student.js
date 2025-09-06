(() => {
  const $ = (sel) => document.querySelector(sel);
  const groupsEl = $('#groups');
  const statsEl = $('#stats');
  const joinForm = $('#joinForm');
  const nameInput = $('#name');
  const joinBtn = $('#joinBtn');
  const leaveBtn = $('#leaveBtn');
  const myGroup = $('#myGroup');

  // Persist name locally for convenience and status detection
  const savedName = localStorage.getItem('gp:name') || '';
  if (savedName) nameInput.value = savedName;

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateMyGroupFromState(state) {
    const name = (nameInput.value || '').trim();
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
    const myName = (nameInput.value || '').trim();
    const lowerMy = myName.toLowerCase();
    groupsEl.innerHTML = groups
      .map(g => {
        const capText = `(${g.members.length}/${g.capacity})`;
        const remaining = g.capacity - g.members.length;
        const isMine = myName && g.members.some(n => n.toLowerCase() === lowerMy);
        const members = g.members.map(n => `<div class="member">${escapeHTML(n)}</div>`).join('');
        const btnLabel = isMine ? '已加入' : (remaining > 0 ? `加入第 ${g.id} 组` : '已满');
        const disabled = isMine || remaining <= 0 ? 'disabled' : '';
        return `
          <div class="group">
            <h3>第 ${g.id} 组 <span class="cap">${capText}</span></h3>
            ${members}
            <div class="actions-row">
              <button class="secondary" data-join="${g.id}" ${disabled}>${btnLabel}</button>
            </div>
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

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    joinBtn.disabled = true;
    leaveBtn.disabled = true;
    try {
      const res = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem('gp:name', name);
        myGroup.classList.remove('hidden');
        myGroup.innerHTML = `已加入 <strong>第 ${data.groupId} 组</strong>`;
      } else {
        alert(data.error || '加入失败');
      }
    } catch (e) {
      alert('网络错误');
    } finally {
      joinBtn.disabled = false;
      leaveBtn.disabled = false;
    }
  });

  // Join a specific group via inline buttons
  groupsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    const groupId = Number(btn.getAttribute('data-join'));
    const name = nameInput.value.trim();
    if (!name) {
      alert('请先填写姓名');
      nameInput.focus();
      return;
    }
    joinBtn.disabled = true;
    leaveBtn.disabled = true;
    btn.disabled = true;
    try {
      const res = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupId }),
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
      joinBtn.disabled = false;
      leaveBtn.disabled = false;
    }
  });

  leaveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return alert('请先填写姓名');
    joinBtn.disabled = true;
    leaveBtn.disabled = true;
    try {
      const res = await fetch('/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
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
      joinBtn.disabled = false;
      leaveBtn.disabled = false;
    }
  });
})();

