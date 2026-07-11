window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};
document.addEventListener('click',event=>{const target=event.target.closest('[data-event]');if(!target)return;window.va('event',{name:target.dataset.event,path:location.pathname,label:(target.textContent||'').trim().slice(0,80)})});
