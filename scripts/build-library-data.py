#!/usr/bin/env python3
"""Create the public Luckline Index from a Chrome bookmark export."""
import json, re, sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

class Parser(HTMLParser):
    def __init__(self): super().__init__(); self.folder="未分类"; self.kind=None; self.buf=[]; self.href=""; self.items=[]
    def handle_starttag(self, tag, attrs):
        if tag.lower()=="h3": self.kind="folder"; self.buf=[]
        elif tag.lower()=="a": self.kind="link"; self.buf=[]; self.href=dict(attrs).get("href","")
    def handle_data(self, data):
        if self.kind: self.buf.append(data)
    def handle_endtag(self, tag):
        if tag.lower()=="h3" and self.kind=="folder": self.folder="".join(self.buf).strip() or "未分类"; self.kind=None
        elif tag.lower()=="a" and self.kind=="link": self.items.append((self.folder,"".join(self.buf).strip(),self.href)); self.kind=None

CATEGORIES={
 "质量工程":("测试","质量","selenium","playwright","jmeter","自动化","覆盖率","持续集成"),
 "软件工程":("java","python","mysql","数据库","linux","spring","maven","mybatis","redis","架构","微服务","算法","设计模式","tomcat","jdk","中间件"),
 "前端与 Web":("javascript"," js","css","html","前端","web","vscode","phantomjs","casperjs","jasmine","karma","移动端"),
 "AI 与产品":("人工智能"," ai","产品","管理","创业","未来","视野","github"),
 "旅行与生活":("旅游","旅行","生活","音乐","电影","城市","读书","英语")}
PRIVATE=("iqiyi","qiyi.domain","qiyi.virtual","jenkins","pms.","gitlab.","测试环境","线上质量-","月报","订单比例","璞玉爱奇艺")
SENSITIVE=("公积金","个税","办税","征信","信用信息","学信档案","学籍查询","成绩查询","预约挂号","积分落户","卖家工作台","个人申请","账户","archive.action","manage.do","localhost","chrome://","file://","招聘","内推","影院","就业管理系统","wiki.n.miui.com","广告位出售")
PREFERRED=("github.com","python.org","developer.mozilla.org","w3.org","ibm.com","runoob.com","ruanyifeng.com","testerhome.com","segmentfault.com","zhihu.com","cnblogs.com","csdn.net")

def unsafe(folder,title,url):
    text=f"{folder} {title} {url}".lower(); host=(urlsplit(url).hostname or "").lower()
    return any(x in text for x in PRIVATE+SENSITIVE) or host in {"localhost","127.0.0.1"} or host.startswith(("10.","192.168.","172.16.")) or urlsplit(url).scheme not in {"http","https"}
def clean_url(url):
    p=urlsplit(url); query=""
    if p.hostname in {"youtube.com","www.youtube.com","youtu.be"}: query=urlencode([(k,v) for k,v in parse_qsl(p.query) if k=="v"])
    return urlunsplit(("https",p.netloc,p.path,query,""))
def classify(folder,title):
    text=f" {folder} {title}".lower()
    return next((name for name,keys in CATEGORIES.items() if any(k in text for k in keys)),"工程视野")
def rank(item):
    title,url,category=item; host=(urlsplit(url).hostname or "").removeprefix("www.")
    return (20 if any(host.endswith(d) for d in PREFERRED) else 0)+(7 if url.startswith("https://") else 0)+min(len(title),50)/10+(5 if category=="质量工程" else 0)
def main():
    source=Path(sys.argv[1] if len(sys.argv)>1 else "/Users/user/Downloads/bookmarks_2026_7_19.html"); target=Path(sys.argv[2] if len(sys.argv)>2 else "library-data.js")
    parser=Parser(); parser.feed(source.read_text(encoding="utf-8",errors="ignore")); seen=set(); groups=defaultdict(list); rejected=0
    for folder,raw_title,raw_url in parser.items:
        title=re.sub(r"\s+"," ",raw_title).strip()
        if not title or unsafe(folder,title,raw_url): rejected+=1; continue
        url=clean_url(raw_url); key=url.rstrip("/").lower()
        if key in seen: continue
        seen.add(key); category=classify(folder,title); groups[category].append((title[:120],url,category))
    limits={"质量工程":32,"软件工程":34,"前端与 Web":20,"AI 与产品":14,"旅行与生活":10,"工程视野":10}; selected=[]
    for category,limit in limits.items(): selected.extend(sorted(groups[category],key=rank,reverse=True)[:limit])
    selected.sort(key=lambda x:(-rank(x),x[2],x[0])); notes={"质量工程":"测试方法、工程实践与质量体系参考。","软件工程":"用于理解工程原理与开发实践。","前端与 Web":"Web 技术、工具与浏览器实践参考。","AI 与产品":"关于产品、工具与技术趋势的长期观察。","旅行与生活":"旅行、城市与生活灵感收藏。","工程视野":"拓展工程判断与问题视角。"}
    featured_keys=("neteasegame/atx","httprunnermanager","测试用例设计经典","职业发展","jacoco 插桩","spring 中@transactional")
    records=[{"id":i,"title":t,"url":u,"domain":(urlsplit(u).hostname or "").removeprefix("www."),"category":c,"featured":any(k in (t+u).lower() for k in featured_keys),"note":notes[c]} for i,(t,u,c) in enumerate(selected,1)]
    payload={"updatedAt":"2026-07-21","sourceCount":len(parser.items),"privateCount":rejected,"items":records}
    target.write_text("window.LUCKLINE_LIBRARY = "+json.dumps(payload,ensure_ascii=False,indent=2)+";\n",encoding="utf-8")
    print(f"Generated {len(records)} public links; rejected {rejected} private or unsafe entries.")
if __name__=="__main__": main()
