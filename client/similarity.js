/* wiki-plugin-similarity - 0.1.3 - Tue, 09 Jun 2026 20:02:35 GMT */
(()=>{var R={high:.78,medium:.68,low:.58},v=R.medium,k=10,z=t=>{let e=[],n=null,s=null,i="search",p=(a,o)=>a.slice(o.length).replace(/^\s*:?\s*/,"").trim();for(let a of t.split(`
`)){let o=a.trim();if(!o||o.startsWith("#"))continue;let l=o.toUpperCase();if(l==="LIST"||l.startsWith("LIST ")||l.startsWith("LIST:")){!e.length&&i==="search"&&(i="list");continue}if(l.startsWith("SIMILAR")){let r=p(l,"SIMILAR").toLowerCase();n=R[r]??v,!e.length&&i==="search"&&(i="similar");continue}if(l.startsWith("THRESHOLD")){n=parseFloat(p(o,"THRESHOLD"))||v;continue}if(l.startsWith("LIMIT")){s=parseInt(p(o,"LIMIT"))||k;continue}e.push(o)}return{mode:i,specs:e,threshold:n??v,limit:s??k}},U=t=>t.includes("*")||t.includes("?"),F=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),S=new Map,W=async(t,e)=>{if(S.has(t))return S.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(n);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let i=await s.json();return S.set(t,i),i},A=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,s=[];for(let i of t)if(i==="*"||U(i))for(let p of await W(i,e))n.has(p.domain)||(n.add(p.domain),s.push(p));else n.has(i)||(n.add(i),s.push({domain:i,page_count:null}));return s},C=new Map,P=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},_=t=>P()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,H=async t=>{if(C.has(t))return C.get(t);let e=await fetch(_(t));if(!e.ok)return[];let n=await e.json();return C.set(t,n),n},I=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},O=async(t,e)=>{let s=(await H(e)).find(i=>i.slug===t);return s?s.vector:null},T=(t,e,{threshold:n,limit:s,excludeSlug:i,excludeDomain:p})=>{let a=[];for(let{domain:o,pages:l}of e)for(let{slug:r,title:h,vector:m}of l){if(r===i&&o===p)continue;let f=0;for(let d=0;d<t.length;d++)f+=t[d]*m[d];f>=n&&a.push({domain:o,slug:r,title:h,score:f})}return a.sort((o,l)=>l.score-o.score),a.slice(0,s)},j=async(t,e)=>{let n=await A(t,e);return(await Promise.all(n.map(async({domain:i})=>({domain:i,pages:await H(i)})))).filter(i=>i.pages.length>0)},E=`
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
  .similar-results h3 { margin:4px 0 6px; font-size:14px; color:#555; }
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
`,q=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,D=(t,e,n,s)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${q(t,s)} ${n}</a>`,V=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:p}=z(e?.text||"");if(n==="list"){let a=s.length?s.join(", "):"*";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${a})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(n==="similar"){let a=s.length?s.join(", "):"current domain";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${a}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else{let a=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${a}</div>
        <div class="sim-results"></div>
      </div>`)}},N=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:p}=z(e?.text||""),a=window.location.origin,o=t.find(".sim-status")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(l){l.preventDefault();let r=$(this);window.wiki.doInternalLink(r.data("title"),t.parents(".page"),r.data("site"))}),n==="list"){let l=t.find(".sim-list")[0],r=s.length?s.join(","):"*";(async()=>{try{let m=`${a}/system/indexed-domains.json?pattern=${encodeURIComponent(r)}`,f=await fetch(m);if(!f.ok)throw new Error(`indexed-domains failed: ${f.status}`);let d=await f.json();if(!d.length){o.textContent="No indexed domains found";return}let u=d.reduce((c,g)=>c+(g.page_count||0),0);o.textContent=`${d.length} domains \u2014 ${u.toLocaleString()} pages`,l.innerHTML=`<table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${d.map(({domain:c,page_count:g})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(c).flag()}"
                       title="${c}" data-site="${c}"> ${c}</td>
              <td>${g!=null?g.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>`}catch(m){o.textContent=`Error: ${m.message}`}})()}else if(n==="similar")(async()=>{try{let r=t.parents(".page"),h=r.find(".title").text().trim()||document.title,m=F(h),f=window.location.hostname,d=await j(s,a),u=d.reduce((x,w)=>x+w.pages.length,0);o.textContent=`Searching ${u.toLocaleString()} pages\u2026`;let c=await O(m,f);if(!c){o.textContent="Embedding page (not yet indexed)\u2026";let x=r.find(".item").map((w,L)=>$(L).text().trim()).get().filter(Boolean).join(`
`);c=await I(x||h,a)}let g=T(c,d,{threshold:i,limit:p,excludeSlug:m,excludeDomain:f});if(!g.length){o.textContent=`No similar pages found above threshold ${i}`;return}let y=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",b=t.find(".sim-results")[0];b.innerHTML=`<h3>Similar Pages</h3><ul>${g.map(({domain:x,slug:w,title:L,score:M})=>`<li>${D(x,w,L,M)}</li>`).join("")}</ul><p class="sim-count">${g.length} found ${y}</p>`,o.textContent=""}catch(r){o.textContent=`Error: ${r.message}`}})();else{let l=t.find(".sim-input")[0],r=t.find(".sim-btn")[0],h=t.find(".sim-results")[0],m=null;(async()=>{try{o.textContent="Resolving domains\u2026",m=await j(s,a);let u=m.reduce((c,g)=>c+g.pages.length,0);o.textContent=`Ready \u2014 ${u.toLocaleString()} pages across ${m.length} domains`}catch(u){o.textContent=`Load error: ${u.message}`}})();let d=async()=>{let u=l.value.trim();if(!(!u||!m)){r.disabled=!0,o.textContent="Embedding query\u2026",h.innerHTML="";try{let c=await I(u,a),g=T(c,m,{threshold:0,limit:p,excludeSlug:null,excludeDomain:null});h.innerHTML=g.map(({domain:y,slug:b,title:x,score:w})=>`<div class="sim-result">${D(y,b,x,w)}</div>`).join(""),o.textContent=`Top ${g.length} results for "${u}"`}catch(c){o.textContent=`Error: ${c.message}`}finally{r.disabled=!1}}};r.addEventListener("click",d),l.addEventListener("keydown",u=>{u.key==="Enter"&&d()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:V,bind:N});})();
//# sourceMappingURL=similarity.js.map
