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
    panel.innerHTML='<div class="nav-content-loading">正在加载文章…</div>';
    let loaded=false;
    const renderPosts=posts=>{
      panel.replaceChildren();
      posts.slice(0,4).forEach(post=>{
        const link=document.createElement('a');
        link.href=`/articles/${encodeURIComponent(String(post.slug||''))}`;
        link.className='nav-content-post';
        link.setAttribute('role','menuitem');
        const title=document.createElement('b');
        title.textContent=String(post.title||'未命名文章');
        const date=document.createElement('small');
        const value=new Date(post.publishedAt);
        date.textContent=Number.isNaN(value.getTime())?'原创文章':new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit'}).format(value);
        link.append(title,date);
        panel.append(link);
      });
      const all=document.createElement('a');
      all.href='/content';
      all.className='nav-content-all';
      all.setAttribute('role','menuitem');
      all.textContent=posts.length?'查看全部文章 →':'进入原创文章 →';
      panel.append(all);
    };
    const loadPosts=()=>{
      if(loaded)return;
      loaded=true;
      fetch('https://timelens.cc/api/content/posts?page=1&pageSize=4')
        .then(response=>{
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(payload=>renderPosts(payload?.data?.list||[]))
        .catch(()=>renderPosts([]));
    };
    const setOpen=open=>{
      menu.classList.toggle('open',open);
      button.setAttribute('aria-expanded',String(open));
    };
    button.addEventListener('click',event=>{
      event.stopPropagation();
      const open=!menu.classList.contains('open');
      setOpen(open);
      if(open)loadPosts();
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
