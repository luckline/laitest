(()=>{
  const nav=document.querySelector('.unified-nav');
  if(!nav)return;
  const product=nav.dataset.product||'luckline';
  const brand=nav.querySelector('.brand,.product-brand,.logo');

  // 首页已有作品导航和产品卡；切换器只服务产品页之间的跨产品导航。
  if(product!=='luckline'&&brand&&!brand.parentElement.classList.contains('nav-brand-group')){
    const group=document.createElement('div');
    group.className='nav-brand-group';
    brand.parentNode.insertBefore(group,brand);
    group.appendChild(brand);
    const switchButton=document.createElement('button');
    switchButton.type='button';
    switchButton.className='product-switch-button';
    switchButton.setAttribute('aria-label','打开全部产品');
    switchButton.setAttribute('aria-expanded','false');
    switchButton.innerHTML='<span>全部产品</span><i>⌄</i>';
    group.appendChild(switchButton);
    const menu=document.createElement('div');
    menu.className='product-switch-menu';
    menu.hidden=true;
    menu.innerHTML='<p>产品导航</p>'+[
      ['luckline','L','Luckline','返回个人主页','/'],
      ['lingtest','领','领测 LingTest','AI 质量工作台','/lingtest'],
      ['timelens','时','时光透卡','旅行与城市足迹','/timelens']
    ].map(x=>`<a href="${x[4]}" class="${x[0]===product?'active':''}"><i>${x[1]}</i><b>${x[2]}</b><small>${x[3]}</small></a>`).join('');
    document.body.appendChild(menu);
    const close=()=>{menu.hidden=true;switchButton.setAttribute('aria-expanded','false')};
    switchButton.onclick=e=>{
      e.stopPropagation();
      if(!menu.hidden){close();return}
      const rect=switchButton.getBoundingClientRect();
      menu.style.left=Math.min(rect.left,innerWidth-242)+'px';
      menu.style.top=rect.bottom+8+'px';
      menu.hidden=false;
      switchButton.setAttribute('aria-expanded','true');
    };
    document.addEventListener('click',e=>{if(!menu.contains(e.target))close()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();nav.classList.remove('nav-mobile-open')}});
  }

  let actions=nav.querySelector('.nav-actions,.workspace-actions,.route-actions');
  if(!actions){actions=document.createElement('div');actions.className='nav-actions';nav.appendChild(actions)}
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
})();
