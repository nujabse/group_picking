(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const qrcodeEl = $('#qrcode');
  const pageUrlEl = $('#pageUrl');
  const groupsEl = $('#groups');
  const statsEl = $('#stats');
  const joinForm = $('#joinForm');
  const nameInput = $('#name');
  const myGroup = $('#myGroup');
  const resetBtn = $('#resetBtn');

  // Teacher view should share the student URL (no QR on student page)
  const studentUrl = window.location.origin + '/join';
  pageUrlEl.textContent = studentUrl;

  // Render QR code for current page URL
  try {
    // qrcode.js will write into the element
    new QRCode(qrcodeEl, {
      text: studentUrl,
      width: 256,
      height: 256,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    qrcodeEl.innerHTML = '<div class="muted">无法生成二维码</div>';
  }

  function render(state) {
    const { groups, counts } = state;
    statsEl.textContent = `已加入 ${counts.joined} / 44，剩余 ${counts.remaining}`;
    groupsEl.innerHTML = groups
      .map(g => {
        const capText = `(${g.members.length}/${g.capacity})`;
        const members = g.members.map(n => `<div class="member">${escapeHTML(n)}</div>`).join('');
        return `<div class="group"><h3>第 ${g.id} 组 <span class="cap">${capText}</span></h3>${members}</div>`;
      })
      .join('');
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    const btn = joinForm.querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        myGroup.classList.remove('hidden');
        const g = data.groupId;
        const tip = data.status === 'exists' ? '（已存在，直接返回）' : '';
        myGroup.innerHTML = `已加入 <strong>第 ${g} 组</strong> ${tip}`;
      } else {
        alert(data.error || '加入失败');
      }
    } catch (e) {
      alert('网络错误');
    } finally {
      btn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', async () => {
    const ok = confirm('确定要重置所有分组吗？此操作不可撤销。');
    if (!ok) return;
    const token = prompt('如需设置管理员口令，默认留空或输入 teacher：', 'teacher') || '';
    try {
      const res = await fetch('/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || '重置失败');
      } else {
        myGroup.classList.add('hidden');
        myGroup.textContent = '';
        nameInput.value = '';
      }
    } catch {}
  });
})();
