/* wiki-plugin-similarity - 0.1.0 - Tue, 09 Jun 2026 19:10:50 GMT */
(()=>{var j={high:.78,medium:.68,low:.58},v=j.medium,E=10,R=t=>{let e=[],s=null,n=null,i="search";for(let c of t.split(`
`)){let o=c.trim();if(!o||o.startsWith("#"))continue;let a=o.toUpperCase();if(a.startsWith("SIMILAR:")){let p=o.split(":")[1].trim().toLowerCase();s=j[p]??v,!e.length&&i==="search"&&(i="similar");continue}if(a.startsWith("THRESHOLD:")){s=parseFloat(o.split(":")[1])||v;continue}if(a.startsWith("LIMIT:")){n=parseInt(o.split(":")[1])||E;continue}e.push(o)}return{mode:i,specs:e,threshold:s??v,limit:n??E}},z=t=>t.includes("*")||t.includes("?"),F=t=>t.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""),L=new Map,U=async(t,e)=>{if(L.has(t))return L.get(t);let s=`${e}/system/indexed-domains.json?pattern=${encodeURIComponent(t)}`,n=await fetch(s);if(!n.ok)throw new Error(`indexed-domains failed: ${n.status}`);let i=await n.json();return L.set(t,i),i},W=async(t,e)=>{t.length||(t=[window.location.hostname]);let s=new Set,n=[];for(let i of t)if(i==="*"||z(i))for(let c of await U(i,e))s.has(c.domain)||(s.add(c.domain),n.push(c));else s.has(i)||(s.add(i),n.push({domain:i,page_count:null}));return n},S=new Map,_=()=>{let t=window.location.hostname;return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"},A=t=>_()?`${window.location.origin}/system/semantic-vectors.json?domain=${encodeURIComponent(t)}`:`http://${t}/system/semantic-vectors.json`,H=async t=>{if(S.has(t))return S.get(t);let e=await fetch(A(t));if(!e.ok)return[];let s=await e.json();return S.set(t,s),s},k=async(t,e)=>{let s=await fetch(`${e}/system/embed.json?text=${encodeURIComponent(t)}`);if(!s.ok)throw new Error(`embed failed: ${s.status}`);return(await s.json()).vector},q=async(t,e)=>{let n=(await H(e)).find(i=>i.slug===t);return n?n.vector:null},C=(t,e,{threshold:s,limit:n,excludeSlug:i,excludeDomain:c})=>{let o=[];for(let{domain:a,pages:p}of e)for(let{slug:u,title:r,vector:d}of p){if(u===i&&a===c)continue;let f=0;for(let m=0;m<t.length;m++)f+=t[m]*d[m];f>=s&&o.push({domain:a,slug:u,title:r,score:f})}return o.sort((a,p)=>p.score-a.score),o.slice(0,n)},D=async(t,e)=>{let s=await W(t,e);return(await Promise.all(s.map(async({domain:i})=>({domain:i,pages:await H(i)})))).filter(i=>i.pages.length>0)},T=`
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
`,O=(t,e)=>`<img class="sim-flag remote" src="${window.wiki.site(t).flag()}"
        title="${t} \u2014 score ${e.toFixed(3)}"
        data-site="${t}">`,I=(t,e,s,n)=>`<a class="sim-link" data-title="${s}" data-slug="${e}" data-site="${t}" href="#">${O(t,n)} ${s}</a>`,P=(t,e)=>{let{mode:s,specs:n,threshold:i,limit:c}=R(e?.text||"");if(s==="similar"){let o=n.length?n.join(", "):"current domain";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-status">Finding similar pages across ${o}\u2026</div>
        <div class="sim-results"></div>
      </div>`)}else{let o=n.length?n.join(", "):"(current domain)";t.html(`
      <style>${T}</style>
      <div class="similarity" data-id="${e.id}">
        <div class="sim-form">
          <input class="sim-input" type="text" placeholder="Search wiki pages\u2026" />
          <button class="sim-btn">Search</button>
        </div>
        <div class="sim-status">Domains: ${o}</div>
        <div class="sim-results"></div>
      </div>`)}},V=(t,e)=>{let{mode:s,specs:n,threshold:i,limit:c}=R(e?.text||""),o=window.location.origin,a=t.find(".sim-status")[0],p=t.find(".sim-results")[0];if(t.on("dblclick",()=>window.wiki.textEditor(t,e)),t.on("click",".sim-link",function(u){u.preventDefault();let r=$(this);window.wiki.doInternalLink(r.data("title"),t.parents(".page"),r.data("site"))}),s==="similar")(async()=>{try{let r=t.parents(".page"),d=r.find(".title").text().trim()||document.title,f=F(d),m=window.location.hostname,l=await D(n,o),h=l.reduce((x,w)=>x+w.pages.length,0);a.textContent=`Searching ${h.toLocaleString()} pages\u2026`;let g=await q(f,m);if(!g){a.textContent="Embedding page (not yet indexed)\u2026";let x=r.find(".item").map((w,b)=>$(b).text().trim()).get().filter(Boolean).join(`
`);g=await k(x||d,o)}let y=C(g,l,{threshold:i,limit:c,excludeSlug:f,excludeDomain:m});if(!y.length){a.textContent=`No similar pages found above threshold ${i}`;return}p.innerHTML=`<h3>Similar Pages</h3><ul>${y.map(({domain:x,slug:w,title:b,score:M})=>`<li>${I(x,w,b,M)}</li>`).join("")}</ul>`,a.textContent=`${y.length} similar pages found`}catch(r){a.textContent=`Error: ${r.message}`}})();else{let u=t.find(".sim-input")[0],r=t.find(".sim-btn")[0],d=null;(async()=>{try{a.textContent="Resolving domains\u2026",d=await D(n,o);let l=d.reduce((h,g)=>h+g.pages.length,0);a.textContent=`Ready \u2014 ${l.toLocaleString()} pages across ${d.length} domains`}catch(l){a.textContent=`Load error: ${l.message}`}})();let m=async()=>{let l=u.value.trim();if(!(!l||!d)){r.disabled=!0,a.textContent="Embedding query\u2026",p.innerHTML="";try{let h=await k(l,o),g=C(h,d,{threshold:0,limit:c,excludeSlug:null,excludeDomain:null});p.innerHTML=g.map(({domain:y,slug:x,title:w,score:b})=>`<div class="sim-result">${I(y,x,w,b)}</div>`).join(""),a.textContent=`Top ${g.length} results for "${l}"`}catch(h){a.textContent=`Error: ${h.message}`}finally{r.disabled=!1}}};r.addEventListener("click",m),u.addEventListener("keydown",l=>{l.key==="Enter"&&m()})}};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.similarity={emit:P,bind:V});})();
//# sourceMappingURL=similarity.js.map
