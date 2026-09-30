(()=>{
  const nav=document.querySelector('.unified-nav');
  if(!nav)return;
  const product=nav.dataset.product||'luckline';
  const links=nav.querySelector('.shared-links,.links,nav');
  let actions=nav.querySelector('.nav-actions,.workspace-actions,.route-actions');
  if(!actions){actions=document.createElement('div');actions.className='nav-actions';nav.appendChild(actions)}

  // 产品页使用稳定可见的主页入口，避免下拉菜单与页面中的产品展示重复。
  if(product!=='luckline'&&links&&!links.querySelector('.site-home-link')){
    const home=document.createElement('a');
    home.href='/';
    home.className='site-home-link';
    home.textContent='主页';
    home.setAttribute('aria-label','返回 Luckline 个人主页');
    links.insertBefore(home,links.firstChild);
  }

  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='nav-mobile-toggle';
  if(links){
    if(!links.id)links.id='site-navigation';
    toggle.setAttribute('aria-controls',links.id);
  }
  const setOpen=open=>{
    nav.classList.toggle('nav-mobile-open',open);
    toggle.textContent=open?'×':'☰';
    toggle.setAttribute('aria-label',open?'关闭导航菜单':'打开导航菜单');
    toggle.setAttribute('aria-expanded',String(open));
  };
  setOpen(false);
  toggle.onclick=()=>setOpen(!nav.classList.contains('nav-mobile-open'));
  actions.insertBefore(toggle,actions.firstChild);
  links?.addEventListener('click',e=>{if(e.target.closest('a,button'))setOpen(false)});
  document.addEventListener('click',e=>{if(!nav.contains(e.target))setOpen(false)});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&nav.classList.contains('nav-mobile-open')){setOpen(false);toggle.focus()}
  });
  window.matchMedia('(max-width:760px)').addEventListener('change',()=>setOpen(false));
})();
