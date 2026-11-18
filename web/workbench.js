"use strict";
const $ = id => document.getElementById(id);
const names = {face:"Facecam",game:"Gameplay",caption:"Captions"};
const colors = {face:"#c8a3ff",game:"#91c9bc",caption:"#eabf8c"};
const state = {jobs:[],clip:null,job:null,layer:"face",cropping:false,dirty:false,loading:0,words:[],guides:true,rendering:false};
const video = $("source"), canvas = $("stage"), pen = canvas.getContext("2d");
const escapeText = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const round = n=>Math.round(n*1000)/1000;
function clockTime(t, precise=false){
  const ticks=Math.round(Math.max(0,t||0)*100);
  return String(Math.floor(ticks/6000)).padStart(2,"0")+":"+String(Math.floor(ticks/100)%60).padStart(2,"0")+(precise?"."+String(ticks%100).padStart(2,"0"):"");
}
async function request(url,options){
  const res=await fetch(url,options);
  if(res.status===401){location.assign("/login");throw Error("Sign in to continue.");}
  const type=res.headers.get("content-type")||"";
  if(!res.ok){const data=type.includes("json")?await res.json().catch(()=>({})):{};throw Error(data.detail || (res.status===404?"The Endrox processing service is not connected to this deployment yet.":"Endrox could not complete that request."));}
  if(!type.includes("json"))throw Error("The Endrox processing service is not connected to this deployment yet.");
  return res.json();
}
const post=(url,data)=>request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
let toastTimer;
function notify(message){$("notice").textContent=message;$("notice").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("notice").hidden=true,6000);}
function dirty(){state.dirty=true;$("saveState").textContent="Unsaved changes";$("save").disabled=state.rendering;}
window.addEventListener("beforeunload",e=>{if(state.dirty){e.preventDefault();e.returnValue="";}});
function entries(){return state.jobs.flatMap(job=>job.clips.filter(c=>c.status==="done").map(clip=>({job,clip})));}
function mediaPage(){return /^\/app\/media\/?$/.test(location.pathname);}
function setPage(){
  $("desk").hidden=mediaPage();$("mediaPool").hidden=!mediaPage();
  document.querySelector("studio-header").selectPath(location.pathname);
  if(mediaPage())video.pause();
}
function mediaPool(){
  const query=$("search").value.toLowerCase();
  $("mediaContent").innerHTML=state.jobs.map(j=>{
    const title=j.title||j.source?.name||"Untitled recording";
    const clips=j.clips.filter(c=>!query||[title,c.title,c.hook].some(v=>(v||"").toLowerCase().includes(query)));
    if(query&&!clips.length&&!title.toLowerCase().includes(query))return "";
    return '<section class="media-group"><h2>'+escapeText(title)+'</h2><p>'+escapeText(j.error||j.stage||j.status)+' · '+clockTime(j.duration)+' · '+clips.length+' clips</p><div class="reels">'+clips.map(c=>{
      const button=c.status==="done";
      return '<button class="reel" data-job="'+escapeText(j.id)+'" data-clip="'+escapeText(c.id)+'" '+(button?"":"disabled")+'>'+(button?'<img loading="lazy" alt="" src="/media/'+encodeURIComponent(j.id)+'/'+encodeURIComponent(c.cover)+'?v='+c.version+'">':'')+'<span>'+escapeText(c.title||c.id)+'</span><small>'+clockTime(c.end-c.start)+' · '+(button?'Open editor ↗':escapeText(c.status))+'</small></button>';
    }).join("")+'</div></section>';
  }).join("")||(query?'<p>No clips match your search.</p>':'<section class="library-empty"><h2>Make your first clip</h2><p>Choose a video or paste a stream link. Your highlights will appear here for editing.</p><button class="violet" data-import>Import footage</button></section>');
}
function clipURL(job,clip){return "/api/jobs/"+encodeURIComponent(job.id)+"/clips/"+encodeURIComponent(clip.id);}
function chooseLayer(layer,cropping=false){
  state.layer=layer;state.cropping=cropping&&layer!=="caption";
  $("layerList").innerHTML=Object.keys(names).map((k,i)=>'<button class="layer '+k+(k===layer?' active':'')+'" data-layer="'+k+'" aria-pressed="'+(k===layer)+'"><i>'+["V2","V1","CC"][i]+'</i><b>'+names[k]+'</b></button>').join("");
  $("viewerTitle").textContent=state.cropping?"Source crop · "+names[layer]:"Clip preview";
  $("viewFormat").textContent=state.cropping?"Original frame":"9:16 · 1080p";
  $("mat").classList.toggle("crop",state.cropping);
  canvas.style.aspectRatio=state.cropping&&video.videoWidth?video.videoWidth+"/"+video.videoHeight:"9/16";
  $("selectionName").textContent=names[layer];$("cropButton").disabled=layer==="caption"||!state.settings;
  if(state.settings)properties();paint();
}
function sanitizeWords(words,clip){
  return words.filter(w=>w.w&&w.e>clip.start&&w.s<clip.end).sort((a,b)=>a.s-b.s).map((w,i,all)=>({
    original:w,w:w.w,confidence:w.confidence,s:round(Math.max(clip.start,w.s)),e:round(Math.min(clip.end,w.e,all[i+1]?.s??Infinity))
  })).filter(w=>w.e>w.s);
}
function editableClip(clip){
  return {...clip,start:Math.round(clip.start*100)/100,end:Math.round(clip.end*100)/100};
}
async function openClip(job,clip){
  const serial=++state.loading;
  video.pause();video.removeAttribute("src");video.load();
  clip=editableClip(clip);
  Object.assign(state,{job,clip:{...clip},saved:clip,base:clipURL(job,clip),settings:null,dirty:false,words:[],rendering:false,trimming:false,pendingSeek:null,style:clip.style||"violet",title:clip.title||clip.id});
  $("trimPanel").hidden=true;$("trimPanel").inert=false;$("trimStatus").textContent="";
  $("save").disabled=true;$("saveState").textContent="Preparing layers…";
  $("empty").hidden=true;canvas.hidden=false;$("clipTitle").textContent=state.title;$("sourceName").textContent=job.title||job.source.name;
  $("download").hidden=false;$("download").href="/media/"+job.id+"/"+encodeURIComponent(clip.file)+"?download=1&v="+clip.version;
  $("clipPicker").value=job.id+"/"+clip.id;$("properties").textContent="Loading source and captions…";
  try {
    const data=await request(state.base+"/composition");
    if(serial!==state.loading)return;
    Object.assign(state,{settings:data.composition,detected:data.detected,offset:data.offset,proxy:false,
      first:data.source_start,last:data.source_end,loadedStart:clip.start,loadedEnd:clip.end,bank:data.captions});
    state.words=sanitizeWords(state.bank,clip);
    video.src=state.base+"/source";video.load();
    $("trimPanel").hidden=false;updateTimingControls();
    $("saveState").textContent=clip.layout==="webcam"?"Saved · v"+clip.version:"Webcam layout preview";
    $("save").disabled=false;chooseLayer("face");drawTracks();
  }catch(err){if(serial===state.loading){$("saveState").textContent=err.message;notify(err.message);}}
}
video.addEventListener("loadedmetadata",()=>{
  if(!state.clip)return;
  video.currentTime=Math.max(0,(state.pendingSeek??state.clip.start)-state.offset);
  state.pendingSeek=null;
  $("sourceDimensions").textContent=video.videoWidth+" × "+video.videoHeight;
  canvas.style.aspectRatio=state.cropping?video.videoWidth+"/"+video.videoHeight:"9/16";
});
video.addEventListener("error",()=>{
  if(!video.getAttribute("src")||!state.clip)return;
  if(!state.proxy)loadProxy(state.pendingSeek??state.clip.start);
  else notify("Could not decode this source. The saved export is available to download.");
});
function loadProxy(playhead){
  const {clip,first,last}=state;
  const start=Math.max(first,Math.floor((clip.start-10)/10)*10);
  const end=Math.min(last,Math.ceil((clip.end+10)/10)*10);
  Object.assign(state,{proxy:true,offset:start,proxyEnd:end,pendingSeek:playhead});
  video.src=state.base+"/proxy?"+new URLSearchParams({start,end});video.load();
}
function parseSourceTime(value){
  const text=value.trim();
  if(/^\d+(?:\.\d{1,2})?$/.test(text))return Number(text);
  const parts=/^(\d+):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(text);
  return parts?Number(parts[1])*60+Number(parts[2])+Number("0."+(parts[3]||"0")):NaN;
}
function updateTimingControls(){
  const {clip,saved,first,last}=state;
  $("cutStart").value=clockTime(clip.start,true);
  $("cutEnd").value=clockTime(clip.end,true);
  $("scrub").max=round(clip.end-clip.start);
  $("duration").textContent=clockTime(clip.end-clip.start,true);
  $("timelineInfo").textContent=clockTime(first,true)+" – "+clockTime(last,true)+" available in source";
  $("resetTrim").disabled=clip.start===saved.start&&clip.end===saved.end;
  for(const button of $("trimPanel").querySelectorAll("[data-edge]")){
    const room=button.dataset.edge==="start"?clip.start-first:last-clip.end;
    button.disabled=room<.005||round(clip.end-clip.start)>=180;
  }
}
function validCaptionTimes(words,clip){
  return words.every((w,i)=>Number.isFinite(w.s+w.e)&&w.s>=clip.start-.001&&w.e<=clip.end+.001&&
    w.s<w.e&&(!i||w.s>=words[i-1].e-.001));
}
async function adjustTiming(start,end,edge,amount=0){
  if(!state.settings||state.trimming||state.rendering)return;
  const {clip,first,last}=state;
  const length=round(end-start);
  if(!Number.isFinite(length)||start<first||end>last||length<3||length>180){
    $("trimStatus").textContent="Use a source time inside the available footage and keep the clip between 3 and 180 seconds.";
    updateTimingControls();return;
  }
  if(start===clip.start&&end===clip.end)return;
  if(!validCaptionTimes(state.words.filter(w=>w.w.trim()),clip)){
    $("trimStatus").textContent="Fix the overlapping or out-of-range caption times before moving the cut.";
    updateTimingControls();return;
  }
  const serial=state.loading,oldEnd=clip.end,oldStart=clip.start;
  const spans=[];
  if(start<state.loadedStart)spans.push([Math.max(first,round(start-10)),state.loadedStart]);
  if(end>state.loadedEnd)spans.push([state.loadedEnd,Math.min(last,round(end+10))]);
  video.pause();state.trimming=true;$("trimPanel").inert=true;$("save").disabled=true;
  $("trimStatus").textContent=spans.length?"Loading captions for the added footage…":"";
  try{
    const batches=await Promise.all(spans.map(([a,b])=>request(state.base+"/context-words?"+new URLSearchParams({start:a,end:b}))));
    if(serial!==state.loading)return;
    for(let i=0;i<spans.length;i++){
      const [a,b]=spans[i];
      for(const word of batches[i]){
        if(a<state.saved.start)word.e=Math.min(word.e,state.saved.start);
        if(word.e>word.s)state.bank.push(word);
      }
      state.loadedStart=Math.min(state.loadedStart,a);state.loadedEnd=Math.max(state.loadedEnd,b);
    }
    Object.assign(clip,{start,end});
    state.words=sanitizeWords(state.bank,clip);
    const target=edge==="end"?Math.max(start,Math.min(oldEnd,end)-1.5):start;
    if(state.proxy&&(start<state.offset||end>state.proxyEnd))loadProxy(target);
    else if(video.readyState)seek(target);
    else state.pendingSeek=target;
    properties();drawTracks();paint();dirty();
    const added=edge==="end"?end-oldEnd:oldStart-start;
    const limit=length===180?"180s clip limit reached.":"Source boundary reached.";
    $("trimStatus").textContent=amount&&round(added)<amount?"Added "+round(added)+"s. "+limit:
      "Selected "+clockTime(start,true)+" – "+clockTime(end,true)+" · "+length.toFixed(2)+"s";
  }catch(err){if(serial===state.loading)$("trimStatus").textContent=err.message;}
  finally{
    if(serial===state.loading){
      state.trimming=false;$("trimPanel").inert=false;$("save").disabled=state.rendering;updateTimingControls();
    }
  }
}
for(const [id,edge] of [["cutStart","start"],["cutEnd","end"]]){
  const field=$(id);
  field.addEventListener("change",()=>{
    const time=parseSourceTime(field.value);
    adjustTiming(edge==="start"?time:state.clip.start,edge==="end"?time:state.clip.end,edge);
  });
  field.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();field.blur();}});
}
$("trimPanel").addEventListener("click",e=>{
  if(!state.clip)return;
  if(e.target.id==="resetTrim"){adjustTiming(state.saved.start,state.saved.end,"start");return;}
  const button=e.target.closest("[data-edge]");
  if(!button)return;
  const {start,end}=state.clip,amount=Number(button.dataset.seconds);
  if(button.dataset.edge==="start")adjustTiming(round(Math.max(state.first,end-180,start-amount)),end,"start",amount);
  else adjustTiming(start,round(Math.min(state.last,start+180,end+amount)),"end",amount);
});
function absoluteTime(){return clamp(video.currentTime+(state.offset||0),state.clip?.start||0,state.clip?.end||0);}
function seek(absolute){if(!state.clip||!video.readyState)return;video.currentTime=Math.max(0,clamp(absolute,state.clip.start,state.clip.end)-state.offset);paint();}
function togglePlay(){if(!state.clip)return;if(!video.paused)return video.pause();if(absoluteTime()>=state.clip.end-.07)seek(state.clip.start);video.play().catch(e=>notify(e.message));}
video.addEventListener("play",()=>{ $("play").textContent="Ⅱ";animate(); });
video.addEventListener("pause",()=>{$("play").textContent="▶";paint();});
for(const event of ["loadeddata","seeked","timeupdate"])video.addEventListener(event,paint);
function animate(){if(video.paused)return;if(absoluteTime()>=state.clip.end-.01){video.pause();return;}paint();requestAnimationFrame(animate);}
function frame(context,crop,box,fill){
  if(video.readyState<2||!video.videoWidth)return;
  let [sx,sy,sw,sh]=crop.map((n,i)=>n*(i%2?video.videoHeight:video.videoWidth));
  let [x,y,w,h]=box.map((n,i)=>n*(i%2?context.canvas.height:context.canvas.width));
  const ratio=sw/sh,target=w/h;
  if(fill){if(ratio>target){const fit=sh*target;sx+=(sw-fit)/2;sw=fit;}else{const fit=sw/target;sy+=(sh-fit)/2;sh=fit;}}
  else if(ratio>target){const fit=w/ratio;y+=(h-fit)/2;h=fit;}else{const fit=h*ratio;x+=(w-fit)/2;w=fit;}
  context.drawImage(video,sx,sy,sw,sh,x,y,w,h);
}
function guide(context,rect,color,handles){
  const W=context.canvas.width,H=context.canvas.height;
  const [x,y,w,h]=rect.map((n,i)=>n*(i%2?H:W));
  context.strokeStyle=color;context.lineWidth=Math.max(1,W/350);context.strokeRect(x,y,w,h);
  if(handles){context.fillStyle=color;for(const [cx,cy] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])context.fillRect(cx-3,cy-3,6,6);}
}
function groups(){
  const per={violet:3,bounce:3,hype:2,clean:4}[state.style]||3;
  const result=[];
  for(const w of state.words){
    let last=result.at(-1);
    if(!last||last.length>=per||last.reduce((s,v)=>s+v.w.length,0)+w.w.length>16||w.s-last.at(-1).e>.45||/[.!?।؟]$/.test(last.at(-1).w)){
      last=[];result.push(last);
    }
    last.push(w);
  }
  return result;
}
function renderText(t){
  const s=state.settings, rect=s.caption;
  const bits=groups(),now=t-s.shift;
  const g=bits.find((g,i)=>g[0].s<=now && now<Math.min(g.at(-1).e+.25,bits[i+1]?.[0].s??state.clip.end));
  if(!g)return;
  const text=g.map(w=>["hype","bounce"].includes(state.style)?w.w.toUpperCase():w.w);
  const maxWidth=rect[2]*canvas.width*.94;
  let size=Math.min(({violet:109,bounce:132,hype:152,clean:100}[state.style]||109)*s.size/2*.77,rect[3]*canvas.height*.75);
  pen.font="800 "+size+"px EndroxCaption, sans-serif";
  const initial=pen.measureText(text.join(" ")).width;
  size*=Math.min(1,maxWidth/Math.max(1,initial));pen.font="800 "+size+"px EndroxCaption, sans-serif";
  let x=(rect[0]+rect[2]/2)*canvas.width-pen.measureText(text.join(" ")).width/2;
  const y=(rect[1]+rect[3]/2)*canvas.height;pen.textBaseline="middle";pen.lineJoin="round";pen.lineWidth=size*.10;pen.strokeStyle="#130f19";
  text.forEach((str,i)=>{pen.strokeText(str,x,y);pen.fillStyle=now>=g[i].s && now<(g[i+1]?.s??Infinity)?({violet:"#cfaeff",bounce:"#fff000",hype:"#ff3c3c",clean:"#ffd76b"}[state.style]):"#fff";pen.fillText(str,x,y);x+=pen.measureText(str+" ").width;});
}
function paint(){
  if(!state.settings)return;
  const crop=state.cropping,sourceRatio=(video.videoWidth||16)/(video.videoHeight||9);
  const W=crop?840:540,H=crop?Math.round(840/sourceRatio):960;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  pen.fillStyle="#100d16";pen.fillRect(0,0,W,H);
  const s=state.settings,t=absoluteTime(),monitor=$("sourceMonitor").getContext("2d");
  frame(monitor,[0,0,1,1],[0,0,1,1],false);
  if(state.layer!=="caption"&&video.readyState>=2)guide(monitor,s[state.layer+"_crop"],colors[state.layer],false);
  if(crop){frame(pen,[0,0,1,1],[0,0,1,1],false);guide(pen,s[state.layer+"_crop"],colors[state.layer],true);}
  else{
    frame(pen,s.game_crop,s.game,false);frame(pen,s.face_crop,s.face,true);renderText(t);
    if(state.guides)guide(pen,s[state.layer],colors[state.layer],true);
  }
  const elapsed=t-state.clip.start;
  $("time").textContent=clockTime(elapsed,true);$("scrub").value=elapsed;
  $("tracks").style.setProperty("--head",(100*elapsed/(state.clip.end-state.clip.start))+"%");
  for(const row of document.querySelectorAll(".cue[data-i]")){const w=state.words[Number(row.dataset.i)];row.classList.toggle("now",!!w&&w.s<=t-s.shift&&t-s.shift<w.e);}
}
function drawTracks(){
  if(!state.clip)return;
  const length=state.clip.end-state.clip.start;
  $("tracks").innerHTML=Object.keys(names).map(k=>'<div class="track '+k+'"><button data-layer="'+k+'">'+names[k]+'</button><div class="lane" data-lane="'+k+'" title="Seek in sequence">'+(k==="caption"?state.words.map(w=>'<span class="cueBar" style="left:'+100*(w.s-state.clip.start)/length+'%;width:'+100*(w.e-w.s)/length+'%"></span>').join(""):'<span class="stripe"></span>')+'</div></div>').join("");
}
function rectKey(){return state.layer+(state.cropping?"_crop":"");}
function updateNumbers(){const rect=state.settings[rectKey()];document.querySelectorAll("[data-axis]").forEach(e=>{e.value=round(rect[Number(e.dataset.axis)]*100);});}
function captionRows(){
  return '<div class="cue cue-head"><span>Word</span><span>In (s)</span><span>Out (s)</span></div>'+state.words.map((w,i)=>'<div class="cue '+(w.confidence<.65?'uncertain':'')+'" data-i="'+i+'"><input data-cue="w" maxlength="100" aria-label="Caption word '+(i+1)+'" value="'+escapeText(w.w)+'"><input data-cue="s" aria-label="Word '+(i+1)+' start" type="number" step=".01" value="'+round(w.s-state.clip.start)+'"><input data-cue="e" aria-label="Word '+(i+1)+' end" type="number" step=".01" value="'+round(w.e-state.clip.start)+'"><button data-delete="'+i+'" title="Remove word" aria-label="Remove word '+(i+1)+'">×</button></div>').join("");
}
function properties(){
  const k=state.layer,crop=state.cropping,s=state.settings;
  const rect=s[rectKey()];
  const transform='<fieldset><legend>'+ (crop?'Source crop (%)':'Output placement (%)')+'</legend><div class="pair">'+["Left","Top","Width","Height"].map((l,i)=>'<label>'+l+'<input type="number" min="'+(i<2?0:2.5)+'" max="100" step=".1" data-axis="'+i+'" value="'+round(rect[i]*100)+'"></label>').join("")+'</div></fieldset>';
  const controls=k==="caption"?'<fieldset><legend>Typography &amp; timing</legend><label>Style<select id="style">'+["violet","bounce","clean","hype"].map(v=>'<option '+(v===state.style?"selected":"")+' value="'+v+'">'+v[0].toUpperCase()+v.slice(1)+'</option>').join("")+'</select></label><div class="pair"><label>Size (%)<input id="fontScale" type="number" min="45" max="180" value="'+Math.round(s.size*100)+'"></label><label>Offset (s)<input id="shift" type="number" min="-2" max="2" step=".05" value="'+s.shift+'"></label></div></fieldset><fieldset><legend>Subtitles</legend><label>Import timed subtitles (.srt)<input type="file" id="subtitleFile" accept=".srt"></label><small>Phrase timing is shared across its words on import.</small><button id="exportSrt">Export SRT</button></fieldset><fieldset><legend>Timed words</legend>'+ (state.words.some(w=>w.confidence<.65)?'<button id="nextUncertain">Review low-confidence word</button>':'') +'<p class="hint">Times are relative to the start of this clip.</p><div id="cueRows">'+captionRows()+'</div><button id="addWord">＋ Add word at playhead</button></fieldset>':
    '<p class="hint">'+(k==="face"?(state.clip.composition?"Crop saved with this clip.":state.detected?"Webcam located across multiple frames.":"Check the suggested webcam crop against your source."):"Choose the part of the recording that contains the action.")+'</p><button id="mode">'+(crop?"Back to composition":"Adjust source crop")+'</button>'+ (k==='game'?'<button id="excludeCam">Exclude webcam from gameplay</button>':'')+'<p class="hint">'+(crop?"Drag a box on the original recording.":"Drag the selected layer in the monitor. Drag a corner to resize.")+'</p>';
  $("properties").innerHTML='<h3>'+names[k]+'</h3>'+transform+controls+'<fieldset><legend>Clip details</legend><label>Title<input id="editTitle" maxlength="100" value="'+escapeText(state.title)+'"></label></fieldset>';
}
function updateRect(i,n){
  const rect=state.settings[rectKey()];
  rect[i]=round(i<2?clamp(n,0,1-rect[i+2]):clamp(n,.025,1-rect[i-2]));
}
$("properties").addEventListener("input",e=>{
  const el=e.target;
  if(el.dataset.cue){
    const word=state.words[+el.closest(".cue").dataset.i],key=el.dataset.cue;
    if(key==="w"){delete word.confidence;delete word.original.confidence;el.closest('.cue').classList.remove('uncertain');}
    word[key]=key==="w"?el.value:round(state.clip.start+Number(el.value));word.original[key]=word[key];drawTracks();
  }else if(el.hasAttribute("data-axis")){if(el.value==="")return;updateRect(Number(el.dataset.axis),Number(el.value)/100);}
  else if(el.id==="style")state.style=el.value;
  else if(el.id==="editTitle"){state.title=el.value;$("clipTitle").textContent=state.title;}
  else if(el.id==="fontScale")state.settings.size=clamp(Number(el.value)/100,.45,1.8);
  else if(el.id==="shift")state.settings.shift=clamp(Number(el.value),-2,2);
  else return;
  dirty();paint();
});
$("properties").addEventListener("change",e=>{if(e.target.hasAttribute("data-axis"))updateNumbers();});
$("properties").addEventListener("focusin",e=>{
  const row=e.target.closest(".cue[data-i]");if(row&&state.words[row.dataset.i]){video.pause();seek(state.words[row.dataset.i].s+.005);}
});
function addWord(){
  let t=Math.min(absoluteTime(),state.clip.end-.05);
  const list=state.words,inside=list.find(w=>w.s<=t&&t<w.e);
  let end;
  if(inside){if(inside.e-inside.s<.06){notify("Move the playhead to a longer word or a gap.");return;}t=clamp(t,inside.s+.025,inside.e-.025);end=inside.e;inside.e=round(t);inside.original.e=inside.e;}
  else end=Math.min(state.clip.end,t+.35,list.find(w=>w.s>t)?.s??Infinity);
  if(end-t<.01)return;
  const original={s:round(t),e:round(end),w:"Word"};state.bank.push(original);
  const item={...original,original};list.push(item);list.sort((a,b)=>a.s-b.s);
  properties();drawTracks();dirty();const field=document.querySelector('.cue[data-i="'+list.indexOf(item)+'"] input');field?.focus();field?.select();paint();
}
$("properties").addEventListener("click",e=>{
  if(e.target.id==="nextUncertain"){
    const i=state.words.findIndex(w=>w.confidence<.65&&w.s>absoluteTime()+.02);
    const index=i<0?state.words.findIndex(w=>w.confidence<.65):i;
    document.querySelector('.cue[data-i="'+index+'"] [data-cue=w]')?.focus();
  }
  if(e.target.id==="excludeCam"){
    const [x,y,w,h]=state.settings.face_crop;
    const choices=[[x+w,0,1-x-w,1],[0,0,x,1],[0,y+h,1,1-y-h],[0,0,1,y]].filter(r=>r[2]>=.025&&r[3]>=.025);
    if(!choices.length){notify("Reduce the webcam crop first.");return;}
    const centre=choices.filter(r=>r[0]<=.55&&r[0]+r[2]>=.55&&r[1]<=.52&&r[1]+r[3]>=.52);
    state.settings.game_crop=(centre.length?centre:choices).sort((a,b)=>b[2]*b[3]-a[2]*a[3])[0];
    dirty();chooseLayer("game",true);
  }
  if(e.target.id==="mode")chooseLayer(state.layer,!state.cropping);
  if(e.target.id==="addWord")addWord();
  if(e.target.dataset.delete!==undefined){
    const [removed]=state.words.splice(+e.target.dataset.delete,1);
    state.bank=state.bank.filter(w=>w!==removed.original);properties();drawTracks();dirty();paint();
  }
});
function point(e){const r=canvas.getBoundingClientRect();return [clamp((e.clientX-r.left)/r.width,0,1),clamp((e.clientY-r.top)/r.height,0,1)];}
let drag=null;
canvas.addEventListener("pointerdown",e=>{
  if(!state.settings||state.rendering)return;
  const [x,y]=point(e),s=state.settings;
  let rect=s[rectKey()],corner=null;
  if(!state.cropping){
    for(const dx of [0,1])for(const dy of [0,1])if(Math.abs(x-rect[0]-dx*rect[2])<.04&&Math.abs(y-rect[1]-dy*rect[3])<.028)corner=[dx,dy];
    if(!corner){
      const hit=["caption","face","game"].find(k=>{const r=s[k];return x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];});
      if(!hit)return;chooseLayer(hit);rect=s[hit];
    }
  }
  drag={x,y,rect:[...rect],corner};canvas.setPointerCapture(e.pointerId);e.preventDefault();video.pause();
});
canvas.addEventListener("pointermove",e=>{
  if(!drag)return;
  const [x,y]=point(e),r=drag.rect,dx=x-drag.x,dy=y-drag.y;
  if(Math.abs(dx)+Math.abs(dy)<.004)return;
  let next;
  if(state.cropping){const a=clamp(Math.min(drag.x,x),0,.975),b=clamp(Math.min(drag.y,y),0,.975);next=[a,b,clamp(Math.abs(dx),.025,1-a),clamp(Math.abs(dy),.025,1-b)];}
  else if(drag.corner){const [cx,cy]=drag.corner;const left=cx?r[0]:clamp(x,0,r[0]+r[2]-.025),top=cy?r[1]:clamp(y,0,r[1]+r[3]-.025);next=[left,top,(cx?clamp(x,r[0]+.025,1):r[0]+r[2])-left,(cy?clamp(y,r[1]+.025,1):r[1]+r[3])-top];}
  else next=[clamp(r[0]+dx,0,1-r[2]),clamp(r[1]+dy,0,1-r[3]),r[2],r[3]];
  state.settings[rectKey()]=next;updateNumbers();dirty();paint();
});
for(const event of ["pointerup","pointercancel","lostpointercapture"])canvas.addEventListener(event,()=>drag=null);
canvas.addEventListener("keydown",e=>{if(e.key===" "){e.preventDefault();togglePlay();return;}if(!state.settings)return;const moves={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[1,-1],ArrowDown:[1,1]},m=moves[e.key];if(!m)return;e.preventDefault();updateRect(m[0],state.settings[rectKey()][m[0]]+m[1]*(e.shiftKey?.02:.002));updateNumbers();dirty();paint();});
function lockEdit(locked){
  state.rendering=locked;$("save").disabled=locked;$("properties").inert=locked;$("trimPanel").inert=locked;$("layerList").inert=locked;$("clipPicker").disabled=locked;
}
async function save(){
  if(!state.clip||state.rendering||state.trimming)return;
  const clip=state.clip,base=state.base;
  const words=state.words.filter(w=>w.w.trim()).map(({w,s,e})=>({w,s,e}));
  if(!validCaptionTimes(words,clip)){
    notify("Adjust caption times so every word fits inside the clip and ends before the next one.");return;
  }
  lockEdit(true);$("saveState").textContent="Rendering…";
  try{
    await post(base+"/render",{start:clip.start,end:clip.end,layout:"webcam",style:state.style,composition:state.settings,caption_track:words,title:state.title,expected_version:clip.version});
    for(let i=0;i<660;i++){
      await new Promise(r=>setTimeout(r,1000));
      const job=await request("/api/jobs/"+state.job.id),next=job.clips.find(c=>c.id===clip.id);
      if(!next)throw Error("This clip was removed.");
      if(next?.status==="error")throw Error(next.error);
      if(next?.status==="done"&&next.version>clip.version){
        state.saved=editableClip(next);state.clip={...state.saved};state.job=job;state.dirty=false;updateTimingControls();
        $("trimStatus").textContent="";$("saveState").textContent="Saved · v"+next.version;
        $("download").href="/media/"+job.id+"/"+encodeURIComponent(next.file)+"?download=1&v="+next.version;
        notify("Saved. The new MP4 is ready.");await refresh();return;
      }
    }
    throw Error("Rendering is taking longer than expected. Check the media pool.");
  }catch(err){notify(err.message);$("saveState").textContent="Check render status";}finally{lockEdit(false);}
}
function selectEntry(id){
  const item=entries().find(o=>o.job.id+"/"+o.clip.id===id);if(!item)return;
  if(state.dirty&&!confirm("Discard unsaved edits to switch clips?"))return;
  history.replaceState(null,"","/app?job="+encodeURIComponent(item.job.id)+"&clip="+encodeURIComponent(item.clip.id));setPage();openClip(item.job,item.clip);
}
async function refresh(){
  try{state.jobs=await request("/api/jobs");$("serviceError").hidden=true;mediaPool();}
  catch(err){$("serviceError").querySelector("span").textContent="Could not load your library. Check that Endrox is running."; $("serviceError").hidden=false;return;}
  const items=entries();$("clipPicker").innerHTML=items.map(({job,clip})=>'<option value="'+escapeText(job.id+"/"+clip.id)+'">'+escapeText(clip.title||clip.id)+'</option>').join("");
  if(state.clip){$("clipPicker").value=state.job.id+"/"+state.clip.id;return;}
  const params=new URLSearchParams(location.search);
  const item=items.find(o=>o.job.id===params.get("job")&&o.clip.id===params.get("clip"))||items[0];
  if(item&&!mediaPage())await openClip(item.job,item.clip);
  else if(!item){canvas.hidden=true;$("empty").hidden=false;$("properties").textContent="Select a finished clip to edit its layers.";}
}
$("speed").onchange=()=>video.playbackRate=Number($("speed").value);
$("save").onclick=save;$("play").onclick=togglePlay;
$("scrub").oninput=e=>{if(state.clip)seek(state.clip.start+Number(e.target.value));};
$("guides").onclick=()=>{state.guides=!state.guides;$("guides").setAttribute("aria-pressed",state.guides);paint();};
$("clipPicker").onchange=e=>selectEntry(e.target.value);
$("cropButton").onclick=()=>chooseLayer(state.layer,true);
document.addEventListener("click",e=>{
  if(e.target.closest("[data-import]"))$("import").click();
  const l=e.target.closest("[data-layer]");if(l)chooseLayer(l.dataset.layer);
  const lane=e.target.closest("[data-lane]");if(lane&&state.clip){chooseLayer(lane.dataset.lane);const r=lane.getBoundingClientRect();seek(state.clip.start+(e.clientX-r.left)/r.width*(state.clip.end-state.clip.start));}
  const c=e.target.closest(".reel");if(c)selectEntry(c.dataset.job+"/"+c.dataset.clip);
});
$("search").oninput=mediaPool;
$("import").onclick = event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!state.rendering) $("importDialog").showModal();
};
$("emptyImport").onclick = () => $("import").click();
$("closeImport").onclick=()=>$("importDialog").close();
$("importForm").onsubmit=async e=>{
  e.preventDefault();const file=$("localFile").files[0],url=$("link").value.trim(),msg=$("importMessage");
  if(Boolean(file)===Boolean(url)){msg.textContent="Choose one file or enter one video link.";return;}
  const options={vocabulary:$("vocab").value,focus:$("focus").value,speech_language:$("language").value,caption_language:$("captionsLang").value,layout:$("layout").value,style:"violet",min_len:+$("minLength").value,max_len:+$("maxLength").value,max_clips:+$("clipCount").value};
  if(options.min_len>=options.max_len){msg.textContent="Maximum clip length must exceed the minimum.";return;}
  const button=e.submitter;button.disabled=true;msg.textContent="Preparing import…";let upload=null;
  try{
    if(file){upload=await post("/api/upload/start",{name:file.name,size:file.size,options});
      for(let i=0;i<upload.parts;i++){
        const part=file.slice(i*upload.part,(i+1)*upload.part);
        let last;
        for(let attempt=0;attempt<3;attempt++){try{await request("/api/upload/"+upload.id+"/"+i,{method:"PUT",body:part});last=null;break;}catch(err){last=err;}}
        if(last)throw last;msg.textContent="Uploading "+Math.round((i+1)/upload.parts*100)+"%";
      }
      await post("/api/upload/"+upload.id+"/finish",{});upload=null;
    }else await post("/api/jobs",{url,options,creator:selectedBroadcast?.url===url?selectedBroadcast.id:null});
    e.target.reset();$("importDialog").close();msg.textContent="";history.pushState(null,"","/app/media");setPage();await refresh();notify("Footage queued for clipping.");
  }catch(err){msg.textContent=err.message;if(upload)fetch("/api/upload/"+upload.id,{method:"DELETE"}).catch(()=>{});}
  finally{button.disabled=false;}
};
window.addEventListener("popstate",()=>{setPage();refresh().catch(e=>notify(e.message));});
$("retryService").onclick=()=>refresh().catch(e=>notify(e.message));
const entryUrl=new URL(location.href);
if(entryUrl.searchParams.get("import")==="1"){
  entryUrl.searchParams.delete("import");
  history.replaceState(null,"",entryUrl);
  $("importDialog").showModal();
}
setPage();chooseLayer("face");refresh().catch(err=>notify(err.message));
setInterval(()=>{if(!document.hidden&&!state.rendering)refresh().catch(()=>{});},6000);

function subtitleSeconds(value){
  const m=value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if(!m)throw Error("Use SubRip times in hours, minutes, seconds and milliseconds.");
  return Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4].padEnd(3,"0"))/1000;
}
async function importSubtitles(file){
  if(!file)return;
  if(file.size>300000)throw Error("Choose subtitles for this clip only.");
  const blocks=(await file.text()).replace(/^\uFEFF/,"").replace(/\r/g,"").trim().split(/\n\s*\n/);
  const words=[];
  for(const block of blocks){
    const lines=block.split("\n");if(/^\d+$/.test(lines[0].trim()))lines.shift();
    const boundaries=(lines.shift()||"").split("-->");
    if(boundaries.length!==2)throw Error("The subtitle file contains an invalid cue.");
    const a=subtitleSeconds(boundaries[0]),b=subtitleSeconds(boundaries[1]);
    if(b<=a||b>state.clip.end-state.clip.start+.025||a+(state.clip.start)<(words.at(-1)?.e??0)-.001)throw Error("Use non-overlapping subtitles timed from the start of this clip.");
    const tokens=lines.join(" ").replace(/<[^>]*>/g,"").trim().split(/\s+/).filter(Boolean);
    for(const [i,text] of tokens.entries()){
      const s=round(state.clip.start+a+(b-a)*i/tokens.length),e=round(Math.min(state.clip.end,state.clip.start+a+(b-a)*(i+1)/tokens.length));
      if(e<=s||text.length>100)throw Error("Check the lengths and timing of the imported words.");
      words.push({w:text,s,e});
    }
  }
  if(!words.length||words.length>1600)throw Error("Choose an SRT with up to 1,600 words.");
  state.bank=state.bank.filter(w=>w.e<=state.clip.start||w.s>=state.clip.end).concat(words);
  state.words=sanitizeWords(state.bank,state.clip);dirty();properties();drawTracks();paint();notify("Imported subtitles. Review their timing, then save.");
}
function downloadSrt(){
  const stamp=t=>new Date(Math.round(Math.max(0,t)*1000)).toISOString().slice(11,23).replace(".",",");
  const s=state.settings,clip=state.clip;
  const rows=groups().map(g=>({a:clamp(g[0].s+s.shift,clip.start,clip.end),b:clamp(g.at(-1).e+s.shift,clip.start,clip.end),text:g.map(w=>w.w).join(" ")})).filter(r=>r.b>r.a);
  const text=rows.map((r,i)=>(i+1)+"\n"+stamp(r.a-clip.start)+" --> "+stamp(r.b-clip.start)+"\n"+r.text).join("\n\n");
  const url=URL.createObjectURL(new Blob([text+"\n"],{type:"application/x-subrip"}));
  const link=document.createElement("a");link.href=url;link.download=(state.title||"captions")+".srt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("properties").addEventListener("change",e=>{if(e.target.id==="subtitleFile")importSubtitles(e.target.files[0]).catch(err=>notify(err.message));});
$("properties").addEventListener("click",e=>{if(e.target.id==="exportSrt")downloadSrt();});

let channelRequest = 0;
let channelRows = [];
let selectedBroadcast = null;
async function showBroadcasts(){
  const id = $("channelChoice").value, version = ++channelRequest;
  $("broadcasts").replaceChildren();
  $("channelStatus").textContent = id ? "Loading recent videos and streams…" : "";
  if(!id)return;
  const creator=channelRows.find(row=>row.id===id);
  const liveProfile=Object.values(creator?.profiles||{}).find(profile=>profile.live);
  if(liveProfile){
    const button=document.createElement("button");
    button.textContent="Live now · Recording controls";
    button.onclick=()=>location.assign("/app/creators/"+encodeURIComponent(id));
    $("broadcasts").append(button);
  }
  try{
    const rows = await request("/api/creators/"+encodeURIComponent(id)+"/catalog");
    if(version!==channelRequest)return;
    $("channelStatus").textContent = rows.length ? "Select a video or past stream" : "No public recordings found. You can still import footage.";
    for(const row of rows){
      const button = document.createElement("button");
      button.textContent = row.title;
      button.onclick = ()=>{
        $("importForm").reset();
        selectedBroadcast = {id,url:row.url};
        $("link").value = row.url;
        $("importForm").querySelector("details").open = true;
        $("importDialog").showModal();
      };
      $("broadcasts").append(button);
    }
  }catch(err){if(version===channelRequest)$("channelStatus").textContent=err.message;}
}
async function loadChannels(selected){
  const rows = await request("/api/creators");
  channelRows = rows;
  const choice = $("channelChoice");
  choice.replaceChildren(new Option("Choose a channel",""));
  for(const row of rows.filter(row=>row.channel))choice.add(new Option(row.name,row.id));
  choice.value = selected || choice.options[1]?.value || "";
  await showBroadcasts();
}
$("channelChoice").onchange=showBroadcasts;
$("addChannel").onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter;
  button.disabled=true;
  try{
    const raw=$("channelUrl").value.trim();
    const url=new URL(raw.includes("://")?raw:"https://"+raw);
    const name=decodeURIComponent(url.pathname.split("/").filter(Boolean).pop()||url.hostname);
    const channel=await post("/api/creators",{name,channel:url.href});
    $("channelUrl").value="";
    await loadChannels(channel.id);
  }catch(err){$("channelStatus").textContent=err.message;}
  finally{button.disabled=false;}
};
$("importDialog").addEventListener("close",()=>{selectedBroadcast=null;});
if(mediaPage())loadChannels().catch(err=>{$("channelStatus").textContent=err.message;});
