/* wiki-plugin-similarity - 0.4.1 - Sat, 27 Jun 2026 15:58:47 GMT */
(()=>{var F={high:.78,medium:.68,low:.58},O=F.medium,q=10,N=t=>{let e=[],i=null,s=null,o="search",x=!1,y=!1,v=null,b=null,p=(n,c)=>n===c||n.startsWith(c)&&/^[\s:]/.test(n.slice(c.length)),w=(n,c)=>n.slice(c.length).replace(/^\s*:?\s*/,"").trim();for(let n of t.split(`
`)){let c=n.trim();if(!c||c.startsWith("#"))continue;let g=c.toUpperCase();if(p(g,"LIVE")){x=!0;continue}if(p(g,"AUTHOR")){!e.length&&o==="search"&&(o="author");continue}if(p(g,"REPORT")){o==="search"&&(o="report");continue}if(p(g,"BUILD")){o==="search"&&(o="build");continue}if(p(g,"FORCE")){y=!0;continue}if(p(g,"GHOST")){v=w(c,"GHOST"),o==="search"&&(o="ghost");continue}if(p(g,"BUTTON")){b=w(c,"BUTTON");continue}if(p(g,"LIST")){!e.length&&o==="search"&&(o="list");continue}if(p(g,"SIMILAR")){let k=w(g,"SIMILAR").toLowerCase();i=F[k]||O,!e.length&&o==="search"&&(o="similar");continue}if(p(g,"THRESHOLD")){let k=w(c,"THRESHOLD");i=F[k.toLowerCase()]??(parseFloat(k)||O);continue}if(p(g,"LIMIT")){s=parseInt(w(c,"LIMIT"))||q;continue}e.push(["PUBLIC","LOCAL","PRIVATE"].includes(g)?g:c)}return{mode:o,specs:e,threshold:i??O,limit:s??q,live:x,force:y,ghostUrl:v,label:b,thresholdSet:i!==null}},Y=t=>t.includes("*")||t.includes("?"),Q=t=>t==="PUBLIC"||t==="LOCAL"||t==="PRIVATE",X=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),M=new Map,Z=async(t,e)=>{if(M.has(t))return M.get(t);let i=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(i);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let o=await s.json();return M.set(t,o),o},B=async(t,e)=>{t.length||(t=[window.location.hostname]);let i=new Set,s=[];for(let o of t)if(o==="*"||Y(o)||Q(o))for(let x of await Z(o,e))i.has(x.domain)||(i.add(x.domain),s.push(x));else i.has(o)||(i.add(o),s.push({domain:o,page_count:null}));return s},U=new Map,tt=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},et=t=>tt()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`${window.location.protocol}//${t}/system/semantic-vectors.json`,V=async t=>{if(U.has(t))return U.get(t);let e=await fetch(et(t));if(!e.ok)return[];let i=await e.json();return U.set(t,i),i},H=async(t,e)=>{let i=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!i.ok)throw new Error(`embed failed: ${i.status}`);return(await i.json()).vector},st=async(t,e)=>{let s=(await V(e)).find(o=>o.slug===t);return s?s.vector:null},P=(t,e,{threshold:i,limit:s,excludeSlug:o,excludeDomain:x})=>{let y=[];for(let{domain:v,pages:b}of e)for(let{slug:p,title:w,vector:n}of b){if(p===o&&v===x)continue;let c=0;for(let g=0;g<t.length;g++)c+=t[g]*n[g];c>=i&&y.push({domain:v,slug:p,title:w,score:c})}return y.sort((v,b)=>b.score-v.score),y.slice(0,s)},A=async(t,e)=>{let i=await B(t,e);return(await Promise.all(i.map(async({domain:o})=>({domain:o,pages:await V(o)})))).filter(o=>o.pages.length>0)},G=t=>`sim-cache-${t}`,nt=t=>{try{let e=JSON.parse(localStorage.getItem(G(t.id))||"null");return e?.text===(t.text||"")?e:null}catch{return null}},I=(t,e)=>{try{localStorage.setItem(G(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...e}))}catch{}},it=t=>{let e=Math.floor((Date.now()-t)/1e3);return e<60?`${e}s ago`:e<3600?`${Math.floor(e/60)}m ago`:e<86400?`${Math.floor(e/3600)}h ago`:`${Math.floor(e/86400)}d ago`},j=`
  .sim-form { display:flex; gap:6px; margin-bottom:8px; }
  .sim-input { flex:1; padding:6px 8px; font-size:14px; border:1px solid #ccc; border-radius:3px; }
  .sim-btn { padding:6px 14px; background:#c4561d; color:white; border:none;
             border-radius:3px; cursor:pointer; font-size:14px; }
  .sim-btn:disabled { opacity:0.5; cursor:not-allowed; }
  .sim-status { font-size:12px; color:#888; margin-bottom:6px; min-height:16px; }
  .sim-results { margin-top:4px; }
  .sim-result { display:flex; align-items:center; gap:8px; padding:3px 0;
                border-bottom:1px solid #f0f0f0; }
  .sim-flag { width:16px; height:16px; vertical-align:middle; margin-right:4px; }
  .sim-link { font-size:14px; color:#406; flex:1; }
  .sim-domain { font-size:11px; color:#999; }
  .similar-results h3, .sim-list h3 { margin:4px 0 6px; font-size:14px; color:#555; }
  .similar-results ul { margin:0; padding-left:18px; }
  .similar-results li { font-size:14px; padding:2px 0; }
  .similar-results .sim-domain { margin-left:6px; }
  .sim-count { font-size:12px; color:#888; margin:4px 0 0; }
  .sim-list table { border-collapse:collapse; width:100%; font-size:13px; }
  .sim-list th { text-align:left; font-size:11px; color:#888; padding:2px 8px 4px 0;
                 border-bottom:1px solid #ddd; }
  .sim-list td { padding:3px 8px 3px 0; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
  .sim-list td:last-child { text-align:right; color:#999; font-size:11px; }
  .sim-list .sim-flag { margin-right:6px; }
`,ot=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,z=(t,e,i,s)=>`<a class="sim-link" data-title="${i}" data-slug="${e}" data-site="${t}" href="#">${ot(t,s)} ${i}</a>`,at=(t,e)=>{let{mode:i,specs:s,threshold:o,limit:x,force:y,ghostUrl:v,label:b}=N(e?.text||"");if(i==="ghost")t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${b||"Open"}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(i==="build")t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${b||`Index ${s.length?s.join(", "):"*"}${y?" (force)":""}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(i==="list"){let p=s.length?s.join(", "):"*";t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${p})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(i==="similar"){let p=s.length?s.join(", "):"current domain";t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${p}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else if(i==="author"||i==="report"){let p=s.length?s.join(", "):"(current domain)",w=i==="report"?"Report":"Author";t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">${w}</button>
        </div>
        <div class="sim-status">Domains: ${p}</div>
        <div class="sim-results"></div>
      </div>`)}else{let p=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${j}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${p}</div>
        <div class="sim-results"></div>
      </div>`)}},lt=(t,e)=>{let{mode:i,specs:s,threshold:o,limit:x,live:y,force:v,ghostUrl:b,thresholdSet:p}=N(e?.text||""),w=window.location.origin,n=t.find(".sim-status")[0],c=y?null:nt(e),g=(d,h,r)=>{let l=[`${d} \u2014 ${h.toLocaleString()} pages across ${r} domains`];return p&&l.push(`threshold ${o}`),l.push(`limit ${x}`),y&&l.push("LIVE"),l.join(" \xB7 ")};t.on("dblclick",d=>{$(d.target).closest(".sim-input").length||window.wiki.textEditor(t,e)}),t.on("click",".sim-link",function(d){d.preventDefault();let h=$(this),r=d.shiftKey?null:t.parents(".page");window.wiki.doInternalLink(h.data("title"),r,h.data("site"))});let k=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",R=d=>d?` \xB7 cached ${it(d)}`:"";if(i==="list"){let d=t.find(".sim-list")[0],h=s.length?s.join(","):"*",r=(l,m)=>{let a=l.reduce((u,f)=>u+(f.page_count||0),0);n.style.display="none",d.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${l.map(({domain:u,page_count:f})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(u).flag()}"
                       title="${u}" data-site="${u}"> ${u}</td>
              <td>${f!=null?f.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${l.length} domains \u2014 ${a.toLocaleString()} pages${R(m)}</p>`};c?.domains?r(c.domains,c.ts):(async()=>{try{let l=`${w}/system/indexed-domains.json?pattern=${encodeURIComponent(h)}&limit=${x}`,m=await fetch(l);if(!m.ok)throw new Error(`indexed-domains failed: ${m.status}`);let a=await m.json();if(!a.length){n.textContent="No indexed domains found";return}r(a,null),I(e,{domains:a})}catch(l){n.textContent=`Error: ${l.message}`}})()}else if(i==="similar"){let d=t.find(".sim-results")[0],h=(r,l)=>{if(!r.length){n.textContent=`No similar pages found above threshold ${o}`;return}d.innerHTML=`<h3>Similar Pages</h3><ul>${r.map(({domain:m,slug:a,title:u,score:f})=>`<li>${z(m,a,u,f)}</li>`).join("")}</ul><p class="sim-count">${r.length} found ${k}${R(l)}</p>`,n.style.display="none"};c?.scored?h(c.scored,c.ts):(async()=>{try{let r=t.parents(".page"),l=r.find(".title").text().trim()||document.title,m=X(l),a=window.location.hostname,u=await A(s,w),f=u.reduce((C,T)=>C+T.pages.length,0);n.textContent=`Searching ${f.toLocaleString()} pages\u2026`;let L=await st(m,a);if(!L){n.textContent="Embedding page (not yet indexed)\u2026";let C=r.find(".item").map((T,D)=>$(D).text().trim()).get().filter(Boolean).join(`
`);L=await H(C||l,w)}let S=P(L,u,{threshold:o,limit:x,excludeSlug:m,excludeDomain:a});h(S,null),S.length&&I(e,{scored:S})}catch(r){n.textContent=`Error: ${r.message}`}})()}else if(i==="ghost"){let d=t.find(".sim-btn")[0],h=async()=>{if(!b){n.textContent="No URL \u2014 GHOST needs a page-json URL";return}d.disabled=!0,n.textContent="Fetching\u2026";try{let r=await fetch(b);if(!r.ok)throw new Error(`fetch failed: ${r.status}`);let l=await r.json();window.wiki.showResult(window.wiki.newPage(l),{$page:t.parents(".page")}),n.textContent=""}catch(r){n.textContent=`Error: ${r.message}`}finally{d.disabled=!1}};d.addEventListener("click",h)}else if(i==="build"){let d=t.find(".sim-btn")[0],h=async()=>{d.disabled=!0,n.textContent="Building index\u2026 (may take a while for large scopes)";try{let r=encodeURIComponent((s.length?s:["*"]).join(",")),l=await fetch(`http://api.localhost/build-index.json?domains=${r}&force=${v?1:0}`);if(!l.ok)throw new Error(`build-index failed: ${l.status}`);let m=await l.json();window.wiki.showResult(window.wiki.newPage(m),{$page:t.parents(".page")}),n.textContent=""}catch(r){n.textContent=`Error: ${r.message}`}finally{d.disabled=!1}};d.addEventListener("click",h)}else if(i==="report"){let d=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],r=`Domains: ${s.length?s.join(", "):"*"}`;(async()=>{try{let m=await B(s.length?s:["*"],w),a=m.reduce((u,f)=>u+(f.page_count||0),0);r=g("Report ready",a,m.length),n.textContent=r}catch(m){n.textContent=`Domain listing unavailable: ${m.message}`}})();let l=async()=>{let m=d.value.trim();if(m){h.disabled=!0,n.textContent="Generating report\u2026";try{let a={query:m,domains:s.length?s:["*"],limit:x,live:y};p&&(a.threshold=o);let u=await fetch("http://api.localhost/search-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a)});if(!u.ok)throw new Error(`search-report failed: ${u.status}`);let f=await u.json(),L=window.wiki.newPage(f);window.wiki.showResult(L,{$page:t.parents(".page")}),n.textContent=r}catch(a){n.textContent=`Error: ${a.message}`}finally{h.disabled=!1}}};h.addEventListener("click",l),d.addEventListener("keydown",m=>{m.key==="Enter"&&l()})}else if(i==="author"){let d=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],r=t.find(".sim-results")[0],l=null;(async()=>{try{c||(n.textContent="Resolving domains\u2026"),l=await A(s,w);let a=l.reduce((u,f)=>u+f.pages.length,0);n.textContent=g("Author ready",a,l.length)}catch(a){n.textContent=`Load error: ${a.message}`}})();let m=async()=>{let a=d.value.trim();if(!(!a||!l)){h.disabled=!0,n.textContent="Embedding query\u2026",r.innerHTML="";try{let u=await H(a,w),f=P(u,l,{threshold:o,limit:x,excludeSlug:null,excludeDomain:null}),L=new Set,S=[];for(let{title:E}of f)L.has(E)||(L.add(E),S.push(E));let C=()=>Math.floor(Math.random()*18446744073709552e3).toString(16).padStart(16,"0"),T=S.map(E=>`- [[${E}]]`).join(`
`),D=[{type:"markdown",id:C(),text:`# Similar Pages

${T}`},{type:"markdown",id:C(),text:"# Reference Links"},...f.map(({domain:E,slug:J,title:W,score:K})=>({type:"reference",id:C(),site:E,slug:J,title:W,text:`score ${K.toFixed(3)}`}))],_=window.wiki.newPage({title:`${a} Results`,story:D,journal:[]});window.wiki.showResult(_,{$page:t.parents(".page")}),n.textContent=`${f.length} pages found`,I(e,{scored:f,query:a})}catch(u){n.textContent=`Error: ${u.message}`}finally{h.disabled=!1}}};h.addEventListener("click",m),d.addEventListener("keydown",a=>{a.key==="Enter"&&m()})}else{let d=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],r=t.find(".sim-results")[0],l=null;c?.scored&&(d.value=c.query||"",r.innerHTML=c.scored.map(({domain:a,slug:u,title:f,score:L})=>`<div class="sim-result">${z(a,u,f,L)}</div>`).join("")+`<p class="sim-count">Top ${c.scored.length} for "${c.query||""}"${R(c.ts)}</p>`,n.textContent=""),(async()=>{try{c||(n.textContent="Resolving domains\u2026"),l=await A(s,w);let a=l.reduce((u,f)=>u+f.pages.length,0);n.textContent=g("Search ready",a,l.length)}catch(a){n.textContent=`Load error: ${a.message}`}})();let m=async()=>{let a=d.value.trim();if(!(!a||!l)){h.disabled=!0,n.textContent="Embedding query\u2026",r.innerHTML="";try{let u=await H(a,w),f=P(u,l,{threshold:o,limit:x,excludeSlug:null,excludeDomain:null});r.innerHTML=f.map(({domain:L,slug:S,title:C,score:T})=>`<div class="sim-result">${z(L,S,C,T)}</div>`).join("")+`<p class="sim-count">Top ${f.length} for "${a}"</p>`,n.textContent="",I(e,{scored:f,query:a})}catch(u){n.textContent=`Error: ${u.message}`}finally{h.disabled=!1}}};h.addEventListener("click",m),d.addEventListener("keydown",a=>{a.key==="Enter"&&m()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:at,bind:lt});})();
//# sourceMappingURL=similarity.js.map
