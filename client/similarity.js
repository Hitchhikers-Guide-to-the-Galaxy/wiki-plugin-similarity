/* wiki-plugin-similarity - 0.8.1 - Tue, 21 Jul 2026 08:15:59 GMT */
(()=>{var q={high:.78,medium:.68,low:.58},M=q.medium,_=10,V=t=>{let e=[],n=[],o=[],f=null,b=null,d="search",y=!1,L=!1,E=null,k=null,w=(i,m)=>i===m||i.startsWith(m)&&/^[\s:]/.test(i.slice(m.length)),x=(i,m)=>i.slice(m.length).replace(/^\s*:?\s*/,"").trim();for(let i of t.split(`
`)){let m=i.trim();if(!m||m.startsWith("#"))continue;let g=m.toUpperCase();if(w(g,"LIVE")){y=!0;continue}if(w(g,"AUTHOR")){!e.length&&d==="search"&&(d="author");continue}if(w(g,"REPORT")){d==="search"&&(d="report");continue}if(w(g,"KEYWORD")){d==="search"&&(d="keyword");continue}if(w(g,"BUILD")){d==="search"&&(d="build");continue}if(w(g,"FORCE")){L=!0;continue}if(w(g,"GHOST")){E=x(m,"GHOST"),d==="search"&&(d="ghost");continue}if(w(g,"BUTTON")){k=x(m,"BUTTON");continue}if(w(g,"ROSTER")){let S=x(m,"ROSTER");S&&n.push(S);continue}if(w(g,"FARM")){let S=x(m,"FARM");S&&o.push(S);continue}if(w(g,"LIST")){!e.length&&d==="search"&&(d="list");continue}if(w(g,"SIMILAR")){let S=x(g,"SIMILAR").toLowerCase();f=q[S]||M,!e.length&&d==="search"&&(d="similar");continue}if(w(g,"THRESHOLD")){let S=x(m,"THRESHOLD");f=q[S.toLowerCase()]??(parseFloat(S)||M);continue}if(w(g,"LIMIT")){b=parseInt(x(m,"LIMIT"))||_;continue}e.push(["PUBLIC","LOCAL","PRIVATE"].includes(g)?g:m)}return{mode:d,specs:e,rosterRefs:n,farms:o,threshold:f??M,limit:b??_,live:y,force:L,ghostUrl:E,label:k,thresholdSet:f!==null}},et=t=>t.includes("*")||t.includes("?"),nt=t=>t==="PUBLIC"||t==="LOCAL"||t==="PRIVATE",st=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),P=new Map,it=async(t,e)=>{if(P.has(t))return P.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,o=await fetch(n);if(!o.ok)throw new Error(`indexed-domains failed: ${o.status}`);let f=await o.json();return P.set(t,f),f},G=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,o=[];for(let f of t)if(f==="*"||et(f)||nt(f))for(let b of await it(f,e))n.has(b.domain)||(n.add(b.domain),o.push(b));else n.has(f)||(n.add(f),o.push({domain:f,page_count:null}));return o},ot=/^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+|localhost)(:\d+)?$/,at=/^ROSTER ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/,rt=/^REFERENCES ([A-Za-z0-9.\-:]+\/[a-z0-9-]+)$/,B=async t=>{let e=t.indexOf("/"),n=await fetch(`//${t.slice(0,e)}/${t.slice(e+1)}.json`);if(!n.ok)throw new Error(`roster page ${t} failed: ${n.status}`);return n.json()},K=async(t,e,n)=>{if(n.has(t))return;n.add(t);let o;try{o=await B(t)}catch(f){console.warn(f.message);return}for(let f of o.story||[])if(f.type==="roster")for(let b of(f.text||"").split(/\r?\n/)){let d=b.trim();if(!d)continue;let y=d.match(ot);if(y){e.add(y[0]);continue}let L=d.match(at);if(L){await K(L[1],e,n);continue}let E=d.match(rt);if(E)try{let k=await B(E[1]);for(let w of k.story||[])w.type==="reference"&&w.site&&e.add(w.site)}catch(k){console.warn(k.message)}}},lt=async t=>{let e=new Set,n=new Set;for(let o of t)await K(o,e,n);return[...e]},ct=async(t,e)=>e.length?[...t,...await lt(e)]:t,A=new Map,dt=t=>`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`,Z=async t=>{if(A.has(t))return A.get(t);let e=await fetch(dt(t));if(!e.ok)return[];let n=await e.json();return A.set(t,n),n},z=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},ft=async(t,e)=>{let o=(await Z(e)).find(f=>f.slug===t);return o?o.vector:null},H=(t,e,{threshold:n,limit:o,excludeSlug:f,excludeDomain:b})=>{let d=[];for(let{domain:y,pages:L}of e)for(let{slug:E,title:k,vector:w}of L){if(E===f&&y===b)continue;let x=0;for(let i=0;i<t.length;i++)x+=t[i]*w[i];x>=n&&d.push({domain:y,slug:E,title:k,score:x})}return d.sort((y,L)=>L.score-y.score),d.slice(0,o)},F=async(t,e)=>{let n=await G(t,e);return(await Promise.all(n.map(async({domain:f})=>({domain:f,pages:await Z(f)})))).filter(f=>f.pages.length>0)},J=t=>`sim-cache-${t}`,mt=t=>{try{let e=JSON.parse(localStorage.getItem(J(t.id))||"null");return e?.text===(t.text||"")?e:null}catch{return null}},O=(t,e)=>{try{localStorage.setItem(J(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...e}))}catch{}},ut=t=>{let e=Math.floor((Date.now()-t)/1e3);return e<60?`${e}s ago`:e<3600?`${Math.floor(e/60)}m ago`:e<86400?`${Math.floor(e/3600)}h ago`:`${Math.floor(e/86400)}d ago`},I=`
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
`,ht=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,N=(t,e,n,o)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${ht(t,o)} ${n}</a>`,pt=(t,e)=>{let{mode:n,specs:o,threshold:f,limit:b,force:d,ghostUrl:y,label:L}=V(e?.text||"");if(n==="ghost")t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${L||"Open"}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(n==="build")t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${L||`Index ${o.length?o.join(", "):"*"}${d?" (force)":""}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(n==="list"){let E=o.length?o.join(", "):"*";t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${E})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(n==="similar"){let E=o.length?o.join(", "):"current domain";t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${E}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else if(n==="author"||n==="report"||n==="keyword"){let E=o.length?o.join(", "):"(current domain)",k=n==="report"?"Report":n==="keyword"?"Keyword":"Author";t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">${k}</button>
        </div>
        <div class="sim-status">Domains: ${E}</div>
        <div class="sim-results"></div>
      </div>`)}else{let E=o.length?o.join(", "):"(current domain)";t.html(`
      <style>${I}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${E}</div>
        <div class="sim-results"></div>
      </div>`)}},gt=(t,e)=>{let{mode:n,specs:o,rosterRefs:f,farms:b,threshold:d,limit:y,live:L,force:E,ghostUrl:k,thresholdSet:w}=V(e?.text||""),x=window.location.origin,i=t.find(".sim-status")[0],m=L?null:mt(e),g=ct(o,f),S=(c,h,a)=>{let r=[`${c} \u2014 ${h.toLocaleString()} pages across ${a} domains`];return w&&r.push(`threshold ${d}`),r.push(`limit ${y}`),L&&r.push("LIVE"),r.join(" \xB7 ")};t.on("dblclick",c=>{$(c.target).closest(".sim-input").length||window.wiki.textEditor(t,e)}),t.on("click",".sim-link",function(c){c.preventDefault();let h=$(this),a=c.shiftKey?null:t.parents(".page");window.wiki.doInternalLink(h.data("title"),a,h.data("site"))});let W=!o.length||o.length===1&&o[0]==="*"?"on farm":o.length===1?`on ${o[0]}`:"in domains",D=c=>c?` \xB7 cached ${ut(c)}`:"";if(n==="list"){let c=t.find(".sim-list")[0],h=(a,r)=>{let u=a.reduce((s,l)=>s+(l.page_count||0),0);i.style.display="none",c.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${a.map(({domain:s,page_count:l})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(s).flag()}"
                       title="${s}" data-site="${s}"> ${s}</td>
              <td>${l!=null?l.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${a.length} domains \u2014 ${u.toLocaleString()} pages${D(r)}</p>`};m?.domains?h(m.domains,m.ts):(async()=>{try{let a=await g,r=a.length?a.join(","):"*",u=`${x}/system/indexed-domains.json?pattern=${encodeURIComponent(r)}&limit=${y}`,s=await fetch(u);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let l=await s.json();if(!l.length){i.textContent="No indexed domains found";return}h(l,null),O(e,{domains:l})}catch(a){i.textContent=`Error: ${a.message}`}})()}else if(n==="similar"){let c=t.find(".sim-results")[0],h=(a,r)=>{if(!a.length){i.textContent=`No similar pages found above threshold ${d}`;return}c.innerHTML=`<h3>Similar Pages</h3><ul>${a.map(({domain:u,slug:s,title:l,score:p})=>`<li>${N(u,s,l,p)}</li>`).join("")}</ul><p class="sim-count">${a.length} found ${W}${D(r)}</p>`,i.style.display="none"};m?.scored?h(m.scored,m.ts):(async()=>{try{let a=t.parents(".page"),r=a.find(".title").text().trim()||document.title,u=st(r),s=window.location.hostname,l=await F(await g,x),p=l.reduce((R,T)=>R+T.pages.length,0);i.textContent=`Searching ${p.toLocaleString()} pages\u2026`;let C=await ft(u,s);if(!C){i.textContent="Embedding page (not yet indexed)\u2026";let R=a.find(".item").map((T,U)=>$(U).text().trim()).get().filter(Boolean).join(`
`);C=await z(R||r,x)}let v=H(C,l,{threshold:d,limit:y,excludeSlug:u,excludeDomain:s});h(v,null),v.length&&O(e,{scored:v})}catch(a){i.textContent=`Error: ${a.message}`}})()}else if(n==="ghost"){let c=t.find(".sim-btn")[0],h=async()=>{if(!k){i.textContent="No URL \u2014 GHOST needs a page-json URL";return}c.disabled=!0,i.textContent="Fetching\u2026";try{let a=await fetch(k);if(!a.ok)throw new Error(`fetch failed: ${a.status}`);let r=await a.json();window.wiki.showResult(window.wiki.newPage(r),{$page:t.parents(".page")}),i.textContent=""}catch(a){i.textContent=`Error: ${a.message}`}finally{c.disabled=!1}};c.addEventListener("click",h)}else if(n==="build"){let c=t.find(".sim-btn")[0],h=async()=>{c.disabled=!0,i.textContent="Building index\u2026 (may take a while for large scopes)";try{let a=encodeURIComponent((o.length?o:["*"]).join(",")),r=await fetch(`${x}/system/build-index.json?domains=${a}&force=${E?1:0}`);if(r.status===501){let s=await r.json().catch(()=>({}));throw new Error(s.hint||"indexing runs on the farm indexer, not this server")}if(!r.ok)throw new Error(`build-index failed: ${r.status}`);let u=await r.json();window.wiki.showResult(window.wiki.newPage(u),{$page:t.parents(".page")}),i.textContent=""}catch(a){i.textContent=`Error: ${a.message}`}finally{c.disabled=!1}};c.addEventListener("click",h)}else if(n==="report"){let c=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],a=`Domains: ${o.length?o.join(", "):"*"}`;(async()=>{try{let u=await g,s=await G(u.length?u:["*"],x),l=s.reduce((p,C)=>p+(C.page_count||0),0);a=S("Report ready",l,s.length),b.length&&(a+=` \xB7 +${b.length} peer farm${b.length>1?"s":""}`),i.textContent=a}catch(u){i.textContent=`Domain listing unavailable: ${u.message}`}})();let r=async()=>{let u=c.value.trim();if(u){h.disabled=!0,i.textContent=b.length?"Generating report (asking peer farms)\u2026":"Generating report\u2026";try{let s=await g,l={query:u,domains:s.length?s:["*"],limit:y,live:L};b.length&&(l.farms=b),w&&(l.threshold=d);let p=await fetch(`${x}/system/search-report.json`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(l)});if(!p.ok)throw new Error(`search-report failed: ${p.status}`);let C=await p.json(),v=window.wiki.newPage(C);window.wiki.showResult(v,{$page:t.parents(".page")}),i.textContent=a}catch(s){i.textContent=`Error: ${s.message}`}finally{h.disabled=!1}}};h.addEventListener("click",r),c.addEventListener("keydown",u=>{u.key==="Enter"&&r()})}else if(n==="keyword"){let c=t.find(".sim-input")[0],h=t.find(".sim-btn")[0];i.textContent=`Keyword search ready \u2014 domains: ${o.length?o.join(", "):"*"} \xB7 limit ${y}`;let a=async()=>{let r=c.value.trim();if(r){h.disabled=!0,i.textContent="Searching live site indexes\u2026";try{let u=await g,s=encodeURIComponent((u.length?u:["*"]).join(",")),l=b.length?`&farms=${encodeURIComponent(b.join(","))}`:"",p=await fetch(`${x}/system/farm-search.json?q=${encodeURIComponent(r)}&pattern=${s}&limit=${y}${l}`);if(!p.ok)throw new Error(`farm-search failed: ${p.status}`);let C=await p.json();window.wiki.showResult(window.wiki.newPage(C),{$page:t.parents(".page")}),i.textContent=`Keyword search ready \u2014 domains: ${o.length?o.join(", "):"*"} \xB7 limit ${y}`}catch(u){i.textContent=`Error: ${u.message}`}finally{h.disabled=!1}}};h.addEventListener("click",a),c.addEventListener("keydown",r=>{r.key==="Enter"&&a()})}else if(n==="author"){let c=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],a=t.find(".sim-results")[0],r=null;(async()=>{try{m||(i.textContent="Resolving domains\u2026"),r=await F(await g,x);let s=r.reduce((l,p)=>l+p.pages.length,0);i.textContent=S("Author ready",s,r.length)}catch(s){i.textContent=`Load error: ${s.message}`}})();let u=async()=>{let s=c.value.trim();if(!(!s||!r)){h.disabled=!0,i.textContent="Embedding query\u2026",a.innerHTML="";try{let l=await z(s,x),p=H(l,r,{threshold:d,limit:y,excludeSlug:null,excludeDomain:null}),C=new Set,v=[];for(let{title:j}of p)C.has(j)||(C.add(j),v.push(j));let R=()=>Math.floor(Math.random()*18446744073709552e3).toString(16).padStart(16,"0"),T=v.map(j=>`- [[${j}]]`).join(`
`),U=[{type:"markdown",id:R(),text:`# Similar Pages

${T}`},{type:"markdown",id:R(),text:"# Reference Links"},...p.map(({domain:j,slug:Q,title:X,score:tt})=>({type:"reference",id:R(),site:j,slug:Q,title:X,text:`score ${tt.toFixed(3)}`}))],Y=window.wiki.newPage({title:`${s} Results`,story:U,journal:[]});window.wiki.showResult(Y,{$page:t.parents(".page")}),i.textContent=`${p.length} pages found`,O(e,{scored:p,query:s})}catch(l){i.textContent=`Error: ${l.message}`}finally{h.disabled=!1}}};h.addEventListener("click",u),c.addEventListener("keydown",s=>{s.key==="Enter"&&u()})}else{let c=t.find(".sim-input")[0],h=t.find(".sim-btn")[0],a=t.find(".sim-results")[0],r=null;m?.scored&&(c.value=m.query||"",a.innerHTML=m.scored.map(({domain:s,slug:l,title:p,score:C})=>`<div class="sim-result">${N(s,l,p,C)}</div>`).join("")+`<p class="sim-count">Top ${m.scored.length} for "${m.query||""}"${D(m.ts)}</p>`,i.textContent=""),(async()=>{try{m||(i.textContent="Resolving domains\u2026"),r=await F(await g,x);let s=r.reduce((l,p)=>l+p.pages.length,0);i.textContent=S("Search ready",s,r.length)}catch(s){i.textContent=`Load error: ${s.message}`}})();let u=async()=>{let s=c.value.trim();if(!(!s||!r)){h.disabled=!0,i.textContent="Embedding query\u2026",a.innerHTML="";try{let l=await z(s,x),p=H(l,r,{threshold:d,limit:y,excludeSlug:null,excludeDomain:null});a.innerHTML=p.map(({domain:C,slug:v,title:R,score:T})=>`<div class="sim-result">${N(C,v,R,T)}</div>`).join("")+`<p class="sim-count">Top ${p.length} for "${s}"</p>`,i.textContent="",O(e,{scored:p,query:s})}catch(l){i.textContent=`Error: ${l.message}`}finally{h.disabled=!1}}};h.addEventListener("click",u),c.addEventListener("keydown",s=>{s.key==="Enter"&&u()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:pt,bind:gt});})();
//# sourceMappingURL=similarity.js.map
