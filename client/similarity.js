/* wiki-plugin-similarity - 0.5.0 - Sat, 11 Jul 2026 12:35:03 GMT */
(()=>{var z={high:.78,medium:.68,low:.58},O=z.medium,F=10,N=t=>{let n=[],a=null,e=null,r="search",x=!1,y=!1,C=null,b=null,h=(s,d)=>s===d||s.startsWith(d)&&/^[\s:]/.test(s.slice(d.length)),w=(s,d)=>s.slice(d.length).replace(/^\s*:?\s*/,"").trim();for(let s of t.split(`
`)){let d=s.trim();if(!d||d.startsWith("#"))continue;let g=d.toUpperCase();if(h(g,"LIVE")){x=!0;continue}if(h(g,"AUTHOR")){!n.length&&r==="search"&&(r="author");continue}if(h(g,"REPORT")){r==="search"&&(r="report");continue}if(h(g,"KEYWORD")){r==="search"&&(r="keyword");continue}if(h(g,"BUILD")){r==="search"&&(r="build");continue}if(h(g,"FORCE")){y=!0;continue}if(h(g,"GHOST")){C=w(d,"GHOST"),r==="search"&&(r="ghost");continue}if(h(g,"BUTTON")){b=w(d,"BUTTON");continue}if(h(g,"LIST")){!n.length&&r==="search"&&(r="list");continue}if(h(g,"SIMILAR")){let S=w(g,"SIMILAR").toLowerCase();a=z[S]||O,!n.length&&r==="search"&&(r="similar");continue}if(h(g,"THRESHOLD")){let S=w(d,"THRESHOLD");a=z[S.toLowerCase()]??(parseFloat(S)||O);continue}if(h(g,"LIMIT")){e=parseInt(w(d,"LIMIT"))||F;continue}n.push(["PUBLIC","LOCAL","PRIVATE"].includes(g)?g:d)}return{mode:r,specs:n,threshold:a??O,limit:e??F,live:x,force:y,ghostUrl:C,label:b,thresholdSet:a!==null}},Y=t=>t.includes("*")||t.includes("?"),Q=t=>t==="PUBLIC"||t==="LOCAL"||t==="PRIVATE",X=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),U=new Map,Z=async(t,n)=>{if(U.has(t))return U.get(t);let a=`${n}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,e=await fetch(a);if(!e.ok)throw new Error(`indexed-domains failed: ${e.status}`);let r=await e.json();return U.set(t,r),r},B=async(t,n)=>{t.length||(t=[window.location.hostname]);let a=new Set,e=[];for(let r of t)if(r==="*"||Y(r)||Q(r))for(let x of await Z(r,n))a.has(x.domain)||(a.add(x.domain),e.push(x));else a.has(r)||(a.add(r),e.push({domain:r,page_count:null}));return e},M=new Map,tt=t=>`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`,V=async t=>{if(M.has(t))return M.get(t);let n=await fetch(tt(t));if(!n.ok)return[];let a=await n.json();return M.set(t,a),a},H=async(t,n)=>{let a=await fetch(`${n}/system/embed.json?text=${encodeURIComponent(t)}`);if(!a.ok)throw new Error(`embed failed: ${a.status}`);return(await a.json()).vector},et=async(t,n)=>{let e=(await V(n)).find(r=>r.slug===t);return e?e.vector:null},P=(t,n,{threshold:a,limit:e,excludeSlug:r,excludeDomain:x})=>{let y=[];for(let{domain:C,pages:b}of n)for(let{slug:h,title:w,vector:s}of b){if(h===r&&C===x)continue;let d=0;for(let g=0;g<t.length;g++)d+=t[g]*s[g];d>=a&&y.push({domain:C,slug:h,title:w,score:d})}return y.sort((C,b)=>b.score-C.score),y.slice(0,e)},A=async(t,n)=>{let a=await B(t,n);return(await Promise.all(a.map(async({domain:r})=>({domain:r,pages:await V(r)})))).filter(r=>r.pages.length>0)},K=t=>`sim-cache-${t}`,nt=t=>{try{let n=JSON.parse(localStorage.getItem(K(t.id))||"null");return n?.text===(t.text||"")?n:null}catch{return null}},R=(t,n)=>{try{localStorage.setItem(K(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...n}))}catch{}},st=t=>{let n=Math.floor((Date.now()-t)/1e3);return n<60?`${n}s ago`:n<3600?`${Math.floor(n/60)}m ago`:n<86400?`${Math.floor(n/3600)}h ago`:`${Math.floor(n/86400)}d ago`},T=`
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
`,it=(t,n)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${n.toFixed(3)}"
        data-site="${t}">`,q=(t,n,a,e)=>`<a class="sim-link" data-title="${a}" data-slug="${n}" data-site="${t}" href="#">${it(t,e)} ${a}</a>`,ot=(t,n)=>{let{mode:a,specs:e,threshold:r,limit:x,force:y,ghostUrl:C,label:b}=N(n?.text||"");if(a==="ghost")t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-form">
          <button class="sim-btn">${b||"Open"}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(a==="build")t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-form">
          <button class="sim-btn">${b||`Index ${e.length?e.join(", "):"*"}${y?" (force)":""}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(a==="list"){let h=e.length?e.join(", "):"*";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-status">Loading indexed domains (${h})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(a==="similar"){let h=e.length?e.join(", "):"current domain";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-status">Finding similar pages across ${h}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else if(a==="author"||a==="report"||a==="keyword"){let h=e.length?e.join(", "):"(current domain)",w=a==="report"?"Report":a==="keyword"?"Keyword":"Author";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">${w}</button>
        </div>
        <div class="sim-status">Domains: ${h}</div>
        <div class="sim-results"></div>
      </div>`)}else{let h=e.length?e.join(", "):"(current domain)";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${n.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${h}</div>
        <div class="sim-results"></div>
      </div>`)}},at=(t,n)=>{let{mode:a,specs:e,threshold:r,limit:x,live:y,force:C,ghostUrl:b,thresholdSet:h}=N(n?.text||""),w=window.location.origin,s=t.find(".sim-status")[0],d=y?null:nt(n),g=(c,f,l)=>{let o=[`${c} \u2014 ${f.toLocaleString()} pages across ${l} domains`];return h&&o.push(`threshold ${r}`),o.push(`limit ${x}`),y&&o.push("LIVE"),o.join(" \xB7 ")};t.on("dblclick",c=>{$(c.target).closest(".sim-input").length||window.wiki.textEditor(t,n)}),t.on("click",".sim-link",function(c){c.preventDefault();let f=$(this),l=c.shiftKey?null:t.parents(".page");window.wiki.doInternalLink(f.data("title"),l,f.data("site"))});let S=!e.length||e.length===1&&e[0]==="*"?"on farm":e.length===1?`on ${e[0]}`:"in domains",I=c=>c?` \xB7 cached ${st(c)}`:"";if(a==="list"){let c=t.find(".sim-list")[0],f=e.length?e.join(","):"*",l=(o,m)=>{let i=o.reduce((u,p)=>u+(p.page_count||0),0);s.style.display="none",c.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${o.map(({domain:u,page_count:p})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(u).flag()}"
                       title="${u}" data-site="${u}"> ${u}</td>
              <td>${p!=null?p.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${o.length} domains \u2014 ${i.toLocaleString()} pages${I(m)}</p>`};d?.domains?l(d.domains,d.ts):(async()=>{try{let o=`${w}/system/indexed-domains.json?pattern=${encodeURIComponent(f)}&limit=${x}`,m=await fetch(o);if(!m.ok)throw new Error(`indexed-domains failed: ${m.status}`);let i=await m.json();if(!i.length){s.textContent="No indexed domains found";return}l(i,null),R(n,{domains:i})}catch(o){s.textContent=`Error: ${o.message}`}})()}else if(a==="similar"){let c=t.find(".sim-results")[0],f=(l,o)=>{if(!l.length){s.textContent=`No similar pages found above threshold ${r}`;return}c.innerHTML=`<h3>Similar Pages</h3><ul>${l.map(({domain:m,slug:i,title:u,score:p})=>`<li>${q(m,i,u,p)}</li>`).join("")}</ul><p class="sim-count">${l.length} found ${S}${I(o)}</p>`,s.style.display="none"};d?.scored?f(d.scored,d.ts):(async()=>{try{let l=t.parents(".page"),o=l.find(".title").text().trim()||document.title,m=X(o),i=window.location.hostname,u=await A(e,w),p=u.reduce((k,j)=>k+j.pages.length,0);s.textContent=`Searching ${p.toLocaleString()} pages\u2026`;let L=await et(m,i);if(!L){s.textContent="Embedding page (not yet indexed)\u2026";let k=l.find(".item").map((j,D)=>$(D).text().trim()).get().filter(Boolean).join(`
`);L=await H(k||o,w)}let v=P(L,u,{threshold:r,limit:x,excludeSlug:m,excludeDomain:i});f(v,null),v.length&&R(n,{scored:v})}catch(l){s.textContent=`Error: ${l.message}`}})()}else if(a==="ghost"){let c=t.find(".sim-btn")[0],f=async()=>{if(!b){s.textContent="No URL \u2014 GHOST needs a page-json URL";return}c.disabled=!0,s.textContent="Fetching\u2026";try{let l=await fetch(b);if(!l.ok)throw new Error(`fetch failed: ${l.status}`);let o=await l.json();window.wiki.showResult(window.wiki.newPage(o),{$page:t.parents(".page")}),s.textContent=""}catch(l){s.textContent=`Error: ${l.message}`}finally{c.disabled=!1}};c.addEventListener("click",f)}else if(a==="build"){let c=t.find(".sim-btn")[0],f=async()=>{c.disabled=!0,s.textContent="Building index\u2026 (may take a while for large scopes)";try{let l=encodeURIComponent((e.length?e:["*"]).join(",")),o=await fetch(`${w}/system/build-index.json?domains=${l}&force=${C?1:0}`);if(o.status===501){let i=await o.json().catch(()=>({}));throw new Error(i.hint||"indexing runs on the farm indexer, not this server")}if(!o.ok)throw new Error(`build-index failed: ${o.status}`);let m=await o.json();window.wiki.showResult(window.wiki.newPage(m),{$page:t.parents(".page")}),s.textContent=""}catch(l){s.textContent=`Error: ${l.message}`}finally{c.disabled=!1}};c.addEventListener("click",f)}else if(a==="report"){let c=t.find(".sim-input")[0],f=t.find(".sim-btn")[0],l=`Domains: ${e.length?e.join(", "):"*"}`;(async()=>{try{let m=await B(e.length?e:["*"],w),i=m.reduce((u,p)=>u+(p.page_count||0),0);l=g("Report ready",i,m.length),s.textContent=l}catch(m){s.textContent=`Domain listing unavailable: ${m.message}`}})();let o=async()=>{let m=c.value.trim();if(m){f.disabled=!0,s.textContent="Generating report\u2026";try{let i={query:m,domains:e.length?e:["*"],limit:x,live:y};h&&(i.threshold=r);let u=await fetch(`${w}/system/search-report.json`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(i)});if(!u.ok)throw new Error(`search-report failed: ${u.status}`);let p=await u.json(),L=window.wiki.newPage(p);window.wiki.showResult(L,{$page:t.parents(".page")}),s.textContent=l}catch(i){s.textContent=`Error: ${i.message}`}finally{f.disabled=!1}}};f.addEventListener("click",o),c.addEventListener("keydown",m=>{m.key==="Enter"&&o()})}else if(a==="keyword"){let c=t.find(".sim-input")[0],f=t.find(".sim-btn")[0];s.textContent=`Keyword search ready \u2014 domains: ${e.length?e.join(", "):"*"} \xB7 limit ${x}`;let l=async()=>{let o=c.value.trim();if(o){f.disabled=!0,s.textContent="Searching live site indexes\u2026";try{let m=encodeURIComponent((e.length?e:["*"]).join(",")),i=await fetch(`${w}/system/farm-search.json?q=${encodeURIComponent(o)}&pattern=${m}&limit=${x}`);if(!i.ok)throw new Error(`farm-search failed: ${i.status}`);let u=await i.json();window.wiki.showResult(window.wiki.newPage(u),{$page:t.parents(".page")}),s.textContent=`Keyword search ready \u2014 domains: ${e.length?e.join(", "):"*"} \xB7 limit ${x}`}catch(m){s.textContent=`Error: ${m.message}`}finally{f.disabled=!1}}};f.addEventListener("click",l),c.addEventListener("keydown",o=>{o.key==="Enter"&&l()})}else if(a==="author"){let c=t.find(".sim-input")[0],f=t.find(".sim-btn")[0],l=t.find(".sim-results")[0],o=null;(async()=>{try{d||(s.textContent="Resolving domains\u2026"),o=await A(e,w);let i=o.reduce((u,p)=>u+p.pages.length,0);s.textContent=g("Author ready",i,o.length)}catch(i){s.textContent=`Load error: ${i.message}`}})();let m=async()=>{let i=c.value.trim();if(!(!i||!o)){f.disabled=!0,s.textContent="Embedding query\u2026",l.innerHTML="";try{let u=await H(i,w),p=P(u,o,{threshold:r,limit:x,excludeSlug:null,excludeDomain:null}),L=new Set,v=[];for(let{title:E}of p)L.has(E)||(L.add(E),v.push(E));let k=()=>Math.floor(Math.random()*18446744073709552e3).toString(16).padStart(16,"0"),j=v.map(E=>`- [[${E}]]`).join(`
`),D=[{type:"markdown",id:k(),text:`# Similar Pages

${j}`},{type:"markdown",id:k(),text:"# Reference Links"},...p.map(({domain:E,slug:_,title:J,score:W})=>({type:"reference",id:k(),site:E,slug:_,title:J,text:`score ${W.toFixed(3)}`}))],G=window.wiki.newPage({title:`${i} Results`,story:D,journal:[]});window.wiki.showResult(G,{$page:t.parents(".page")}),s.textContent=`${p.length} pages found`,R(n,{scored:p,query:i})}catch(u){s.textContent=`Error: ${u.message}`}finally{f.disabled=!1}}};f.addEventListener("click",m),c.addEventListener("keydown",i=>{i.key==="Enter"&&m()})}else{let c=t.find(".sim-input")[0],f=t.find(".sim-btn")[0],l=t.find(".sim-results")[0],o=null;d?.scored&&(c.value=d.query||"",l.innerHTML=d.scored.map(({domain:i,slug:u,title:p,score:L})=>`<div class="sim-result">${q(i,u,p,L)}</div>`).join("")+`<p class="sim-count">Top ${d.scored.length} for "${d.query||""}"${I(d.ts)}</p>`,s.textContent=""),(async()=>{try{d||(s.textContent="Resolving domains\u2026"),o=await A(e,w);let i=o.reduce((u,p)=>u+p.pages.length,0);s.textContent=g("Search ready",i,o.length)}catch(i){s.textContent=`Load error: ${i.message}`}})();let m=async()=>{let i=c.value.trim();if(!(!i||!o)){f.disabled=!0,s.textContent="Embedding query\u2026",l.innerHTML="";try{let u=await H(i,w),p=P(u,o,{threshold:r,limit:x,excludeSlug:null,excludeDomain:null});l.innerHTML=p.map(({domain:L,slug:v,title:k,score:j})=>`<div class="sim-result">${q(L,v,k,j)}</div>`).join("")+`<p class="sim-count">Top ${p.length} for "${i}"</p>`,s.textContent="",R(n,{scored:p,query:i})}catch(u){s.textContent=`Error: ${u.message}`}finally{f.disabled=!1}}};f.addEventListener("click",m),c.addEventListener("keydown",i=>{i.key==="Enter"&&m()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:ot,bind:at});})();
//# sourceMappingURL=similarity.js.map
