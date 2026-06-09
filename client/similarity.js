/* wiki-plugin-similarity - 0.3.0 - Tue, 09 Jun 2026 23:03:06 GMT */
(()=>{var A={high:.78,medium:.68,low:.58},T=A.medium,q=10,F=t=>{let e=[],i=null,s=null,a="search",x=!1,m=(o,l)=>o===l||o.startsWith(l)&&/^[\s:]/.test(o.slice(l.length)),g=(o,l)=>o.slice(l.length).replace(/^\s*:?\s*/,"").trim();for(let o of t.split(`
`)){let l=o.trim();if(!l||l.startsWith("#"))continue;let w=l.toUpperCase();if(m(w,"LIVE")){x=!0;continue}if(m(w,"AUTHOR")){!e.length&&a==="search"&&(a="author");continue}if(m(w,"LIST")){!e.length&&a==="search"&&(a="list");continue}if(m(w,"SIMILAR")){let v=g(w,"SIMILAR").toLowerCase();i=A[v]||T,!e.length&&a==="search"&&(a="similar");continue}if(m(w,"THRESHOLD")){i=parseFloat(g(l,"THRESHOLD"))||T;continue}if(m(w,"LIMIT")){s=parseInt(g(l,"LIMIT"))||q;continue}e.push(l)}return{mode:a,specs:e,threshold:i??T,limit:s??q,live:x}},W=t=>t.includes("*")||t.includes("?"),J=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),j=new Map,B=async(t,e)=>{if(j.has(t))return j.get(t);let i=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(i);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let a=await s.json();return j.set(t,a),a},G=async(t,e)=>{t.length||(t=[window.location.hostname]);let i=new Set,s=[];for(let a of t)if(a==="*"||W(a))for(let x of await B(a,e))i.has(x.domain)||(i.add(x.domain),s.push(x));else i.has(a)||(i.add(a),s.push({domain:a,page_count:null}));return s},D=new Map,K=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},Y=t=>K()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`${window.location.protocol}//${t}/system/semantic-vectors.json`,U=async t=>{if(D.has(t))return D.get(t);let e=await fetch(Y(t));if(!e.ok)return[];let i=await e.json();return D.set(t,i),i},M=async(t,e)=>{let i=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!i.ok)throw new Error(`embed failed: ${i.status}`);return(await i.json()).vector},Q=async(t,e)=>{let s=(await U(e)).find(a=>a.slug===t);return s?s.vector:null},R=(t,e,{threshold:i,limit:s,excludeSlug:a,excludeDomain:x})=>{let m=[];for(let{domain:g,pages:o}of e)for(let{slug:l,title:w,vector:v}of o){if(l===a&&g===x)continue;let p=0;for(let u=0;u<t.length;u++)p+=t[u]*v[u];p>=i&&m.push({domain:g,slug:l,title:w,score:p})}return m.sort((g,o)=>o.score-g.score),m.slice(0,s)},H=async(t,e)=>{let i=await G(t,e);return(await Promise.all(i.map(async({domain:a})=>({domain:a,pages:await U(a)})))).filter(a=>a.pages.length>0)},O=t=>`sim-cache-${t}`,X=t=>{try{let e=JSON.parse(localStorage.getItem(O(t.id))||"null");return e?.text===(t.text||"")?e:null}catch{return null}},E=(t,e)=>{try{localStorage.setItem(O(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...e}))}catch{}},Z=t=>{let e=Math.floor((Date.now()-t)/1e3);return e<60?`${e}s ago`:e<3600?`${Math.floor(e/60)}m ago`:e<86400?`${Math.floor(e/3600)}h ago`:`${Math.floor(e/86400)}d ago`},k=`
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
`,tt=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,z=(t,e,i,s)=>`<a class="sim-link" data-title="${i}" data-slug="${e}" data-site="${t}" href="#">${tt(t,s)} ${i}</a>`,et=(t,e)=>{let{mode:i,specs:s,threshold:a,limit:x}=F(e?.text||"");if(i==="list"){let m=s.length?s.join(", "):"*";t.html(`
      <style>${k}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${m})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(i==="similar"){let m=s.length?s.join(", "):"current domain";t.html(`
      <style>${k}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${m}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else if(i==="author"){let m=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${k}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Author</button>
        </div>
        <div class="sim-status">Domains: ${m}</div>
        <div class="sim-results"></div>
      </div>`)}else{let m=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${k}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${m}</div>
        <div class="sim-results"></div>
      </div>`)}},st=(t,e)=>{let{mode:i,specs:s,threshold:a,limit:x,live:m}=F(e?.text||""),g=window.location.origin,o=t.find(".sim-status")[0],l=m?null:X(e);t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(p){p.preventDefault();let u=$(this);window.wiki.doInternalLink(u.data("title"),t.parents(".page"),u.data("site"))});let w=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",v=p=>p?` \xB7 cached ${Z(p)}`:"";if(i==="list"){let p=t.find(".sim-list")[0],u=s.length?s.join(","):"*",f=(c,h)=>{let n=c.reduce((r,d)=>r+(d.page_count||0),0);o.style.display="none",p.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${c.map(({domain:r,page_count:d})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(r).flag()}"
                       title="${r}" data-site="${r}"> ${r}</td>
              <td>${d!=null?d.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${c.length} domains \u2014 ${n.toLocaleString()} pages${v(h)}</p>`};l?.domains?f(l.domains,l.ts):(async()=>{try{let c=`${g}/system/indexed-domains.json?pattern=${encodeURIComponent(u)}&limit=${x}`,h=await fetch(c);if(!h.ok)throw new Error(`indexed-domains failed: ${h.status}`);let n=await h.json();if(!n.length){o.textContent="No indexed domains found";return}f(n,null),E(e,{domains:n})}catch(c){o.textContent=`Error: ${c.message}`}})()}else if(i==="similar"){let p=t.find(".sim-results")[0],u=(f,c)=>{if(!f.length){o.textContent=`No similar pages found above threshold ${a}`;return}p.innerHTML=`<h3>Similar Pages</h3><ul>${f.map(({domain:h,slug:n,title:r,score:d})=>`<li>${z(h,n,r,d)}</li>`).join("")}</ul><p class="sim-count">${f.length} found ${w}${v(c)}</p>`,o.style.display="none"};l?.scored?u(l.scored,l.ts):(async()=>{try{let f=t.parents(".page"),c=f.find(".title").text().trim()||document.title,h=J(c),n=window.location.hostname,r=await H(s,g),d=r.reduce((b,C)=>b+C.pages.length,0);o.textContent=`Searching ${d.toLocaleString()} pages\u2026`;let y=await Q(h,n);if(!y){o.textContent="Embedding page (not yet indexed)\u2026";let b=f.find(".item").map((C,I)=>$(I).text().trim()).get().filter(Boolean).join(`
`);y=await M(b||c,g)}let L=R(y,r,{threshold:a,limit:x,excludeSlug:h,excludeDomain:n});u(L,null),L.length&&E(e,{scored:L})}catch(f){o.textContent=`Error: ${f.message}`}})()}else if(i==="author"){let p=t.find(".sim-input")[0],u=t.find(".sim-btn")[0],f=t.find(".sim-results")[0],c=null;(async()=>{try{l||(o.textContent="Resolving domains\u2026"),c=await H(s,g);let n=c.reduce((r,d)=>r+d.pages.length,0);o.textContent=`Ready \u2014 ${n.toLocaleString()} pages across ${c.length} domains`}catch(n){o.textContent=`Load error: ${n.message}`}})();let h=async()=>{let n=p.value.trim();if(!(!n||!c)){u.disabled=!0,o.textContent="Embedding query\u2026",f.innerHTML="";try{let r=await M(n,g),d=R(r,c,{threshold:a,limit:x,excludeSlug:null,excludeDomain:null}),y=new Set,L=[];for(let{title:S}of d)y.has(S)||(y.add(S),L.push(S));let b=()=>Math.floor(Math.random()*18446744073709552e3).toString(16).padStart(16,"0"),C=L.map(S=>`- [[${S}]]`).join(`
`),I=[{type:"markdown",id:b(),text:`# Similar Pages

${C}`},{type:"markdown",id:b(),text:"# Reference Links"},...d.map(({domain:S,slug:N,title:V,score:_})=>({type:"reference",id:b(),site:S,slug:N,title:V,text:`score ${_.toFixed(3)}`}))],P=window.wiki.newPage({title:`${n} Results`,story:I,journal:[]});window.wiki.showResult(P,{$page:t.parents(".page")}),o.textContent=`${d.length} pages found`,E(e,{scored:d,query:n})}catch(r){o.textContent=`Error: ${r.message}`}finally{u.disabled=!1}}};u.addEventListener("click",h),p.addEventListener("keydown",n=>{n.key==="Enter"&&h()})}else{let p=t.find(".sim-input")[0],u=t.find(".sim-btn")[0],f=t.find(".sim-results")[0],c=null;l?.scored&&(p.value=l.query||"",f.innerHTML=l.scored.map(({domain:n,slug:r,title:d,score:y})=>`<div class="sim-result">${z(n,r,d,y)}</div>`).join("")+`<p class="sim-count">Top ${l.scored.length} for "${l.query||""}"${v(l.ts)}</p>`,o.textContent=""),(async()=>{try{l||(o.textContent="Resolving domains\u2026"),c=await H(s,g);let n=c.reduce((r,d)=>r+d.pages.length,0);o.textContent=`Ready \u2014 ${n.toLocaleString()} pages across ${c.length} domains`}catch(n){o.textContent=`Load error: ${n.message}`}})();let h=async()=>{let n=p.value.trim();if(!(!n||!c)){u.disabled=!0,o.textContent="Embedding query\u2026",f.innerHTML="";try{let r=await M(n,g),d=R(r,c,{threshold:a,limit:x,excludeSlug:null,excludeDomain:null});f.innerHTML=d.map(({domain:y,slug:L,title:b,score:C})=>`<div class="sim-result">${z(y,L,b,C)}</div>`).join("")+`<p class="sim-count">Top ${d.length} for "${n}"</p>`,o.textContent="",E(e,{scored:d,query:n})}catch(r){o.textContent=`Error: ${r.message}`}finally{u.disabled=!1}}};u.addEventListener("click",h),p.addEventListener("keydown",n=>{n.key==="Enter"&&h()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:et,bind:st});})();
//# sourceMappingURL=similarity.js.map
