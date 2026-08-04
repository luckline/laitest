(()=>{
  const root=document.getElementById('homeLatestPosts');
  if(!root)return;
  const accountNames={xiaoliang:'小梁游记',mingjin:'铭锦数智'};
  const text=value=>String(value||'').trim();
  const featuredKeywords=['测试','自动化','质量','接口','人工智能','AI','产品','工程','架构','数据','研发','开发','独立产品'];
  const featuredScore=post=>{
    const title=text(post.title);
    const summary=text(post.summary);
    return featuredKeywords.reduce((score,keyword)=>score+(title.includes(keyword)?3:0)+(summary.includes(keyword)?1:0),0);
  };
  const selectFeatured=posts=>{
    const ranked=posts
      .map((post,index)=>({post,index,score:featuredScore(post)}))
      .filter(item=>item.score>0)
      .sort((a,b)=>b.score-a.score||a.index-b.index)
      .map(item=>item.post);
    const selected=[...ranked];
    posts.filter(post=>post.accountKey==='mingjin'&&!selected.includes(post)).forEach(post=>selected.push(post));
    posts.filter(post=>!selected.includes(post)).forEach(post=>selected.push(post));
    return selected.slice(0,3);
  };
  const formatDate=value=>{
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  };
  const renderPost=post=>{
    const article=document.createElement('article');
    article.className='home-content-card-v6';
    const link=document.createElement('a');
    link.href=`/articles/${encodeURIComponent(text(post.slug))}`;
    const meta=document.createElement('span');
    meta.textContent=`${accountNames[post.accountKey]||text(post.accountKey)||'Luckline'} · ${formatDate(post.publishedAt)}`;
    const title=document.createElement('h3');
    title.textContent=text(post.title)||'未命名文章';
    const summary=document.createElement('p');
    summary.textContent=text(post.summary)||'打开查看完整内容。';
    const action=document.createElement('b');
    action.textContent='阅读全文 →';
    link.append(meta,title,summary,action);
    article.append(link);
    return article;
  };
  fetch('https://timelens.cc/api/content/posts?page=1&pageSize=12')
    .then(response=>{
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(payload=>{
      const posts=selectFeatured(payload?.data?.list||[]);
      root.replaceChildren();
      if(posts.length){
        posts.forEach(post=>root.append(renderPost(post)));
        return;
      }
      root.innerHTML='<div class="home-content-loading-v6">原创内容正在整理中，稍后再来看看。</div>';
    })
    .catch(()=>{
      root.innerHTML='<div class="home-content-loading-v6"><a href="/content">前往内容中心 →</a></div>';
    });
})();
