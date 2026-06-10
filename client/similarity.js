/* wiki-plugin-similarity - 0.3.2 - Wed, 10 Jun 2026 23:19:15 GMT */
(()=>{var A={high:.78,medium:.68,low:.58},I=A.medium,z=10,F=t=>{let e=[],i=null,s=null,o="search",x=!1,b=!1,L=null,y=null,d=(m,w)=>m===w||m.startsWith(w)&&/^[\s:]/.test(m.slice(w.length)),n=(m,w)=>m.slice(w.length).replace(/^\s*:?\s*/,"").trim();for(let m of t.split(`
`)){let w=m.trim();if(!w||w.startsWith("#"))continue;let p=w.toUpperCase();if(d(p,"LIVE")){x=!0;continue}if(d(p,"AUTHOR")){!e.length&&o==="search"&&(o="author");continue}if(d(p,"REPORT")){o==="search"&&(o="report");continue}if(d(p,"BUILD")){o==="search"&&(o="build");continue}if(d(p,"FORCE")){b=!0;continue}if(d(p,"GHOST")){L=n(w,"GHOST"),o==="search"&&(o="ghost");continue}if(d(p,"BUTTON")){y=n(w,"BUTTON");continue}if(d(p,"LIST")){!e.length&&o==="search"&&(o="list");continue}if(d(p,"SIMILAR")){let r=n(p,"SIMILAR").toLowerCase();i=A[r]||I,!e.length&&o==="search"&&(o="similar");continue}if(d(p,"THRESHOLD")){let r=n(w,"THRESHOLD");i=A[r.toLowerCase()]??(parseFloat(r)||I);continue}if(d(p,"LIMIT")){s=parseInt(n(w,"LIMIT"))||z;continue}e.push(["PUBLIC","LOCAL","PRIVATE"].includes(p)?p:w)}return{mode:o,specs:e,threshold:i??I,limit:s??z,live:x,force:b,ghostUrl:L,label:y}},J=t=>t.includes("*")||t.includes("?"),W=t=>t==="PUBLIC"||t==="LOCAL"||t==="PRIVATE",K=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),D=new Map,Y=async(t,e)=>{if(D.has(t))return D.get(t);let i=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(i);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let o=await s.json();return D.set(t,o),o},Q=async(t,e)=>{t.length||(t=[window.location.hostname]);let i=new Set,s=[];for(let o of t)if(o==="*"||J(o)||W(o))for(let x of await Y(o,e))i.has(x.domain)||(i.add(x.domain),s.push(x));else i.has(o)||(i.add(o),s.push({domain:o,page_count:null}));return s},O=new Map,X=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},Z=t=>X()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`${window.location.protocol}//${t}/system/semantic-vectors.json`,q=async t=>{if(O.has(t))return O.get(t);let e=await fetch(Z(t));if(!e.ok)return[];let i=await e.json();return O.set(t,i),i},M=async(t,e)=>{let i=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!i.ok)throw new Error(`embed failed: ${i.status}`);return(await i.json()).vector},tt=async(t,e)=>{let s=(await q(e)).find(o=>o.slug===t);return s?s.vector:null},U=(t,e,{threshold:i,limit:s,excludeSlug:o,excludeDomain:x})=>{let b=[];for(let{domain:L,pages:y}of e)for(let{slug:d,title:n,vector:m}of y){if(d===o&&L===x)continue;let w=0;for(let p=0;p<t.length;p++)w+=t[p]*m[p];w>=i&&b.push({domain:L,slug:d,title:n,score:w})}return b.sort((L,y)=>y.score-L.score),b.slice(0,s)},H=async(t,e)=>{let i=await Q(t,e);return(await Promise.all(i.map(async({domain:o})=>({domain:o,pages:await q(o)})))).filter(o=>o.pages.length>0)},N=t=>`sim-cache-${t}`,et=t=>{try{let e=JSON.parse(localStorage.getItem(N(t.id))||"null");return e?.text===(t.text||"")?e:null}catch{return null}},R=(t,e)=>{try{localStorage.setItem(N(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...e}))}catch{}},st=t=>{let e=Math.floor((Date.now()-t)/1e3);return e<60?`${e}s ago`:e<3600?`${Math.floor(e/60)}m ago`:e<86400?`${Math.floor(e/3600)}h ago`:`${Math.floor(e/86400)}d ago`},T=`
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
`,nt=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,P=(t,e,i,s)=>`<a class="sim-link" data-title="${i}" data-slug="${e}" data-site="${t}" href="#">${nt(t,s)} ${i}</a>`,it=(t,e)=>{let{mode:i,specs:s,threshold:o,limit:x,force:b,ghostUrl:L,label:y}=F(e?.text||"");if(i==="ghost")t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${y||"Open"}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(i==="build")t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <button class="sim-btn">${y||`Index ${s.length?s.join(", "):"*"}${b?" (force)":""}`}</button>
        </div>
        <div class="sim-status"></div>
      </div>`);else if(i==="list"){let d=s.length?s.join(", "):"*";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${d})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(i==="similar"){let d=s.length?s.join(", "):"current domain";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${d}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else if(i==="author"||i==="report"){let d=s.length?s.join(", "):"(current domain)",n=i==="report"?"Report":"Author";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">${n}</button>
        </div>
        <div class="sim-status">Domains: ${d}</div>
        <div class="sim-results"></div>
      </div>`)}else{let d=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${d}</div>
        <div class="sim-results"></div>
      </div>`)}},ot=(t,e)=>{let{mode:i,specs:s,threshold:o,limit:x,live:b,force:L,ghostUrl:y}=F(e?.text||""),d=window.location.origin,n=t.find(".sim-status")[0],m=b?null:et(e);t.on("dblclick",r=>{$(r.target).closest(".sim-input").length||window.wiki.textEditor(t,e)}),t.on("click",".sim-link",function(r){r.preventDefault();let g=$(this),c=r.shiftKey?null:t.parents(".page");window.wiki.doInternalLink(g.data("title"),c,g.data("site"))});let w=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",p=r=>r?` \xB7 cached ${st(r)}`:"";if(i==="list"){let r=t.find(".sim-list")[0],g=s.length?s.join(","):"*",c=(l,f)=>{let a=l.reduce((u,h)=>u+(h.page_count||0),0);n.style.display="none",r.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${l.map(({domain:u,page_count:h})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(u).flag()}"
                       title="${u}" data-site="${u}"> ${u}</td>
              <td>${h!=null?h.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${l.length} domains \u2014 ${a.toLocaleString()} pages${p(f)}</p>`};m?.domains?c(m.domains,m.ts):(async()=>{try{let l=`${d}/system/indexed-domains.json?pattern=${encodeURIComponent(g)}&limit=${x}`,f=await fetch(l);if(!f.ok)throw new Error(`indexed-domains failed: ${f.status}`);let a=await f.json();if(!a.length){n.textContent="No indexed domains found";return}c(a,null),R(e,{domains:a})}catch(l){n.textContent=`Error: ${l.message}`}})()}else if(i==="similar"){let r=t.find(".sim-results")[0],g=(c,l)=>{if(!c.length){n.textContent=`No similar pages found above threshold ${o}`;return}r.innerHTML=`<h3>Similar Pages</h3><ul>${c.map(({domain:f,slug:a,title:u,score:h})=>`<li>${P(f,a,u,h)}</li>`).join("")}</ul><p class="sim-count">${c.length} found ${w}${p(l)}</p>`,n.style.display="none"};m?.scored?g(m.scored,m.ts):(async()=>{try{let c=t.parents(".page"),l=c.find(".title").text().trim()||document.title,f=K(l),a=window.location.hostname,u=await H(s,d),h=u.reduce((C,k)=>C+k.pages.length,0);n.textContent=`Searching ${h.toLocaleString()} pages\u2026`;let v=await tt(f,a);if(!v){n.textContent="Embedding page (not yet indexed)\u2026";let C=c.find(".item").map((k,j)=>$(j).text().trim()).get().filter(Boolean).join(`
`);v=await M(C||l,d)}let E=U(v,u,{threshold:o,limit:x,excludeSlug:f,excludeDomain:a});g(E,null),E.length&&R(e,{scored:E})}catch(c){n.textContent=`Error: ${c.message}`}})()}else if(i==="ghost"){let r=t.find(".sim-btn")[0],g=async()=>{if(!y){n.textContent="No URL \u2014 GHOST needs a page-json URL";return}r.disabled=!0,n.textContent="Fetching\u2026";try{let c=await fetch(y);if(!c.ok)throw new Error(`fetch failed: ${c.status}`);let l=await c.json();window.wiki.showResult(window.wiki.newPage(l),{$page:t.parents(".page")}),n.textContent=""}catch(c){n.textContent=`Error: ${c.message}`}finally{r.disabled=!1}};r.addEventListener("click",g)}else if(i==="build"){let r=t.find(".sim-btn")[0],g=async()=>{r.disabled=!0,n.textContent="Building index\u2026 (may take a while for large scopes)";try{let c=encodeURIComponent((s.length?s:["*"]).join(",")),l=await fetch(`http://api.localhost/build-index.json?domains=${c}&force=${L?1:0}`);if(!l.ok)throw new Error(`build-index failed: ${l.status}`);let f=await l.json();window.wiki.showResult(window.wiki.newPage(f),{$page:t.parents(".page")}),n.textContent=""}catch(c){n.textContent=`Error: ${c.message}`}finally{r.disabled=!1}};r.addEventListener("click",g)}else if(i==="report"){let r=t.find(".sim-input")[0],g=t.find(".sim-btn")[0],c=async()=>{let l=r.value.trim();if(l){g.disabled=!0,n.textContent="Generating report\u2026";try{let f=await fetch("http://localhost:8000/search-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:l,domains:s.length?s:["*"],limit:x})});if(!f.ok)throw new Error(`search-report failed: ${f.status}`);let a=await f.json(),u=window.wiki.newPage(a);window.wiki.showResult(u,{$page:t.parents(".page")}),n.textContent=""}catch(f){n.textContent=`Error: ${f.message}`}finally{g.disabled=!1}}};g.addEventListener("click",c),r.addEventListener("keydown",l=>{l.key==="Enter"&&c()})}else if(i==="author"){let r=t.find(".sim-input")[0],g=t.find(".sim-btn")[0],c=t.find(".sim-results")[0],l=null;(async()=>{try{m||(n.textContent="Resolving domains\u2026"),l=await H(s,d);let a=l.reduce((u,h)=>u+h.pages.length,0);n.textContent=`Ready \u2014 ${a.toLocaleString()} pages across ${l.length} domains`}catch(a){n.textContent=`Load error: ${a.message}`}})();let f=async()=>{let a=r.value.trim();if(!(!a||!l)){g.disabled=!0,n.textContent="Embedding query\u2026",c.innerHTML="";try{let u=await M(a,d),h=U(u,l,{threshold:o,limit:x,excludeSlug:null,excludeDomain:null}),v=new Set,E=[];for(let{title:S}of h)v.has(S)||(v.add(S),E.push(S));let C=()=>Math.floor(Math.random()*18446744073709552e3).toString(16).padStart(16,"0"),k=E.map(S=>`- [[${S}]]`).join(`
`),j=[{type:"markdown",id:C(),text:`# Similar Pages

${k}`},{type:"markdown",id:C(),text:"# Reference Links"},...h.map(({domain:S,slug:V,title:G,score:_})=>({type:"reference",id:C(),site:S,slug:V,title:G,text:`score ${_.toFixed(3)}`}))],B=window.wiki.newPage({title:`${a} Results`,story:j,journal:[]});window.wiki.showResult(B,{$page:t.parents(".page")}),n.textContent=`${h.length} pages found`,R(e,{scored:h,query:a})}catch(u){n.textContent=`Error: ${u.message}`}finally{g.disabled=!1}}};g.addEventListener("click",f),r.addEventListener("keydown",a=>{a.key==="Enter"&&f()})}else{let r=t.find(".sim-input")[0],g=t.find(".sim-btn")[0],c=t.find(".sim-results")[0],l=null;m?.scored&&(r.value=m.query||"",c.innerHTML=m.scored.map(({domain:a,slug:u,title:h,score:v})=>`<div class="sim-result">${P(a,u,h,v)}</div>`).join("")+`<p class="sim-count">Top ${m.scored.length} for "${m.query||""}"${p(m.ts)}</p>`,n.textContent=""),(async()=>{try{m||(n.textContent="Resolving domains\u2026"),l=await H(s,d);let a=l.reduce((u,h)=>u+h.pages.length,0);n.textContent=`Ready \u2014 ${a.toLocaleString()} pages across ${l.length} domains`}catch(a){n.textContent=`Load error: ${a.message}`}})();let f=async()=>{let a=r.value.trim();if(!(!a||!l)){g.disabled=!0,n.textContent="Embedding query\u2026",c.innerHTML="";try{let u=await M(a,d),h=U(u,l,{threshold:o,limit:x,excludeSlug:null,excludeDomain:null});c.innerHTML=h.map(({domain:v,slug:E,title:C,score:k})=>`<div class="sim-result">${P(v,E,C,k)}</div>`).join("")+`<p class="sim-count">Top ${h.length} for "${a}"</p>`,n.textContent="",R(e,{scored:h,query:a})}catch(u){n.textContent=`Error: ${u.message}`}finally{g.disabled=!1}}};g.addEventListener("click",f),r.addEventListener("keydown",a=>{a.key==="Enter"&&f()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:it,bind:ot});})();
//# sourceMappingURL=similarity.js.map
