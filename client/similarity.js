/* wiki-plugin-similarity - 0.1.4 - Tue, 09 Jun 2026 20:06:24 GMT */
(()=>{var R={high:.78,medium:.68,low:.58},v=R.medium,k=10,z=t=>{let e=[],n=null,s=null,i="search",m=(o,a)=>o===a||o.startsWith(a)&&/^[\s:]/.test(o.slice(a.length)),r=(o,a)=>o.slice(a.length).replace(/^\s*:?\s*/,"").trim();for(let o of t.split(`
`)){let a=o.trim();if(!a||a.startsWith("#"))continue;let l=a.toUpperCase();if(m(l,"LIST")){!e.length&&i==="search"&&(i="list");continue}if(m(l,"SIMILAR")){let h=r(l,"SIMILAR").toLowerCase();n=R[h]||v,!e.length&&i==="search"&&(i="similar");continue}if(m(l,"THRESHOLD")){n=parseFloat(r(a,"THRESHOLD"))||v;continue}if(m(l,"LIMIT")){s=parseInt(r(a,"LIMIT"))||k;continue}e.push(a)}return{mode:i,specs:e,threshold:n??v,limit:s??k}},U=t=>t.includes("*")||t.includes("?"),F=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),S=new Map,A=async(t,e)=>{if(S.has(t))return S.get(t);let n=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,s=await fetch(n);if(!s.ok)throw new Error(`indexed-domains failed: ${s.status}`);let i=await s.json();return S.set(t,i),i},P=async(t,e)=>{t.length||(t=[window.location.hostname]);let n=new Set,s=[];for(let i of t)if(i==="*"||U(i))for(let m of await A(i,e))n.has(m.domain)||(n.add(m.domain),s.push(m));else n.has(i)||(n.add(i),s.push({domain:i,page_count:null}));return s},C=new Map,_=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},O=t=>_()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,H=async t=>{if(C.has(t))return C.get(t);let e=await fetch(O(t));if(!e.ok)return[];let n=await e.json();return C.set(t,n),n},I=async(t,e)=>{let n=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!n.ok)throw new Error(`embed failed: ${n.status}`);return(await n.json()).vector},q=async(t,e)=>{let s=(await H(e)).find(i=>i.slug===t);return s?s.vector:null},T=(t,e,{threshold:n,limit:s,excludeSlug:i,excludeDomain:m})=>{let r=[];for(let{domain:o,pages:a}of e)for(let{slug:l,title:h,vector:p}of a){if(l===i&&o===m)continue;let f=0;for(let d=0;d<t.length;d++)f+=t[d]*p[d];f>=n&&r.push({domain:o,slug:l,title:h,score:f})}return r.sort((o,a)=>a.score-o.score),r.slice(0,s)},j=async(t,e)=>{let n=await P(t,e);return(await Promise.all(n.map(async({domain:i})=>({domain:i,pages:await H(i)})))).filter(i=>i.pages.length>0)},E=`
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
`,V=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,D=(t,e,n,s)=>`<a class="sim-link" data-title="${n}" data-slug="${e}" data-site="${t}" href="#">${V(t,s)} ${n}</a>`,W=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:m}=z(e?.text||"");if(n==="list"){let r=s.length?s.join(", "):"*";t.html(`
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
      </div>`)}},N=(t,e)=>{let{mode:n,specs:s,threshold:i,limit:m}=z(e?.text||""),r=window.location.origin,o=t.find(".sim-status")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(a){a.preventDefault();let l=$(this);window.wiki.doInternalLink(l.data("title"),t.parents(".page"),l.data("site"))}),n==="list"){let a=t.find(".sim-list")[0],l=s.length?s.join(","):"*";(async()=>{try{let p=`${r}/system/indexed-domains.json?pattern=${encodeURIComponent(l)}`,f=await fetch(p);if(!f.ok)throw new Error(`indexed-domains failed: ${f.status}`);let d=await f.json();if(!d.length){o.textContent="No indexed domains found";return}let g=d.reduce((c,u)=>c+(u.page_count||0),0);o.textContent=`${d.length} domains \u2014 ${g.toLocaleString()} pages`,a.innerHTML=`<table>
          <tr><th>Domain</th><th>Pages</th></tr>
          ${d.map(({domain:c,page_count:u})=>`
            <tr>
              <td><img class="sim-flag remote" src="${window.wiki.site(c).flag()}"
                       title="${c}" data-site="${c}"> ${c}</td>
              <td>${u!=null?u.toLocaleString():"\u2014"}</td>
            </tr>`).join("")}
        </table>`}catch(p){o.textContent=`Error: ${p.message}`}})()}else if(n==="similar")(async()=>{try{let l=t.parents(".page"),h=l.find(".title").text().trim()||document.title,p=F(h),f=window.location.hostname,d=await j(s,r),g=d.reduce((x,w)=>x+w.pages.length,0);o.textContent=`Searching ${g.toLocaleString()} pages\u2026`;let c=await q(p,f);if(!c){o.textContent="Embedding page (not yet indexed)\u2026";let x=l.find(".item").map((w,L)=>$(L).text().trim()).get().filter(Boolean).join(`
`);c=await I(x||h,r)}let u=T(c,d,{threshold:i,limit:m,excludeSlug:p,excludeDomain:f});if(!u.length){o.textContent=`No similar pages found above threshold ${i}`;return}let y=!s.length||s.length===1&&s[0]==="*"?"on farm":s.length===1?`on ${s[0]}`:"in domains",b=t.find(".sim-results")[0];b.innerHTML=`<h3>Similar Pages</h3><ul>${u.map(({domain:x,slug:w,title:L,score:M})=>`<li>${D(x,w,L,M)}</li>`).join("")}</ul><p class="sim-count">${u.length} found ${y}</p>`,o.textContent=""}catch(l){o.textContent=`Error: ${l.message}`}})();else{let a=t.find(".sim-input")[0],l=t.find(".sim-btn")[0],h=t.find(".sim-results")[0],p=null;(async()=>{try{o.textContent="Resolving domains\u2026",p=await j(s,r);let g=p.reduce((c,u)=>c+u.pages.length,0);o.textContent=`Ready \u2014 ${g.toLocaleString()} pages across ${p.length} domains`}catch(g){o.textContent=`Load error: ${g.message}`}})();let d=async()=>{let g=a.value.trim();if(!(!g||!p)){l.disabled=!0,o.textContent="Embedding query\u2026",h.innerHTML="";try{let c=await I(g,r),u=T(c,p,{threshold:0,limit:m,excludeSlug:null,excludeDomain:null});h.innerHTML=u.map(({domain:y,slug:b,title:x,score:w})=>`<div class="sim-result">${D(y,b,x,w)}</div>`).join(""),o.textContent=`Top ${u.length} results for "${g}"`}catch(c){o.textContent=`Error: ${c.message}`}finally{l.disabled=!1}}};l.addEventListener("click",d),a.addEventListener("keydown",g=>{g.key==="Enter"&&d()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:W,bind:N});})();
//# sourceMappingURL=similarity.js.map
