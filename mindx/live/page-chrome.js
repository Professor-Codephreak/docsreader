function adjFont(d){const p=document.querySelector('.page');const s=parseFloat(getComputedStyle(p).fontSize)||14;p.style.fontSize=Math.max(10,Math.min(22,s+d))+'px';try{localStorage.setItem('mindx_fs',p.style.fontSize)}catch{}}
try{const fs=localStorage.getItem('mindx_fs');if(fs)document.addEventListener('DOMContentLoaded',()=>{document.querySelector('.page').style.fontSize=fs})}catch{}
// ── Living docs: inject live data from API into data-live spans ──
(function(){
  var spans=document.querySelectorAll('[data-live]');
  if(!spans.length)return;
  var style=document.createElement('style');
  style.textContent='[data-live]{font-family:"JetBrains Mono","SF Mono",monospace;font-weight:600;transition:color .3s}[data-live].loaded{color:#3fb950}[data-live].stale{color:#d29922}';
  document.head.appendChild(style);
  function populate(data,src){
    spans.forEach(function(el){
      var key=el.getAttribute('data-live');
      var val=key.split('.').reduce(function(o,k){return o&&o[k]},data);
      if(val!==undefined&&val!==null){
        el.textContent=typeof val==='number'?val.toLocaleString():String(val);
        el.classList.add('loaded');el.classList.remove('stale');
        el.title='Live from /'+src+' at '+new Date().toISOString().slice(11,19);
      }
    });
  }
  fetch('/thesis/evidence').then(function(r){return r.json()}).then(function(d){populate(d,'thesis/evidence')}).catch(function(){});
  fetch('/diagnostics/live').then(function(r){return r.json()}).then(function(d){
    var flat={};
    flat.agents_count=(d.agents||[]).length;
    flat.uptime=d.uptime||"?";
    flat.cpu_percent=(d.system||{}).cpu_percent||0;
    flat.memory_percent=(d.system||{}).memory_percent||0;
    flat.memory_used_gb=(d.system||{}).memory_used_gb||0;
    flat.memory_total_gb=(d.system||{}).memory_total_gb||0;
    flat.inference_available=(d.inference||{}).available||0;
    flat.inference_total=(d.inference||{}).total||0;
    flat.beliefs_count=(d.beliefs||{}).count||0;
    flat.vault_entries=(d.vault||{}).entries||0;
    flat.stm_records=(d.memory||{}).stm_records||0;
    flat.db_memories=(d.database||{}).memories||0;
    flat.db_embeddings=(d.database||{}).mem_embeddings||0;
    flat.db_size=(d.database||{}).db_size||"?";
    flat.db_actions=(d.database||{}).actions||0;
    flat.db_godel_choices=(d.database||{}).godel_choices||0;
    flat.dojo_count=(d.dojo||[]).length;
    flat.actions_count=(d.actions||[]).length;
    flat.interactions_count=(d.interactions||[]).length;
    flat.loop_running=(d.autonomous||{}).loop_running?"active":"stopped";
    flat.governor_mode=(d.governor||{}).mode||"?";
    var th=d.thesis||{};
    flat.improvement_rate=th.improvement_rate?((th.improvement_rate*100).toFixed(1)+'%'):"?";
    flat.improvements_succeeded=th.improvements_succeeded||0;
    flat.improvements_attempted=th.improvements_attempted||0;
    flat.godel_choices=th.godel_choices||0;
    flat.self_referential=th.self_referential||0;
    flat.evidence_span_hours=th.evidence_span_hours?th.evidence_span_hours.toFixed(0)+"h":"?";
    populate(flat,'diagnostics/live');
  }).catch(function(){});
  // Refresh only when page is visible (no background polling)
  var _liveInterval=setInterval(function(){
    if(document.hidden)return; // skip if tab not visible
    fetch('/diagnostics/live').then(function(r){return r.json()}).then(function(d){
      var flat={};
      flat.agents_count=(d.agents||[]).length;flat.uptime=d.uptime||"?";
      flat.cpu_percent=(d.system||{}).cpu_percent||0;
      flat.inference_available=(d.inference||{}).available||0;flat.inference_total=(d.inference||{}).total||0;
      flat.db_memories=(d.database||{}).memories||0;flat.db_embeddings=(d.database||{}).mem_embeddings||0;
      flat.stm_records=(d.memory||{}).stm_records||0;flat.loop_running=(d.autonomous||{}).loop_running?"active":"stopped";
      var th=d.thesis||{};flat.improvement_rate=th.improvement_rate?((th.improvement_rate*100).toFixed(1)+'%'):"?";
      flat.improvements_succeeded=th.improvements_succeeded||0;flat.godel_choices=th.godel_choices||0;
      flat.self_referential=th.self_referential||0;flat.evidence_span_hours=th.evidence_span_hours?th.evidence_span_hours.toFixed(0)+"h":"?";
      populate(flat,'diagnostics/live');
    }).catch(function(){spans.forEach(function(el){el.classList.add('stale')})});
  },60000); // 60s refresh, only when visible
})();
