/* Detects unbalanced canvas save()/restore() calls, which corrupt state. */
const fs=require('fs'), path=require('path');
const {createCanvas}=require('@napi-rs/canvas');
const {JSDOM}=require('jsdom');
const root='/home/user/tanvir2450';
const files=['js/data.js','js/audio.js','js/art.js','js/fx.js','js/fighter.js','js/ai.js','js/battle.js','js/ui.js','js/game.js'];
const W=1280,H=720;
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,''),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://e.test/'});
const {window}=dom;
let depth=0, minDepth=0, maxDepth=0, log=[]; const saveSites=[];
const backing=new Map();
window.HTMLCanvasElement.prototype.getContext=function(kind){
  if(kind!=='2d') return null;
  if(!backing.has(this)){
    const c=createCanvas(W,H);
    const raw=c.getContext('2d');
    const proxy=new Proxy(raw,{
      get(t,k){
        if(k==='save') return function(...a){ depth++; saveSites.push((new Error().stack||'').split('\n').slice(2,4).join(' <- ')); return t.save(...a); };
        if(k==='restore') return function(...a){ depth--; if(depth<0){ log.push('EXTRA restore at:\n  '+'\n'+(new Error().stack||'')); depth=0; } else saveSites.pop(); return t.restore(...a); };
        const v=t[k]; return typeof v==='function'? v.bind(t): v;
      },
      set(t,k,v){ t[k]=v; return true; },
    });
    backing.set(this,{canvas:c,ctx:proxy});
  }
  return backing.get(this).ctx;
};
class P{constructor(){this.value=0}setValueAtTime(){}linearRampToValueAtTime(){}exponentialRampToValueAtTime(){}cancelScheduledValues(){}}
class N{constructor(){this.gain=new P();this.frequency=new P();this.detune=new P();this.Q=new P();this.pan=new P()}connect(){}disconnect(){}start(){}stop(){}}
window.AudioContext=class{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='running';this.destination=new N()}resume(){}createGain(){return new N()}createOscillator(){return new N()}createBiquadFilter(){return new N()}createBufferSource(){return new N()}createStereoPanner(){return new N()}createBuffer(c,l){return{getChannelData:()=>new Float32Array(l)}}};
const raf=[]; window.requestAnimationFrame=cb=>{raf.push(cb);return raf.length};
window.devicePixelRatio=1;
Object.defineProperty(window,'innerWidth',{value:W,writable:true});
Object.defineProperty(window,'innerHeight',{value:H,writable:true});
for(const f of files) window.eval(fs.readFileSync(path.join(root,f),'utf8'));
window.dispatchEvent(new window.Event('load'));
const GAME=window.GAME;
let t=0; const frame=n=>{for(let i=0;i<n;i++){t+=16.7;raf.splice(0,raf.length).forEach(cb=>cb(t));}};
GAME.selectedChar='luffy';
GAME.startBattle(0,10);
const w=GAME.world;
// force hit flashes and specials so every draw path runs
for(let i=0;i<600;i++){
  w.player.hurtFlash = i%20<3 ? 0.2 : 0;
  if(w.boss) w.boss.hurtFlash = i%13<3 ? 0.2 : 0;
  if(i%120===0){ w.player.mana=999; w.playerSpecial(i%4); }
  if(i%90===0) w.playerAttack();
  frame(1);
  if(depth!==0) log.push('depth '+depth+' after frame '+i);
  if(log.length>6) break;
}
console.log('final depth', depth);
console.log(log.slice(0,2).join('\n---\n') || 'balanced');
process.exit(0);
