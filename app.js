window.addEventListener("kb-ready",()=>{
(() => {
  'use strict';
  const KB = JSON.parse(document.getElementById('kb-data').textContent);
  const els = {
    chat:document.getElementById('chat'), chatInner:document.getElementById('chatInner'), q:document.getElementById('question'), send:document.getElementById('sendBtn'),
    dataStatus:document.getElementById('dataStatus'), docSummary:document.getElementById('docSummary'),
    settingsBtn:document.getElementById('settingsBtn'), backdrop:document.getElementById('settingsBackdrop'), closeSettings:document.getElementById('closeSettings'),
    apiKey:document.getElementById('apiKey'), model:document.getElementById('model'), topK:document.getElementById('topK'), topKValue:document.getElementById('topKValue'),
    docFilter:document.getElementById('docFilter'), rememberKey:document.getElementById('rememberKey'), toggleKey:document.getElementById('toggleKey'), saveSettings:document.getElementById('saveSettings'), testApi:document.getElementById('testApi')
  };

  const DEFAULT_MODEL = 'gemini-3.6-flash';
  const LEGACY_MODELS = new Set(['gemini-2.5-flash','models/gemini-2.5-flash']);
  function normalizeModelName(model=''){
    let m=String(model||'').trim().replace(/^models\//i,'');
    if(!m || LEGACY_MODELS.has(m) || LEGACY_MODELS.has('models/'+m)) return DEFAULT_MODEL;
    return m;
  }

  const state = { chunks:[], history:[], busy:false, lastQuestion:'', settings:{model:DEFAULT_MODEL,topK:8,docFilter:'all'} };

  const SYN = {
    '1인수의':['1인견적','1인 견적','수의계약','전자시담'], '1인':['1인견적','1인 수의'],
    '2인수의':['2인이상 견적','2인 이상 견적','견적제출','수의계약'], '2인':['2인이상','2인 이상'],
    '낙찰하한율':['낙찰하한률','견적가격','예정가격'], '선금':['선금 지급','선금 정산','선금공제'],
    '기성':['기성금','기성','대가'], '준공':['준공계','준공검사','준공대가','정산'], '설계변경':['설계 변경','계약금액 조정','변경계약'],
    '현장대리인':['현장기술자','현장대리인계'], '폐기물':['건설폐기물','폐기물처리'], '하자':['하자보수','하자담보','하자보수보증금'],
    '구비서류':['제출서류','계약서류','서류','붙임 4'], '감사':['감사사례','지적','부적정'], '보험료':['국민연금','건강보험','노인장기요양','고용보험','산재보험']
  };

  function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function norm(s=''){return String(s).toLowerCase().replace(/[·ㆍ\u00b7]/g,' ').replace(/[^0-9a-z가-힣%]+/g,' ').replace(/\s+/g,' ').trim();}
  function tokens(q){
    const n=norm(q); const arr=n.split(' ').filter(x=>x.length>=2 || /^\d+$/.test(x));
    for(const [k,vs] of Object.entries(SYN)){ if(n.includes(norm(k))) vs.forEach(v=>arr.push(norm(v))); }
    return [...new Set(arr.filter(Boolean))];
  }
  function splitText(text,max=2300,overlap=220){
    text=(text||'').trim(); if(!text)return [];
    if(text.length<=max)return [text];
    const out=[]; let start=0;
    while(start<text.length){ let end=Math.min(text.length,start+max); if(end<text.length){ const cut=Math.max(text.lastIndexOf('\n',end),text.lastIndexOf('. ',end)); if(cut>start+max*.55) end=cut+1; } out.push(text.slice(start,end).trim()); if(end>=text.length)break; start=Math.max(start+1,end-overlap); }
    return out.filter(Boolean);
  }
  function buildHwpChunks(doc,docIndex){
    const lines=(doc.full_text||'').split(/\r?\n/); let chapter='',section='',sub=''; let buf=[]; let size=0; const chunks=[];
    const flush=()=>{ if(!buf.length)return; const text=buf.join('\n').trim(); if(text){ splitText(text,2200,180).forEach((part,i)=>chunks.push({docIndex,type:'guide',docTitle:doc.metadata.title,revision:doc.metadata.revision_date||'',location:[chapter,section,sub].filter(Boolean).join(' > ')||'본문',subIndex:i+1,text:part})); } buf=[]; size=0; };
    for(const raw of lines){ const line=raw.trim(); if(!line)continue;
      if(/^제\d+장\s/.test(line)){flush();chapter=line;section='';sub='';continue;}
      if(/^제\d+절\s/.test(line)){flush();section=line;sub='';continue;}
      if(/^【붙임\s*\d/.test(line)){flush();chapter=line;section='';sub='';continue;}
      if(/^\d+\.\s*[^0-9]/.test(line) && line.length<100){ if(size>700)flush(); sub=line; }
      buf.push(line); size+=line.length+1; if(size>2400)flush();
    }
    flush(); return chunks;
  }
  function buildIndex(){
    const docs=KB.collection?.documents||[]; const chunks=[];
    docs.forEach((doc,di)=>{
      if(Array.isArray(doc.pages)) doc.pages.forEach(p=>splitText(p.text||'',2400,180).forEach((part,i)=>chunks.push({docIndex:di,type:'qa',docTitle:doc.metadata.title,revision:doc.metadata.revision||'',page:p.page,location:`p.${p.page}${i?`-${i+1}`:''}`,text:part})));
      if(doc.full_text) chunks.push(...buildHwpChunks(doc,di));
    });
    chunks.forEach((c,i)=>{c.id=i;c.norm=norm(c.docTitle+' '+c.location+' '+c.text)}); state.chunks=chunks;
    const qaPages=docs[0]?.metadata?.page_count||docs[0]?.pages?.length||0;
    els.dataStatus.textContent=`자료 ${docs.length}종 · 검색조각 ${chunks.length.toLocaleString()}개`;
    els.docSummary.innerHTML=docs.map((d,i)=>`<div class="doc-item"><span class="doc-dot" style="background:${i?'#157a58':'#2e6ac7'}"></span><div><b>${esc(d.metadata.title)}</b><span>${esc(d.metadata.revision||d.metadata.revision_date||'')} ${d.metadata.page_count?`· ${d.metadata.page_count}쪽`:''}</span></div></div>`).join('') + `<div style="font-size:11px;color:#738198;margin-top:8px">Q&A 원문 ${qaPages}쪽과 지침 본문을 HTML 안에 내장했습니다.</div>`;
  }

  function legalRefs(text){
    const pats=[/「[^」]{2,50}」\s*제\s*\d+조(?:의\s*\d+)?(?:\s*제\s*\d+항)?(?:\s*제\s*\d+호)?/g,/지방계약법(?:\s*시행령|\s*시행규칙)?\s*제\s*\d+조(?:의\s*\d+)?/g,/집행기준\s*제\s*\d+장(?:\([^)]{1,40}\))?/g,/낙찰자\s*결정기준\s*제\s*\d+장/g,/<별표\s*\d+>/g,/\[붙임\s*\d+(?:-\d+)?\]/g];
    const out=[]; pats.forEach(p=>{for(const m of text.matchAll(p))out.push(m[0].replace(/\s+/g,' '));}); return [...new Set(out)].slice(0,12);
  }
  function search(query,topK){
    let searchQuery=query; const short=norm(query).length<12 || /그거|그럼|위|이 경우|그 경우|그러면/.test(query); if(short && state.lastQuestion) searchQuery=state.lastQuestion+' '+query;
    const qNorm=norm(searchQuery), ts=tokens(searchQuery); const filter=state.settings.docFilter;
    const candidates=state.chunks.filter(c=>filter==='all'||c.type===filter);
    const dfs={}; ts.forEach(t=>{dfs[t]=candidates.reduce((n,c)=>n+(c.norm.includes(t)?1:0),0)});
    const scored=[];
    for(const c of candidates){ let score=0; for(const t of ts){ if(!c.norm.includes(t))continue; const df=dfs[t]||1, idf=Math.log((candidates.length+1)/(df+1))+1; const count=Math.min(5,(c.norm.split(t).length-1)); score += idf*(1.4+count*.45)*(t.length>=4?1.35:1); if(norm(c.location).includes(t))score+=2.2; }
      if(qNorm.length>=5 && c.norm.includes(qNorm))score+=14;
      const nTitle=norm(c.docTitle); ts.forEach(t=>{if(nTitle.includes(t))score+=.7});
      if(/근거|조항|법령|시행령|규정/.test(query) && /제\s*\d+조|집행기준|시행령|지방계약법/.test(c.text)) score+=2.5;
      if(score>0) scored.push({...c,score});
    }
    scored.sort((a,b)=>b.score-a.score);
    const chosen=[]; const seen=new Set();
    for(const c of scored){ const fingerprint=norm(c.text).slice(0,140); if(seen.has(fingerprint))continue; chosen.push(c);seen.add(fingerprint); if(chosen.length>=topK)break; }
    return chosen;
  }

  function sourceDisplay(s){
    const refs=legalRefs(s.text);
    const loc=s.location||'위치 미표기';
    const base=`「${s.docTitle}」 ${loc}`;
    return refs.length ? `${base} / 관련 조항표현: ${refs.join(' · ')}` : base;
  }
  function sourceBlock(s,i){
    const refs=legalRefs(s.text);
    return `=== 근거자료 ${i+1} ===\n출처표기용 문구: ${sourceDisplay(s)}\n문서명: ${s.docTitle}\n자료시점: ${s.revision||'미표기'}\n위치: ${s.location}\n원문에서 감지된 조항표현: ${refs.length?refs.join(' | '):'없음'}\n---\n${s.text}`;
  }

  function buildPrompt(question,sources){
    const history=state.history.slice(-4).map(x=>`${x.role==='user'?'사용자':'챗봇'}: ${x.text}`).join('\n');
    return `사용자 질문:\n${question}\n\n이전 대화(문맥 참고용이며 근거가 아님):\n${history||'없음'}\n\n검색된 첨부자료 원문:\n\n${sources.map(sourceBlock).join('\n\n====================\n\n')}`;
  }
  const SYSTEM = `당신은 서울특별시교육청 공사계약 실무를 돕는 근거중심 챗봇이다. 반드시 아래 규칙을 지켜라.

1) 답변은 사용자가 제공한 검색 원문에 명시된 내용만 근거로 작성한다. 일반 상식, 기억, 인터넷 지식을 보태지 않는다.
2) 숫자, 금액기준, 비율, 기간, 절차, 제출서류는 원문에 있는 값을 그대로 사용한다. 서로 다른 시점 자료가 충돌하면 둘 다 명시하고, 더 최신 자료가 개정사항이라고 명시하는 경우에만 최신 기준을 우선 설명한다. 충돌을 숨기지 않는다.
3) 근거조항은 원문에 실제로 법령명·지침명·장·절·조·항·별표·붙임 번호가 적힌 경우에만 적는다. 조항번호를 추측하거나 만들어내지 않는다. 정확한 조항번호가 검색 원문에 없으면 '첨부자료에서 정확한 조항번호는 확인되지 않음'이라고 적는다.
4) 절대로 [S1], [S2], S1, S2 같은 출처 기호를 답변에 사용하지 않는다. 근거자료 번호도 답변에 노출하지 않는다.
5) 핵심 사실을 설명할 때는 가능한 한 문장 끝에 실제 출처를 다음 형식으로 적는다.
   - PDF 자료: 【「문서명」 p.페이지】
   - 지침 자료: 【「문서명」 제○장 > 제○절 > 세부항목】
   - 검색 원문에 실제 법령 조항이 확인되면: 【「문서명」 위치 / 「법령명」 제○조】
   제공된 '출처표기용 문구'를 참고하되, 검색 원문에 없는 페이지·조항·항목은 만들어내지 않는다.
6) '근거조항' 표의 출처 칸에도 S번호 대신 반드시 실제 문서명과 페이지 또는 장·절 위치를 적는다.
7) 답변을 다음 형식으로 작성한다.
## 답변
질문에 대한 결론을 먼저 2~5문장으로 설명하고, 핵심 문장마다 실제 출처를 붙인다.

## 근거조항
가능하면 마크다운 표로 '구분 | 근거조항·기준 | 적용 내용 | 출처'를 작성한다.
- 출처 예시: 「공사계약 Q&A 및 사례연습」 p.342
- 출처 예시: 「서울특별시교육청 계약업무 처리지침」 제2장 > 제3절 수의계약
근거조항이 없으면 그 사실을 명시한다.

## 실무 체크
실무자가 확인할 항목을 2~6개로 정리하고, 필요한 경우 각 항목 끝에 실제 출처를 붙인다.

## 자료상 유의사항
자료의 개정시점 차이, 한시특례, 검색원문만으로 확정하기 어려운 사항이 있을 때만 적는다. 없으면 생략한다.

8) 질문과 직접 관련 없는 장황한 설명을 피한다. 법률 자문처럼 단정하지 말고 '첨부자료 기준'임을 유지한다.`;

  async function callGemini(question,sources){
    const key=els.apiKey.value.trim() || sessionStorage.getItem('contractGeminiKey') || '';
    if(!key) throw new Error('Gemini API Key를 먼저 설정해 주세요. 우측 상단의 “API 설정”을 누르면 입력할 수 있습니다.');
    const model=normalizeModelName(els.model.value);
    els.model.value=model;
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body={systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:buildPrompt(question,sources)}]}],generationConfig:{temperature:0.12,topP:0.9,maxOutputTokens:4096}};
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body)});
    let payload={}; try{payload=await res.json()}catch(e){}
    if(!res.ok){ const msg=payload?.error?.message||`HTTP ${res.status}`; throw new Error(`Gemini API 오류: ${msg}`); }
    const text=(payload.candidates||[]).flatMap(c=>c.content?.parts||[]).map(p=>p.text||'').join('\n').trim();
    if(!text) throw new Error('Gemini에서 답변 텍스트를 받지 못했습니다. 모델명 또는 API 권한을 확인해 주세요.');
    return text;
  }

  function inlineMd(s){
    let x=esc(s); x=x.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
    x=x.replace(/【([^】]{2,180})】/g,'<span class="cite">【$1】</span>'); return x;
  }
  function renderMarkdown(md){
    const lines=md.replace(/\r/g,'').split('\n'); let out='',inUl=false,inOl=false; const closeLists=()=>{if(inUl){out+='</ul>';inUl=false}if(inOl){out+='</ol>';inOl=false}};
    for(let i=0;i<lines.length;i++){
      const l=lines[i];
      if(/^\|.+\|\s*$/.test(l) && i+1<lines.length && /^\|?\s*:?-+/.test(lines[i+1])){ closeLists(); const headers=l.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim()); i+=2; const rows=[]; while(i<lines.length && /^\|.+\|\s*$/.test(lines[i])){rows.push(lines[i].trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim()));i++;} i--; out+='<table><thead><tr>'+headers.map(h=>`<th>${inlineMd(h)}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+headers.map((_,j)=>`<td>${inlineMd(r[j]||'')}</td>`).join('')+'</tr>').join('')+'</tbody></table>'; continue; }
      let m;
      if((m=l.match(/^###\s+(.+)/))){closeLists();out+=`<h3>${inlineMd(m[1])}</h3>`;continue}
      if((m=l.match(/^##\s+(.+)/))){closeLists();out+=`<h2>${inlineMd(m[1])}</h2>`;continue}
      if((m=l.match(/^####\s+(.+)/))){closeLists();out+=`<h4>${inlineMd(m[1])}</h4>`;continue}
      if((m=l.match(/^[-*]\s+(.+)/))){if(inOl){out+='</ol>';inOl=false}if(!inUl){out+='<ul>';inUl=true}out+=`<li>${inlineMd(m[1])}</li>`;continue}
      if((m=l.match(/^\d+[.)]\s+(.+)/))){if(inUl){out+='</ul>';inUl=false}if(!inOl){out+='<ol>';inOl=true}out+=`<li>${inlineMd(m[1])}</li>`;continue}
      if(!l.trim()){closeLists();continue}
      closeLists(); out+=`<p>${inlineMd(l)}</p>`;
    }
    closeLists(); return out;
  }
  function addUser(text){const el=document.createElement('div');el.className='message user';el.innerHTML=`<div class="bubble">${esc(text).replace(/\n/g,'<br>')}</div><div class="avatar">나</div>`;els.chatInner.appendChild(el);scrollBottom();}
  function addTyping(){const el=document.createElement('div');el.className='message assistant';el.id='typingMsg';el.innerHTML='<div class="avatar">AI</div><div class="bubble"><span class="retrieval-badge">자료 검색 완료 · Gemini 답변 생성 중</span><div class="typing"><i></i><i></i><i></i></div></div>';els.chatInner.appendChild(el);scrollBottom();return el;}
  function addAssistant(text,sources,isError=false){
    const el=document.createElement('div'); el.className='message assistant';
    const sourceHtml=sources?.length?`<div class="sources"><button class="source-toggle">▸ 사용한 원문 근거 ${sources.length}개 보기</button><div class="source-list">${sources.map((s,i)=>`<div class="source-card"><div class="source-head"><span class="source-id">근거 ${i+1}</span><div class="source-meta"><b>${esc(s.docTitle)}</b><br><b>${esc(s.location)}</b> · ${esc(s.revision||'시점 미표기')} · 검색점수 ${s.score.toFixed(1)}</div></div>${legalRefs(s.text).length?`<div style="font-size:10.5px;color:#7a5b13;margin-top:6px">원문에서 확인된 근거조항: ${legalRefs(s.text).map(esc).join(' · ')}</div>`:''}<div style="font-size:11px;color:#38516b;margin-top:6px;font-weight:700">답변 표기: ${esc(sourceDisplay(s))}</div><div class="source-text">${esc(s.text)}</div></div>`).join('')}</div></div>`:'';
    el.innerHTML=`<div class="avatar">AI</div><div class="bubble">${isError?`<div class="error">${esc(text)}</div>`:`<div class="retrieval-badge">첨부자료 근거 답변</div>${renderMarkdown(text)}`}<div class="msg-tools"><button class="mini-btn copy-answer">답변 복사</button></div>${sourceHtml}</div>`;
    els.chatInner.appendChild(el);
    el.querySelector('.source-toggle')?.addEventListener('click',e=>{const list=el.querySelector('.source-list');const open=list.classList.toggle('open');e.target.textContent=`${open?'▾':'▸'} 사용한 원문 근거 ${sources.length}개 ${open?'접기':'보기'}`});
    el.querySelector('.copy-answer')?.addEventListener('click',async e=>{try{await navigator.clipboard.writeText(text);e.target.textContent='복사됨';setTimeout(()=>e.target.textContent='답변 복사',1200)}catch(_){}});
    scrollBottom();
  }
  function scrollBottom(){requestAnimationFrame(()=>els.chat.scrollTop=els.chat.scrollHeight)}
  function autoGrow(){els.q.style.height='auto';els.q.style.height=Math.min(180,els.q.scrollHeight)+'px'}

  async function ask(raw){
    const question=(raw??els.q.value).trim(); if(!question||state.busy)return;
    state.busy=true;els.send.disabled=true;addUser(question);els.q.value='';autoGrow();
    const topK=Number(state.settings.topK)||8; const sources=search(question,topK); const typing=addTyping();
    try{
      if(!sources.length) throw new Error('첨부자료에서 질문과 관련된 원문을 찾지 못했습니다. 계약 단계, 금액, 공종 등 핵심어를 포함해 다시 질문해 주세요.');
      const answer=await callGemini(question,sources); typing.remove(); addAssistant(answer,sources,false); state.history.push({role:'user',text:question},{role:'assistant',text:answer}); state.history=state.history.slice(-8); state.lastQuestion=question;
    }catch(err){typing.remove();addAssistant(err.message||String(err),sources,true)}finally{state.busy=false;els.send.disabled=false;els.q.focus()}
  }

  function loadSettings(){
    const saved=JSON.parse(localStorage.getItem('contractChatSettings')||'{}');
    state.settings={...state.settings,...saved};
    state.settings.model=normalizeModelName(state.settings.model);
    els.model.value=state.settings.model;
    els.topK.value=state.settings.topK||8;
    els.topKValue.textContent=`${els.topK.value}개`;
    els.docFilter.value=state.settings.docFilter||'all';
    localStorage.setItem('contractChatSettings',JSON.stringify(state.settings));
    const k=sessionStorage.getItem('contractGeminiKey'); if(k){els.apiKey.value=k;els.rememberKey.checked=true}
  }
  function saveSettings(close=true){
    state.settings.model=normalizeModelName(els.model.value);
    els.model.value=state.settings.model;
    state.settings.topK=Number(els.topK.value);
    state.settings.docFilter=els.docFilter.value;
    localStorage.setItem('contractChatSettings',JSON.stringify(state.settings));
    if(els.rememberKey.checked && els.apiKey.value.trim())sessionStorage.setItem('contractGeminiKey',els.apiKey.value.trim());
    else sessionStorage.removeItem('contractGeminiKey');
    if(close)els.backdrop.classList.remove('open')
  }
  async function testApi(){
    saveSettings(false);
    els.testApi.disabled=true;
    const old=els.testApi.textContent;
    els.testApi.textContent='확인 중…';
    try{
      const key=els.apiKey.value.trim()||sessionStorage.getItem('contractGeminiKey')||'';
      if(!key)throw new Error('API Key를 입력해 주세요.');
      let model=normalizeModelName(els.model.value);
      els.model.value=model;

      const request=async(m)=>{
        const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,{
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':key},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:'연결 확인입니다. OK라고만 답하세요.'}]}],generationConfig:{maxOutputTokens:8,temperature:0}})
        });
        let p={}; try{p=await r.json()}catch(_){ }
        return {r,p};
      };

      let {r,p}=await request(model);
      const msg=p?.error?.message||'';
      if(!r.ok && model!==DEFAULT_MODEL && /no longer available|not found|unsupported|deprecated/i.test(msg)){
        model=DEFAULT_MODEL;
        els.model.value=model;
        state.settings.model=model;
        localStorage.setItem('contractChatSettings',JSON.stringify(state.settings));
        ({r,p}=await request(model));
      }
      if(!r.ok)throw new Error(p?.error?.message||`HTTP ${r.status}`);
      els.testApi.textContent='연결 성공 ✓';
      setTimeout(()=>els.testApi.textContent=old,1600)
    }catch(e){
      alert(e.message||e);
      els.testApi.textContent=old
    }finally{els.testApi.disabled=false}
  }

  els.send.addEventListener('click',()=>ask()); els.q.addEventListener('input',autoGrow); els.q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
  document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>ask(b.textContent)));
  els.settingsBtn.addEventListener('click',()=>els.backdrop.classList.add('open'));els.closeSettings.addEventListener('click',()=>els.backdrop.classList.remove('open'));els.backdrop.addEventListener('click',e=>{if(e.target===els.backdrop)els.backdrop.classList.remove('open')});
  els.topK.addEventListener('input',()=>els.topKValue.textContent=`${els.topK.value}개`);els.toggleKey.addEventListener('click',()=>{els.apiKey.type=els.apiKey.type==='password'?'text':'password';els.toggleKey.textContent=els.apiKey.type==='password'?'보기':'숨김'});els.saveSettings.addEventListener('click',()=>saveSettings(true));els.testApi.addEventListener('click',testApi);

  buildIndex(); loadSettings();
  setTimeout(()=>{if(!(els.apiKey.value.trim()||sessionStorage.getItem('contractGeminiKey'))) els.backdrop.classList.add('open')},350);
})();
});
