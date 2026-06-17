#!/usr/bin/env node
/**
 * tvs-boss 团队面板 —— 零依赖本地网页 dashboard。
 *
 * 只用 node 内置（http / fs / child_process），不引任何三方库。
 * 起一个本地服务，浏览器打开一个带 tab、键盘可切换的面板：
 *   总览 / 项目 / 守则 / 契约 / 活跃态(现场 git)
 * 记忆三件套（projects.md / rules.md / contracts.md）是慢变量，直接读文件；
 * "谁在哪条分支干什么"是快变量，不存——打开活跃态 tab 时现场 git 推。
 *
 * 用法：node panel.mjs [--port 4500]
 *   从当前目录向上找团队根（含 .tvs-boss/），找到盘符根还没有就报错提示先建团。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, parse as parsePath } from 'node:path';
import { execSync } from 'node:child_process';

/** 从当前目录向上找团队根（含 .tvs-boss/），到盘符根停 */
function findTeamRoot(start = process.cwd()) {
    let dir = start;
    while (true) {
        if (existsSync(join(dir, '.tvs-boss'))) return dir;
        const up = parsePath(dir).dir;
        if (up === dir) return null; // 到根了
        dir = up;
    }
}

/** 读团队记忆某个 md，没有则返回占位 */
function readMem(root, name) {
    const p = join(root, '.tvs-boss', name);
    if (!existsSync(p)) return `（${name} 还没建）`;
    return readFileSync(p, 'utf8');
}

/** 从 projects.md 里抠出每个项目的 path（行形如 "- path: E:/xxx"） */
function parseProjectPaths(projectsMd) {
    const paths = [];
    for (const line of projectsMd.split('\n')) {
        const m = line.match(/^\s*-\s*path:\s*(.+?)\s*$/i);
        if (m) paths.push(m[1]);
    }
    return paths;
}

/** 现场 git：取某项目当前分支 + 最近一条 commit；失败则如实报 */
function gitState(path) {
    try {
        const branch = execSync(`git -C "${path}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf8' }).trim();
        const last = execSync(`git -C "${path}" log -1 --format=%s`, { encoding: 'utf8' }).trim();
        const dirty = execSync(`git -C "${path}" status --porcelain`, { encoding: 'utf8' }).trim() !== '';
        return { path, branch, last, dirty };
    } catch (e) {
        return { path, error: '读不到 git（路径不存在或非仓库）' };
    }
}

/** 组装当前状态 JSON */
function buildState(root) {
    const projectsMd = readMem(root, 'projects.md');
    const active = parseProjectPaths(projectsMd).map(gitState);
    return {
        root,
        projects: projectsMd,
        rules: readMem(root, 'rules.md'),
        contracts: readMem(root, 'contracts.md'),
        active,
    };
}

/** 自包含页面：tab + 键盘(1~5)切换，纯 vanilla JS */
const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>tvs-boss 团队面板</title><style>
:root{--bg:#0d1117;--fg:#c9d1d9;--mut:#8b949e;--ac:#58a6ff;--line:#21262d;--ok:#3fb950;--warn:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 ui-monospace,Consolas,monospace}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px}
h1{font-size:15px;margin:0;color:var(--ac)}.root{color:var(--mut);font-size:12px}
nav{display:flex;gap:4px;padding:8px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav button{background:transparent;border:1px solid var(--line);color:var(--mut);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}
nav button.on{color:var(--bg);background:var(--ac);border-color:var(--ac)}
nav button .k{opacity:.6;margin-right:6px}
main{padding:20px;max-width:1000px}
pre{white-space:pre-wrap;word-break:break-word;background:#161b22;border:1px solid var(--line);border-radius:8px;padding:16px;margin:0}
.card{background:#161b22;border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:10px}
.card .b{color:var(--ac);font-weight:600}.dirty{color:var(--warn)}.clean{color:var(--ok)}.err{color:#f85149}
.hint{color:var(--mut);font-size:12px;margin-top:14px}
</style></head><body>
<header><h1>tvs-boss 团队面板</h1><span class="root" id="root"></span></header>
<nav id="nav"></nav><main id="view"></main>
<script>
const TABS=[['总览','overview'],['项目','projects'],['守则','rules'],['契约','contracts'],['活跃态','active']];
let S={},cur=0;
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function render(){
  document.getElementById('root').textContent=S.root||'';
  const nav=document.getElementById('nav');nav.innerHTML='';
  TABS.forEach((t,i)=>{const b=document.createElement('button');b.className=i===cur?'on':'';
    b.innerHTML='<span class="k">'+(i+1)+'</span>'+t[0];b.onclick=()=>{cur=i;render()};nav.appendChild(b)});
  const v=document.getElementById('view');const key=TABS[cur][1];
  if(key==='overview'){
    const n=(S.active||[]).length;
    v.innerHTML='<div class="card"><div class="b">团队根</div>'+esc(S.root)+'</div>'
      +'<div class="card"><div class="b">项目数</div>'+n+'</div>'
      +'<p class="hint">慢变量（项目/守则/契约）来自 .tvs-boss 的 md；活跃态是现场 git 推的，不落盘。按 1~5 切 tab。</p>';
  }else if(key==='active'){
    const rows=(S.active||[]).map(a=>a.error
      ?'<div class="card"><span class="b">'+esc(a.path)+'</span> <span class="err">'+esc(a.error)+'</span></div>'
      :'<div class="card"><span class="b">'+esc(a.path)+'</span><br>分支 <b>'+esc(a.branch)+'</b> '
        +(a.dirty?'<span class="dirty">●有改动</span>':'<span class="clean">○干净</span>')
        +'<br><span class="hint">最近: '+esc(a.last)+'</span></div>').join('');
    v.innerHTML=rows||'<p class="hint">没有项目。先 /tvs-boss 建团。</p>';
  }else{
    v.innerHTML='<pre>'+esc(S[key])+'</pre>';
  }
}
document.addEventListener('keydown',e=>{const n=parseInt(e.key);if(n>=1&&n<=TABS.length){cur=n-1;render()}});
fetch('/api/state').then(r=>r.json()).then(d=>{S=d;render()});
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
        if (req.url === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(buildState(root)));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(PAGE);
        }
    }).listen(port, () => {
        console.log(`tvs-boss 面板已起：http://localhost:${port}  （团队根 ${root}）`);
        console.log('浏览器打开上面地址；Ctrl+C 关闭。');
    });
}

if (process.argv[1]?.endsWith('panel.mjs')) main();
