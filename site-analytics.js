window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};

(()=>{
  const routeEvents=[
    [/^\/$/,'open_home'],
    [/^\/mingtest$/,'open_lingtest'],
    [/^\/timelens(?:\?|$)/,'open_timelens'],
    [/^\/app(?:\?|$)/,'open_workspace'],
    [/^\/mingtest-pricing(?:\?|$)/,'view_pricing'],
    [/^\/mingtest-login(?:\?|$)/,'start_login'],
    [/^\/mingtest-tools(?:\?|$)/,'open_toolbox'],
    [/^\/timelens-route(?:\?|$)/,'open_public_route'],
  ];
  const formEvents={leadForm:'submit_pro_application',loginForm:'submit_login',activationForm:'submit_activation',commentForm:'submit_route_comment'};
  const emit=(name,extra={})=>{
    if(!name)return;
    window.va('event',{name,path:location.pathname,...extra});
  };
  const eventForLink=target=>{
    const explicit=target.dataset.event;
    if(explicit)return explicit;
    const href=target.getAttribute('href')||'';
    if(href.startsWith('mailto:'))return 'contact_email';
    if(href.startsWith('http')&&!href.startsWith(location.origin))return 'open_external_link';
    try{
      const url=new URL(href,location.href);
      const matched=routeEvents.find(([pattern])=>pattern.test(url.pathname+(url.search||'')));
      return matched?.[1]||'';
    }catch{return ''}
  };
  document.addEventListener('click',event=>{
    const target=event.target.closest('a,button,[data-event]');
    if(!target)return;
    const name=eventForLink(target);
    emit(name,{label:(target.textContent||'').trim().replace(/\s+/g,' ').slice(0,80)});
  });
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    emit(form.dataset.event||formEvents[form.id]||'submit_form',{formId:form.id||'anonymous'});
  });
  emit('page_view_product',{product:document.querySelector('[data-product]')?.dataset.product||'luckline'});
})();
