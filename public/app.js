'use strict';
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const state = { user:null, page:'dashboard', data:{} };
const titles = {dashboard:'Visão geral',orders:'Ordens de serviço',clients:'Clientes',stock:'Estoque de peças',team:'Usuários e perfis',audit:'Trilha de auditoria'};
const statusLabel = {ABERTA:'Aberta',EM_DIAGNOSTICO:'Em diagnóstico',AGUARDANDO_APROVACAO:'Aguardando aprovação',EM_EXECUCAO:'Em execução',CONCLUIDA:'Concluída',CANCELADA:'Cancelada'};
const statusClass = {ABERTA:'status-open',EM_DIAGNOSTICO:'status-diagnosis',AGUARDANDO_APROVACAO:'status-wait',EM_EXECUCAO:'status-work',CONCLUIDA:'status-done',CANCELADA:'status-cancel'};
const roleLabel = {ADMIN:'Administrador',TECNICO:'Técnico',CONSULTA:'Consulta'};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = (v) => v ? new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
const currency = (v) => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
async function api(url, options={}) {
  const response = await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data = await response.json().catch(()=>({error:'Resposta inválida do servidor.'}));
  if (!response.ok) { const err = new Error(data.error || 'Falha na solicitação.'); err.status=response.status; throw err; }
  return data;
}
function toast(message, error=false) {
  const el=$('#toast'); el.textContent=message; el.className=`toast show${error?' error':''}`;
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className='toast',3200);
}
function showLogin() { $('#login-screen').classList.remove('hidden'); $('#app-shell').classList.add('hidden'); state.user=null; }
function showApp(user) {
  state.user=user; $('#login-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden');
  $('#user-name').textContent=user.name; $('#user-role').textContent=roleLabel[user.role]; $('#user-avatar').textContent=user.name.trim().charAt(0).toUpperCase(); $('#sidebar-user-name').textContent=user.name; $('#sidebar-user-role').textContent=roleLabel[user.role]; $('#sidebar-user-avatar').textContent=user.name.trim().charAt(0).toUpperCase();
  $$('.admin-only').forEach(el=>el.classList.toggle('hidden',user.role!=='ADMIN'));
  navigate('dashboard');
}
function statusBadge(status){return `<span class="status ${statusClass[status]||'status-open'}">${esc(statusLabel[status]||status)}</span>`;}
function pageHeader(title,desc,actions=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div><div class="heading-actions">${actions}</div></div>`;}
function panel(title,body,subtitle=''){return `<section class="panel"><div class="panel-head"><div><h3>${title}</h3>${subtitle?`<div class="panel-subtitle">${subtitle}</div>`:''}</div></div>${body}</section>`;}
async function navigate(page){
  if (!titles[page] || (['team','audit'].includes(page) && state.user?.role!=='ADMIN')) return;
  state.page=page; $('#page-title').textContent=state.user ? `Bem-vindo, ${state.user.name.trim().split(/\s+/)[0]}` : titles[page];
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  $('.sidebar').classList.remove('open'); $('#page-content').innerHTML='<div class="empty-state">Carregando dados...</div>';
  try {
    if(page==='dashboard') await renderDashboard();
    if(page==='orders') await renderOrders();
    if(page==='clients') await renderClients();
    if(page==='stock') await renderStock();
    if(page==='team') await renderTeam();
    if(page==='audit') await renderAudit();
  } catch(e){ $('#page-content').innerHTML=`<div class="panel"><div class="empty-state">${esc(e.message)}</div></div>`; if(e.status===401) showLogin(); }
  $('#page-content').focus({preventScroll:true});
}
async function renderDashboard(){
  const d=await api('/api/dashboard');
  const low=(await api('/api/parts')).parts.filter(p=>p.quantity<=p.min_quantity);
  const statusGroups=[
    ['Abertas','ABERTA'],['Diagnóstico','EM_DIAGNOSTICO'],['Aguardando','AGUARDANDO_APROVACAO'],
    ['Execução','EM_EXECUCAO'],['Concluídas','CONCLUIDA'],['Canceladas','CANCELADA']
  ];
  const distribution=statusGroups.map(([label,status])=>({label,count:d.recent.filter(o=>o.status===status).length}));
  const maxCount=Math.max(1,...distribution.map(x=>x.count));
  const bars=distribution.map(item=>{
    const level=item.count?Math.max(1,Math.ceil((item.count/maxCount)*6)):0;
    return `<div class="chart-column"><span class="chart-count">${item.count}</span><div class="chart-bar bar-level-${level}"></div><span class="chart-label">${item.label}</span></div>`;
  }).join('');
  const recent=d.recent.map(o=>`<tr><td><span class="primary-cell">${esc(o.code)}</span></td><td>${esc(o.client_name)}</td><td>${esc(o.device)}</td><td>${date(o.created_at)}</td><td>${statusBadge(o.status)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">Nenhuma ordem cadastrada.</td></tr>';
  const lowPreview=low.slice(0,2).map(p=>`<div class="stock-mini-item"><span>${esc(p.name)}</span><small>${p.quantity} un. · mínimo ${p.min_quantity}</small></div>`).join('');
  $('#page-content').innerHTML=`${pageHeader('Visão geral','Acompanhe os indicadores e os atendimentos da assistência.',`<button class="btn btn-primary" type="button" data-page="orders">＋ Nova ordem de serviço</button>`)}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Ordens abertas</div><div class="stat-value">${d.counts.open_orders||0}</div><div class="stat-foot">Aguardando andamento ou conclusão</div></div>
      <div class="stat-card green"><div class="stat-label">Em atendimento</div><div class="stat-value">${d.counts.in_progress||0}</div><div class="stat-foot">Serviços em execução</div></div>
      <div class="stat-card amber"><div class="stat-label">Estoque baixo</div><div class="stat-value">${d.lowStock||0}</div><div class="stat-foot">Itens no mínimo ou abaixo</div></div>
      <div class="stat-card"><div class="stat-label">Concluídas</div><div class="stat-value">${d.counts.completed||0}</div><div class="stat-foot">Ordens finalizadas</div></div>
    </div>
    <div class="dashboard-grid">
      ${panel('Volume de atendimentos',`<div class="chart-wrap"><div class="chart-bars">${bars}</div><div class="chart-caption">Distribuição por status nas ordens recentes</div></div>`,'Distribuição das ordens recentes')}
      ${panel('Ações rápidas',`<div class="quick-actions">
        <button class="quick-action" type="button" data-page="orders"><span class="quick-icon purple">OS</span><span class="quick-copy"><strong>Abrir nova ordem</strong><small>Registrar equipamento e defeito</small></span><b>›</b></button>
        <button class="quick-action" type="button" data-page="clients"><span class="quick-icon green">CL</span><span class="quick-copy"><strong>Cadastrar cliente</strong><small>Manter dados de contato atualizados</small></span><b>›</b></button>
        <button class="quick-action" type="button" data-page="stock"><span class="quick-icon amber">ST</span><span class="quick-copy"><strong>Movimentar estoque</strong><small>Consultar peças e registrar entradas</small></span><b>›</b></button>
      </div>
      <div class="stock-mini-summary"><div><strong>${low.length} itens</strong><span>em atenção no estoque</span></div><button type="button" data-page="stock">Ver estoque →</button></div>
      ${lowPreview?`<div class="stock-mini-list">${lowPreview}</div>`:''}`,'Atalhos para os módulos principais')}
    </div>
    ${panel('Atendimentos recentes',`<div class="table-wrap"><table class="data-table"><thead><tr><th>Ordem</th><th>Cliente</th><th>Equipamento</th><th>Abertura</th><th>Status</th></tr></thead><tbody>${recent}</tbody></table></div>`,'Últimas ordens cadastradas')}
    <div class="section-note">Ambiente de demonstração: os dados exibidos são fictícios e servem para validar o fluxo funcional e os controles de acesso.</div>`;
}
async function renderOrders(){
  const [o,c,p]=await Promise.all([api('/api/orders'),api('/api/clients'),api('/api/parts')]);
  state.data.orders=o.orders; state.data.clients=c.clients; state.data.parts=p.parts;
  const options=c.clients.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  const rows=o.orders.map(x=>`<tr>
    <td><span class="primary-cell">${esc(x.code)}</span><span class="secondary-cell">${esc(x.device)}</span></td>
    <td>${esc(x.client_name)}</td>
    <td>${esc(x.technician_name||'Não atribuído')}</td>
    <td>${statusBadge(x.status)}</td>
    <td>${date(x.created_at)}</td>
    <td><div class="inline-actions"><select class="status-select" data-status-for="${x.id}" aria-label="Próximo status da ordem ${esc(x.code)}"><option value="">Alterar status...</option>${(transitionsClient[x.status]||[]).map(s=>`<option value="${s}">${statusLabel[s]}</option>`).join('')}</select><button class="action-btn" data-action="change-status" data-id="${x.id}">Aplicar</button>${x.status==='EM_EXECUCAO'?`<button class="action-btn" data-action="add-part" data-id="${x.id}">＋ Peça</button>`:''}</div></td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty-state">Nenhuma ordem cadastrada.</td></tr>';
  const form=state.user.role==='CONSULTA'?'':`<details class="create-disclosure"><summary class="btn btn-primary">＋ Nova OS</summary><section class="form-card create-form-card"><h3>Dados do atendimento</h3>${c.clients.length?`<form data-form="order"><div class="form-grid"><div class="field"><label>Cliente</label><select name="clientId" required>${options}</select></div><div class="field"><label>Equipamento</label><input name="device" maxlength="120" required placeholder="Ex.: Notebook, desktop, impressora"></div><div class="field full"><label>Problema relatado</label><textarea name="problem" maxlength="1200" required placeholder="Descreva o relato inicial do cliente..."></textarea></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Abrir ordem de serviço</button></div></form>`:`<div class="muted-note">Cadastre pelo menos um cliente antes de abrir uma ordem.</div>`}</section></details>`;
  $('#page-content').innerHTML=`${pageHeader('Ordens de serviço','Gerencie solicitações, prazos e etapas de atendimento.',form)}
    <div class="filters-row"><label class="search-control"><span aria-hidden="true">⌕</span><input class="search-input" id="order-search" placeholder="Buscar por número, cliente ou equipamento..." aria-label="Buscar ordens de serviço"></label><div class="filter-context">${o.orders.length} ordens cadastradas</div></div>
    <section class="panel"><div class="table-toolbar"><div><strong>Ordens cadastradas</strong><span class="badge-count">${o.orders.length}</span></div><span class="panel-hint">Atualizado com os dados do sistema</span></div><div class="table-wrap"><table class="data-table orders-table"><thead><tr><th>Ordem / equipamento</th><th>Cliente</th><th>Responsável</th><th>Status</th><th>Entrada</th><th>Ações</th></tr></thead><tbody id="orders-body">${rows}</tbody></table></div></section>
    <div class="section-note">Regras: a ordem inicia como ABERTA; as mudanças de status seguem transições permitidas no servidor. Para concluir, é obrigatório informar a solução aplicada.</div>`;
  $('#order-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('#orders-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');});
}
const transitionsClient={ABERTA:['EM_DIAGNOSTICO','CANCELADA'],EM_DIAGNOSTICO:['AGUARDANDO_APROVACAO','EM_EXECUCAO','CANCELADA'],AGUARDANDO_APROVACAO:['EM_EXECUCAO','CANCELADA'],EM_EXECUCAO:['CONCLUIDA','CANCELADA'],CONCLUIDA:[],CANCELADA:[]};
async function renderClients(){
  const {clients}=await api('/api/clients');
  const rows=clients.map(c=>`<tr><td><span class="primary-cell">${esc(c.name)}</span><span class="secondary-cell">Cadastro ${date(c.created_at)}</span></td><td>${esc(c.phone||'—')}</td><td>${esc(c.email||'—')}</td><td><span class="role-pill ${c.active?'role-tech':'role-read'}">${c.active?'Ativo':'Inativo'}</span></td></tr>`).join('')||'<tr><td colspan="4" class="empty-state">Nenhum cliente cadastrado.</td></tr>';
  const form=state.user.role==='CONSULTA'?'':`<details class="create-disclosure"><summary class="btn btn-primary">＋ Novo cliente</summary><section class="form-card create-form-card"><h3>Informações do cliente</h3><form data-form="client"><div class="form-grid three"><div class="field"><label>Nome</label><input name="name" maxlength="120" required placeholder="Nome do cliente"></div><div class="field"><label>Telefone</label><input name="phone" maxlength="30" placeholder="(19) 90000-0000"></div><div class="field"><label>E-mail</label><input name="email" type="email" maxlength="120" placeholder="cliente@exemplo.com"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Cadastrar cliente</button></div></form></section></details>`;
  $('#page-content').innerHTML=`${pageHeader('Clientes','Consulte os cadastros e o histórico de relacionamento.',form)}
    <div class="filters-row"><label class="search-control"><span aria-hidden="true">⌕</span><input class="search-input" id="client-search" placeholder="Buscar por nome, telefone ou e-mail..." aria-label="Buscar clientes"></label><div class="filter-context">${clients.length} registros</div></div>
    <section class="panel"><div class="panel-head"><div><h3>Base de clientes</h3><div class="panel-subtitle">Dados de contato necessários para a prestação do serviço</div></div><span class="badge-count">${clients.length} registros</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Cliente</th><th>Telefone</th><th>E-mail</th><th>Situação</th></tr></thead><tbody id="clients-body">${rows}</tbody></table></div></section>
    <div class="section-note">Privacidade: o protótipo não solicita CPF, dados sensíveis nem senhas de acesso dos equipamentos. Cadastre apenas dados de contato necessários à execução do serviço.</div>`;
  $('#client-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('#clients-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');});
}
async function renderStock(){
  const {parts}=await api('/api/parts');
  const low=parts.filter(p=>p.quantity<=p.min_quantity);
  const totalUnits=parts.reduce((sum,p)=>sum+Number(p.quantity||0),0);
  const inventoryValue=parts.reduce((sum,p)=>sum+(Number(p.quantity||0)*Number(p.unit_cost||0)),0);
  const rows=parts.map(p=>`<tr><td><span class="primary-cell">${esc(p.name)}</span><span class="secondary-cell">SKU: ${esc(p.sku)}</span></td><td>${p.quantity}</td><td>${p.min_quantity}</td><td>${currency(p.unit_cost)}</td><td>${p.quantity<=p.min_quantity?'<span class="status status-cancel">Atenção</span>':'<span class="status status-done">Normal</span>'}</td><td>${state.user.role==='ADMIN'?`<button class="action-btn" data-action="stock-entry" data-id="${p.id}">Registrar entrada</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty-state">Nenhuma peça cadastrada.</td></tr>';
  const form=state.user.role==='ADMIN'?`<details class="create-disclosure"><summary class="btn btn-primary">＋ Cadastrar peça</summary><section class="form-card create-form-card"><h3>Cadastro de item</h3><form data-form="part"><div class="form-grid three"><div class="field"><label>SKU / código</label><input name="sku" maxlength="40" required placeholder="Ex.: SSD-480"></div><div class="field"><label>Descrição</label><input name="name" maxlength="120" required placeholder="Nome da peça"></div><div class="field"><label>Quantidade inicial</label><input name="quantity" type="number" min="0" max="100000" value="0" required></div><div class="field"><label>Estoque mínimo</label><input name="minQuantity" type="number" min="0" max="100000" value="0" required></div><div class="field"><label>Custo unitário (R$)</label><input name="unitCost" type="number" min="0" step="0.01" value="0" required></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Cadastrar peça</button></div></form></section></details>`:'';
  $('#page-content').innerHTML=`${pageHeader('Estoque de peças','Controle entradas, saídas e disponibilidade de componentes.',form)}
    <div class="stats-grid stock-stats">
      <div class="stat-card"><div class="stat-label">Itens cadastrados</div><div class="stat-value">${parts.length}</div><div class="stat-foot">Catálogo de peças</div></div>
      <div class="stat-card amber"><div class="stat-label">Estoque baixo</div><div class="stat-value">${low.length}</div><div class="stat-foot">Requer reposição</div></div>
      <div class="stat-card"><div class="stat-label">Unidades disponíveis</div><div class="stat-value">${totalUnits}</div><div class="stat-foot">Saldo total em estoque</div></div>
      <div class="stat-card green"><div class="stat-label">Valor em estoque</div><div class="stat-value stock-value">${currency(inventoryValue)}</div><div class="stat-foot">Custo estimado</div></div>
    </div>
    <div class="filters-row"><label class="search-control"><span aria-hidden="true">⌕</span><input class="search-input" id="stock-search" placeholder="Buscar por nome ou código da peça..." aria-label="Buscar itens do estoque"></label><div class="filter-context">${parts.length} itens cadastrados</div></div>
    <section class="panel"><div class="panel-head"><div><h3>Itens em estoque</h3><div class="panel-subtitle">Saldos, níveis mínimos e custo unitário</div></div><span class="badge-count">${parts.length} itens</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Peça</th><th>Saldo</th><th>Mínimo</th><th>Custo unit.</th><th>Indicador</th><th>Movimentação</th></tr></thead><tbody id="stock-body">${rows}</tbody></table></div></section>
    <div class="section-note">Saídas do estoque são feitas dentro de uma ordem em execução. O servidor valida o saldo e registra a movimentação em transação, impedindo estoque negativo.</div>`;
  $('#stock-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('#stock-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');});
}
async function renderTeam(){
  const {users}=await api('/api/users');
  const rows=users.map(u=>`<tr><td><span class="primary-cell">${esc(u.name)}</span><span class="secondary-cell">@${esc(u.username)}</span></td><td><span class="role-pill ${u.role==='ADMIN'?'role-admin':u.role==='TECNICO'?'role-tech':'role-read'}">${roleLabel[u.role]}</span></td><td>${u.active?'Ativo':'Inativo'}</td><td>${date(u.created_at)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-state">Nenhum usuário cadastrado.</td></tr>';
  const form=`<details class="create-disclosure"><summary class="btn btn-primary">＋ Novo usuário</summary><section class="form-card create-form-card"><h3>Criar usuário de equipe</h3><form data-form="user"><div class="form-grid three"><div class="field"><label>Nome</label><input name="name" maxlength="120" required></div><div class="field"><label>Usuário</label><input name="username" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" required></div><div class="field"><label>Perfil</label><select name="role"><option value="TECNICO">Técnico</option><option value="CONSULTA">Consulta</option></select></div><div class="field"><label>Senha inicial</label><input name="password" type="password" minlength="12" required placeholder="Mínimo 12 caracteres"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Criar usuário</button></div></form><div class="muted-note">Política: 12 a 72 bytes, com letras maiúsculas e minúsculas, número e símbolo. O protótipo não permite criar novos administradores pelo painel.</div></section></details>`;
  $('#page-content').innerHTML=`${pageHeader('Usuários e perfis','Gerencie os acessos e aplique o menor nível de privilégio necessário.',form)}
    <section class="panel"><div class="panel-head"><div><h3>Contas cadastradas</h3><div class="panel-subtitle">Perfis e situação de acesso ao sistema</div></div><span class="badge-count">${users.length}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Usuário</th><th>Perfil RBAC</th><th>Situação</th><th>Criação</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
async function renderAudit(){
  const {logs}=await api('/api/audit?limit=150');
  const rows=logs.map(l=>`<tr><td>${date(l.created_at)}</td><td><span class="primary-cell">${esc(l.actor_username||'Sistema')}</span></td><td>${esc(l.action)}</td><td>${esc(l.entity)}${l.entity_id?` #${esc(l.entity_id)}`:''}</td><td><span class="role-pill ${l.result==='SUCCESS'?'role-tech':'role-read'}">${esc(l.result)}</span></td><td><div class="audit-detail">${esc(l.details_json||'{}')}</div></td></tr>`).join('')||'<tr><td colspan="6" class="empty-state">Nenhum evento registrado.</td></tr>';
  $('#page-content').innerHTML=`${pageHeader('Trilha de auditoria','Consulte o histórico de autenticação e operações críticas; acesso restrito ao administrador.')}
    <div class="filters-row"><label class="search-control"><span aria-hidden="true">⌕</span><input class="search-input" id="audit-search" placeholder="Buscar usuário, ação ou recurso..." aria-label="Buscar eventos de auditoria"></label><div class="filter-context">${logs.length} eventos recentes</div></div>
    <section class="panel"><div class="panel-head"><div><h3>Eventos recentes</h3><div class="panel-subtitle">Histórico de operações e resultados de segurança</div></div><span class="badge-count">${logs.length} eventos</span></div><div class="table-wrap"><table class="data-table audit-table"><thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Recurso</th><th>Resultado</th><th>Detalhes mínimos</th></tr></thead><tbody id="audit-body">${rows}</tbody></table></div></section>
    <div class="section-note">A trilha é append-only no banco do protótipo: gatilhos SQL bloqueiam UPDATE e DELETE. Em produção, mantenha cópia externa e acesso separado para reduzir risco de adulteração.</div>`;
  $('#audit-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('#audit-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');});
}
document.addEventListener('submit',async e=>{
  const form=e.target.closest('form[data-form],#login-form'); if(!form)return; e.preventDefault();
  if(form.id==='login-form'){
    const error=$('#login-error'); error.textContent=''; const data=Object.fromEntries(new FormData(form).entries());
    const btn=$('button[type="submit"]',form); btn.disabled=true; btn.textContent='Autenticando...';
    try{const r=await api('/api/login',{method:'POST',body:JSON.stringify(data)}); form.reset(); showApp(r.user); toast('Acesso autorizado. Bem-vindo ao sistema.');}
    catch(err){error.textContent=err.message;}
    finally{btn.disabled=false;btn.innerHTML='Entrar no sistema <span aria-hidden="true">→</span>';}
    return;
  }
  const kind=form.dataset.form; const data=Object.fromEntries(new FormData(form).entries());
  try{
    if(kind==='client') await api('/api/clients',{method:'POST',body:JSON.stringify(data)});
    if(kind==='order') await api('/api/orders',{method:'POST',body:JSON.stringify(data)});
    if(kind==='part') await api('/api/parts',{method:'POST',body:JSON.stringify(data)});
    if(kind==='user') await api('/api/users',{method:'POST',body:JSON.stringify(data)});
    toast('Registro salvo com sucesso.'); await navigate(state.page);
  }catch(err){toast(err.message,true);}
});

document.addEventListener('click',async e=>{
  const fill=e.target.closest('[data-fill-user]'); if(fill){$('#username').value=fill.dataset.fillUser;$('#password').value=fill.dataset.fillPass;return;}
  const nav=e.target.closest('[data-page]'); if(nav){navigate(nav.dataset.page);return;}
  const action=e.target.closest('[data-action]'); if(!action)return;
  const a=action.dataset.action;
  if(a==='toggle-menu'){$('.sidebar').classList.toggle('open');return;}
  if(a==='logout'){try{await api('/api/logout',{method:'POST',body:'{}'});}catch{}showLogin();toast('Sessão encerrada.');return;}
  if(a==='change-status'){
    const id=action.dataset.id; const select=$(`[data-status-for="${id}"]`); const status=select?.value;
    if(!status){toast('Escolha o próximo status.',true);return;}
    const payload={status}; if(status==='CONCLUIDA'){const resolution=prompt('Descreva a solução aplicada (mínimo 10 caracteres):');if(!resolution)return;payload.resolution=resolution;}
    try{await api(`/api/orders/${id}/status`,{method:'PATCH',body:JSON.stringify(payload)});toast('Status atualizado e auditado.');await navigate('orders');}catch(err){toast(err.message,true);}return;
  }
  if(a==='add-part'){
    const parts=(await api('/api/parts')).parts; if(!parts.length){toast('Cadastre uma peça primeiro.',true);return;}
    const list=parts.map(p=>`${p.id} - ${p.name} (saldo: ${p.quantity})`).join('\n');
    const partId=Number(prompt(`Informe o ID da peça:\n${list}`)); if(!partId)return;
    const quantity=Number(prompt('Quantidade a consumir:','1')); if(!quantity)return;
    try{await api(`/api/orders/${action.dataset.id}/parts`,{method:'POST',body:JSON.stringify({partId,quantity})});toast('Saída registrada na ordem e no estoque.');await navigate('orders');}catch(err){toast(err.message,true);}return;
  }
  if(a==='stock-entry'){
    const quantity=Number(prompt('Quantidade de entrada:','1')); if(!quantity)return;
    const reason=prompt('Motivo da entrada:','Reposição de estoque'); if(!reason)return;
    try{await api('/api/stock/entry',{method:'POST',body:JSON.stringify({partId:Number(action.dataset.id),quantity,reason})});toast('Entrada registrada e auditada.');await navigate('stock');}catch(err){toast(err.message,true);}return;
  }
});

(async()=>{try{const r=await api('/api/me');showApp(r.user);}catch{showLogin();}})();
