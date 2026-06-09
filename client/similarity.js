/* wiki-plugin-similarity - 0.1.1 - Tue, 09 Jun 2026 19:40:05 GMT */
(()=>{var I={high:.78,medium:.68,low:.58},L=I.medium,E=10,z=t=>{let s=[],e=null,n=null,i="search";for(let g of t.split(`
`)){let a=g.trim();if(!a||a.startsWith("#"))continue;let o=a.toUpperCase();if(o==="LIST"||o.startsWith("LIST ")){!s.length&&i==="search"&&(i="list");continue}if(o.startsWith("SIMILAR:")){let m=a.split(":")[1].trim().toLowerCase();e=I[m]??L,!s.length&&i==="search"&&(i="similar");continue}if(o.startsWith("THRESHOLD:")){e=parseFloat(a.split(":")[1])||L;continue}if(o.startsWith("LIMIT:")){n=parseInt(a.split(":")[1])||E;continue}s.push(a)}return{mode:i,specs:s,threshold:e??L,limit:n??E}},M=t=>t.includes("*")||t.includes("?"),U=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),v=new Map,F=async(t,s)=>{if(v.has(t))return v.get(t);let e=`${s}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,n=await fetch(e);if(!n.ok)throw new Error(`indexed-domains failed: ${n.status}`);let i=await n.json();return v.set(t,i),i},W=async(t,s)=>{t.length||(t=[window.location.hostname]);let e=new Set,n=[];for(let i of t)if(i==="*"||M(i))for(let g of await F(i,s))e.has(g.domain)||(e.add(g.domain),n.push(g));else e.has(i)||(e.add(i),n.push({domain:i,page_count:null}));return n},S=new Map,P=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},_=t=>P()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,R=async t=>{if(S.has(t))return S.get(t);let s=await fetch(_(t));if(!s.ok)return[];let e=await s.json();return S.set(t,e),e},k=async(t,s)=>{let e=await fetch(`${s}/system/embed.json?text=${encodeURIComponent(t)}`);if(!e.ok)throw new Error(`embed failed: ${e.status}`);return(await e.json()).vector},A=async(t,s)=>{let n=(await R(s)).find(i=>i.slug===t);return n?n.vector:null},j=(t,s,{threshold:e,limit:n,excludeSlug:i,excludeDomain:g})=>{let a=[];for(let{domain:o,pages:m}of s)for(let{slug:l,title:h,vector:d}of m){if(l===i&&o===g)continue;let f=0;for(let c=0;c<t.length;c++)f+=t[c]*d[c];f>=e&&a.push({domain:o,slug:l,title:h,score:f})}return a.sort((o,m)=>m.score-o.score),a.slice(0,n)},T=async(t,s)=>{let e=await W(t,s);return(await Promise.all(e.map(async({domain:i})=>({domain:i,pages:await R(i)})))).filter(i=>i.pages.length>0)},C=`
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
  .similar-results h3 small { font-size:12px; color:#888; font-weight:normal; margin-left:6px; }
  .similar-results ul { margin:0; padding-left:18px; }
  .similar-results li { font-size:14px; padding:2px 0; }
  .similar-results .sim-domain { margin-left:6px; }
  .sim-list table { border-collapse:collapse; width:100%; font-size:13px; }
  .sim-list th { text-align:left; font-size:11px; color:#888; padding:2px 8px 4px 0;
                 border-bottom:1px solid #ddd; }
  .sim-list td { padding:3px 8px 3px 0; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
  .sim-list td:last-child { text-align:right; color:#999; font-size:11px; }
  .sim-list .sim-flag { margin-right:6px; }
`,q=(t,s)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${s.toFixed(3)}"
        data-site="${t}">`,D=(t,s,e,n)=>`<a class="sim-link" data-title="${e}" data-slug="${s}" data-site="${t}" href="#">${q(t,n)} ${e}</a>`,O=(t,s)=>{let{mode:e,specs:n,threshold:i,limit:g}=z(s?.text||"");if(e==="list"){let a=n.length?n.join(", "):"*";t.html(`
      <style>${C}</style>
      <div class="similarity" data-id="${s.id}">
        <div class="sim-status">Loading indexed domains (${a})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(e==="similar"){let a=n.length?n.join(", "):"current domain";t.html(`
      <style>${C}</style>
      <div class="similarity" data-id="${s.id}">
        <div class="sim-status">Finding similar pages across ${a}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else{let a=n.length?n.join(", "):"(current domain)";t.html(`
      <style>${C}</style>
      <div class="similarity" data-id="${s.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${a}</div>
        <div class="sim-results"></div>
      </div>`)}},V=(t,s)=>{let{mode:e,specs:n,threshold:i,limit:g}=z(s?.text||""),a=window.location.origin,o=t.find(".sim-status")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,s)),t.on("click",".sim-link",function(m){m.preventDefault();let l=$(this);window.wiki.doInternalLink(l.data("title"),t.parents(".page"),l.data("site"))}),e==="list"){let m=t.find(".sim-list")[0],l=n.length?n.join(","):"*";(async()=>{try{let d=`${a}/system/indexed-domains.json?pattern=${encodeURIComponent(l)}`,f=await fetch(d);if(!f.ok)throw new Error(`indexed-domains failed: ${f.status}`);let c=await f.json();if(!c.length){o.textContent="No indexed domains found";return}let p=c.reduce((r,u)=>r+(u.page_count||0),0);o.textContent=`${c.length} domains \u2014 ${p.toLocaleString()} pages`,m.innerHTML=`<table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${c.map(({domain:r,page_count:u})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(r).flag()}"
                       title="${r}" data-site="${r}"> ${r}</td>
              <td>${u!=null?u.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>`}catch(d){o.textContent=`Error: ${d.message}`}})()}else if(e==="similar")(async()=>{try{let l=t.parents(".page"),h=l.find(".title").text().trim()||document.title,d=U(h),f=window.location.hostname,c=await T(n,a),p=c.reduce((x,w)=>x+w.pages.length,0);o.textContent=`Searching ${p.toLocaleString()} pages\u2026`;let r=await A(d,f);if(!r){o.textContent="Embedding page (not yet indexed)\u2026";let x=l.find(".item").map((w,y)=>$(y).text().trim()).get().filter(Boolean).join(`
`);r=await k(x||h,a)}let u=j(r,c,{threshold:i,limit:g,excludeSlug:d,excludeDomain:f});if(!u.length){o.textContent=`No similar pages found above threshold ${i}`;return}let b=t.find(".sim-results")[0];b.innerHTML=`<h3>Similar Pages <small>${u.length} found</small></h3><ul>${u.map(({domain:x,slug:w,title:y,score:H})=>`<li>${D(x,w,y,H)}</li>`).join("")}</ul>`,o.textContent=""}catch(l){o.textContent=`Error: ${l.message}`}})();else{let m=t.find(".sim-input")[0],l=t.find(".sim-btn")[0],h=t.find(".sim-results")[0],d=null;(async()=>{try{o.textContent="Resolving domains\u2026",d=await T(n,a);let p=d.reduce((r,u)=>r+u.pages.length,0);o.textContent=`Ready \u2014 ${p.toLocaleString()} pages across ${d.length} domains`}catch(p){o.textContent=`Load error: ${p.message}`}})();let c=async()=>{let p=m.value.trim();if(!(!p||!d)){l.disabled=!0,o.textContent="Embedding query\u2026",h.innerHTML="";try{let r=await k(p,a),u=j(r,d,{threshold:0,limit:g,excludeSlug:null,excludeDomain:null});h.innerHTML=u.map(({domain:b,slug:x,title:w,score:y})=>`<div class="sim-result">${D(b,x,w,y)}</div>`).join(""),o.textContent=`Top ${u.length} results for "${p}"`}catch(r){o.textContent=`Error: ${r.message}`}finally{l.disabled=!1}}};l.addEventListener("click",c),m.addEventListener("keydown",p=>{p.key==="Enter"&&c()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:O,bind:V});})();
//# sourceMappingURL=similarity.js.map
