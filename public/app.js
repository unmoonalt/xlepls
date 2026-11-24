const $ = s => document.querySelector(s);
const fmt = n => Number(n).toFixed(2) + ' ₽';
let me = null;

async function api(path, opts={}) {
  const res = await fetch('/api' + path, {
    headers: {'Content-Type':'application/json'}, credentials: 'same-origin', ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

async function ensureAuth() {
  try { me = await api('/me'); } 
  catch { 
    const login = 'player_' + Math.floor(Math.random()*99999);
    const r = await api('/register', { method:'POST', body:{ login, password:'123' }}); // Если регистрация отключена, сделаем авто-логин админа
    me = r.user; 
  }
  renderUserPanel(); refreshProfile();
}

function renderUserPanel() {
  $('#userPanel').innerHTML = `
    <div class="balance-chip">${fmt(me.balance)}</div>
    <button class="btn success" onclick="document.getElementById('depositModal').classList.add('active')">＋ Пополнить</button>
  `;
}

document.querySelectorAll('nav a').forEach(a => a.onclick = e => {
  e.preventDefault();
  document.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  document.querySelectorAll('main section').forEach(s => s.hidden = true);
  $('#page-' + a.dataset.page).hidden = false;
  if (a.dataset.page === 'upgrade') loadUpgradeOptions();
  if (a.dataset.page === 'profile') refreshProfile();
  if (a.dataset.page === 'leaders') loadLeaders();
});

async function loadCases() {
  const allCases = await api('/cases');
  $('#casesGrid').innerHTML = allCases.map(c => `
    <div class="case-card">
      <div class="icon">${c.icon.startsWith('http') ? `<img src="${c.icon}">` : c.icon}</div>
      <div>${c.name}</div>
      <div class="price">${fmt(c.price)}</div>
      <button class="btn primary" onclick="openCase(${c.id})">Открыть</button>
    </div>
  `).join('');
}

async function openCase(id) {
  try {
    const r = await api(`/cases/${id}/open`, { method:'POST' });
    me.balance = r.newBalance; renderUserPanel(); refreshProfile();

    const track = $('#rouletteTrack');
    let trackHTML = '';
    const rndItems = Array.from({length: 50}, () => r.allItems[Math.floor(Math.random() * r.allItems.length)]);
    rndItems[45] = r.win;

    rndItems.forEach(item => {
      const isImg = item.icon.startsWith('http');
      trackHTML += `<div class="roulette-item">
        <div class="icon">${isImg ? `<img src="${item.icon}">` : item.icon}</div>
        <div style="font-size:10px; overflow:hidden;">${item.name}</div>
      </div>`;
    });
    
    track.innerHTML = trackHTML;
    track.style.transition = 'none'; track.style.transform = 'translateX(0)';
    
    $('#caseAnimModal').classList.add('active');
    $('#caseAnimTitle').textContent = `Открываем кейс...`;
    $('#caseAnimBtn').style.display = 'none';

    setTimeout(() => {
      track.style.transition = 'transform 5s cubic-bezier(0.1, 0.7, 0.1, 1)';
      track.style.transform = `translateX(-${(45 * 120) + 60 - (track.parentElement.clientWidth / 2)}px)`;
    }, 100);

    setTimeout(() => {
      $('#caseAnimTitle').textContent = `🎉 Вы выиграли: ${r.win.name} (${fmt(r.win.price)})`;
      $('#caseAnimBtn').style.display = 'block';
    }, 5200);
  } catch(e) { alert(e.message); }
}

async function confirmDeposit() {
  const amount = Number($('#depositAmt').value);
  try {
    const r = await api('/deposit', { method:'POST', body:{ amount }});
    me.balance = r.newBalance; renderUserPanel(); refreshProfile();
    document.getElementById('depositModal').classList.remove('active');
  } catch(e) { alert(e.message); }
}

async function refreshProfile() {
  if (!me) return;
  $('#publicId').textContent = me.public_id;
  $('#balanceBig').textContent = fmt(me.balance);
  
  const inv = await api('/inventory');
  const eq = inv.find(i => i.equipped === 1);
  
  if (eq) {
    $('#equippedBox').style.display = 'block';
    $('#equippedContent').innerHTML = `
      <div style="font-size:30px;">${eq.icon.startsWith('http') ? `<img src="${eq.icon}" style="height:40px;">` : eq.icon}</div>
      <div><b>${eq.name}</b><br><span style="color:#4ade80; font-weight:bold;">Множитель: x${eq.multiplier}</span></div>
    `;
  } else { $('#equippedBox').style.display = 'none'; }

  $('#invGrid').innerHTML = inv.length ? inv.map(i => `
    <div class="inv-card" style="${i.equipped ? 'border-color:#4ade80;' : ''}">
      <div style="height: 60px; display: flex; align-items: center; justify-content: center;">
        ${i.icon.startsWith('http') ? `<img src="${i.icon}">` : i.icon}
      </div>
      <div style="font-size:14px; margin-top:5px;">${i.name}</div>
      <div style="color:#4ade80; font-size:12px;">${fmt(i.price)} ${i.multiplier > 1 ? `<span style="color:#fbbf24">(x${i.multiplier})</span>` : ''}</div>
      <button onclick="sellItem(${i.id})" style="background:#ef4444; color:#fff;">Продать</button>
      <button onclick="toggleEquip(${i.id})" style="background:${i.equipped ? '#4ade80' : '#2a2a4a'}; color:${i.equipped ? '#000' : '#fff'};">${i.equipped ? 'Снять' : 'Экипировать'}</button>
    </div>`).join('') : '<p style="color:#aaa">Пусто</p>';
}

async function toggleEquip(id) { await api(`/inventory/${id}/equip`, { method:'POST' }); refreshProfile(); }
async function sellItem(id) { 
  const r = await api(`/inventory/${id}/sell`, { method:'POST' }); 
  me.balance = r.newBalance; renderUserPanel(); refreshProfile(); 
  alert(`Продано за ${fmt(r.earned)}`); 
}

async function loadUpgradeOptions() {
  const inv = await api('/inventory');
  const cases = await api('/cases');
  const targets = cases.flatMap(c => c.items);

  $('#upgradeFrom').innerHTML = inv.map(i => `<option value="${i.id}" data-price="${i.price}">${i.name} — ${fmt(i.price)}</option>`).join('') || '<option disabled>Нет предметов</option>';
  $('#upgradeTo').innerHTML = targets.map(t => `<option value="${t.id}" data-price="${t.price}">${t.name} — ${fmt(t.price)}</option>`).join('');

  $('#upgradeFrom').onchange = updateChance; $('#upgradeTo').onchange = updateChance; updateChance();
}

function updateChance() {
  const from = $('#upgradeFrom').selectedOptions[0]; const to = $('#upgradeTo').selectedOptions[0];
  if (!from || !to) return;
  const fp = Number(from.dataset.price) || 0; const tp = Number(to.dataset.price) || 0;
  if (tp <= fp) { $('#upgradeChance').textContent = 'Шанс: 0% (цель дешевле)'; return; }
  $('#upgradeChance').textContent = 'Шанс: ' + Math.min(90, (fp/tp)*100).toFixed(1) + '%';
}

async function doUpgrade() {
  const invId = Number($('#upgradeFrom').value); const targetId = Number($('#upgradeTo').value);
  if (!invId || !targetId) return alert('Выберите предметы');
  try {
    const r = await api('/upgrade', { method:'POST', body:{ inventory_id: invId, target_case_item_id: targetId }});
    $('#upgIcon').innerHTML = r.target.icon.startsWith('http') ? `<img src="${r.target.icon}" style="max-height: 60px;">` : r.target.icon;
    $('#upgResult').textContent = ''; $('#upgProgress').style.width = '0%'; $('#upgProgress').style.background = '#ff6b35'; $('#upgBtn').style.display = 'none';
    $('#upgradeAnimModal').classList.add('active');

    setTimeout(() => {
      $('#upgProgress').style.width = Math.round(r.chance * 100) + '%';
      setTimeout(() => {
        if (r.success) {
          $('#upgProgress').style.width = '100%'; $('#upgProgress').style.background = '#4ade80';
          $('#upgResult').textContent = '🎉 УСПЕХ!'; $('#upgResult').style.color = '#4ade80';
        } else {
          $('#upgProgress').style.background = '#ef4444'; $('#upgResult').textContent = '😢 НЕУДАЧА'; $('#upgResult').style.color = '#ef4444';
        }
        $('#upgBtn').style.display = 'block';
      }, 1500);
    }, 100);
  } catch(e) { alert(e.message); }
}

async function loadLeaders() {
  const data = await api('/leaderboard');
  $('#leaderMoney').innerHTML = data.topMoney.map((u, i) => `
    <div class="leader-row ${i < 3 ? 'top-' + (i+1) : ''}">
      <div>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 + '.'} ${u.login}</div>
      <div class="leader-val">${fmt(u.balance)}</div>
    </div>`).join('');
  $('#leaderDrops').innerHTML = data.topDrops.map((u, i) => `
    <div class="leader-row ${i < 3 ? 'top-' + (i+1) : ''}">
      <div>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 + '.'} ${u.login}</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span>${u.best_drop_icon.startsWith('http') ? `<img src="${u.best_drop_icon}" width="30">` : u.best_drop_icon}</span>
        <span class="leader-val" style="color:#ff6b35">${fmt(u.best_drop_price)}</span>
      </div>
    </div>`).join('');
}

(async () => { await ensureAuth(); await loadCases(); })();