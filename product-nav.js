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
  toggle.setAttribute('aria-label','打开导航菜单');
  toggle.textContent='☰';
  toggle.onclick=()=>{
    const open=nav.classList.toggle('nav-mobile-open');
    toggle.textContent=open?'×':'☰';
    toggle.setAttribute('aria-label',open?'关闭导航菜单':'打开导航菜单');
  };
  actions.insertBefore(toggle,actions.firstChild);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')nav.classList.remove('nav-mobile-open')});
})();
