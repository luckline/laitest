const API_BASE="https://timelens.cc",TOKEN_KEY="lingtest:admin-token";
const $=selector=>document.querySelector(selector),loginPanel=$("#loginPanel"),adminPanel=$("#adminPanel"),leadList=$("#leadList"),loginMessage=$("#loginMessage");
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
document.head.insertAdjacentHTML("beforeend",'<link rel="stylesheet" href="/css/lingtest-admin-users.css?v=1">');
adminPanel.querySelector(".admin-tabs [data-view='leads']").insertAdjacentHTML("beforebegin",'<button data-view="users">用户数据</button>');
$("#usageView").insertAdjacentHTML("afterend",'<section id="usersView" hidden><div class="admin-head"><div><p>USER INSIGHTS</p><h1>用户数据</h1><span>查看用户增长、活跃与小程序数据沉淀情况。</span></div><div><span id="usersUpdatedAt" class="updated-at"></span><button class="refresh" data-refresh>刷新用户</button></div></div><div id="usersStatus" class="data-status" role="status">正在读取用户数据…</div><div id="userMetricGrid" class="metric-grid user-metrics" aria-live="polite"></div><section class="dashboard-panel user-panel"><div class="panel-head"><div><p>RECENT USERS</p><h2>最近活跃用户</h2></div><span>最多显示 100 位 · 手机号已脱敏</span></div><div id="userList" class="user-list"></div></section><div class="scope-note"><b>隐私说明</b><span>仅展示运营所需的聚合数据和脱敏手机号，不返回密码、微信 OpenID、完整手机号等敏感凭证。</span></div></section>');
let token=sessionStorage.getItem(TOKEN_KEY)||"";
const statusLabels={new:"待处理",contacted:"已联系",approved:"已通过",active:"已激活",rejected:"已拒绝"};
async function api(path,options={}){const response=await fetch(`${API_BASE}${path}`,{...options,headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`,...options.headers}});const data=await response.json().catch(()=>({}));if(!response.ok||data.code!==0)throw new Error(data.message||`HTTP ${response.status}`);return data.data||data}
function showAdmin(){loginPanel.hidden=true;adminPanel.hidden=false;$("#logout").hidden=false}
function showLogin(message=""){loginPanel.hidden=false;adminPanel.hidden=true;$("#logout").hidden=true;loginMessage.textContent=message}
function render(leads){const counts=leads.reduce((out,lead)=>(out[lead.status]=(out[lead.status]||0)+1,out),{});$("#summary").innerHTML=Object.entries(statusLabels).map(([key,label])=>`<span>${label} ${counts[key]||0}</span>`).join("");leadList.innerHTML=leads.length?leads.map(lead=>`<article class="lead-card" data-id="${escapeHtml(lead.id)}"><header><div><span>${escapeHtml(lead.source||"pricing")} · ${escapeHtml(new Date(lead.createdAt).toLocaleString())}</span><h2>${escapeHtml(lead.name)} ${lead.company?`· ${escapeHtml(lead.company)}`:""}</h2><div class="meta"><b>${escapeHtml(lead.contact)}</b><span>${escapeHtml(lead.role||"角色未填")}</span><span>${escapeHtml(lead.teamSize||"规模未填")}</span><span>${escapeHtml(lead.budgetRange||"预算未填")}</span></div></div><i class="status">${escapeHtml(statusLabels[lead.status]||lead.status)}</i></header><div class="need">${escapeHtml(lead.needSummary)}</div><div class="lead-actions"><select data-status><option value="new" ${lead.status==="new"?"selected":""}>待处理</option><option value="contacted" ${lead.status==="contacted"?"selected":""}>已联系</option><option value="rejected" ${lead.status==="rejected"?"selected":""}>已拒绝</option></select><button data-save>保存状态</button><button class="approve" data-approve>通过并生成激活码</button>${lead.licenseStatus?`<span>授权：${escapeHtml(lead.licenseStatus)}</span>`:""}</div></article>`).join(""):"<div class='empty'>当前筛选条件下还没有申请</div>"}
const number=value=>new Intl.NumberFormat("zh-CN").format(Number(value)||0);
const listOf=data=>Array.isArray(data?.list)?data.list:Array.isArray(data?.items)?data.items:[];
function renderUsage(routeData,cardData){
  const routes=listOf(routeData),cards=listOf(cardData);
  const total=(rows,key)=>rows.reduce((sum,row)=>sum+(Number(row[key])||0),0);
  const routeViews=total(routes,"viewCount"),cardViews=total(cards,"viewCount");
  const routeLikes=total(routes,"likeCount"),cardLikes=total(cards,"likeCount");
  const routeFavorites=total(routes,"favoriteCount"),cardFavorites=total(cards,"favoriteCount");
  const metrics=[
    {label:"公开路线",value:routeData.total??routes.length,note:"路线广场内容总量",tone:"green"},
    {label:"公开旅行卡片",value:cardData.total??cards.length,note:"用户公开发布内容",tone:"blue"},
    {label:"累计浏览",value:routeViews+cardViews,note:"当前接口返回内容合计",tone:"orange"},
    {label:"累计互动",value:routeLikes+cardLikes+routeFavorites+cardFavorites,note:`${number(routeLikes+cardLikes)} 点赞 · ${number(routeFavorites+cardFavorites)} 收藏`,tone:"purple"}
  ];
  $("#metricGrid").innerHTML=metrics.map(item=>`<article class="metric-card ${item.tone}"><span>${item.label}</span><strong>${number(item.value)}</strong><small>${item.note}</small></article>`).join("");
  const ranked=[...routes].sort((a,b)=>(Number(b.viewCount)||0)+(Number(b.likeCount)||0)*3+(Number(b.favoriteCount)||0)*5-((Number(a.viewCount)||0)+(Number(a.likeCount)||0)*3+(Number(a.favoriteCount)||0)*5)).slice(0,6);
  $("#topRoutes").innerHTML=ranked.length?ranked.map((route,index)=>`<article><b>${String(index+1).padStart(2,"0")}</b><div><strong>${escapeHtml(route.title||"未命名路线")}</strong><span>${escapeHtml(route.destination||"目的地未填写")}</span></div><div class="route-stats"><span>浏览 ${number(route.viewCount)}</span><span>点赞 ${number(route.likeCount)}</span><span>收藏 ${number(route.favoriteCount)}</span></div></article>`).join(""):"<div class='empty compact'>还没有公开路线数据</div>";
  const destinations=routes.reduce((map,route)=>{const name=route.destination||"其他";map.set(name,(map.get(name)||0)+1);return map},new Map());
  const sorted=[...destinations].sort((a,b)=>b[1]-a[1]).slice(0,8),max=sorted[0]?.[1]||1;
  $("#destinationList").innerHTML=sorted.length?sorted.map(([name,count])=>`<div><span><b>${escapeHtml(name)}</b><em>${number(count)} 条</em></span><i><u style="width:${Math.max(8,count/max*100)}%"></u></i></div>`).join(""):"<div class='empty compact'>暂无目的地数据</div>";
  $("#updatedAt").textContent=`更新于 ${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`;
  $("#usageStatus").hidden=true;
}
async function loadUsage(){const status=$("#usageStatus");status.hidden=false;status.className="data-status";status.textContent="正在读取当前数据…";try{const [routes,cards]=await Promise.all([loadPublicCollection("/api/trips/public"),loadPublicCollection("/api/cards/public")]);renderUsage(routes,cards)}catch(error){status.className="data-status error";status.textContent=`小程序数据加载失败：${error.message}`;$("#metricGrid").innerHTML=""}}
async function loadLeads(){const status=$("#statusFilter").value;const data=await api(`/api/lingtest/admin/leads${status?`?status=${encodeURIComponent(status)}`:""}`);render(data.leads||[])}
function dateTime(value){if(!value)return"从未登录";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function renderUsers(data){
  const summary=data.summary||{},users=Array.isArray(data.users)?data.users:[];
  const metrics=[
    {label:"注册用户",value:summary.totalUsers,note:`微信用户 ${number(summary.wechatUsers)}`,tone:"green"},
    {label:"今日新增",value:summary.newToday,note:`近 7 日新增 ${number(summary.newSevenDays)}`,tone:"blue"},
    {label:"今日活跃",value:summary.activeToday,note:`近 7 日活跃 ${number(summary.activeSevenDays)}`,tone:"orange"},
    {label:"已验证手机",value:summary.mobileUsers,note:"可跨端登录账户",tone:"purple"}
  ];
  $("#userMetricGrid").innerHTML=metrics.map(item=>`<article class="metric-card ${item.tone}"><span>${item.label}</span><strong>${number(item.value)}</strong><small>${item.note}</small></article>`).join("");
  $("#userList").innerHTML=users.length?users.map(user=>`<article><div class="user-identity"><i>${escapeHtml(String(user.nickname||"用").slice(0,1))}</i><span><b>${escapeHtml(user.nickname||`用户 ${user.id}`)}</b><small>${escapeHtml(user.mobileMasked||"未绑定手机")} · ${user.wechatBound?"微信用户":"非微信用户"}</small></span></div><div><b>${number(user.tripCount)}</b><small>路线</small></div><div><b>${number(user.recordCount)}</b><small>记录</small></div><div><b>${number(user.markerCount)}</b><small>足迹</small></div><time><b>${escapeHtml(dateTime(user.lastLoginAt))}</b><small>最近登录</small></time></article>`).join(""):"<div class='empty compact'>还没有用户数据</div>";
  $("#usersUpdatedAt").textContent=`更新于 ${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`;
  $("#usersStatus").hidden=true;
}
async function loadUsers(){const status=$("#usersStatus");status.hidden=false;status.className="data-status";status.textContent="正在读取用户数据…";try{renderUsers(await api("/api/lingtest/admin/users"))}catch(error){status.className="data-status error";status.textContent=`用户数据加载失败：${error.message}`;$("#userMetricGrid").innerHTML="";$("#userList").innerHTML=""}}
async function loadPublicCollection(path){const first=await api(`${path}?page=1&pageSize=100`),pages=Math.ceil((Number(first.total)||0)/100);if(pages<=1)return first;const rest=await Promise.all(Array.from({length:pages-1},(_,index)=>api(`${path}?page=${index+2}&pageSize=100`)));return{...first,list:[...listOf(first),...rest.flatMap(listOf)]}}
async function load(){try{await loadLeads();showAdmin();await loadUsage()}catch(error){if(/凭证|401/.test(error.message)){token="";sessionStorage.removeItem(TOKEN_KEY);showLogin(error.message)}else leadList.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`}}
$("#loginForm").addEventListener("submit",event=>{event.preventDefault();token=$("#adminToken").value.trim();sessionStorage.setItem(TOKEN_KEY,token);load()});
$("#logout").addEventListener("click",()=>{token="";sessionStorage.removeItem(TOKEN_KEY);showLogin()});
document.querySelectorAll("[data-refresh]").forEach(button=>button.addEventListener("click",()=>button.closest("#usageView")?loadUsage():button.closest("#usersView")?loadUsers():loadLeads()));$("#statusFilter").addEventListener("change",loadLeads);
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("[data-view]").forEach(item=>item.classList.toggle("active",item===button));$("#usageView").hidden=button.dataset.view!=="usage";$("#usersView").hidden=button.dataset.view!=="users";$("#leadsView").hidden=button.dataset.view!=="leads";if(button.dataset.view==="users"&&!$("#userMetricGrid").children.length)loadUsers()}));
leadList.addEventListener("click",async event=>{const card=event.target.closest(".lead-card");if(!card)return;const id=card.dataset.id;try{if(event.target.matches("[data-save]")){await api(`/api/lingtest/admin/leads/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status:card.querySelector("[data-status]").value})});await load()}if(event.target.matches("[data-approve]")){event.target.disabled=true;const data=await api(`/api/lingtest/admin/leads/${encodeURIComponent(id)}/approve`,{method:"POST",body:JSON.stringify({durationDays:365})});$("#activationCode").textContent=data.activationCode;$("#codeDialog").showModal();await load()}}catch(error){alert(error.message)}finally{if(event.target)event.target.disabled=false}});
$("#closeCode").addEventListener("click",()=>$("#codeDialog").close());$("#copyCode").addEventListener("click",async()=>{await navigator.clipboard.writeText($("#activationCode").textContent);$("#copyCode").textContent="已复制"});
if(token)load();else showLogin();
