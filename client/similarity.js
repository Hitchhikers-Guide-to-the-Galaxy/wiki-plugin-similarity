/* wiki-plugin-similarity - 0.1.5 - Tue, 09 Jun 2026 20:17:37 GMT */
(()=>{var R={high:.78,medium:.68,low:.58},v=R.medium,k=10,z=t=>{let e=[],n=null,s=null,i="search",d=(o,a)=>o===a||o.startsWith(a)&&/^[\s:]/.test(o.slice(a.length)),r=(o,a)=>o.slice(a.length).replace(/^\s*:?\s*/,"").trim();for(let o of t.split(`
`)){let a=o.trim();if(!a||a.startsWith("#"))continue;let l=a.toUpperCase();if(d(l,"LIST")){!e.length&&i==="search"&&(i="list");continue}if(d(l,"SIMILAR")){let h=r(l,"SIMILAR").toLowerCase();n=R[h]||v,!e.length&&i==="search"&&(i="similar");continue}if(d(l,"THRESHOLD")){n=parseFloat(r(a,"THRESHOLD"))||v;continue}if(d(l,"LIMIT")){s=parseInt(r(a,"LIMIT"))||k;continue}e.push(a)}return{mode:i,specs:e,threshold:n??v,limit:s??k}},U=t=>t.includes("*")||t.includes("?"),F=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),S=new Map,A=async(t,e)=>{if(S.has(t))return S.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(n);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let i=await s.json();return S.set(t,i),i},P=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,s=[];for(let i of t)if(i==="*"||U(i))for(let d of await A(i,e))n.has(d.domain)||(n.add(d.domain),s.push(d));else n.has(i)||(n.add(i),s.push({domain:i,page_count:null}));return s},C=new Map,_=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},O=t=>_()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,H=async t=>{if(C.has(t))return C.get(t);let e=await fetch(O(t));if(!e.ok)return[];let n=await e.json();return C.set(t,n),n},I=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},q=async(t,e)=>{let s=(await H(e)).find(i=>i.slug===t);return s?s.vector:null},D=(t,e,{threshold:n,limit:s,excludeSlug:i,excludeDomain:d})=>{let r=[];for(let{domain:o,pages:a}of e)for(let{slug:l,title:h,vector:p}of a){if(l===i&&o===d)continue;let g=0;for(let c=0;c<t.length;c++)g+=t[c]*p[c];g>=n&&r.push({domain:o,slug:l,title:h,score:g})}return r.sort((o,a)=>a.score-o.score),r.slice(0,s)},T=async(t,e)=>{let n=await P(t,e);return(await Promise.all(n.map(async({domain:i})=>({domain:i,pages:await H(i)})))).filter(i=>i.pages.length>0)},E=`
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
`,N=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,j=(t,e,n,s)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${N(t,s)} ${n}</a>`,V=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:d}=z(e?.text||"");if(n==="list"){let r=s.length?s.join(", "):"*";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Loading indexed domains (${r})\u2026</div>
        <div class="sim-list"></div>
      </div>`)}else if(n==="similar"){let r=s.length?s.join(", "):"current domain";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${r}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else{let r=s.length?s.join(", "):"(current domain)";t.html(`
      <style>${E}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${r}</div>
        <div class="sim-results"></div>
      </div>`)}},W=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:d}=z(e?.text||""),r=window.location.origin,o=t.find(".sim-status")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(a){a.preventDefault();let l=$(this);window.wiki.doInternalLink(l.data("title"),t.parents(".page"),l.data("site"))}),n==="list"){let a=t.find(".sim-list")[0],l=s.length?s.join(","):"*";(async()=>{try{let p=`${r}/system/indexed-domains.json?pattern=${encodeURIComponent(l)}`,g=await fetch(p);if(!g.ok)throw new Error(`indexed-domains failed: ${g.status}`);let c=await g.json();if(!c.length){o.textContent="No indexed domains found";return}let m=c.slice(0,d),u=c.reduce((x,w)=>x+(w.page_count||0),0),f=m.length<c.length?`showing ${m.length} of ${c.length}`:`${c.length} domains`;o.textContent=`${f} \u2014 ${u.toLocaleString()} pages`,a.innerHTML=`<table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${m.map(({domain:x,page_count:w})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(x).flag()}"
                       title="${x}" data-site="${x}"> ${x}</td>
              <td>${w!=null?w.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>`}catch(p){o.textContent=`Error: ${p.message}`}})()}else if(n==="similar")(async()=>{try{let l=t.parents(".page"),h=l.find(".title").text().trim()||document.title,p=F(h),g=window.location.hostname,c=await T(s,r),m=c.reduce((y,b)=>y+b.pages.length,0);o.textContent=`Searching ${m.toLocaleString()} pages\u2026`;let u=await q(p,g);if(!u){o.textContent="Embedding page (not yet indexed)\u2026";let y=l.find(".item").map((b,L)=>$(L).text().trim()).get().filter(Boolean).join(`
`);u=await I(y||h,r)}let f=D(u,c,{threshold:i,limit:d,excludeSlug:p,excludeDomain:g});if(!f.length){o.textContent=`No similar pages found above threshold ${i}`;return}let x=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",w=t.find(".sim-results")[0];w.innerHTML=`<h3>Similar Pages</h3><ul>${f.map(({domain:y,slug:b,title:L,score:M})=>`<li>${j(y,b,L,M)}</li>`).join("")}</ul><p class="sim-count">${f.length} found ${x}</p>`,o.textContent=""}catch(l){o.textContent=`Error: ${l.message}`}})();else{let a=t.find(".sim-input")[0],l=t.find(".sim-btn")[0],h=t.find(".sim-results")[0],p=null;(async()=>{try{o.textContent="Resolving domains\u2026",p=await T(s,r);let m=p.reduce((u,f)=>u+f.pages.length,0);o.textContent=`Ready \u2014 ${m.toLocaleString()} pages across ${p.length} domains`}catch(m){o.textContent=`Load error: ${m.message}`}})();let c=async()=>{let m=a.value.trim();if(!(!m||!p)){l.disabled=!0,o.textContent="Embedding query\u2026",h.innerHTML="";try{let u=await I(m,r),f=D(u,p,{threshold:0,limit:d,excludeSlug:null,excludeDomain:null});h.innerHTML=f.map(({domain:x,slug:w,title:y,score:b})=>`<div class="sim-result">${j(x,w,y,b)}</div>`).join(""),o.textContent=`Top ${f.length} results for "${m}"`}catch(u){o.textContent=`Error: ${u.message}`}finally{l.disabled=!1}}};l.addEventListener("click",c),a.addEventListener("keydown",m=>{m.key==="Enter"&&c()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:V,bind:W});})();
//# sourceMappingURL=similarity.js.map
