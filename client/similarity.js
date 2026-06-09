/* wiki-plugin-similarity - 0.1.2 - Tue, 09 Jun 2026 19:46:51 GMT */
(()=>{var z={high:.78,medium:.68,low:.58},v=z.medium,k=10,R=t=>{let e=[],n=null,s=null,i="search";for(let g of t.split(`
`)){let a=g.trim();if(!a||a.startsWith("#"))continue;let o=a.toUpperCase();if(o==="LIST"||o.startsWith("LIST ")){!e.length&&i==="search"&&(i="list");continue}if(o.startsWith("SIMILAR:")){let m=a.split(":")[1].trim().toLowerCase();n=z[m]??v,!e.length&&i==="search"&&(i="similar");continue}if(o.startsWith("THRESHOLD:")){n=parseFloat(a.split(":")[1])||v;continue}if(o.startsWith("LIMIT:")){s=parseInt(a.split(":")[1])||k;continue}e.push(a)}return{mode:i,specs:e,threshold:n??v,limit:s??k}},U=t=>t.includes("*")||t.includes("?"),F=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),S=new Map,W=async(t,e)=>{if(S.has(t))return S.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(n);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let i=await s.json();return S.set(t,i),i},P=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,s=[];for(let i of t)if(i==="*"||U(i))for(let g of await W(i,e))n.has(g.domain)||(n.add(g.domain),s.push(g));else n.has(i)||(n.add(i),s.push({domain:i,page_count:null}));return s},C=new Map,_=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},A=t=>_()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,H=async t=>{if(C.has(t))return C.get(t);let e=await fetch(A(t));if(!e.ok)return[];let n=await e.json();return C.set(t,n),n},j=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},q=async(t,e)=>{let s=(await H(e)).find(i=>i.slug===t);return s?s.vector:null},T=(t,e,{threshold:n,limit:s,excludeSlug:i,excludeDomain:g})=>{let a=[];for(let{domain:o,pages:m}of e)for(let{slug:l,title:h,vector:d}of m){if(l===i&&o===g)continue;let f=0;for(let c=0;c<t.length;c++)f+=t[c]*d[c];f>=n&&a.push({domain:o,slug:l,title:h,score:f})}return a.sort((o,m)=>m.score-o.score),a.slice(0,s)},D=async(t,e)=>{let n=await P(t,e);return(await Promise.all(n.map(async({domain:i})=>({domain:i,pages:await H(i)})))).filter(i=>i.pages.length>0)},E=`
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
`,O=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,I=(t,e,n,s)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${O(t,s)} ${n}</a>`,V=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:g}=R(e?.text||"");if(n==="list"){let a=s.length?s.join(", "):"*";t.html(`
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
      </div>`)}},N=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:g}=R(e?.text||""),a=window.location.origin,o=t.find(".sim-status")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(m){m.preventDefault();let l=$(this);window.wiki.doInternalLink(l.data("title"),t.parents(".page"),l.data("site"))}),n==="list"){let m=t.find(".sim-list")[0],l=s.length?s.join(","):"*";(async()=>{try{let d=`${a}/system/indexed-domains.json?pattern=${encodeURIComponent(l)}`,f=await fetch(d);if(!f.ok)throw new Error(`indexed-domains failed: ${f.status}`);let c=await f.json();if(!c.length){o.textContent="No indexed domains found";return}let p=c.reduce((r,u)=>r+(u.page_count||0),0);o.textContent=`${c.length} domains \u2014 ${p.toLocaleString()} pages`,m.innerHTML=`<table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${c.map(({domain:r,page_count:u})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(r).flag()}"
                       title="${r}" data-site="${r}"> ${r}</td>
              <td>${u!=null?u.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>`}catch(d){o.textContent=`Error: ${d.message}`}})()}else if(n==="similar")(async()=>{try{let l=t.parents(".page"),h=l.find(".title").text().trim()||document.title,d=F(h),f=window.location.hostname,c=await D(s,a),p=c.reduce((x,w)=>x+w.pages.length,0);o.textContent=`Searching ${p.toLocaleString()} pages\u2026`;let r=await q(d,f);if(!r){o.textContent="Embedding page (not yet indexed)\u2026";let x=l.find(".item").map((w,L)=>$(L).text().trim()).get().filter(Boolean).join(`
`);r=await j(x||h,a)}let u=T(r,c,{threshold:i,limit:g,excludeSlug:d,excludeDomain:f});if(!u.length){o.textContent=`No similar pages found above threshold ${i}`;return}let y=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",b=t.find(".sim-results")[0];b.innerHTML=`<h3>Similar Pages</h3><ul>${u.map(({domain:x,slug:w,title:L,score:M})=>`<li>${I(x,w,L,M)}</li>`).join("")}</ul><p class="sim-count">${u.length} found ${y}</p>`,o.textContent=""}catch(l){o.textContent=`Error: ${l.message}`}})();else{let m=t.find(".sim-input")[0],l=t.find(".sim-btn")[0],h=t.find(".sim-results")[0],d=null;(async()=>{try{o.textContent="Resolving domains\u2026",d=await D(s,a);let p=d.reduce((r,u)=>r+u.pages.length,0);o.textContent=`Ready \u2014 ${p.toLocaleString()} pages across ${d.length} domains`}catch(p){o.textContent=`Load error: ${p.message}`}})();let c=async()=>{let p=m.value.trim();if(!(!p||!d)){l.disabled=!0,o.textContent="Embedding query\u2026",h.innerHTML="";try{let r=await j(p,a),u=T(r,d,{threshold:0,limit:g,excludeSlug:null,excludeDomain:null});h.innerHTML=u.map(({domain:y,slug:b,title:x,score:w})=>`<div class="sim-result">${I(y,b,x,w)}</div>`).join(""),o.textContent=`Top ${u.length} results for "${p}"`}catch(r){o.textContent=`Error: ${r.message}`}finally{l.disabled=!1}}};l.addEventListener("click",c),m.addEventListener("keydown",p=>{p.key==="Enter"&&c()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:V,bind:N});})();
//# sourceMappingURL=similarity.js.map
