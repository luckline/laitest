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

  const contentLink=[...(links?.querySelectorAll('a')||[])].find(link=>{
    try{return new URL(link.href,location.href).pathname==='/content'}catch{return false}
  });
  if(contentLink){
    const menu=document.createElement('div');
    menu.className='nav-content-menu';
    const button=document.createElement('button');
    button.type='button';
    button.className='nav-content-trigger';
    button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-haspopup','menu');
    button.innerHTML='<span>内容</span><i aria-hidden="true">⌄</i>';
    const panel=document.createElement('div');
    panel.className='nav-content-panel';
    panel.setAttribute('role','menu');
    panel.innerHTML=`
      <a href="/content" role="menuitem"><b>内容总览</b><small>原创、方法与资源</small></a>
      <a href="/content#latest" role="menuitem"><b>原创文章</b><small>最新发布与内容归档</small></a>
      <a href="/mingtest-guides" role="menuitem"><b>测试方法</b><small>框架、清单与实践</small></a>
      <a href="/library" role="menuitem"><b>资源收藏</b><small>外部资料与工具</small></a>`;
    const setOpen=open=>{
      menu.classList.toggle('open',open);
      button.setAttribute('aria-expanded',String(open));
    };
    button.addEventListener('click',event=>{
      event.stopPropagation();
      setOpen(!menu.classList.contains('open'));
    });
    panel.addEventListener('click',event=>event.stopPropagation());
    menu.append(button,panel);
    contentLink.replaceWith(menu);
    document.addEventListener('click',()=>setOpen(false));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false)});
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
