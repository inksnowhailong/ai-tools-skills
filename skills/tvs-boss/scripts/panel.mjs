#!/usr/bin/env node
/**
 * tvs-boss 团队面板 —— 零依赖本地网页 dashboard（v3：SSE 实时推送 + 在岗名单）。
 *
 * 只用 node 内置（http / fs / child_process），不引任何三方库。
 * 实时来源两路，都走一个 SSE 流推给浏览器（客户端不再自己轮询）：
 *   - 文件变（.tvs-boss 下记忆/在岗名单）→ fs.watch 即时推
 *   - git 活跃态（分支/改动/领先落后/提交）→ 服务端每 2s 重扫一次再推
 * 慢变量：projects.md / rules.md / contracts.md（直接读）。
 * 在岗名单：live-agents.json —— 这是【运行态 scratchpad，不是记忆】，由 leader 每次 spawn/回收时覆盖写，
 *   reflect 当前在岗（spawn 列表 git 推不出来，所以这一项破例落一个会被不断覆盖的临时文件）。
 *
 * 用法：node panel.mjs [--port 4500]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, watch } from 'node:fs';
import { join, parse as parsePath } from 'node:path';
import { execSync } from 'node:child_process';

function findTeamRoot(start = process.cwd()) {
    let dir = start;
    while (true) {
        if (existsSync(join(dir, '.tvs-boss'))) return dir;
        const up = parsePath(dir).dir;
        if (up === dir) return null;
        dir = up;
    }
}

function readMem(root, name) {
    const p = join(root, '.tvs-boss', name);
    if (!existsSync(p)) return `（${name} 还没建）`;
    return readFileSync(p, 'utf8');
}

/** 读在岗名单（运行态文件，可能不存在） */
function readLiveAgents(root) {
    const p = join(root, '.tvs-boss', 'live-agents.json');
    if (!existsSync(p)) return { updatedAt: '', agents: [] };
    try { const j = JSON.parse(readFileSync(p, 'utf8')); return { updatedAt: j.updatedAt || '', agents: j.agents || [] }; }
    catch { return { updatedAt: '', agents: [] }; }
}

function parseProjects(md) {
    const out = [];
    let cur = null;
    for (const line of md.split('\n')) {
        const h = line.match(/^##\s+(.+?)\s*$/);
        if (h) { cur = { id: h[1], path: '', main: 'main' }; out.push(cur); continue; }
        if (!cur) continue;
        const mp = line.match(/^\s*-\s*path:\s*(.+?)\s*$/i);
        if (mp) cur.path = mp[1];
        const mm = line.match(/^\s*-\s*主分支:\s*(.+?)\s*$/);
        if (mm) cur.main = mm[1];
    }
    return out;
}

function git(path, args) {
    try { return execSync(`git -C "${path}" ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
}

function gitSnapshot(p) {
    const branch = git(p.path, 'rev-parse --abbrev-ref HEAD');
    if (branch === null) return { ...p, error: '读不到 git（路径不存在或非仓库）' };
    const porcelain = git(p.path, 'status --porcelain') || '';
    const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
    let ahead = 0, behind = 0;
    const lr = git(p.path, `rev-list --left-right --count ${p.main}...HEAD`);
    if (lr) { const [b, a] = lr.split(/\s+/).map(Number); behind = b || 0; ahead = a || 0; }
    const branches = (git(p.path, 'branch --format=%(refname:short)') || '')
        .split('\n').map((s) => s.trim()).filter((s) => s && s !== p.main);
    const last = git(p.path, 'log -1 --format="%s|%cr|%an"') || '';
    const [msg, when, who] = last.split('|');
    return { ...p, branch, dirty, ahead, behind, branches, last: { msg, when, who } };
}

function buildState(root) {
    const projectsMd = readMem(root, 'projects.md');
    const live = readLiveAgents(root);
    return {
        root,
        now: new Date().toLocaleTimeString('zh-CN'),
        projects: parseProjects(projectsMd).map(gitSnapshot),
        agents: live.agents,
        agentsUpdatedAt: live.updatedAt,
        rulesMd: readMem(root, 'rules.md'),
        contractsMd: readMem(root, 'contracts.md'),
    };
}

const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>tvs-boss 团队面板</title><style>
:root{--bg:#1a1b26;--panel:#1f2335;--card:#24283b;--line:#2f344d;
  --fg:#c0caf5;--mut:#565f89;--dim:#787c99;
  --ac:#7aa2f7;--ok:#9ece6a;--warn:#e0af68;--bad:#f7768e;--info:#7dcfff;--pur:#bb9af7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13.5px/1.65 ui-monospace,"SF Mono",Consolas,monospace}
header{padding:16px 24px;display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--line)}
h1{font-size:15px;margin:0;color:var(--ac);font-weight:600;letter-spacing:.3px}
.root{color:var(--mut);font-size:12px}
.live{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--dim);font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok);transition:.3s}
.dot.off{background:var(--bad);box-shadow:none}
.flash{animation:fl .6s}@keyframes fl{0%{background:var(--info)}100%{background:var(--ok)}}
nav{display:flex;gap:6px;padding:12px 24px;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav button{background:transparent;border:1px solid var(--line);color:var(--dim);padding:7px 16px;border-radius:8px;cursor:pointer;font:inherit;transition:.15s}
nav button:hover{color:var(--fg);border-color:var(--mut)}
nav button.on{color:var(--bg);background:var(--ac);border-color:var(--ac);font-weight:600}
nav button .k{opacity:.55;margin-right:7px;font-size:11px}
main{padding:24px;max-width:1080px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card h3{margin:0 0 4px;font-size:14px;color:var(--fg)}
.path{color:var(--mut);font-size:11px;margin-bottom:12px;word-break:break-all}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:7px 0}
.tag{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;font-size:11.5px;background:var(--panel);border:1px solid var(--line)}
.tag.branch{color:var(--info)}.tag.clean{color:var(--ok)}.tag.dirty{color:var(--warn)}
.tag.ahead{color:var(--ok)}.tag.behind{color:var(--bad)}.tag.warm{color:var(--ok)}.tag.role{color:var(--pur)}
.feat{margin:10px 0 4px;padding-top:10px;border-top:1px dashed var(--line)}
.feat .lbl{color:var(--mut);font-size:11px;margin-bottom:5px}
.feat span{display:inline-block;color:var(--info);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:2px 8px;margin:0 5px 5px 0;font-size:11.5px}
.last{color:var(--dim);font-size:11.5px;margin-top:10px}.last b{color:var(--fg);font-weight:500}
.err{color:var(--bad)}
.ov{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 20px;min-width:110px}
.stat .n{font-size:24px;color:var(--ac);font-weight:600}.stat .l{color:var(--mut);font-size:12px}
.doc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px}
.doc h2{font-size:15px;color:var(--ac);margin:18px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
.doc h2:first-child{margin-top:0}.doc li{margin:4px 0}.doc p{color:var(--dim)}
.empty{color:var(--mut);padding:30px;text-align:center}
</style></head><body>
<header><h1>⬢ tvs-boss</h1><span class="root" id="root"></span>
  <span class="live"><span class="dot" id="dot"></span><span id="livetxt">连接中…</span></span></header>
<nav id="nav"></nav><main id="view"></main>
<script>
const TABS=[['总览','overview'],['项目','projects'],['团队','team'],['守则','rules'],['契约','contracts']];
let S={},cur=0;
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function md(t){const out=[];let ul=false;
  for(const raw of (t||'').split('\\n')){const l=raw.trimEnd();
    if(/^##\\s+/.test(l)){if(ul){out.push('</ul>');ul=false}out.push('<h2>'+esc(l.replace(/^##\\s+/,''))+'</h2>')}
    else if(/^[-*]\\s+/.test(l)){if(!ul){out.push('<ul>');ul=true}out.push('<li>'+esc(l.replace(/^[-*]\\s+/,''))+'</li>')}
    else if(l===''){if(ul){out.push('</ul>');ul=false}}
    else{if(ul){out.push('</ul>');ul=false}if(!/^#\\s/.test(l))out.push('<p>'+esc(l)+'</p>')}}
  if(ul)out.push('</ul>');return out.join('')}
function projectCard(p){
  if(p.error)return '<div class="card"><h3>'+esc(p.id)+'</h3><div class="path">'+esc(p.path)+'</div><div class="err">'+esc(p.error)+'</div></div>';
  const d=p.dirty>0?'<span class="tag dirty">●'+p.dirty+' 改动</span>':'<span class="tag clean">○ 干净</span>';
  const ab=(p.ahead?'<span class="tag ahead">↑'+p.ahead+'</span>':'')+(p.behind?'<span class="tag behind">↓'+p.behind+'</span>':'');
  const feat=p.branches.length?'<div class="feat"><div class="lbl">在途分支（'+p.branches.length+'）</div>'+p.branches.map(b=>'<span>'+esc(b)+'</span>').join('')+'</div>':'<div class="feat"><div class="lbl">在途分支</div><span style="color:var(--mut);border:0;background:none;padding-left:0">— 无</span></div>';
  const last=p.last&&p.last.msg?'<div class="last">最近 <b>'+esc(p.last.msg)+'</b><br>'+esc(p.last.when||'')+' · '+esc(p.last.who||'')+'</div>':'';
  return '<div class="card"><h3>'+esc(p.id)+'</h3><div class="path">'+esc(p.path)+'</div><div class="row"><span class="tag branch">⎇ '+esc(p.branch)+'（主 '+esc(p.main)+'）</span></div><div class="row">'+d+ab+'</div>'+feat+last+'</div>';
}
function agentCard(a){
  return '<div class="card"><h3>'+esc(a.name||'?')+'</h3><div class="row">'
    +'<span class="tag role">'+esc(a.role||'?')+'</span>'
    +(a.project?'<span class="tag branch">'+esc(a.project)+'</span>':'')
    +'<span class="tag warm">'+esc(a.state||'在岗')+'</span></div>'
    +(a.since?'<div class="last">起于 '+esc(a.since)+'</div>':'')+'</div>';
}
function render(){
  document.getElementById('root').textContent=S.root?(S.root+'  ·  '+S.now):'';
  const nav=document.getElementById('nav');nav.innerHTML='';
  TABS.forEach((t,i)=>{const b=document.createElement('button');b.className=i===cur?'on':'';b.innerHTML='<span class="k">'+(i+1)+'</span>'+t[0];b.onclick=()=>{cur=i;render()};nav.appendChild(b)});
  const v=document.getElementById('view'),key=TABS[cur][1],ps=S.projects||[],ag=S.agents||[];
  if(key==='overview'){
    const dirty=ps.filter(p=>p.dirty>0).length,feat=ps.reduce((n,p)=>n+((p.branches||[]).length),0);
    v.innerHTML='<div class="ov">'
      +'<div class="stat"><div class="n">'+ps.length+'</div><div class="l">项目</div></div>'
      +'<div class="stat"><div class="n">'+ag.length+'</div><div class="l">在岗成员</div></div>'
      +'<div class="stat"><div class="n">'+feat+'</div><div class="l">在途分支</div></div>'
      +'<div class="stat"><div class="n">'+dirty+'</div><div class="l">有未提交</div></div></div>'
      +'<div class="grid">'+(ps.map(projectCard).join('')||'<div class="empty">还没登记项目，先 /tvs-boss 建团</div>')+'</div>';
  }else if(key==='projects'){v.innerHTML='<div class="grid">'+(ps.map(projectCard).join('')||'<div class="empty">还没登记项目</div>')+'</div>';}
  else if(key==='team'){
    v.innerHTML=ag.length?('<div class="grid">'+ag.map(agentCard).join('')+'</div>')
      :'<div class="empty">当前无在岗成员（懒启动：来活才 spawn）<br><span style="font-size:12px">leader 没在写 live-agents.json 时这里恒空</span></div>';
  }
  else if(key==='rules'){v.innerHTML='<div class="doc">'+md(S.rulesMd)+'</div>';}
  else{v.innerHTML='<div class="doc">'+md(S.contractsMd)+'</div>';}
}
// SSE：服务端推，客户端不轮询
function connect(){
  const es=new EventSource('/events');
  const dot=document.getElementById('dot'),txt=document.getElementById('livetxt');
  es.onopen=()=>{dot.className='dot';txt.textContent='实时'};
  es.onmessage=e=>{S=JSON.parse(e.data);render();dot.classList.remove('flash');void dot.offsetWidth;dot.classList.add('flash')};
  es.onerror=()=>{dot.className='dot off';txt.textContent='断了·重连中';};
}
document.addEventListener('keydown',e=>{const n=parseInt(e.key);if(n>=1&&n<=TABS.length){cur=n-1;render()}});
connect();
</script></body></html>`;

function main() {
    const portArg = process.argv.indexOf('--port');
    const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 4500;
    const root = findTeamRoot();
    if (!root) {
        console.error('没找到团队根（向上没发现 .tvs-boss/）。先在项目目录跑 /tvs-boss 建团。');
        process.exit(1);
    }
    createServer((req, res) => {
        if (req.url === '/events') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            const push = () => res.write(`data: ${JSON.stringify(buildState(root))}\n\n`);
            push();
            // 文件变即时推（记忆 / 在岗名单）
            let fsTimer = null;
            let watcher;
            try {
                watcher = watch(join(root, '.tvs-boss'), () => {
                    clearTimeout(fsTimer);
                    fsTimer = setTimeout(push, 150); // 抖动合并
                });
            } catch { /* 平台不支持 watch 时降级靠下面的定时推 */ }
            // git 活跃态：每 2s 兜底重扫推一次
            const timer = setInterval(push, 2000);
            req.on('close', () => { clearInterval(timer); clearTimeout(fsTimer); watcher?.close(); });
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(PAGE);
        }
    }).listen(port, () => {
        console.log(`tvs-boss 面板已起：http://localhost:${port}  （团队根 ${root}）`);
        console.log('浏览器打开；SSE 实时推送（文件变即时 / git 每 2s）；键盘 1-5 切 tab；Ctrl+C 关闭。');
    });
}

if (process.argv[1]?.endsWith('panel.mjs')) main();
