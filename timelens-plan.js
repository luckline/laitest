(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cleanInline=value=>String(value||'').replace(/^\*\*|\*\*$/g,'').trim();
  const inline=value=>escape(value).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');

  function parse(markdown=''){
    const text=String(markdown||'').replace(/\r/g,'').trim();
    const sections=[];
    let current={title:'路线概览',paragraphs:[],items:[]};
    const push=()=>{if(current.paragraphs.length||current.items.length||current.title!=='路线概览')sections.push(current)};
    for(const sourceLine of text.split('\n')){
      const line=sourceLine.trim();
      if(!line||/^---+$/.test(line))continue;
      const heading=line.match(/^#{2,6}\s+(.+)$/);
      if(heading){push();current={title:cleanInline(heading[1]),paragraphs:[],items:[]};continue}
      const item=line.match(/^[-*]\s+(.+)$/);
      if(item){current.items.push(item[1].trim());continue}
      current.paragraphs.push(line);
    }
    push();
    return {version:1,title:sections.find(section=>/^Day\s*1|第[一1]天/i.test(section.title))?.title||sections[0]?.title||'AI 路线方案',sections};
  }

  function normalize(value){
    if(!value)return parse('');
    if(typeof value==='string'){try{return normalize(JSON.parse(value))}catch{return parse(value)}}
    if(Array.isArray(value.sections))return value;
    return parse(value.rawPlan||value.travelPlan||'');
  }

  function render(value,meta={}){
    const plan=normalize(value);
    const sections=plan.sections.map((section,index)=>{
      const day=/^(Day\s*\d+|第[一二三四五六七八九十\d]+天)/i.test(section.title);
      const paragraphs=section.paragraphs.map(text=>`<p>${inline(text)}</p>`).join('');
      const items=section.items.length?`<ul>${section.items.map(text=>`<li>${inline(text)}</li>`).join('')}</ul>`:'';
      return `<article class="travel-plan-section ${day?'day':''}"><div class="travel-plan-index">${day?String(index).padStart(2,'0'):'✦'}</div><div><h3>${inline(section.title)}</h3>${paragraphs}${items}</div></article>`;
    }).join('');
    const facts=[meta.provider&&`模型服务：${escape(meta.provider)}`,meta.model&&escape(meta.model),meta.elapsedMs&&`耗时 ${(Number(meta.elapsedMs)/1000).toFixed(1)} 秒`,meta.createdAt&&`保存于 ${escape(new Date(meta.createdAt).toLocaleString('zh-CN'))}`].filter(Boolean).map(text=>`<span>${text}</span>`).join('');
    return `<section class="travel-plan-result"><div class="travel-plan-head"><div><span class="eyebrow">AI TRAVEL PLAN</span><h2>路线方案</h2></div><div class="travel-plan-facts">${facts}</div></div><div class="travel-plan-sections">${sections||'<p>暂时没有可展示的路线内容。</p>'}</div></section>`;
  }

  globalThis.TimeLensPlan={parse,normalize,render};
})();
