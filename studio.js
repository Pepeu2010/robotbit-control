/* Robotbit Control 5.0 — Robotics Studio.
   Browser-side only: no changes to micro:bit firmware.
   Hardware is NEVER driven by simulation playback. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bridge=window.RobotbitBridge;
  if(!bridge){console.warn('RobotbitBridge não encontrado; Studio indisponível.');return;}
  const storage='robotbit-studio-v5';
  const optionsDefault={cautious:false,idleSeconds:60,curve:1,sensitivity:1,hand:'right',theme:'blue',reduced:false};
  const tabs=[
    ['control','Controle','◈'],['studio','Estúdio 3D','⬡'],
    ['motion','Movimentos','⏺'],['missions','Missões','◎'],
    ['diagnostics','Diagnóstico','⌁'],['safety','Segurança','⬡'],
    ['academy','Academia','▤'],['profiles','Perfis','⚙']
  ];
  const codeMap={L:[0,-1],R:[0,1],B:[1,-1],F:[1,1],D:[2,-1],U:[2,1],O:[3,-1],C:[3,1]};
  const channels=[
    {title:'BASE · P12',negative:'L',positive:'R',minus:'◀',plus:'▶'},
    {title:'BRAÇO · P13',negative:'B',positive:'F',minus:'▼',plus:'▲'},
    {title:'PULSO · P14',negative:'D',positive:'U',minus:'▼',plus:'▲'},
    {title:'GARRA · P8',negative:'O',positive:'C',minus:'Abrir',plus:'Fechar'}
  ];
  const quests=[
    {name:'Primeiro giro',axis:0,target:12,description:'Gire a base virtual para +12 passos.',time:60},
    {name:'Braço preciso',axis:1,target:18,description:'Eleve o braço virtual até +18 passos.',time:55},
    {name:'Pinça coordenada',axis:3,target:-16,description:'Abra a pinça virtual até −16 passos.',time:60},
    {name:'Controle do pulso',axis:2,target:-15,description:'Mova o pulso virtual para −15 passos.',time:50}
  ];
  const lessons=[
    {name:'Servomotores',body:'Um servomotor posiciona seu eixo conforme o comando recebido. No seu robô, P8 controla a garra, P12 a base, P13 o braço e P14 o pulso. Os limites reais dependem da montagem e do firmware.',question:'Qual pino corresponde à garra?',answers:['P14','P8','P12'],correct:1},
    {name:'Bluetooth BLE',body:'O celular envia caracteres pelo serviço UART BLE. O firmware interpreta cada caractere e move um servo por passo. O painel não recebe de volta a posição real das articulações.',question:'O que é comprovado por um comando enviado?',answers:['Que o motor chegou à posição','Que uma operação de envio BLE terminou sem erro','Que a bateria está cheia'],correct:1},
    {name:'Dois joysticks',body:'Cada joystick acompanha um identificador de toque independente. O navegador intercala os comandos para os quatro eixos, pois o canal UART transmite uma instrução por vez.',question:'Movimentos simultâneos significam...',answers:['Comandos intercalados para os eixos','Quatro canais físicos BLE independentes','Leitura da posição dos servos'],correct:0},
    {name:'Segurança',body:'O botão de bloqueio interrompe os envios e tenta transmitir o comando de parada. Não é um desligamento elétrico de emergência. Mantenha as mãos livres das engrenagens e evite movimentos nos limites.',question:'O botão de parada do site...',answers:['Corta a alimentação da Robotbit','É equivalente a uma chave física de emergência','Bloqueia comandos pelo software'],correct:2},
    {name:'Simulação 3D',body:'O braço 3D é um gêmeo digital ilustrativo, animado pelos comandos. Sem sensores no robô, sua posição virtual pode divergir da real. A simulação funciona desconectada.',question:'A posição do braço 3D representa...',answers:['Uma estimativa baseada nos comandos','A posição exata medida por sensor','Um vídeo da garra real'],correct:0}
  ];
  function load(){
    try{
      const raw=JSON.parse(localStorage.getItem(storage)||'null');
      return raw&&typeof raw==='object'?raw:{};
    }catch(e){return {};}
  }
  const stored=load();
  const opts=Object.assign({},optionsDefault,stored.options||{});
  opts.curve=clamp(Number(opts.curve)||1,.55,2.6);
  opts.sensitivity=clamp(Number(opts.sensitivity)||1,.4,1.8);
  opts.idleSeconds=[0,30,60,120].includes(Number(opts.idleSeconds))?Number(opts.idleSeconds):60;
  opts.cautious=!!opts.cautious;
  opts.hand=opts.hand==='left'?'left':'right';
  opts.theme=['blue','teal','violet'].includes(opts.theme)?opts.theme:'blue';
  opts.reduced=!!opts.reduced;
  window.RobotbitV5Options=opts;
  const state={
    view:'control',virtual:bridge.snapshot().steps.slice(),recording:false,
    recordStart:0,events:[],selection:-1,playTimer:null,playToken:0,
    recordingName:'Nova sequência',log:[],bleOk:0,bleFail:0,bleTime:[],
    sessionStart:Date.now(),lastCommandTimes:[],sentCodes:0,
    best:stored.best&&typeof stored.best==='object'?stored.best:{},
    academy:stored.academy&&typeof stored.academy==='object'?stored.academy:{},
    profiles:Array.isArray(stored.profiles)?stored.profiles.slice(0,8):[],
    lesson:0,mission:null,missionStart:0,missionInterval:null,
    warningTimer:null
  };
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
  function persist(){
    try{
      localStorage.setItem(storage,JSON.stringify({
        options:opts,profiles:state.profiles.slice(0,8),
        best:state.best,academy:state.academy
      }));
    }catch(e){log('erro','Não foi possível salvar no navegador');}
  }
  function applyPrefs(){
    document.body.classList.toggle('studio-left-handed',opts.hand==='left');
    document.body.classList.toggle('studio-reduced-motion',opts.reduced);
    document.body.classList.remove('studio-theme-blue','studio-theme-teal','studio-theme-violet');
    document.body.classList.add('studio-theme-'+opts.theme);
    document.documentElement.style.scrollBehavior=opts.reduced?'auto':'';
  }
  applyPrefs();
  function safeText(v){return String(v??'');}
  function escapeHTML(s){return safeText(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function formatTime(t){return new Date(t).toLocaleTimeString('pt-BR',{hour12:false});}
  function duration(sec){return Math.floor(sec/60)+':'+String(Math.floor(sec%60)).padStart(2,'0');}
  function button(label,action,cls){return '<button type="button" class="studio-button '+(cls||'')+'" data-action="'+action+'">'+label+'</button>';}
  function heading(kicker,title,subtitle,badge){
    return '<div class="studio-heading"><div><div class="studio-eyebrow">'+kicker+'</div><h2>'+title+'</h2><p>'+subtitle+'</p></div>'+
    (badge?'<span class="studio-pill">'+badge+'</span>':'')+'</div>';
  }
  function progress(pct){return '<div class="studio-progress" aria-label="Progresso"><div style="width:'+clamp(pct,0,100)+'%"></div></div>';}
  function controlMarkup(){
    return '<section class="studio-card" id="studioControlPro">'+
      '<div class="studio-row between"><div><div class="studio-eyebrow">CONTROL PRO · AJUSTES AO VIVO</div><h3 style="margin:6px 0">Seu jeito de controlar</h3><p>Os ajustes alteram a resposta dos joysticks sem mudar o firmware.</p></div>'+
      '<span class="studio-tag">V5.0</span></div>'+
      '<div class="studio-two" style="margin-top:12px">'+
      '<label class="studio-field"><span class="studio-label">Sensibilidade <output id="ctrlSensVal">'+opts.sensitivity.toFixed(1)+'×</output></span><input id="ctrlSens" type="range" min=".4" max="1.8" step=".1" value="'+opts.sensitivity+'"></label>'+
      '<label class="studio-field"><span class="studio-label">Curva de resposta <output id="ctrlCurveVal">'+opts.curve.toFixed(2)+'</output></span><input id="ctrlCurve" type="range" min=".55" max="2.6" step=".05" value="'+opts.curve+'"></label></div>'+
      '<div class="studio-row between" style="margin-top:13px"><label class="studio-check"><input type="checkbox" id="ctrlHand" '+(opts.hand==='left'?'checked':'')+'> Preferir joysticks invertidos (canhoto)</label>'+
      '<button class="studio-button sm" data-action="reset-response">Padrão</button></div>'+
      '<p class="studio-muted" style="margin-top:10px">Movimentos menores enviam comandos com menor frequência. Mantenha o modo Preciso durante os primeiros testes.</p></section>';
  }
  const nav=document.createElement('nav');
  nav.className='studio-nav';nav.id='studioNav';nav.setAttribute('aria-label','Áreas do Robotbit Control');
  for(const item of tabs){
    const b=document.createElement('button');
    b.type='button';b.dataset.view=item[0];b.textContent=item[2]+'  '+item[1];
    b.setAttribute('aria-current',item[0]==='control'?'page':'false');nav.appendChild(b);
  }
  const page=document.createElement('section');page.id='studioPage';page.className='studio-page';page.setAttribute('aria-live','off');
  const hero=document.querySelector('.hero');
  hero.after(nav,page);
  const controlPro=document.createElement('div');controlPro.id='studioControlMount';controlPro.innerHTML=controlMarkup();
  const extras=$('extras');extras.parentNode.insertBefore(controlPro,extras);
  const quickStop=document.createElement('button');
  quickStop.type='button';quickStop.className='studio-fab';quickStop.textContent='■  BLOQUEAR MOVIMENTOS';
  quickStop.setAttribute('aria-label','Bloquear comandos do robô');
  document.body.appendChild(quickStop);
  quickStop.addEventListener('click',()=>bridge.stop());
  const dialog=document.createElement('div');dialog.className='studio-dialog';dialog.hidden=true;
  dialog.innerHTML='<div class="studio-dialog-inner" role="alertdialog" aria-modal="true" aria-labelledby="sdTitle" aria-describedby="sdText">'+
    '<h3 id="sdTitle"></h3><p id="sdText"></p><div class="studio-dialog-actions"><button class="studio-button" id="sdCancel" type="button">Cancelar</button><button class="studio-button danger" id="sdConfirm" type="button">Confirmar</button></div></div>';
  document.body.appendChild(dialog);
  let dialogResolve=null;
  function ask(title,message){
    $('sdTitle').textContent=title;$('sdText').textContent=message;dialog.hidden=false;
    $('sdCancel').focus();
    return new Promise(resolve=>{dialogResolve=resolve;});
  }
  function closeDialog(yes){dialog.hidden=true;if(dialogResolve){dialogResolve(yes);dialogResolve=null;}}
  $('sdCancel').addEventListener('click',()=>closeDialog(false));
  $('sdConfirm').addEventListener('click',()=>closeDialog(true));
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeDialog(false);}});
  const oldPreviewParent=$('armStage').parentNode,oldPreviewNext=$('armStage').nextSibling;
  function moveStage(toStudio){
    const stage=$('armStage');
    if(toStudio){
      const target=$('studioPreviewSlot');
      if(target&&stage.parentNode!==target)target.appendChild(stage);
      window.robotbit3D?.show?.();
      window.robotbit3D?.setSteps?.(state.virtual);
    }else if(stage.parentNode!==oldPreviewParent){
      oldPreviewParent.insertBefore(stage,oldPreviewNext);
    }
    requestAnimationFrame(()=>window.robotbit3D?.resize?.());
  }
  function navigate(next){
    if(!tabs.some(x=>x[0]===next))return;
    if(next!=='control'&&bridge.snapshot().armed){
      void bridge.stop();log('segurança','Controle bloqueado ao sair da tela de operação');
    }
    if(state.view==='studio'&&next!=='studio')moveStage(false);
    if(next!=='motion')cancelPlayback();
    state.view=next;
    document.body.classList.toggle('studio-subpage',next!=='control');
    nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.view===next?'page':'false'));
    page.innerHTML=next==='control'?'':markup(next);
    if(next==='studio')moveStage(true);
    if(next==='diagnostics')refreshDiagnostics();
    if(next==='motion')renderTimeline();
    if(next==='missions')updateMissionUI();
    if(next==='academy')renderLesson();
    if(next==='profiles')renderProfiles();
    if(next==='safety')refreshSafety();
    if(next==='studio')syncStudioControls();
    window.scrollTo(0,0);
    log('navegação','Área: '+(tabs.find(x=>x[0]===next)||[])[1]);
  }
  nav.addEventListener('click',event=>{
    const b=event.target.closest('[data-view]');if(b)navigate(b.dataset.view);
  });
  function log(level,message,extra){
    const entry={at:Date.now(),level:level,message:safeText(message).slice(0,200),extra:extra||null};
    state.log.push(entry);if(state.log.length>200)state.log.shift();
    if(state.view==='diagnostics')drawLog();
  }
  function emitVirtual(code,step){
    if(!Object.hasOwn(codeMap,code))return;
    const result=bridge.simulate(code,step);
    if(result)state.virtual=result.slice();
    refreshVirtualLabels();
    if(state.recording)capture(code,step,'virtual');
    if(state.mission)checkMission();
  }
  function virtualControls(){
    return '<div class="studio-virtual-controls">'+channels.map(ch=>
      '<div class="studio-control-block"><span>'+ch.title+'</span><div><button type="button" data-virtual="'+ch.negative+'" aria-label="'+ch.title+' negativo">'+ch.minus+'</button>'+
      '<button type="button" data-virtual="'+ch.positive+'" aria-label="'+ch.title+' positivo">'+ch.plus+'</button></div></div>'
    ).join('')+'</div>';
  }
  function visualSteps(){
    return '<div class="studio-stats" id="virtualSteps">'+
      ['P12 · Base','P13 · Braço','P14 · Pulso','P8 · Garra'].map((name,i)=>'<div class="studio-stat"><strong data-step="'+i+'">'+(state.virtual[i]||0)+'</strong><span>'+name+'</span></div>').join('')+
      '</div>';
  }
  function refreshVirtualLabels(){
    page.querySelectorAll('[data-step]').forEach(node=>{
      const i=Number(node.dataset.step);
      node.textContent=String(state.virtual[i]||0);
    });
    for(let i=0;i<4;i++){const input=$('studioAxis'+i);if(input&&document.activeElement!==input)input.value=String(state.virtual[i]||0);}
  }
  function markup(which){
    if(which==='studio')return studioMarkup();
    if(which==='motion')return motionMarkup();
    if(which==='missions')return missionMarkup();
    if(which==='diagnostics')return diagnosticMarkup();
    if(which==='safety')return safetyMarkup();
    if(which==='academy')return academyMarkup();
    if(which==='profiles')return profileMarkup();
    return '';
  }
  function studioMarkup(){
    return heading('02 / ROBOTICS VISUAL STUDIO','Laboratório 3D','Experimente a garra virtual, explore a câmera e teste cada articulação sem conectar o robô.','SIMULAÇÃO OFFLINE*')+
    '<div class="studio-grid"><div class="studio-card"><div class="studio-row between" style="margin-bottom:10px"><h3>Gêmeo digital ilustrativo</h3>'+
    '<span class="studio-tag">THREE.JS</span></div><div id="studioPreviewSlot" class="studio-preview-mount"></div>'+
    '<div class="studio-shelf" style="margin-top:10px">'+
    button('Isométrica','cam-iso','sm')+button('Frontal','cam-front','sm')+
    button('Lateral','cam-side','sm')+button('Superior','cam-top','sm')+
    button('Reiniciar posição','reset-virtual','sm')+'</div>'+
    '<p class="studio-muted" style="margin-top:9px">O 3D recebe comandos virtuais e reais. É uma estimativa visual; não mede a posição dos servos.</p></div>'+
    '<div class="studio-stack"><div class="studio-card"><h3>Controle de articulações</h3><p>Os controles abaixo movem apenas a simulação.</p>'+
    '<div class="studio-stack" style="margin-top:11px">'+
    channels.map((ch,i)=>'<label class="studio-field"><span class="studio-label">'+ch.title+' <output id="studioAxisOut'+i+'">'+state.virtual[i]+'</output></span>'+
    '<input id="studioAxis'+i+'" type="range" min="-32" max="32" step="1" value="'+state.virtual[i]+'" data-axis="'+i+'"></label>').join('')+
    '</div>'+button('Centralizar articulações','reset-virtual','')+'</div>'+
    '<div class="studio-card"><h3>Cenário e acabamento</h3><p>Escolha uma aparência para a bancada.</p>'+
    '<div class="studio-row" style="margin-top:11px">'+
    button('Azul','paint-blue','sm')+button('Verde','paint-teal','sm')+button('Grafite','paint-graphite','sm')+'</div>'+
    '<label class="studio-check" style="margin-top:12px"><input type="checkbox" id="studioObjects"> Exibir objetos de demonstração</label>'+
    '<p class="studio-muted" style="margin-top:9px">Os objetos são ilustrativos; a simulação não calcula colisões reais.</p></div></div></div>'+
    '<div class="studio-card" style="margin-top:13px"><div class="studio-row between"><h3>Comandos virtuais</h3>'+
    '<span class="studio-tag">NÃO MOVIMENTA A GARRA FÍSICA</span></div>'+
    virtualControls()+'<div style="margin-top:10px">'+visualSteps()+'</div></div>';
  }
  function motionMarkup(){
    return heading('03 / MOTION STUDIO','Gravação de movimentos','Grave comandos Bluetooth ou crie sequências virtuais; edite e reproduza com segurança na simulação.','SEM EXECUÇÃO FÍSICA')+
    '<div class="studio-banner warn" style="margin-bottom:13px"><div>⚠</div><div><strong>Reprodução apenas virtual.</strong> Como não há confirmação de posição física, sequências gravadas não serão enviadas automaticamente aos motores.</div></div>'+
    '<div class="studio-card"><div class="studio-row between"><div><h3>Linha do tempo</h3><p>Limite de 250 eventos e 60 segundos por gravação.</p></div>'+
    '<div class="studio-row">'+button('● REC','rec-toggle','danger')+button('▶ Reproduzir','play-motion','good')+button('■ Parar','stop-motion','sm')+'</div></div>'+
    '<div class="studio-row" style="margin-top:11px">'+
    '<span class="studio-tag" id="recordStatus">NÃO GRAVANDO</span><span class="studio-tag" id="motionCount">0 EVENTOS</span>'+
    '<label class="studio-field" style="flex:1"><span class="studio-label">Nome</span><input class="studio-input" id="motionName" maxlength="32" value="'+escapeHTML(state.recordingName)+'"></label></div>'+
    '<div id="motionTimeline" class="studio-timeline" aria-label="Sequência de comandos"></div>'+
    '<div class="studio-row">'+
    button('Remover selecionado','delete-step','sm')+button('Limpar','clear-motion','sm')+
    button('Exportar JSON','export-motion','sm')+button('Importar JSON','import-motion','sm')+
    '<input type="file" id="motionFile" accept=".json,application/json" hidden></div>'+
    '<div class="studio-divider"></div><h3>Registrar movimentos virtuais</h3><p>Ative REC e toque nos botões. Também é possível gravar os movimentos que você fizer na garra real.</p>'+
    '<div style="margin-top:12px">'+virtualControls()+'</div></div>'+
    '<div class="studio-card" style="margin-top:12px"><h3>Posição da simulação</h3><div style="margin-top:11px">'+visualSteps()+'</div></div>';
  }
  function missionMarkup(){
    return heading('04 / MISSION CENTER','Centro de Missões','Desafios cronometrados de articulação para praticar o controle virtual.','TREINO VIRTUAL')+
    '<div class="studio-grid"><div class="studio-card"><h3>Desafios</h3><p>Escolha um desafio. Nada será enviado por Bluetooth.</p>'+
    '<div class="studio-stack" id="missionCards" style="margin-top:12px">'+quests.map((q,i)=>{
      const best=Number(state.best[i]);
      return '<div class="studio-mission-card" data-done="'+Number.isFinite(best&&best)?'true':'false'+'">'+
        '<div class="studio-row between"><div><strong>'+(i+1)+'. '+q.name+'</strong><small style="display:block;margin-top:4px">'+q.description+'</small></div>'+
        '<span class="studio-tag">'+(best?'RECORDE '+best+'s':'INÉDITA')+'</span></div>'+
        button('Iniciar desafio','mission-start-'+i,'sm')+'</div>';
    }).join('')+'</div></div>'+
    '<div class="studio-stack"><div class="studio-card"><h3 id="missionTitle">Selecione uma missão</h3>'+
    '<p id="missionGoal">Objetivo e progresso aparecerão aqui.</p>'+
    '<div class="studio-stats" style="margin-top:12px;grid-template-columns:1fr 1fr"><div class="studio-stat"><strong id="missionTime">0:00</strong><span>Tempo decorrido</span></div>'+
    '<div class="studio-stat"><strong id="missionScore">—</strong><span>Alvo virtual</span></div></div>'+
    '<div id="missionBar" style="margin:13px 0">'+progress(0)+'</div>'+
    '<div class="studio-row">'+button('Reiniciar','mission-restart','sm')+button('Cancelar','mission-cancel','sm')+'</div></div>'+
    '<div class="studio-card"><h3>Comandos para treinar</h3><p>Use os controles virtuais para alcançar o alvo.</p>'+
    '<div style="margin-top:10px">'+virtualControls()+'</div>'+
    '<div style="margin-top:11px">'+visualSteps()+'</div></div></div></div>';
  }
  function diagnosticMarkup(){
    return heading('05 / DIAGNOSTICS CENTER','Diagnóstico BLE','Métricas do navegador: operações, erros e tempo das escritas Bluetooth.','DADOS LOCAIS')+
    '<div class="studio-card"><div id="diagMetrics" class="studio-stats"></div>'+
    '<canvas id="diagChart" class="studio-chart" width="700" height="115" aria-label="Gráfico de tempo das últimas operações Bluetooth"></canvas>'+
    '<div class="studio-row between" style="margin-top:13px"><div><h3>Log de eventos</h3><p>Os 200 eventos mais recentes ficam somente nesta sessão.</p></div>'+
    '<div class="studio-row">'+button('Exportar CSV','export-diag','sm')+button('Limpar log','clear-diag','sm')+'</div></div>'+
    '<div id="diagLog" class="studio-log" aria-live="off" style="margin-top:11px"></div></div>'+
    '<div class="studio-banner" style="margin-top:12px"><div>ℹ</div><div>Tempo de escrita BLE não é o tempo de resposta mecânica. Esta página não lê bateria, corrente, força ou ângulos físicos dos servos.</div></div>';
  }
  function safetyMarkup(){
    return heading('06 / SAFETY CENTER','Segurança de operação','Proteções adicionais no navegador. Não substituem desligamento elétrico nem limitadores físicos.','CONTROLE DE RISCO')+
    '<div class="studio-banner danger" style="margin-bottom:13px"><div>■</div><div><strong>Parada por software.</strong> Pressionar BLOQUEAR impede novos comandos e tenta enviar ! por BLE, mas não corta alimentação e não garante parada se a conexão falhar.</div></div>'+
    '<div class="studio-grid"><div class="studio-card"><h3>Limites do navegador</h3>'+
    '<label class="studio-check" style="margin-top:14px"><input type="checkbox" id="safeCautious" '+(opts.cautious?'checked':'')+'> Modo prudente: limitar velocidade para 1° por passo</label>'+
    '<label class="studio-label" for="safeIdle" style="margin-top:18px">Bloqueio automático por inatividade</label>'+
    '<select id="safeIdle" class="studio-select">'+[
      [0,'Desativado'],[30,'30 segundos'],[60,'60 segundos'],[120,'120 segundos']
    ].map(([s,t])=>'<option value="'+s+'" '+(opts.idleSeconds===s?'selected':'')+'>'+t+'</option>').join('')+'</select>'+
    '<p class="studio-muted" style="margin-top:9px">O tempo conta a partir da última interação. Mesmo segurando um joystick parado, o navegador pode bloquear ao atingir o limite.</p>'+
    '<div class="studio-divider"></div>'+
    '<div class="studio-row">'+button('■ Bloquear agora','safety-stop','danger')+button('Testar resposta visual','safety-test','sm')+'</div></div>'+
    '<div class="studio-card"><h3>Estado da operação</h3><div id="safeMetrics" class="studio-stack" style="margin-top:13px"></div>'+
    '<div class="studio-divider"></div><h3>Checklist antes de operar</h3>'+
    '<div class="studio-stack" style="margin-top:11px">'+[
      'Garra apoiada e sem obstáculos','Mãos afastadas das engrenagens','Fonte de energia estável','Botão de bloqueio acessível'
    ].map((t,i)=>'<label class="studio-check"><input type="checkbox" data-safety-check="'+i+'"> '+t+'</label>').join('')+'</div>'+
    '<p class="studio-muted" style="margin-top:10px">Checklist informativo: a conexão não depende destas caixas.</p></div></div>';
  }
  function academyMarkup(){
    const count=Object.keys(state.academy).filter(k=>state.academy[k]===true).length;
    return heading('07 / ROBOTICS ACADEMY','Academia de Robótica','Cinco lições curtas, cada uma com uma pergunta prática.','PROGRESSO LOCAL')+
    '<div class="studio-grid"><div class="studio-card"><h3>Trilha de aprendizado</h3>'+
    '<p style="margin-top:5px">'+count+' de '+lessons.length+' lições concluídas</p>'+
    '<div style="margin:12px 0">'+progress(100*count/lessons.length)+'</div>'+
    '<div class="studio-stack" style="margin-top:13px">'+lessons.map((l,i)=>
      '<button class="studio-button" style="justify-content:space-between" data-lesson="'+i+'"><span>'+(i+1)+'. '+l.name+'</span>'+
      '<span>'+ (state.academy[i]?'✓ Concluída':'Estudar →')+'</span></button>'
    ).join('')+'</div></div>'+
    '<div class="studio-card"><div id="lessonPanel"></div></div></div>';
  }
  function profileMarkup(){
    return heading('08 / WORKSPACE','Perfis e personalização','Guarde layouts, exporte arquivos e escolha o tema do controle.','ARMAZENAMENTO LOCAL')+
    '<div class="studio-grid"><div class="studio-stack"><div class="studio-card"><h3>Perfis de controle</h3>'+
    '<p>Até oito perfis salvos neste navegador. A aplicação de um perfil reinicia a página.</p>'+
    '<label class="studio-label" for="profileName">Nome do perfil</label><div class="studio-row"><input class="studio-input" style="flex:1" id="profileName" maxlength="25" placeholder="Ex.: Robô da escola">'+
    button('Salvar atual','profile-save','primary')+'</div>'+
    '<div class="studio-stack" id="profileList" style="margin-top:13px"></div></div>'+
    '<div class="studio-card"><h3>Backup de configurações</h3><p>Exporte ou importe as preferências e os perfis em JSON. Nenhum dado é enviado para servidor.</p>'+
    '<div class="studio-row" style="margin-top:12px">'+button('Exportar JSON','profile-export','sm')+button('Importar JSON','profile-import','sm')+
    '<input id="profileFile" type="file" accept=".json,application/json" hidden></div></div></div>'+
    '<div class="studio-stack"><div class="studio-card"><h3>Visual do aplicativo</h3>'+
    '<label class="studio-label" for="profileTheme">Cor do tema</label><select id="profileTheme" class="studio-select">'+
    [['blue','Azul tecnológico'],['teal','Verde esmeralda'],['violet','Violeta']].map(([k,v])=>
      '<option value="'+k+'" '+(opts.theme===k?'selected':'')+'>'+v+'</option>').join('')+'</select>'+
    '<label class="studio-check" style="margin-top:14px"><input id="profileHand" type="checkbox" '+(opts.hand==='left'?'checked':'')+'> Interface para canhotos</label>'+
    '<label class="studio-check" style="margin-top:12px"><input id="profileReduce" type="checkbox" '+(opts.reduced?'checked':'')+'> Reduzir animações da interface</label></div>'+
    '<div class="studio-card"><h3>Privacidade</h3><p>Preferências e progresso são salvos no armazenamento local do navegador. O cache pode ser apagado pelo sistema. Exportar um backup evita perda de configurações.</p>'+
    '<div style="margin-top:12px">'+button('Restaurar preferências da v5','profile-reset','sm')+'</div></div></div></div>';
  }
  // --- Diagnostics -------------------------------------------------------
  window.addEventListener('robotbit:ble',event=>{
    const data=event.detail||{};
    if(data.ok){state.bleOk++;state.bleTime.push(Number(data.ms)||0);if(state.bleTime.length>120)state.bleTime.shift();}
    else state.bleFail++;
    log(data.ok?'sucesso':'erro',(data.ok?'BLE OK ':'BLE FALHOU ')+(data.code||'?')+' · '+(data.ms||0)+'ms',data);
  });
  window.addEventListener('robotbit:command',event=>{
    const data=event.detail||{};
    state.sentCodes++;
    state.lastCommandTimes.push(Date.now());
    state.lastCommandTimes=state.lastCommandTimes.filter(t=>Date.now()-t<60000);
    if(state.recording)capture(data.code,Number(data.speed)||1,'bluetooth');
    log('comando','Enviado: '+data.code+' · '+data.speed+'°',data);
  });
  window.addEventListener('robotbit:state',event=>{
    const data=event.detail||{};
    if(data.connected!==state.lastConnected ||data.armed!==state.lastArmed){
      log('estado','Bluetooth: '+(data.connected?'conectado':'desconectado')+' · '+(data.armed?'habilitado':'bloqueado'));
      state.lastConnected=data.connected;state.lastArmed=data.armed;
    }
  });
  window.addEventListener('robotbit:safety',event=>{
    const d=event.detail||{};
    log('segurança',d.type==='idle'?'Bloqueio automático por inatividade':'Controle bloqueado');
  });
  function metrics(){
    const ok=state.bleOk,avg=ok?(state.bleTime.reduce((a,b)=>a+b,0)/state.bleTime.length):0;
    return [[String(state.sentCodes),'Comandos aos motores'],[String(state.bleFail),'Erros BLE'],[Math.round(avg)+' ms','Média da escrita'],[duration((Date.now()-state.sessionStart)/1000),'Duração da sessão']];
  }
  function refreshDiagnostics(){
    const root=$('diagMetrics');if(!root)return;
    root.innerHTML=metrics().map(([v,label])=>
      '<div class="studio-stat"><strong>'+escapeHTML(v)+'</strong><span>'+escapeHTML(label)+'</span></div>').join('');
    drawLog();
    const cv=$('diagChart');
    if(cv){
      const ctx=cv.getContext('2d');if(ctx){
        const w=cv.width,h=cv.height;ctx.clearRect(0,0,w,h);
        ctx.strokeStyle='#345271';ctx.lineWidth=1;for(let i=1;i<4;i++){const y=i*h/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
        const samples=state.bleTime.slice(-40);const max=Math.max(35,...samples);
        const dx=w/Math.max(1,samples.length-1);
        ctx.strokeStyle='#75c8dc';ctx.lineWidth=2.4;ctx.beginPath();
        samples.forEach((v,i)=>{const x=i*dx,y=h-8-(v/max)*(h-20);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
        ctx.stroke();
      }
    }
  }
  function drawLog(){
    const root=$('diagLog');if(!root)return;
    root.replaceChildren();
    for(const e of state.log.slice().reverse().slice(0,110)){
      const div=document.createElement('div');
      div.className='studio-log-line '+(e.level==='erro'?'error':e.level==='sucesso'?'success':'');
      const time=document.createElement('time');time.textContent=formatTime(e.at);
      const name=document.createElement('strong');name.textContent=e.level.toUpperCase().slice(0,10);
      const detail=document.createElement('span');detail.textContent=e.message;
      div.append(time,name,detail);root.appendChild(div);
    }
  }
  function download(name,content,type){
    const blob=new Blob([content],{type:type||'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  // --- Motion Recorder ---------------------------------------------------
  function capture(code,speed,source){
    if(!state.recording||!Object.hasOwn(codeMap,code))return;
    const t=clamp(Math.round(performance.now()-state.recordStart),0,60000);
    if(state.events.length>=250||t>=60000){
      state.recording=false;log('gravação','Gravação encerrada no limite de 250 eventos / 60 s');
      updateMotionMeta();return;
    }
    state.events.push({t,code,speed:clamp(Number(speed)||1,1,3),source});
    if(state.view==='motion')renderTimeline();
  }
  function toggleRecording(){
    if(state.recording){state.recording=false;log('gravação','Parou: '+state.events.length+' eventos');}
    else{
      cancelPlayback();
      if(state.events.length>=250){state.events=[];state.selection=-1;}
      state.recording=true;
      state.recordStart=performance.now()-(state.events.length?state.events[state.events.length-1].t+100:0);
      log('gravação','REC iniciado');
    }
    updateMotionMeta();
  }
  function updateMotionMeta(){
    if($('recordStatus'))$('recordStatus').textContent=state.recording?'● GRAVANDO':'NÃO GRAVANDO';
    if($('motionCount'))$('motionCount').textContent=state.events.length+' EVENTOS';
    const b=page.querySelector('[data-action="rec-toggle"]');
    if(b)b.textContent=state.recording?'■ Encerrar REC':'● REC';
  }
  function renderTimeline(){
    const root=$('motionTimeline');if(!root)return;
    root.replaceChildren();
    state.events.forEach((ev,i)=>{
      const button=document.createElement('button');
      button.className='studio-timeline-item'+(state.selection===i?' selected':'');
      button.type='button';button.dataset.motionIndex=String(i);
      const name=channels.find(c=>c.negative===ev.code||c.positive===ev.code);
      const title=document.createElement('strong');title.textContent=ev.code;
      const time=document.createElement('small');time.textContent=(ev.t/1000).toFixed(1)+'s · '+(name?name.title:'')+' · '+ev.speed+'°';
      const src=document.createElement('em');src.textContent=ev.source==='bluetooth'?'BLE':'VIRTUAL';
      button.append(title,time,src);root.append(button);
    });
    if(!state.events.length)root.textContent='Nenhum comando gravado. Ative REC e use o robô ou os comandos virtuais.';
    updateMotionMeta();
  }
  function cancelPlayback(){
    state.playToken++;clearTimeout(state.playTimer);state.playTimer=null;
  }
  async function playMotion(){
    if(state.recording){state.recording=false;updateMotionMeta();}
    if(!state.events.length){notice('Grave ou importe uma sequência antes de reproduzir.');return;}
    const okay=await ask('Reproduzir na simulação?','Esta sequência será executada somente na garra virtual, sem transmitir comandos aos motores reais.');
    if(!okay)return;
    cancelPlayback();
    const token=state.playToken;
    state.virtual=bridge.setSteps([0,0,0,0]);
    log('simulação','Reprodução iniciada · '+state.events.length+' eventos');
    const events=state.events.slice();
    function run(i){
      if(token!==state.playToken)return;
      if(i>=events.length){state.playTimer=null;notice('Reprodução virtual concluída.');log('simulação','Reprodução concluída');return;}
      const ev=events[i],previous=i?events[i-1].t:0;
      const delay=clamp(ev.t-previous,0,2000);
      state.playTimer=setTimeout(()=>{
        if(token!==state.playToken)return;
        state.virtual=bridge.simulate(ev.code,ev.speed)||state.virtual;
        refreshVirtualLabels();
        const cell=page.querySelector('[data-motion-index="'+i+'"]');if(cell)cell.classList.add('selected');
        run(i+1);
      },delay);
    }
    run(0);
  }
  function validEvents(raw){
    if(!Array.isArray(raw)||raw.length>250)throw Error('Limite de 250 comandos excedido');
    const items=raw.map(x=>{
      if(!x||!Object.hasOwn(codeMap,x.code))throw Error('Comando inválido');
      const t=Number(x.t),speed=Number(x.speed);
      if(!Number.isFinite(t)||t<0||t>60000||!Number.isInteger(speed)||speed<1||speed>3)throw Error('Dados da sequência inválidos');
      return {t:Math.round(t),code:x.code,speed,source:'importado'};
    });
    for(let i=1;i<items.length;i++)if(items[i].t<items[i-1].t)throw Error('Tempos fora de ordem');
    return items;
  }
  async function loadJSON(file,limit=100000){
    if(!file||file.size>limit)throw Error('Arquivo inválido ou grande demais (máximo 100 KB)');
    return JSON.parse(await file.text());
  }
  // --- Missions ----------------------------------------------------------
  function startMission(i){
    const quest=quests[i];if(!quest)return;
    state.mission=i;state.missionStart=Date.now();
    state.virtual=bridge.setSteps([0,0,0,0]);
    clearInterval(state.missionInterval);
    state.missionInterval=setInterval(updateMissionUI,250);
    log('missão','Iniciada: '+quest.name);
    updateMissionUI();
  }
  function cancelMission(){
    state.mission=null;clearInterval(state.missionInterval);state.missionInterval=null;
    updateMissionUI();
  }
  function checkMission(){
    if(state.mission===null)return;
    const quest=quests[state.mission];
    const elapsed=(Date.now()-state.missionStart)/1000;
    if(elapsed>quest.time){notice('Tempo esgotado. Tente outra vez.');cancelMission();return;}
    const distance=Math.abs(state.virtual[quest.axis]-quest.target);
    if(distance<=1){
      const sec=Math.max(1,Math.round(elapsed));
      const previous=Number(state.best[state.mission])||Infinity;
      if(sec<previous)state.best[state.mission]=sec;
      persist();log('missão','Concluída: '+quest.name+' em '+sec+'s');
      cancelMission();notice('Missão concluída em '+sec+' segundos!');
      if(state.view==='missions'){const cards=$('missionCards');if(cards)cards.innerHTML=quests.map((q,i)=>
        '<div class="studio-mission-card" data-done="'+(!!state.best[i])+'"><div class="studio-row between"><div><strong>'+(i+1)+'. '+q.name+'</strong><small style="display:block;margin-top:4px">'+q.description+'</small></div><span class="studio-tag">'+(state.best[i]?'RECORDE '+state.best[i]+'s':'INÉDITA')+'</span></div>'+button('Iniciar desafio','mission-start-'+i,'sm')+'</div>').join('');}
    }
  }
  function updateMissionUI(){
    if(state.view!=='missions')return;
    const active=state.mission!==null;const quest=active?quests[state.mission]:null;
    if($('missionTitle'))$('missionTitle').textContent=quest?quest.name:'Selecione uma missão';
    if($('missionGoal'))$('missionGoal').textContent=quest?quest.description:'Objetivo e progresso aparecerão aqui.';
    const time=active?(Date.now()-state.missionStart)/1000:0;
    if($('missionTime'))$('missionTime').textContent=duration(time);
    if($('missionScore'))$('missionScore').textContent=quest?String(quest.target):'—';
    if($('missionBar'))$('missionBar').innerHTML=progress(quest?100*(1-Math.abs(quest.target-state.virtual[quest.axis])/Math.max(1,Math.abs(quest.target))):0);
    if(quest&&time>quest.time){notice('Tempo da missão esgotado.');cancelMission();}
  }
  // --- Academy -----------------------------------------------------------
  function renderLesson(){
    const root=$('lessonPanel');if(!root)return;
    const lesson=lessons[state.lesson],done=!!state.academy[state.lesson];
    root.innerHTML='<div class="studio-eyebrow">LIÇÃO '+(state.lesson+1)+' / '+lessons.length+'</div>'+
    '<h3 style="font-size:20px;margin:9px 0">'+lesson.name+'</h3>'+
    '<p style="font-size:12px;line-height:1.75">'+lesson.body+'</p>'+
    '<div class="studio-divider"></div><h3>'+lesson.question+'</h3>'+
    '<div class="studio-academy-options" style="margin-top:12px">'+lesson.answers.map((a,i)=>
      '<button type="button" class="studio-answer" data-answer="'+i+'">'+escapeHTML(a)+'</button>'
    ).join('')+'</div>'+
    '<p id="lessonFeedback" class="studio-muted" style="margin-top:12px">'+(done?'✓ Você já concluiu esta lição.':'Responda para registrar seu progresso.')+'</p>';
  }
  // --- Settings + profiles ----------------------------------------------
  function applyProfile(profile){
    if(!profile||!profile.options)return;
    const newOpts=Object.assign({},optionsDefault,profile.options);
    for(const key of Object.keys(optionsDefault))opts[key]=newOpts[key];
    opts.curve=clamp(Number(opts.curve)||1,.55,2.6);
    opts.sensitivity=clamp(Number(opts.sensitivity)||1,.4,1.8);
    opts.idleSeconds=[0,30,60,120].includes(Number(opts.idleSeconds))?Number(opts.idleSeconds):60;
    opts.hand=opts.hand==='left'?'left':'right';
    opts.theme=['blue','teal','violet'].includes(opts.theme)?opts.theme:'blue';
    opts.cautious=!!opts.cautious;opts.reduced=!!opts.reduced;
    if(profile.legacy&&typeof profile.legacy==='object'){
      try{
        const v={deadzone:clamp(Number(profile.legacy.deadzone)||24,15,45),invert:Array.isArray(profile.legacy.invert)?profile.legacy.invert.slice(0,4).map(Boolean):[false,false,false,false]};
        if(v.invert.length===4)localStorage.setItem('robotbit-control-v4-settings',JSON.stringify(v));
      }catch(e){}
    }
    persist();applyPrefs();
  }
  function profileSnapshot(){
    let legacy=null;try{legacy=JSON.parse(localStorage.getItem('robotbit-control-v4-settings')||'null')}catch(e){}
    return {options:Object.assign({},opts),legacy:legacy};
  }
  function renderProfiles(){
    const list=$('profileList');if(!list)return;
    list.replaceChildren();
    for(const entry of state.profiles){
      const row=document.createElement('div');row.className='studio-profile';
      const text=document.createElement('div');
      const strong=document.createElement('strong');strong.textContent=entry.name;
      const small=document.createElement('small');small.textContent='Perfil local · '+new Date(entry.created).toLocaleDateString('pt-BR');
      text.append(strong,document.createElement('br'),small);
      const actions=document.createElement('div');actions.className='studio-row';
      const apply=document.createElement('button');apply.className='studio-button sm';apply.type='button';apply.textContent='Usar';apply.dataset.applyProfile=entry.id;
      const del=document.createElement('button');del.className='studio-button sm danger';del.type='button';del.textContent='Excluir';del.dataset.deleteProfile=entry.id;
      actions.append(apply,del);row.append(text,actions);list.append(row);
    }
    if(!state.profiles.length)list.textContent='Ainda não há perfis salvos.';
  }
  function refreshSafety(){
    const root=$('safeMetrics');if(!root)return;
    const s=bridge.snapshot();
    root.innerHTML='<div class="studio-row between"><span class="studio-muted">Bluetooth</span><strong class="studio-number">'+(s.connected?'Conectado':'Desconectado')+'</strong></div>'+
      '<div class="studio-row between"><span class="studio-muted">Controle</span><strong class="studio-number">'+(s.armed?'Habilitado':'Bloqueado')+'</strong></div>'+
      '<div class="studio-row between"><span class="studio-muted">Velocidade</span><strong class="studio-number">'+s.speed+'°</strong></div>'+
      '<div class="studio-row between"><span class="studio-muted">Proteção automática</span><strong class="studio-number">'+(opts.idleSeconds?opts.idleSeconds+'s':'Desativada')+'</strong></div>';
  }
  function notice(message){
    log('info',message);
    const toast=$('toast');
    if(toast){toast.textContent=message;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),3300);}
  }
  // --- Delegated interactions --------------------------------------------
  page.addEventListener('click',async ev=>{
    const virt=ev.target.closest('[data-virtual]');
    if(virt){emitVirtual(virt.dataset.virtual,1);return;}
    const cell=ev.target.closest('[data-motion-index]');
    if(cell){
      state.selection=Number(cell.dataset.motionIndex);
      renderTimeline();return;
    }
    const lesson=ev.target.closest('[data-lesson]');
    if(lesson){state.lesson=Number(lesson.dataset.lesson);renderLesson();return;}
    const ans=ev.target.closest('[data-answer]');
    if(ans){
      const current=lessons[state.lesson];
      const chosen=Number(ans.dataset.answer);
      const correct=chosen===current.correct;
      ans.classList.add(correct?'correct':'incorrect');
      if(correct){
        state.academy[state.lesson]=true;persist();
        $('lessonFeedback').textContent='Correto! Progresso salvo neste navegador.';
        const button=page.querySelector('[data-lesson="'+state.lesson+'"] span:last-child');
        if(button)button.textContent='✓ Concluída';
      }else $('lessonFeedback').textContent='Ainda não. Leia a explicação e tente outra alternativa.';
      return;
    }
    const ap=ev.target.closest('[data-apply-profile]');
    if(ap){
      const entry=state.profiles.find(x=>x.id===ap.dataset.applyProfile);
      if(!entry)return;
      const yes=await ask('Aplicar perfil?', 'O site será recarregado para aplicar também as inversões dos eixos. A operação da garra será bloqueada antes disso.');
      if(yes){await bridge.stop();applyProfile(entry);location.reload();}
      return;
    }
    const dp=ev.target.closest('[data-delete-profile]');
    if(dp){
      const entry=state.profiles.find(x=>x.id===dp.dataset.deleteProfile);
      if(!entry)return;
      const yes=await ask('Excluir perfil?', 'Excluir "'+entry.name+'"? Esta ação não altera os ajustes atuais.');
      if(yes){state.profiles=state.profiles.filter(x=>x.id!==entry.id);persist();renderProfiles();}
      return;
    }
    const action=ev.target.closest('[data-action]')?.dataset.action;
    if(!action)return;
    if(action==='reset-response'){opts.sensitivity=1;opts.curve=1;persist();updateControlPro();notice('Resposta padrão restaurada.');return;}
    if(action.startsWith('cam-')){window.robotbit3D?.cameraPreset?.(action.slice(4));return;}
    if(action.startsWith('paint-')){
      const style=action.slice(6);window.robotbit3D?.setStyle?.(style);
      $('armStage').dataset.style=style;notice('Acabamento: '+style);return;
    }
    if(action==='reset-virtual'){
      state.virtual=bridge.setSteps([0,0,0,0]);
      refreshVirtualLabels();return;
    }
    if(action==='rec-toggle'){toggleRecording();return;}
    if(action==='play-motion'){await playMotion();return;}
    if(action==='stop-motion'){cancelPlayback();notice('Reprodução interrompida.');return;}
    if(action==='delete-step'){
      if(state.selection>=0&&state.selection<state.events.length){
        state.events.splice(state.selection,1);state.selection=-1;renderTimeline();
      }return;
    }
    if(action==='clear-motion'){
      if(await ask('Apagar a sequência?','Todos os eventos desta gravação serão apagados.')){
        cancelPlayback();state.recording=false;state.events=[];state.selection=-1;renderTimeline();
      }return;
    }
    if(action==='export-motion'){
      download('robotbit-movimentos.json',JSON.stringify({format:'robotbit-motion-v1',name:state.recordingName,events:state.events},null,2));return;
    }
    if(action==='import-motion'){$('motionFile')?.click();return;}
    if(action.startsWith('mission-start-')){startMission(Number(action.slice(14)));return;}
    if(action==='mission-restart'){if(state.mission!==null)startMission(state.mission);return;}
    if(action==='mission-cancel'){cancelMission();return;}
    if(action==='export-diag'){
      const rows=[['timestamp','evento','mensagem','duracao_ms']].concat(state.log.map(x=>[
        new Date(x.at).toISOString(),x.level,x.message,x.extra?.ms??''
      ]));
      const csv=rows.map(row=>row.map(cell=>'"'+safeText(cell).replace(/"/g,'""')+'"').join(',')).join('\r\n');
      download('robotbit-diagnostico.csv','\uFEFF'+csv,'text/csv;charset=utf-8');return;
    }
    if(action==='clear-diag'){state.log=[];state.bleTime=[];state.bleOk=0;state.bleFail=0;state.sentCodes=0;refreshDiagnostics();return;}
    if(action==='safety-stop'){await bridge.stop();refreshSafety();return;}
    if(action==='safety-test'){notice('O botão BLOQUEAR é por software. Use uma chave física para cortar energia em emergências.');return;}
    if(action==='profile-save'){
      const name=($('profileName')?.value||'').trim().slice(0,25);
      if(name.length<2){notice('Informe um nome com pelo menos 2 caracteres.');return;}
      if(state.profiles.length>=8){notice('Limite de oito perfis atingido.');return;}
      state.profiles.push({id:'p'+Date.now(),name,created:Date.now(),...profileSnapshot()});
      persist();renderProfiles();notice('Perfil salvo neste navegador.');return;
    }
    if(action==='profile-export'){
      const snapshot={format:'robotbit-workspace-v5',exported:new Date().toISOString(),...profileSnapshot(),
        profiles:state.profiles,best:state.best,academy:state.academy};
      download('robotbit-backup.json',JSON.stringify(snapshot,null,2));return;
    }
    if(action==='profile-import'){$('profileFile')?.click();return;}
    if(action==='profile-reset'){
      const yes=await ask('Restaurar preferências?', 'Isso restaura os ajustes da v5, preservando perfis e histórico de missões.');
      if(yes){Object.assign(opts,optionsDefault);persist();applyPrefs();navigate('profiles');}
    }
  });
  page.addEventListener('change',async ev=>{
    const id=ev.target.id;
    if(id==='studioObjects'){window.robotbit3D?.setObjects?.(ev.target.checked);return;}
    if(id==='safeCautious'){
      opts.cautious=ev.target.checked;persist();refreshSafety();
      if(opts.cautious&&bridge.snapshot().speed>1)bridge.speed(1);return;
    }
    if(id==='safeIdle'){
      opts.idleSeconds=Number(ev.target.value);persist();refreshSafety();return;
    }
    if(id==='profileTheme'){opts.theme=ev.target.value;persist();applyPrefs();return;}
    if(id==='profileHand'){opts.hand=ev.target.checked?'left':'right';persist();applyPrefs();return;}
    if(id==='profileReduce'){opts.reduced=ev.target.checked;persist();applyPrefs();return;}
    if(id==='motionFile'&&ev.target.files?.[0]){
      try{
        const data=await loadJSON(ev.target.files[0]);
        if(data?.format!=='robotbit-motion-v1')throw Error('Formato de gravação não reconhecido');
        const events=validEvents(data.events);
        cancelPlayback();state.recording=false;state.events=events;state.selection=-1;
        state.recordingName=safeText(data.name||'Sequência importada').slice(0,32);
        $('motionName').value=state.recordingName;
        renderTimeline();notice('Sequência importada com '+events.length+' eventos.');
      }catch(error){notice('Falha ao importar: '+error.message);}
      ev.target.value='';return;
    }
    if(id==='profileFile'&&ev.target.files?.[0]){
      try{
        const data=await loadJSON(ev.target.files[0]);
        if(data?.format!=='robotbit-workspace-v5'||!data.options||typeof data.options!=='object')
          throw Error('Backup incompatível');
        const yes=await ask('Importar configurações?', 'O backup substituirá os ajustes e perfis salvos. O site será recarregado.');
        if(yes){
          state.profiles=Array.isArray(data.profiles)?data.profiles.filter(p=>p&&typeof p.name==='string'&&typeof p.id==='string').slice(0,8).map(p=>({
            id:p.id.slice(0,40),name:p.name.slice(0,25),created:Number(p.created)||Date.now(),
            options:typeof p.options==='object'?p.options:{},legacy:p.legacy||null
          })):[];
          state.best=data.best&&typeof data.best==='object'?data.best:{};
          state.academy=data.academy&&typeof data.academy==='object'?data.academy:{};
          await bridge.stop();
          applyProfile({options:data.options,legacy:data.legacy});
          location.reload();
        }
      }catch(error){notice('Falha ao importar: '+error.message);}
      ev.target.value='';return;
    }
  });
  page.addEventListener('input',ev=>{
    if(ev.target.matches('[data-axis]')){
      const i=Number(ev.target.dataset.axis);
      const next=state.virtual.slice();next[i]=clamp(Number(ev.target.value)||0,-32,32);
      state.virtual=bridge.setSteps(next);refreshVirtualLabels();
      return;
    }
    if(ev.target.id==='motionName'){state.recordingName=ev.target.value.slice(0,32);return;}
  });
  page.addEventListener('pointerdown',ev=>{
    if(ev.target.matches('[data-virtual]'))ev.preventDefault();
  });
  controlPro.addEventListener('input',event=>{
    const id=event.target.id;
    if(id==='ctrlSens'){opts.sensitivity=clamp(Number(event.target.value),.4,1.8);persist();updateControlPro();}
    if(id==='ctrlCurve'){opts.curve=clamp(Number(event.target.value),.55,2.6);persist();updateControlPro();}
  });
  controlPro.addEventListener('change',event=>{
    if(event.target.id==='ctrlHand'){
      opts.hand=event.target.checked?'left':'right';persist();applyPrefs();
    }
  });
  controlPro.addEventListener('click',event=>{
    if(event.target.closest('[data-action="reset-response"]')){
      opts.curve=1;opts.sensitivity=1;persist();updateControlPro();notice('Resposta padrão restaurada.');
    }
  });
  function updateControlPro(){
    if($('ctrlSens'))$('ctrlSens').value=String(opts.sensitivity);
    if($('ctrlCurve'))$('ctrlCurve').value=String(opts.curve);
    if($('ctrlSensVal'))$('ctrlSensVal').textContent=opts.sensitivity.toFixed(1)+'×';
    if($('ctrlCurveVal'))$('ctrlCurveVal').textContent=opts.curve.toFixed(2);
  }
  // Strong controls remain usable in landscape and require no app navigation.
  window.addEventListener('resize',()=>{
    if(document.body.classList.contains('game-mode')&&state.view!=='control')navigate('control');
  },{passive:true});
  window.addEventListener('orientationchange',()=>{
    if(state.view!=='control'&&window.innerWidth>window.innerHeight)navigate('control');
  },{passive:true});
  setInterval(()=>{
    if(state.view==='diagnostics')refreshDiagnostics();
    if(state.view==='safety')refreshSafety();
    const snap=bridge.snapshot();
    if(opts.cautious&&snap.armed&&snap.speed>1)bridge.speed(1);
  },1000);
  log('sistema','Robotics Studio v5 iniciado');
})();