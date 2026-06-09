/* wiki-plugin-similarity - 0.2.0 - Tue, 09 Jun 2026 21:09:52 GMT */
(()=>{var z={high:.78,medium:.68,low:.58},C=z.medium,j=10,F=t=>{let e=[],n=null,s=null,o="search",h=!1,d=(a,i)=>a===i||a.startsWith(i)&&/^[\s:]/.test(a.slice(i.length)),f=(a,i)=>a.slice(i.length).replace(/^\s*:?\s*/,"").trim();for(let a of t.split(`
`)){let i=a.trim();if(!i||i.startsWith("#"))continue;let w=i.toUpperCase();if(d(w,"LIVE")){h=!0;continue}if(d(w,"LIST")){!e.length&&o==="search"&&(o="list");continue}if(d(w,"SIMILAR")){let y=f(w,"SIMILAR").toLowerCase();n=z[y]||C,!e.length&&o==="search"&&(o="similar");continue}if(d(w,"THRESHOLD")){n=parseFloat(f(i,"THRESHOLD"))||C;continue}if(d(w,"LIMIT")){s=parseInt(f(i,"LIMIT"))||j;continue}e.push(i)}return{mode:o,specs:e,threshold:n??C,limit:s??j,live:h}},q=t=>t.includes("*")||t.includes("?"),N=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),E=new Map,P=async(t,e)=>{if(E.has(t))return E.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(n);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let o=await s.json();return E.set(t,o),o},_=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,s=[];for(let o of t)if(o==="*"||q(o))for(let h of await P(o,e))n.has(h.domain)||(n.add(h.domain),s.push(h));else n.has(o)||(n.add(o),s.push({domain:o,page_count:null}));return s},I=new Map,V=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},W=t=>V()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`${window.location.protocol}//${t}/system/semantic-vectors.json`,U=async t=>{if(I.has(t))return I.get(t);let e=await fetch(W(t));if(!e.ok)return[];let n=await e.json();return I.set(t,n),n},M=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},J=async(t,e)=>{let s=(await U(e)).find(o=>o.slug===t);return s?s.vector:null},H=(t,e,{threshold:n,limit:s,excludeSlug:o,excludeDomain:h})=>{let d=[];for(let{domain:f,pages:a}of e)for(let{slug:i,title:w,vector:y}of a){if(i===o&&f===h)continue;let m=0;for(let p=0;p<t.length;p++)m+=t[p]*y[p];m>=n&&d.push({domain:f,slug:i,title:w,score:m})}return d.sort((f,a)=>a.score-f.score),d.slice(0,s)},R=async(t,e)=>{let n=await _(t,e);return(await Promise.all(n.map(async({domain:o})=>({domain:o,pages:await U(o)})))).filter(o=>o.pages.length>0)},A=t=>`sim-cache-${t}`,B=t=>{try{let e=JSON.parse(localStorage.getItem(A(t.id))||"null");return e?.text===(t.text||"")?e:null}catch{return null}},D=(t,e)=>{try{localStorage.setItem(A(t.id),JSON.stringify({text:t.text||"",ts:Date.now(),...e}))}catch{}},G=t=>{let e=Math.floor((Date.now()-t)/1e3);return e<60?`${e}s ago`:e<3600?`${Math.floor(e/60)}m ago`:e<86400?`${Math.floor(e/3600)}h ago`:`${Math.floor(e/86400)}d ago`},T=`
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
`,K=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,k=(t,e,n,s)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${K(t,s)} ${n}</a>`,Y=(t,e)=>{let{mode:n,specs:s,threshold:o,limit:h}=F(e?.text||"");if(n==="list"){let d=s.length?s.join(", "):"*";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${d})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(n==="similar"){let d=s.length?s.join(", "):"current domain";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${d}\u2026</div>
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
      </div>`)}},Q=(t,e)=>{let{mode:n,specs:s,threshold:o,limit:h,live:d}=F(e?.text||""),f=window.location.origin,a=t.find(".sim-status")[0],i=d?null:B(e);t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(m){m.preventDefault();let p=$(this);window.wiki.doInternalLink(p.data("title"),t.parents(".page"),p.data("site"))});let w=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",y=m=>m?` \xB7 cached ${G(m)}`:"";if(n==="list"){let m=t.find(".sim-list")[0],p=s.length?s.join(","):"*",g=(c,x)=>{let l=c.reduce((r,u)=>r+(u.page_count||0),0);a.style.display="none",m.innerHTML=`<h3>Indexed Farm Domains</h3>
        <table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${c.map(({domain:r,page_count:u})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(r).flag()}"
                       title="${r}" data-site="${r}"> ${r}</td>
              <td>${u!=null?u.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>
        <p class="sim-count">${c.length} domains \u2014 ${l.toLocaleString()} pages${y(x)}</p>`};i?.domains?g(i.domains,i.ts):(async()=>{try{let c=`${f}/system/indexed-domains.json?pattern=${encodeURIComponent(p)}&limit=${h}`,x=await fetch(c);if(!x.ok)throw new Error(`indexed-domains failed: ${x.status}`);let l=await x.json();if(!l.length){a.textContent="No indexed domains found";return}g(l,null),D(e,{domains:l})}catch(c){a.textContent=`Error: ${c.message}`}})()}else if(n==="similar"){let m=t.find(".sim-results")[0],p=(g,c)=>{if(!g.length){a.textContent=`No similar pages found above threshold ${o}`;return}m.innerHTML=`<h3>Similar Pages</h3><ul>${g.map(({domain:x,slug:l,title:r,score:u})=>`<li>${k(x,l,r,u)}</li>`).join("")}</ul><p class="sim-count">${g.length} found ${w}${y(c)}</p>`,a.style.display="none"};i?.scored?p(i.scored,i.ts):(async()=>{try{let g=t.parents(".page"),c=g.find(".title").text().trim()||document.title,x=N(c),l=window.location.hostname,r=await R(s,f),u=r.reduce((v,S)=>v+S.pages.length,0);a.textContent=`Searching ${u.toLocaleString()} pages\u2026`;let b=await J(x,l);if(!b){a.textContent="Embedding page (not yet indexed)\u2026";let v=g.find(".item").map((S,O)=>$(O).text().trim()).get().filter(Boolean).join(`
`);b=await M(v||c,f)}let L=H(b,r,{threshold:o,limit:h,excludeSlug:x,excludeDomain:l});p(L,null),L.length&&D(e,{scored:L})}catch(g){a.textContent=`Error: ${g.message}`}})()}else{let m=t.find(".sim-input")[0],p=t.find(".sim-btn")[0],g=t.find(".sim-results")[0],c=null;i?.scored&&(m.value=i.query||"",g.innerHTML=i.scored.map(({domain:l,slug:r,title:u,score:b})=>`<div class="sim-result">${k(l,r,u,b)}</div>`).join("")+`<p class="sim-count">Top ${i.scored.length} for "${i.query||""}"${y(i.ts)}</p>`,a.textContent=""),(async()=>{try{i||(a.textContent="Resolving domains\u2026"),c=await R(s,f);let l=c.reduce((r,u)=>r+u.pages.length,0);a.textContent=`Ready \u2014 ${l.toLocaleString()} pages across ${c.length} domains`}catch(l){a.textContent=`Load error: ${l.message}`}})();let x=async()=>{let l=m.value.trim();if(!(!l||!c)){p.disabled=!0,a.textContent="Embedding query\u2026",g.innerHTML="";try{let r=await M(l,f),u=H(r,c,{threshold:0,limit:h,excludeSlug:null,excludeDomain:null});g.innerHTML=u.map(({domain:b,slug:L,title:v,score:S})=>`<div class="sim-result">${k(b,L,v,S)}</div>`).join("")+`<p class="sim-count">Top ${u.length} for "${l}"</p>`,a.textContent="",D(e,{scored:u,query:l})}catch(r){a.textContent=`Error: ${r.message}`}finally{p.disabled=!1}}};p.addEventListener("click",x),m.addEventListener("keydown",l=>{l.key==="Enter"&&x()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:Y,bind:Q});})();
//# sourceMappingURL=similarity.js.map
